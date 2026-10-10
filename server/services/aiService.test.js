const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeDiscovery } = require('./aiService');

const image = 'data:image/jpeg;base64,AAAA';
const validAnalysis = {
  title: 'A leafy branch',
  observation: 'Several green leaves catch the light.',
  whyInteresting: 'The overlapping leaves create a range of green shades.',
  lookCloser: 'Notice the fine veins in the nearest leaf.',
  microMission: null,
  nextMission: null,
  category: 'plant',
  uncertain: false,
  confidence: 82,
};

function ollamaResponse(content, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => status >= 400 ? { error: content } : { message: { content } },
  };
}

async function withFetch(fetchImplementation, callback) {
  const originalFetch = global.fetch;
  global.fetch = fetchImplementation;
  try {
    return await callback();
  } finally {
    global.fetch = originalFetch;
  }
}

test('sends a concise prompt and separate image to Ollama without walk history', async () => {
  let request;
  const privateWalkData = 'ROUTE_GEOMETRY_AND_PREVIOUS_DISCOVERIES_MUST_NOT_BE_SENT';
  const result = await withFetch(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    request = JSON.parse(options.body);
    return ollamaResponse(JSON.stringify(validAnalysis));
  }, () => analyzeDiscovery(image, {
    route: { geometry: privateWalkData },
    previousDiscoveries: [{ observation: privateWalkData }],
  }));

  assert.equal(result.title, validAnalysis.title);
  assert.equal(request.model, 'gemma3:4b');
  assert.equal(request.stream, false);
  assert.equal(request.format, 'json');
  assert.equal(request.options.num_ctx, 4096);
  assert.equal(request.options.num_predict, 512);
  assert.equal(request.options.temperature, 0.2);
  assert.equal(request.keep_alive, '10m');
  assert.equal(request.messages.length, 2);
  assert.deepEqual(request.messages[1].images, ['AAAA']);
  assert.ok(request.messages.every((message) => !message.content.includes('AAAA')));
  assert.ok(JSON.stringify(request.messages).length < 1_000);
  assert.ok(!JSON.stringify(request.messages).includes(privateWalkData));
});

test('reports Ollama context-limit responses distinctly with their real token error', async () => {
  await withFetch(async () => ollamaResponse(
    'request (13851 tokens) exceeds the available context size (4096 tokens), prompt_tokens=13851',
    400,
  ), async () => {
    await assert.rejects(analyzeDiscovery(image), (error) => (
      error.code === 'GEMMA_CONTEXT_LIMIT'
      && error.statusCode === 413
      && error.message.includes('13851 tokens')
      && error.message.includes('4096-token context window')
    ));
  });
});

test('reports malformed Gemma analysis without fabricating a result', async () => {
  await withFetch(async () => ollamaResponse('not valid JSON'), async () => {
    await assert.rejects(analyzeDiscovery(image), (error) => (
      error.code === 'GEMMA_INVALID_RESPONSE'
      && error.statusCode === 502
      && error.message.includes('malformed analysis JSON')
    ));
  });
});

test('distinguishes unavailable Ollama and inference timeout', async (t) => {
  await t.test('unavailable Ollama', async () => {
    await withFetch(async () => { throw new TypeError('fetch failed'); }, async () => {
      await assert.rejects(analyzeDiscovery(image), (error) => (
        error.code === 'GEMMA_UNAVAILABLE'
        && error.message.includes('Local Ollama')
      ));
    });
  });

  await t.test('timeout', async () => {
    await withFetch(async (_url, options) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      });
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }, async () => {
      await assert.rejects(analyzeDiscovery(image), (error) => (
        error.code === 'GEMMA_TIMEOUT'
        && error.statusCode === 504
        && error.message.includes('timed out')
      ));
    });
  });
});
