const express = require('express');
const cors = require('cors');
const Walk = require('./models/Walk');
const Discovery = require('./models/Discovery');
const Reflection = require('./models/Reflection');
const mongoose = require('mongoose');
const { generatePersonalizedRoute, generateMissions } = require('./services/routeService');
const { analyzeDiscovery, generateMission, generateWalkSummary, getAIHealthStatus } = require('./services/aiService');
const { prepareDiscoveryImage } = require('./services/imageService');

const app = express();
app.disable('x-powered-by');
const allowedOrigins = [...new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://192.168.29.147:3000',
  process.env.CLIENT_URL,
].filter(Boolean))];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '18mb' }));

const success = (res, data, status = 200) => res.status(status).json({ success: true, data });
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validObjectId = (value) => mongoose.isValidObjectId(value);

app.get('/api/health', (_req, res) => res.status(200).json({ ok: true, status: 'healthy' }));

app.get('/api/diagnostics', async (_req, res) => {
  const mongoReadyState = mongoose.connection.readyState;
  const mongoStatus = mongoReadyState === 1 ? 'connected' : mongoReadyState === 2 ? 'connecting' : 'disconnected';

  let ollamaStatus;
  try {
    ollamaStatus = await getAIHealthStatus();
  } catch (error) {
    ollamaStatus = {
      provider: 'ollama',
      model: process.env.OLLAMA_MODEL || 'gemma3:4b',
      status: 'unavailable',
      modelAvailable: false,
      reason: error?.message || 'unknown error',
    };
  }

  const isHealthy = mongoStatus === 'connected' && ollamaStatus?.status === 'healthy';
  res.status(200).json({
    ok: isHealthy,
    status: isHealthy ? 'healthy' : 'degraded',
    services: {
      mongodb: {
        status: mongoStatus,
        readyState: mongoReadyState,
      },
      ollama: ollamaStatus,
    },
  });
});

app.post('/api/walks', asyncRoute(async (req, res) => {
  const startedAt = Date.now();
  console.info('[WALK] create request received');
  const { preferences, location } = req.body;
  if (!preferences || !location) return res.status(400).json({ success: false, code: 'LOCATION_REQUIRED', message: 'Walk preferences and location are required.' });
  try {
    console.info('[WALK] location validated');
    const route = await generatePersonalizedRoute(preferences, location);
    const missionContext = {
      preferences: {
        mood: preferences.mood,
        customMood: preferences.customMood,
        duration: preferences.duration,
        distance: preferences.distance,
        difficulty: preferences.difficulty,
        environment: preferences.environment,
        crowdLevel: preferences.crowdLevel,
      },
      route: {
        title: route.title,
        duration: route.duration,
        distance: route.distance,
        difficulty: route.difficulty,
        greenery: route.greenery,
        crowd: route.crowd,
      },
    };
    const saveStartedAt = Date.now();
    console.info('[PERF] Mongo save start');
    console.info('[DB] walk save started');
    const walk = await Walk.create({
      mood: preferences.mood, customMood: preferences.customMood,
      availableTime: preferences.duration, distance: preferences.distance,
      difficulty: preferences.difficulty, environment: preferences.environment,
      crowdPreference: preferences.crowdLevel, preferences, route, missions: [],
    });
    console.info(`[PERF] Mongo save completed: ${Date.now() - saveStartedAt}ms`);
    console.info('[DB] walk saved');
    console.info(`[PERF] TOTAL walk creation: ${Date.now() - startedAt}ms`);
    void generateMissions(missionContext)
      .then((missions) => Walk.findByIdAndUpdate(walk._id, { missions }))
      .then(() => console.info('[AI] mission completed in background'))
      .catch((error) => console.error(`[AI] background mission generation failed: ${error.message}`));
    console.info('[WALK] create completed');
    return success(res, walk, 201);
  } catch (error) {
    console.error(`[WALK] FAILED at ${error.message}`);
    throw error;
  }
}));

app.get('/api/walks', asyncRoute(async (_req, res) => success(res, await Walk.find().sort({ createdAt: -1 }))));
app.get('/api/walks/:id', asyncRoute(async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid walk ID.' });
  const walk = await Walk.findById(req.params.id);
  if (!walk) return res.status(404).json({ success: false, message: 'Walk not found' });
  return success(res, walk);
}));
app.post('/api/walks/:id/start', asyncRoute(async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid walk ID.' });
  const walk = await Walk.findByIdAndUpdate(req.params.id, { status: 'started', startedAt: new Date(), trackingStartedAt: new Date(), gpsStatus: 'starting' }, { new: true });
  if (!walk) return res.status(404).json({ success: false, message: 'Walk not found' });
  return success(res, walk);
}));
app.post('/api/walks/:id/location', asyncRoute(async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid walk ID.' });
  const { latitude, longitude, accuracy, speed, heading, timestamp } = req.body;
  if (![latitude, longitude, accuracy, timestamp].every(Number.isFinite)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    || accuracy < 0 || (speed !== null && speed !== undefined && !Number.isFinite(speed))
    || (heading !== null && heading !== undefined && (!Number.isFinite(heading) || heading < 0 || heading > 360))) {
    return res.status(400).json({ success: false, code: 'INVALID_COORDINATES', message: 'Invalid location data.' });
  }
  const walk = await Walk.findById(req.params.id);
  if (!walk) return res.status(404).json({ success: false, message: 'Walk not found' });
  const previous = walk.currentLocation;
  const toRadians = (value) => value * Math.PI / 180;
  const distance = previous
    ? 6371000 * 2 * Math.asin(Math.sqrt(
      Math.sin((toRadians(latitude - previous.latitude)) / 2) ** 2
      + Math.cos(toRadians(previous.latitude)) * Math.cos(toRadians(latitude))
      * Math.sin((toRadians(longitude - previous.longitude)) / 2) ** 2,
    ))
    : 0;
  walk.currentLocation = { latitude, longitude, accuracy, speed: speed ?? null, heading: heading ?? null, timestamp };
  walk.distanceTravelled = (walk.distanceTravelled || 0) + distance / 1000;
  walk.gpsStatus = 'active';
  walk.locationSamples = [...(walk.locationSamples || []).slice(-299), walk.currentLocation];
  await walk.save();
  return success(res, walk);
}));
app.post('/api/walks/:id/reroute', asyncRoute(async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid walk ID.' });
  const { latitude, longitude } = req.body;
  if (![latitude, longitude].every(Number.isFinite) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ success: false, code: 'INVALID_COORDINATES', message: 'Invalid location data.' });
  }
  const walk = await Walk.findById(req.params.id);
  if (!walk) return res.status(404).json({ success: false, message: 'Walk not found' });
  walk.route = await generatePersonalizedRoute(walk.preferences, { latitude, longitude });
  await walk.save();
  return success(res, walk);
}));
app.post('/api/walks/:id/complete', asyncRoute(async (req, res) => {
  if (!validObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid walk ID.' });
  const { distanceTravelled, activeDurationSeconds } = req.body;
  if ((distanceTravelled !== undefined && (!Number.isFinite(distanceTravelled) || distanceTravelled < 0))
    || (activeDurationSeconds !== undefined && (!Number.isFinite(activeDurationSeconds) || activeDurationSeconds < 0))) {
    return res.status(400).json({ success: false, message: 'Invalid walk summary.' });
  }
  const summary = {};
  if (distanceTravelled !== undefined) summary.distanceTravelled = distanceTravelled;
  if (activeDurationSeconds !== undefined) summary.activeDurationSeconds = activeDurationSeconds;
  const walk = await Walk.findByIdAndUpdate(req.params.id, {
    ...summary, status: 'completed', completedAt: new Date(), trackingEndedAt: new Date(),
  }, { new: true });
  if (!walk) return res.status(404).json({ success: false, message: 'Walk not found' });
  return success(res, walk);
}));

app.get('/api/walks/:walkId/missions', asyncRoute(async (req, res) => {
  if (!validObjectId(req.params.walkId)) return res.status(400).json({ success: false, message: 'Invalid walk ID.' });
  const walk = await Walk.findById(req.params.walkId).select('missions');
  if (!walk) return res.status(404).json({ success: false, message: 'Walk not found' });
  return success(res, walk.missions);
}));
app.post('/api/missions/:missionId/complete', asyncRoute(async (req, res) => {
  const walk = await Walk.findOneAndUpdate(
    { missions: { $elemMatch: { id: req.params.missionId, completed: false } } },
    { $set: { 'missions.$.completed': true } },
    { new: true },
  );
  if (!walk) return res.status(404).json({ success: false, message: 'Mission not found' });
  return success(res, walk.missions.find((mission) => mission.id === req.params.missionId));
}));

app.post('/api/discoveries/analyze', asyncRoute(async (req, res) => {
  const image = await prepareDiscoveryImage(req.body?.image);
  return success(res, await analyzeDiscovery(image));
}));

app.post('/api/walks/:walkId/discoveries', asyncRoute(async (req, res) => {
  if (!validObjectId(req.params.walkId)) return res.status(400).json({ success: false, message: 'Invalid walk ID.' });
  const image = await prepareDiscoveryImage(req.body?.image);
  const walk = await Walk.findById(req.params.walkId);
  if (!walk) return res.status(404).json({ success: false, message: 'Walk not found' });
  if (req.body.missionId && await Discovery.exists({ walkId: walk._id, missionId: req.body.missionId })) {
    return res.status(409).json({ success: false, message: 'This mission already has a discovery.' });
  }
  const currentMission = walk.missions.find((mission) => mission.id === req.body.missionId);
  const analysis = await analyzeDiscovery(image);
  const savedDiscovery = await Discovery.create({
    walkId: walk._id,
    missionId: req.body.missionId,
    image,
    ...analysis,
  });
  const nextMission = walk.missions.find((mission) => mission.order === (currentMission?.order || 0) + 1);
  if (nextMission) {
    const mission = await generateMission({
      preferences: walk.preferences,
      route: walk.route,
      discovery: analysis,
      completedMissions: walk.missions.filter((item) => item.completed),
      missionNumber: nextMission.order,
    });
    await Walk.updateOne(
      { _id: walk._id, 'missions.id': nextMission.id },
      {
        $set: {
          'missions.$.title': mission.title,
          'missions.$.instruction': mission.instruction,
          'missions.$.description': mission.description,
          'missions.$.type': mission.type,
          'missions.$.durationMinutes': mission.durationMinutes,
          'missions.$.duration': mission.durationMinutes,
          'missions.$.estimatedDuration': mission.estimatedDuration,
          'missions.$.phoneAway': mission.phoneAway,
        },
      },
    );
    savedDiscovery.nextMission = {
      type: mission.type,
      instruction: mission.instruction,
    };
    await savedDiscovery.save();
  }
  return success(res, savedDiscovery, 201);
}));
app.get('/api/walks/:walkId/discoveries', asyncRoute(async (req, res) => {
  if (!validObjectId(req.params.walkId)) return res.status(400).json({ success: false, message: 'Invalid walk ID.' });
  return success(res, await Discovery.find({ walkId: req.params.walkId }).sort({ createdAt: 1 }));
}));

app.post('/api/walks/:walkId/reflection', asyncRoute(async (req, res) => {
  if (!validObjectId(req.params.walkId)) return res.status(400).json({ success: false, message: 'Invalid walk ID.' });
  const walk = await Walk.findById(req.params.walkId);
  if (!walk) return res.status(404).json({ success: false, message: 'Walk not found' });
  if (await Reflection.exists({ walkId: walk._id })) {
    return res.status(409).json({ success: false, message: 'This walk already has a reflection.' });
  }
  const savedReflection = await Reflection.create({ walkId: walk._id, ...req.body });
  const discoveries = await Discovery.find({ walkId: walk._id }).select('name title description');
  const completedMissions = walk.missions.filter((mission) => mission.completed);
  const summary = await generateWalkSummary({
    mood: walk.mood,
    duration: walk.availableTime,
    distance: walk.distance,
    completedMissions,
    discoveries,
    reflection: req.body,
  });
  return success(res, { reflection: savedReflection, summary }, 201);
}));

app.get('/api/profile/stats', asyncRoute(async (_req, res) => {
  const [walks, discoveries] = await Promise.all([Walk.find({ status: 'completed' }), Discovery.countDocuments()]);
  const totalMinutesOutside = walks.reduce((total, walk) => total + (walk.availableTime || 0), 0);
  const totalDistance = walks.reduce((total, walk) => total + (walk.distanceTravelled || walk.distance || 0), 0);
  const missionsCompleted = walks.reduce(
    (total, walk) => total + walk.missions.filter((mission) => mission.completed).length,
    0,
  );
  return success(res, {
    totalWalks: walks.length,
    totalMinutesOutside,
    totalDistance,
    totalDiscoveries: discoveries,
    missionsCompleted,
    averageScore: 0,
    streakDays: 0,
  });
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  const isInvalidJson = error.type === 'entity.parse.failed';
  const isDatabaseError = error.name?.startsWith('Mongo') || error.name?.startsWith('Mongoose');
  const statusCode = error.statusCode || error.status || (isInvalidJson ? 400 : isDatabaseError ? 503 : 500);
  const errorCode = typeof error.code === 'string' ? error.code : undefined;
  const code = errorCode
    ? errorCode
    : isInvalidJson
      ? 'INVALID_JSON'
      : isDatabaseError
        ? 'DATABASE_UNAVAILABLE'
        : statusCode >= 500
          ? 'INTERNAL_SERVER_ERROR'
          : 'REQUEST_ERROR';
  const message = isInvalidJson
    ? 'Request body must be valid JSON.'
    : isDatabaseError
      ? 'MongoDB is unavailable. Check the local database service and try again.'
      : statusCode >= 500 && !errorCode
        ? 'Roamly could not complete the request. Please try again.'
        : error.message || 'Something went wrong.';
  res.status(statusCode).json({
    success: false,
    code,
    message,
  });
});

module.exports = app;
