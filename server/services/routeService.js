const { generateText, generateMissions: generateMissionsWithGemma } = require('./aiService');

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
const OSRM_TIMEOUT_MS = 10000;
const PLACE_PROVIDER_URL = process.env.PLACE_PROVIDER_URL;
const NOMINATIM_BASE_URL = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org/search';
const OVERPASS_BASE_URL = process.env.OVERPASS_BASE_URL || 'https://overpass-api.de/api/interpreter';
const OVERPASS_FALLBACK_URL = process.env.OVERPASS_FALLBACK_URL || 'https://overpass.private.coffee/api/interpreter';
const OVERPASS_SECONDARY_URL = process.env.OVERPASS_SECONDARY_URL || 'https://overpass.kumi.systems/api/interpreter';
const PLACE_SEARCH_DEADLINE_MS = 8000;
const PLACE_PROVIDER_TIMEOUT_MS = 2200;
const OLLAMA_KEEP_ALIVE = '10m';
const PUBLIC_PLACE_CATEGORIES = new Set([
  'park', 'garden', 'playground', 'recreation_ground', 'pitch', 'plaza',
  'pedestrian', 'viewpoint', 'nature_reserve', 'water', 'riverbank',
  'track',
]);
const INSTITUTIONAL_PATTERN = /\b(?:iit|university|college|institute|institution|department|faculty|laboratory|lab|research|campus|hostel|office|government office|school|hospital|police|industrial|company|corporate|training centre|training center|academic|administrative|engineering|hydrology|science|military|cantonment)\b/i;
const GENERIC_PRIVATE_PLACE_PATTERN = /\b(?:lawn|garden|ground|green|field|recreation|pitch|track)\b/i;
const PUBLIC_IDENTITY_PATTERN = /\b(?:public|municipal|city|central|nagar|palika|playground|ghat|promenade|walking track|riverfront|riverside|viewpoint|picnic)\b/i;
const RESTRICTED_ACCESS = new Set(['private', 'no', 'customers', 'members', 'permit', 'permissive']);
const institutionalContextCache = new Map();

async function generateExperience(preferences, destination) {
  const startedAt = Date.now();
  console.info('[PERF] Gemma experience start');
  console.info('[AI] experience started');
  const result = await generateText(
    `Choose a safe outdoor walking experience from this context: ${JSON.stringify({ ...preferences, destination })}. `
      + 'Return JSON only: experienceTitle, recommendedPlaceType, reason, experienceGoal, '
      + 'preferredCharacteristics (array of short strings). Use the user text and all preferences. '
      + 'recommendedPlaceType must describe an experience characteristic or public outdoor place type, '
      + 'never a named destination. Prefer public parks, gardens, playgrounds, recreation grounds, '
      + 'riverside areas, promenades, walking tracks, viewpoints, or public nature areas. '
      + 'Do not invent places, coordinates, distances, or medical benefits.',
    {
      format: {
        type: 'object',
        properties: {
          experienceTitle: { type: 'string' },
          recommendedPlaceType: { type: 'string' },
          reason: { type: 'string' },
          experienceGoal: { type: 'string' },
          preferredCharacteristics: { type: 'array', items: { type: 'string' } },
        },
        required: ['experienceTitle', 'recommendedPlaceType', 'reason', 'experienceGoal', 'preferredCharacteristics'],
      },
      options: { num_predict: 160, temperature: 0 },
      keep_alive: OLLAMA_KEEP_ALIVE,
    },
  );
  try {
    const experience = JSON.parse(result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
    if (
      typeof experience.experienceTitle !== 'string'
      || typeof experience.recommendedPlaceType !== 'string'
      || typeof experience.reason !== 'string'
      || typeof experience.experienceGoal !== 'string'
      || !Array.isArray(experience.preferredCharacteristics)
      || experience.preferredCharacteristics.some((item) => typeof item !== 'string')
    ) throw new Error('Invalid experience shape');
    console.info(`[PERF] Gemma experience completed: ${Date.now() - startedAt}ms`);
    console.info('[AI] experience completed');
    return experience;
  } catch (cause) {
    const error = new Error('Gemma returned an invalid route experience.', { cause });
    error.statusCode = 503;
    throw error;
  }
}

function placeCategories(preferences, recommendedPlaceType) {
  const environment = preferences.environment === 'urban'
    ? ['park', 'garden', 'playground', 'recreation_ground', 'plaza', 'pedestrian', 'track']
    : preferences.environment === 'scenic'
    ? ['viewpoint', 'park', 'garden', 'water', 'riverbank', 'pedestrian']
      : preferences.environment === 'quiet'
      ? ['park', 'garden', 'playground', 'recreation_ground', 'nature_reserve', 'water', 'riverbank', 'track']
      : ['park', 'garden', 'playground', 'recreation_ground', 'nature_reserve', 'water', 'riverbank', 'viewpoint', 'track'];
  const knownTypes = [...PUBLIC_PLACE_CATEGORIES, 'forest'];
  const recommended = String(recommendedPlaceType || '').toLowerCase().replace(/[^a-z_]/g, '');
  return [...new Set([...environment, ...(knownTypes.includes(recommended) ? [recommended] : [])])];
}

function placeQuery(preferences, location, radius, recommendedPlaceType) {
  const categories = placeCategories(preferences, recommendedPlaceType);
  const values = categories.join('|');
  const selectors = [
    `nwr(around:${radius},${location.latitude},${location.longitude})["leisure"~"^(${values})$"];`,
    `nwr(around:${radius},${location.latitude},${location.longitude})["tourism"~"^(${values})$"];`,
    `nwr(around:${radius},${location.latitude},${location.longitude})["natural"~"^(${values})$"];`,
    `nwr(around:${radius},${location.latitude},${location.longitude})["waterway"="riverbank"];`,
    `nwr(around:${radius},${location.latitude},${location.longitude})["highway"="pedestrian"];`,
  ].join('');
  return `[out:json][timeout:2];(${selectors});out center tags;`;
}

function providerUrls() {
  return [
    { kind: 'nominatim', url: NOMINATIM_BASE_URL },
    ...[PLACE_PROVIDER_URL, OVERPASS_BASE_URL, OVERPASS_FALLBACK_URL, OVERPASS_SECONDARY_URL]
      .filter(Boolean).map((url) => ({ kind: 'overpass', url })),
  ].filter((provider, index, providers) => providers.findIndex((item) => item.url === provider.url) === index);
}

async function fetchPlacePayload(endpoint, query, remainingMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(PLACE_PROVIDER_TIMEOUT_MS, remainingMs));
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Roamly/1.0 outdoor-experience-planner' },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.elements)) throw new Error(`HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOverpassCandidates(payload) {
  return (payload?.elements || []).map((element) => {
    const latitude = Number(element.lat ?? element.center?.lat);
    const longitude = Number(element.lon ?? element.center?.lon);
    const tags = element.tags || {};
    const name = tags.name || tags['name:en'];
    const category = tags.leisure || tags.tourism || tags.natural || tags.waterway || tags.highway || tags.landuse;
    return {
      id: `${element.type}-${element.id}`,
      name,
      address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || undefined,
      latitude,
      longitude,
      category,
      characteristics: [category, tags.surface, tags.access, tags.public_access].filter(Boolean),
      tags,
    };
  }).filter((place) => typeof place.name === 'string' && place.name.trim()
    && Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
}

function normalizeNominatimCandidates(payload) {
  const supportedTypes = new Set([
    'park', 'garden', 'playground', 'nature_reserve', 'recreation_ground',
    'pitch', 'sports_centre', 'viewpoint', 'pedestrian', 'track', 'grass',
  ]);
  return (payload || []).map((place) => {
    const category = place.type === 'recreation_ground' ? 'recreation_ground' : place.type;
    return {
      id: `nominatim-${place.place_id}`,
      name: place.name || place.display_name?.split(',')[0],
      address: place.display_name,
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      category,
      characteristics: [category, place.class].filter(Boolean),
      tags: { type: category, class: place.class, access: place.extratags?.access },
    };
  }).filter((place) => supportedTypes.has(place.category)
    && typeof place.name === 'string' && place.name.trim()
    && Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
}

async function fetchNominatim(endpoint, preferences, location, radius, remainingMs, recommendedPlaceType) {
  const categories = placeCategories(preferences, recommendedPlaceType);
  const query = categories.includes('garden') ? 'garden' : categories.includes('park') ? 'park' : 'nature reserve';
  const latitudeDelta = radius / 111000;
  const longitudeDelta = radius / (111000 * Math.cos(location.latitude * Math.PI / 180));
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    viewbox: `${location.longitude - longitudeDelta},${location.latitude + latitudeDelta},${location.longitude + longitudeDelta},${location.latitude - latitudeDelta}`,
    bounded: '1',
    limit: '20',
    addressdetails: '1',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(PLACE_PROVIDER_TIMEOUT_MS, remainingMs));
  try {
    const response = await fetch(`${endpoint}?${params}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Roamly/1.0 contact=local' },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload)) throw new Error(`HTTP ${response.status}`);
    return normalizeNominatimCandidates(payload);
  } finally {
    clearTimeout(timeout);
  }
}

function rankPlaces(candidates, preferences, location, recommendedPlaceType) {
  const categories = placeCategories(preferences, recommendedPlaceType);
  const requestedDistance = Number(preferences.distance) || 2;
  const maxDistance = Math.max(requestedDistance * 1.75, requestedDistance + 0.75);
  const unique = deduplicatePlaces(candidates.filter(isPublicRecreationalPlace));
  return unique.map((place) => {
    const distance = Math.hypot(
      (place.latitude - location.latitude) * 111,
      (place.longitude - location.longitude) * 111 * Math.cos(location.latitude * Math.PI / 180),
    );
    const categoryScore = categories.includes(place.category) ? 25 : 0;
    const publicAccessScore = publicAccessScoreFor(place);
    const distanceScore = distance <= maxDistance
      ? 18 - Math.abs(distance - requestedDistance) * 7
      : -100;
    const environmentScore = preferences.environment === 'nature' && ['park', 'garden', 'nature_reserve', 'riverbank'].includes(place.category)
      ? 10
      : preferences.environment === 'urban' && ['plaza', 'pedestrian', 'playground'].includes(place.category)
        ? 8
        : 0;
    const popularityScore = calculatePopularityScore(place);
    const moodFitScore = categoryScore + environmentScore;
    return {
      ...place,
      distance,
      popularityScore,
      moodFitScore,
      score: publicAccessScore + distanceScore + categoryScore + environmentScore + popularityScore,
    };
  }).filter((place) => place.distance <= maxDistance).sort((a, b) => b.score - a.score).slice(0, 8);
}

function normalizePlaceName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function deduplicatePlaces(candidates) {
  const seenIds = new Set();
  const seenCoordinates = new Set();
  const seenNames = new Set();
  return candidates.filter((place) => {
    const coordinateKey = `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
    const nameKey = normalizePlaceName(place.name);
    if (seenIds.has(place.id) || seenCoordinates.has(coordinateKey) || seenNames.has(nameKey)) return false;
    seenIds.add(place.id);
    seenCoordinates.add(coordinateKey);
    seenNames.add(nameKey);
    return true;
  });
}

function calculatePopularityScore(place) {
  const tags = place.tags || {};
  let score = 0;
  if (tags.wikidata || tags.wikipedia) score += 8;
  if (tags.tourism || tags.official_name) score += 5;
  if (tags.leisure === 'park' || tags.leisure === 'playground' || tags.leisure === 'recreation_ground') score += 7;
  if (tags.name && tags.name !== place.name) score += 2;
  return score;
}

function publicAccessScoreFor(place) {
  const category = String(place.category || '').toLowerCase();
  const tags = place.tags || {};
  let score = PUBLIC_PLACE_CATEGORIES.has(category) ? 55 : 0;
  if (['park', 'garden', 'playground', 'recreation_ground', 'pitch', 'pedestrian', 'viewpoint'].includes(category)) score += 15;
  if (tags.leisure || tags.tourism || tags.highway === 'pedestrian' || tags.waterway === 'riverbank') score += 10;
  if (tags.access === 'yes' || tags.access === 'public' || tags.public_access === 'yes') score += 12;
  return score;
}

function hasInstitutionalAssociation(place) {
  const tags = place.tags || {};
  const associatedText = [
    place.name,
    place.category,
    tags.operator,
    tags.owner,
    tags['operator:type'],
    tags.amenity,
    tags.landuse,
    tags.building,
    tags.boundary,
    ...(place.context?.institutionalNames || []),
  ].filter(Boolean).join(' ');
  return INSTITUTIONAL_PATTERN.test(associatedText)
    || place.context?.institutionalNearby === true;
}

function hasStrongPublicEvidence(place) {
  const tags = place.tags || {};
  const access = String(tags.access || tags.public_access || '').toLowerCase();
  const operator = [tags.operator, tags.owner].filter(Boolean).join(' ');
  const publicTag = access === 'public' || access === 'yes'
    || /\b(?:municipal|city|public|nagar|palika|government)\b/i.test(operator);
  const publicName = PUBLIC_IDENTITY_PATTERN.test(place.name);
  const category = String(place.category || '').toLowerCase();
  const explicitPublicCategory = ['playground', 'pedestrian', 'viewpoint', 'riverbank'].includes(category)
    && (publicName || publicTag);
  const genericAmenity = GENERIC_PRIVATE_PLACE_PATTERN.test(place.name);
  const namedAmenityWithoutPublicOwner = genericAmenity
    && !publicName
    && !/\b(?:municipal|city|public|nagar|palika|government)\b/i.test(operator);
  return !namedAmenityWithoutPublicOwner && (publicTag || publicName || explicitPublicCategory);
}

function publicAccessScoreFor(place) {
  const category = String(place.category || '').toLowerCase();
  const tags = place.tags || {};
  let score = PUBLIC_PLACE_CATEGORIES.has(category) ? 55 : 0;
  if (['park', 'garden', 'playground', 'recreation_ground', 'pitch', 'pedestrian', 'viewpoint'].includes(category)) score += 15;
  if (tags.leisure || tags.tourism || tags.highway === 'pedestrian' || tags.waterway === 'riverbank') score += 10;
  if (tags.access === 'yes' || tags.access === 'public' || tags.public_access === 'yes') score += 12;
  if (hasStrongPublicEvidence(place)) score += 25;
  return score;
}

function isPublicRecreationalPlace(place) {
  if (!place || typeof place.name !== 'string') return false;
  if (!place.context || place.context.lookupFailed || place.context.checked !== true) return false;
  const tags = place.tags || {};
  if (RESTRICTED_ACCESS.has(String(tags.access || '').toLowerCase())
    || RESTRICTED_ACCESS.has(String(tags.public_access || '').toLowerCase())) return false;
  if (hasInstitutionalAssociation(place) || !hasStrongPublicEvidence(place)) return false;
  return PUBLIC_PLACE_CATEGORIES.has(String(place.category || '').toLowerCase())
    || Boolean(tags.leisure || tags.tourism || tags.highway === 'pedestrian' || tags.waterway === 'riverbank');
}

function contextQuery(candidates) {
  const selectors = candidates.slice(0, 8).map((place) => [
    `nwr(around:150,${place.latitude},${place.longitude})["amenity"~"^(university|college|school|hospital|police|research_institute)$"];`,
    `nwr(around:150,${place.latitude},${place.longitude})["landuse"="education"];`,
    `nwr(around:150,${place.latitude},${place.longitude})["boundary"="campus"];`,
    `nwr(around:150,${place.latitude},${place.longitude})["name"~"IIT|university|college|institute|campus|department|faculty|research|laboratory|school|hospital|police|military|cantonment",i];`,
  ].join('')).join('');
  return `[out:json][timeout:2];(${selectors});out center tags;`;
}

function contextFeatureCoordinates(feature) {
  return {
    latitude: Number(feature.lat ?? feature.center?.lat),
    longitude: Number(feature.lon ?? feature.center?.lon),
  };
}

function distanceBetweenPlaces(first, second) {
  return Math.hypot(
    (first.latitude - second.latitude) * 111000,
    (first.longitude - second.longitude) * 111000 * Math.cos(first.latitude * Math.PI / 180),
  );
}

async function enrichInstitutionalContext(candidates, endpoint, remainingMs) {
  const uncached = candidates.filter((place) => !institutionalContextCache.has(`${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`));
  const needsContext = uncached.filter((place) => GENERIC_PRIVATE_PLACE_PATTERN.test(place.name)
    || !hasStrongPublicEvidence(place));
  for (const place of uncached.filter((candidate) => !needsContext.includes(candidate))) {
    institutionalContextCache.set(`${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`, {
      institutionalNearby: false,
      institutionalNames: [],
      checked: true,
    });
  }
  if (needsContext.length && remainingMs > 150) {
    try {
      const payload = await fetchPlacePayload(endpoint, contextQuery(needsContext), remainingMs);
      for (const place of needsContext) {
        const nearbyFeatures = (payload.elements || []).filter((feature) => {
          const coordinates = contextFeatureCoordinates(feature);
          return Number.isFinite(coordinates.latitude)
            && Number.isFinite(coordinates.longitude)
            && distanceBetweenPlaces(place, coordinates) <= 120;
        });
        institutionalContextCache.set(`${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`, {
          institutionalNearby: nearbyFeatures.length > 0,
          institutionalNames: nearbyFeatures.map((feature) => feature.tags?.name).filter(Boolean),
          checked: true,
        });
      }
    } catch (error) {
      console.warn(`[PLACES] context lookup failed: ${error.message}`);
    }
  }
  return candidates.map((place) => ({
    ...place,
    context: institutionalContextCache.get(`${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`)
      || { lookupFailed: true },
  }));
}

async function findNearbyPlaces(preferences, location, recommendedPlaceType) {
  const startedAt = Date.now();
  const deadline = startedAt + PLACE_SEARCH_DEADLINE_MS;
  const initialRadius = Math.min(3200, Math.max(1200, (Number(preferences.distance) || 2) * 1200));
  const radii = [initialRadius, Math.min(5000, Math.round(initialRadius * 1.6))];
  let candidates = [];
  for (const radius of radii) {
    for (const provider of providerUrls()) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      try {
        const discovered = provider.kind === 'nominatim'
          ? await fetchNominatim(provider.url, preferences, location, radius, remainingMs, recommendedPlaceType)
          : normalizeOverpassCandidates(await fetchPlacePayload(
            provider.url,
            placeQuery(preferences, location, radius, recommendedPlaceType),
            remainingMs,
          ));
        const contextEndpoint = provider.kind === 'overpass' ? provider.url : OVERPASS_BASE_URL;
        const contextualCandidates = await enrichInstitutionalContext(discovered, contextEndpoint, remainingMs);
        candidates = deduplicatePlaces([
          ...candidates,
          ...contextualCandidates.filter(isPublicRecreationalPlace),
        ]);
      } catch (error) {
        console.warn(`[PLACES] ${provider.kind} failed: ${provider.url} (${error.name === 'AbortError' ? 'timeout' : error.message})`);
      }
    }
    if (candidates.length >= 8 || Date.now() >= deadline) break;
  }
  console.info(`[Roamly timing] Place search: ${Date.now() - startedAt}ms`);
  if (!candidates.length) {
    const error = new Error('No suitable public recreational destination is available within the requested walking range.');
    error.code = 'NO_PUBLIC_DESTINATION_AVAILABLE';
    error.statusCode = 503;
    throw error;
  }
  return candidates;
}

function buildDestinationExperience(experience, preferences, place, route) {
  const mood = (preferences.customMood?.trim() || `You chose the ${preferences.mood} mood`).replace(/[.!?]+$/, '');
  const environment = preferences.environment === 'doesnt-matter' ? 'an open outdoor setting' : `${preferences.environment}-oriented surroundings`;
  const crowd = preferences.crowdLevel === 'doesnt-matter' ? 'flexible crowd levels' : `${preferences.crowdLevel}-crowd setting`;
  const placeType = place.tags?.leisure || place.tags?.tourism || place.tags?.natural;
  const mappedFeature = placeType ? ` It is mapped as a ${placeType.replaceAll('_', ' ')}, which gives you a concrete outdoor setting to notice.` : '';
  const experienceCharacteristics = experience.preferredCharacteristics?.filter(Boolean).slice(0, 3).join(', ');
  const characteristicSentence = experienceCharacteristics
    ? ` This also matches the experience qualities Gemma selected: ${experienceCharacteristics}.`
    : '';
  return {
    ...experience,
    reason: `${mood}. ${place.name} fits the ${environment}, ${crowd}, and ${preferences.difficulty} walking experience you selected.${mappedFeature}${characteristicSentence} The ${route.distance} km route creates a dedicated ${preferences.duration}-minute change of surroundings for gentle movement and fresh air. Use the walk to notice the place's surroundings, slow your pace, and take a short break from your screen rather than treating it as another task to finish.`,
    experienceGoal: `Walk toward ${place.name} without rushing. Once there, spend a few quiet minutes noticing the outdoor surroundings, sounds, movement, and open space before returning to your routine.`,
  };
}

async function generatePersonalizedRoute(preferences, location) {
  if (
    !location
    || !Number.isFinite(Number(location.latitude))
    || !Number.isFinite(Number(location.longitude))
    || Number(location.latitude) < -90
    || Number(location.latitude) > 90
    || Number(location.longitude) < -180
    || Number(location.longitude) > 180
    || (Number(location.latitude) === 0 && Number(location.longitude) === 0)
  ) {
    const error = new Error('A valid location is required to build a walking route.');
    error.code = 'INVALID_COORDINATES';
    error.statusCode = 400;
    throw error;
  }

  const normalizedLocation = { latitude: Number(location.latitude), longitude: Number(location.longitude) };
  const gemmaStartedAt = Date.now();
  const experience = await generateExperience({
    mood: preferences.mood,
    userText: preferences.customMood || '',
    availableTime: preferences.duration,
    distance: preferences.distance,
    difficulty: preferences.difficulty,
    crowdLevel: preferences.crowdLevel,
    environment: preferences.environment,
    userLatitude: normalizedLocation.latitude,
    userLongitude: normalizedLocation.longitude,
  });
  console.info(`[Roamly timing] Gemma: ${Date.now() - gemmaStartedAt}ms`);
  const places = await findNearbyPlaces(preferences, normalizedLocation, experience.recommendedPlaceType);
  const rankingStartedAt = Date.now();
  const rankedPlaces = rankPlaces(places, preferences, normalizedLocation, experience.recommendedPlaceType);
  if (!rankedPlaces.length) {
    const error = new Error('No suitable public recreational destination is available within the requested walking range.');
    error.code = 'NO_PUBLIC_DESTINATION_AVAILABLE';
    error.statusCode = 503;
    throw error;
  }
  console.info(`[Roamly timing] Place ranking: ${Date.now() - rankingStartedAt}ms`);
  const routeStartedAt = Date.now();
  const selectedPlace = rankedPlaces[0];
  const routeUrl = `${OSRM_BASE_URL}/route/v1/foot/${normalizedLocation.longitude},${normalizedLocation.latitude};${selectedPlace.longitude},${selectedPlace.latitude}?overview=full&geometries=geojson&steps=true`;
  const routeController = new AbortController();
  const routeTimeout = setTimeout(() => routeController.abort(), OSRM_TIMEOUT_MS);
  let route;
  try {
    const routeResponse = await fetch(routeUrl, {
      signal: routeController.signal,
      headers: { 'User-Agent': 'Roamly/1.0 outdoor-experience-planner' },
    });
    const routePayload = await routeResponse.json().catch(() => null);
    route = routeResponse.ok ? routePayload?.routes?.[0] : null;
  } catch (cause) {
    route = null;
  } finally {
    clearTimeout(routeTimeout);
  }
  console.info(`[Roamly timing] OSRM: ${Date.now() - routeStartedAt}ms`);
  if (!route) {
    const error = new Error('No real walking route is available to nearby outdoor places. Try again nearby.');
    error.code = 'REAL_ROUTE_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  }
  console.info('[OSRM] origin coordinates valid');
  const coordinates = route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
  const routeGeometry = coordinates.at(-1)?.[0] === selectedPlace.latitude
    && coordinates.at(-1)?.[1] === selectedPlace.longitude
    ? coordinates
    : [...coordinates, [selectedPlace.latitude, selectedPlace.longitude]];
  const destination = {
    id: selectedPlace.id,
    name: selectedPlace.name,
    lat: selectedPlace.latitude,
    lng: selectedPlace.longitude,
    description: selectedPlace.address,
    characteristics: selectedPlace.characteristics,
    category: selectedPlace.category,
    distance: Number(selectedPlace.distance.toFixed(2)),
    walkingDuration: Math.max(1, Math.round(selectedPlace.distance / 0.0833)),
    popularityScore: selectedPlace.popularityScore,
    moodFitScore: selectedPlace.moodFitScore,
    publicAccess: true,
    isRecommended: true,
  };
  const destinations = rankedPlaces.map((place, index) => ({
    id: place.id,
    name: place.name,
    lat: place.latitude,
    lng: place.longitude,
    description: place.address,
    characteristics: place.characteristics,
    category: place.category,
    distance: Number(place.distance.toFixed(2)),
    walkingDuration: Math.max(1, Math.round(place.distance / 0.0833)),
    popularityScore: place.popularityScore,
    moodFitScore: place.moodFitScore,
    publicAccess: true,
    isRecommended: index === 0,
  }));
  const destinationExperience = buildDestinationExperience(experience, preferences, selectedPlace, {
    distance: Number((route.distance / 1000).toFixed(2)),
  });
  return {
    id: `route-${Date.now()}`,
    title: experience.experienceTitle,
    duration: Math.round(route.duration / 60),
    distance: Number((route.distance / 1000).toFixed(2)),
    difficulty: preferences.difficulty || 'easy',
    greenery: preferences.environment === 'nature' ? 'high' : 'medium',
    crowd: preferences.crowdLevel === 'low' ? 'low' : 'medium',
    startPoint: { id: 'start', name: 'Your location', lat: normalizedLocation.latitude, lng: normalizedLocation.longitude },
    destination,
    primaryDestination: destination,
    destinations,
    checkpoints: [],
    geometry: routeGeometry,
    steps: route.legs?.[0]?.steps || [],
    aiReasoning: destinationExperience.reason,
    destinationAddress: selectedPlace.address,
    experience: destinationExperience,
  };
}

async function generateMissions(context) {
  const startedAt = Date.now();
  console.info('[PERF] Gemma missions start');
  const missions = await generateMissionsWithGemma(context);
  console.info(`[PERF] Gemma missions completed: ${Date.now() - startedAt}ms`);
  return missions.map((mission, index) => {
    const order = index + 1;
    return {
      ...mission,
      id: `mission-${Date.now()}-${order}`,
      number: order,
      order,
      instruction: mission.instruction,
      duration: mission.durationMinutes,
      completed: false,
    };
  });
}

module.exports = {
  generatePersonalizedRoute,
  generateMissions,
  findNearbyPlaces,
  isPublicRecreationalPlace,
  rankPlaces,
  deduplicatePlaces,
  calculatePopularityScore,
  hasInstitutionalAssociation,
  hasStrongPublicEvidence,
};
