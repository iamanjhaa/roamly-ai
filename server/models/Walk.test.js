const test = require('node:test');
const assert = require('node:assert/strict');
const Walk = require('./Walk');

test('walk routes persist canonical and alternate destination metadata', () => {
  const routeSchema = Walk.schema.path('route').schema;

  assert.ok(routeSchema.path('destination'));
  assert.ok(routeSchema.path('primaryDestination'));
  assert.ok(routeSchema.path('destinations'));
  assert.ok(routeSchema.path('destination').schema.path('publicAccess'));
  assert.ok(routeSchema.path('destinations').schema.path('isRecommended'));
});
