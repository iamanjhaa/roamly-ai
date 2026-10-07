const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPublicRecreationalPlace,
  hasInstitutionalAssociation,
  rankPlaces,
  deduplicatePlaces,
} = require('./routeService');

function candidate(name, tags = {}, category = 'park', context = {}) {
  return {
    name,
    category,
    tags: { leisure: category, ...tags },
    context: { checked: true, institutionalNearby: false, ...context },
  };
}

test('rejects institutional destination names generically', () => {
  for (const name of [
    'AN Khosla Lawn',
    'Hydrology Department Lawn',
    'IIT Campus Lawn',
    "Director's Lawn",
    'Faculty Garden',
    'University Botanical Research Garden',
    'Engineering College Ground',
    'Institute Campus Garden',
    'Department Recreation Ground',
  ]) {
    assert.equal(isPublicRecreationalPlace(candidate(name, { access: 'public' })), false, name);
  }
});

test('rejects a harmless candidate name inside an institutional context', () => {
  const place = candidate('Beautiful Lawn', { access: 'yes' }, 'park', {
    institutionalNearby: true,
    institutionalNames: ['Indian Institute of Technology Roorkee'],
  });
  assert.equal(hasInstitutionalAssociation(place), true);
  assert.equal(isPublicRecreationalPlace(place), false);
});

test('accepts a harmless candidate name with confirmed municipal context', () => {
  const place = candidate('Beautiful Lawn', {
    access: 'public',
    operator: 'Roorkee Municipal Corporation',
  }, 'park', { institutionalNearby: false, institutionalNames: [] });
  assert.equal(isPublicRecreationalPlace(place), true);
});

test('accepts clearly public recreational destinations', () => {
  for (const [name, category] of [
    ['City Park', 'park'],
    ['Municipal Park', 'park'],
    ['Public Riverside Ghat', 'riverbank'],
    ['Public Playground', 'playground'],
    ['Public Recreation Ground', 'recreation_ground'],
    ['Public Walking Track', 'track'],
  ]) {
    assert.equal(isPublicRecreationalPlace(candidate(name, { access: 'public' }, category)), true, name);
  }
});

test('rejects unknown access and failed context lookup', () => {
  assert.equal(isPublicRecreationalPlace(candidate('Green Park')), false);
  assert.equal(isPublicRecreationalPlace(candidate('City Park', { access: 'public' }, 'park', { lookupFailed: true })), false);
});

test('returns multiple deduplicated public destinations and keeps popularity behind access', () => {
  const places = [
    candidate('City Park', { access: 'public', wikidata: 'Q1' }),
    candidate('City Park', { access: 'public' }),
    candidate('Public Riverside Ghat', { access: 'public' }, 'riverbank'),
    candidate('IIT Main Lawn', { access: 'public', wikidata: 'Q2' }),
    candidate('Public Playground', { access: 'public' }, 'playground'),
  ].map((place, index) => ({ ...place, id: `place-${index}`, latitude: 29.87 + index * 0.002, longitude: 77.89 }));
  const ranked = rankPlaces(places, { distance: 2, environment: 'nature' }, { latitude: 29.87, longitude: 77.89 }, 'public park');
  assert.equal(ranked.length, 3);
  assert.equal(ranked.some((place) => /IIT/i.test(place.name)), false);
  assert.equal(new Set(ranked.map((place) => place.name)).size, ranked.length);
});

test('deduplicates provider copies by id, coordinates, and normalized name', () => {
  const deduplicated = deduplicatePlaces([
    { id: 'osm-1', name: 'City Park', latitude: 29.87, longitude: 77.89 },
    { id: 'nominatim-2', name: 'City   Park', latitude: 29.87001, longitude: 77.89001 },
    { id: 'osm-3', name: 'Riverside Ghat', latitude: 29.88, longitude: 77.9 },
  ]);
  assert.deepEqual(deduplicated.map((place) => place.name), ['City Park', 'Riverside Ghat']);
});
