const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('./app');

async function withServer(callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    return await callback(port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('GET /api/health responds with express-ready status', async () => {
  await withServer(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, { ok: true, status: 'healthy' });
  });
});

test('GET /api/diagnostics reports dependency status without exposing secrets', async () => {
  await withServer(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/diagnostics`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload && typeof payload === 'object');
    assert.ok('services' in payload);
    assert.ok(payload.services.mongodb && typeof payload.services.mongodb.status === 'string');
    assert.ok(payload.services.ollama && typeof payload.services.ollama.status === 'string');
    assert.equal(typeof payload.ok, 'boolean');
    assert.ok(!JSON.stringify(payload).includes('mongodb://') && !JSON.stringify(payload).includes('password'));
  });
});

test('POST /api/discoveries/analyze rejects a missing image without requiring a walk', async () => {
  await withServer(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/discoveries/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, 'INVALID_IMAGE');
    assert.match(payload.message, /JPEG, PNG, or WebP/);
  });
});

test('POST /api/discoveries/analyze rejects unsupported image data', async () => {
  await withServer(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/discoveries/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/gif;base64,R0lGODlh' }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, 'INVALID_IMAGE');
  });
});
