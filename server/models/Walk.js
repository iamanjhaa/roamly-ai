const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema({ id: String, name: String, lat: Number, lng: Number, description: String, characteristics: [String] }, { _id: false });
const destinationSchema = new mongoose.Schema({
  id: String, name: String, lat: Number, lng: Number, description: String, characteristics: [String],
  category: String, distance: Number, walkingDuration: Number, popularityScore: Number,
  moodFitScore: Number, publicAccess: Boolean, isRecommended: Boolean,
}, { _id: false });
const routeSchema = new mongoose.Schema({
  id: String, title: String, duration: Number, distance: Number, difficulty: String,
  greenery: String, crowd: String, startPoint: pointSchema, destination: destinationSchema,
  primaryDestination: destinationSchema, destinations: [destinationSchema],
  checkpoints: [pointSchema], aiReasoning: String, destinationAddress: String,
  experience: {
    experienceTitle: String,
    recommendedPlaceType: String,
    reason: String,
    experienceGoal: String,
    preferredCharacteristics: [String],
  },
  geometry: [[Number]], steps: [mongoose.Schema.Types.Mixed],
}, { _id: false });
const missionSchema = new mongoose.Schema({
  id: String, number: Number, order: Number, title: String, description: String,
  instruction: String, description: String, type: String, durationMinutes: Number,
  estimatedDuration: Number, duration: Number, completed: { type: Boolean, default: false }, phoneAway: Boolean,
}, { _id: false });
const locationSchema = new mongoose.Schema({
  latitude: Number, longitude: Number, accuracy: Number, speed: Number, heading: Number, timestamp: Number,
}, { _id: false });

const walkSchema = new mongoose.Schema({
  userId: { type: String, default: 'local-user' },
  mood: String, customMood: String, availableTime: Number, distance: Number,
  difficulty: String, environment: String, crowdPreference: String, preferences: mongoose.Schema.Types.Mixed,
  route: routeSchema, missions: [missionSchema], status: { type: String, default: 'created' },
  startedAt: Date, completedAt: Date, trackingStartedAt: Date, trackingEndedAt: Date,
  currentLocation: locationSchema, distanceTravelled: { type: Number, default: 0 }, activeDurationSeconds: Number,
  locationSamples: { type: [locationSchema], default: [] }, gpsStatus: String,
}, { timestamps: true });

module.exports = mongoose.model('Walk', walkSchema);
