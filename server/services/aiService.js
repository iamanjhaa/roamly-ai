const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const OLLAMA_TIMEOUT_MS = 120000;
const OLLAMA_CONTEXT_SIZE = 4096;
const OLLAMA_HEALTH_TIMEOUT_MS = 1500;
const OLLAMA_KEEP_ALIVE = '10m';

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      const error = new Error(`Ollama request timed out after ${timeoutMs / 1000} seconds.`, { cause });
      error.name = 'OllamaTimeoutError';
      error.statusCode = 503;
      throw error;
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

class OllamaError extends Error {
  constructor(message, cause, { code = 'GEMMA_UNAVAILABLE', statusCode = 503 } = {}) {
    super(message, { cause });
    this.name = 'OllamaError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function getAIHealthStatus() {
  const baseStatus = {
    provider: 'ollama',
    model: OLLAMA_MODEL,
  };
  const unavailable = (status, reason) => {
    console.warn(`[HEALTH] Ollama ${reason}`);
    return { ...baseStatus, status, modelAvailable: false, reason };
  };

  try {
    const response = await fetchWithTimeout(
      `${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/tags`,
      {},
      OLLAMA_HEALTH_TIMEOUT_MS,
    );
    if (!response.ok) {
      return unavailable('unavailable', `health check returned HTTP ${response.status}.`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return unavailable('unavailable', 'health check returned invalid JSON.');
    }

    const modelAvailable = Array.isArray(payload?.models)
      && payload.models.some((model) => model.name === OLLAMA_MODEL || model.model === OLLAMA_MODEL);
    if (!modelAvailable) {
      return unavailable('model_unavailable', `model ${OLLAMA_MODEL} is not installed.`);
    }

    console.info(`[HEALTH] Ollama is healthy; model ${OLLAMA_MODEL} is available.`);
    return { ...baseStatus, status: 'healthy', modelAvailable: true };
  } catch (error) {
    const reason = error?.message?.includes('timed out')
      ? 'health check timed out.'
      : 'could not be reached.';
    return unavailable('unavailable', reason);
  }
}

async function generateText(prompt, options = {}) {
  console.info('[AI] Gemma text generation');
  let response;

  try {
    response = await fetchWithTimeout(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        ...options,
      }),
    }, OLLAMA_TIMEOUT_MS);
  } catch (error) {
    throw new OllamaError(
      `Ollama is unavailable at ${OLLAMA_BASE_URL}. Start Ollama and ensure ${OLLAMA_MODEL} is installed.`,
      error,
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new OllamaError(payload?.error || `Ollama returned HTTP ${response.status}`);
  }
  if (!payload || typeof payload.response !== 'string' || !payload.response.trim()) {
    throw new OllamaError('Ollama returned an empty or invalid response.');
  }

  return payload.response.trim();
}

async function generateVision(prompt, image) {
  const imageMatch = typeof image === 'string'
    && image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!imageMatch || Buffer.from(imageMatch[2], 'base64').length > 1.5 * 1024 * 1024) {
    const error = new Error('A resized JPEG, PNG, or WebP image smaller than 1.5 MB is required.');
    error.statusCode = 400;
    error.code = 'INVALID_IMAGE';
    throw error;
  }

  console.info('[AI] Gemma vision discovery');
  const base64Image = imageMatch[2];
  let response;
  try {
    response = await fetchWithTimeout(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user, images: [base64Image] },
        ],
        stream: false,
        format: 'json',
        options: {
          num_ctx: OLLAMA_CONTEXT_SIZE,
          num_predict: 512,
          temperature: 0.2,
        },
        keep_alive: OLLAMA_KEEP_ALIVE,
      }),
    }, OLLAMA_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'OllamaTimeoutError') {
      throw new OllamaError(
        'Local Gemma image analysis timed out after 120 seconds. Try again with a smaller image.',
        error,
        { code: 'GEMMA_TIMEOUT', statusCode: 504 },
      );
    }
    throw new OllamaError(
      `Local Ollama at ${OLLAMA_BASE_URL} could not complete image analysis. Check that ${OLLAMA_MODEL} is running.`,
      error,
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const ollamaMessage = typeof payload?.error === 'string' ? payload.error : `Ollama returned HTTP ${response.status}`;
    const isContextError = /context|prompt_tokens|num_ctx|input length/i.test(ollamaMessage);
    throw new OllamaError(
      isContextError
        ? `Local Gemma rejected the image analysis because it exceeded the ${OLLAMA_CONTEXT_SIZE}-token context window. Try a smaller image. (${ollamaMessage})`
        : `Local Gemma image analysis failed: ${ollamaMessage}`,
      undefined,
      {
        code: isContextError ? 'GEMMA_CONTEXT_LIMIT' : 'GEMMA_REQUEST_FAILED',
        statusCode: isContextError ? 413 : 502,
      },
    );
  }
  if (typeof payload?.message?.content !== 'string' || !payload.message.content.trim()) {
    throw new OllamaError('Local Gemma returned an empty image analysis.', undefined, {
      code: 'GEMMA_INVALID_RESPONSE',
      statusCode: 502,
    });
  }
  if (Number.isFinite(payload.prompt_eval_count)) {
    console.info(`[AI] Gemma image tokens prompt=${payload.prompt_eval_count} completion=${payload.eval_count || 0} context=${OLLAMA_CONTEXT_SIZE}`);
  }
  return parseJsonResponse(payload.message.content);
}

function parseJsonResponse(text) {
  if (typeof text !== 'string') throw new OllamaError('Ollama returned a non-text JSON response.');
  const normalized = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new OllamaError('Local Gemma returned malformed analysis JSON. Please retry the image.', error, {
      code: 'GEMMA_INVALID_RESPONSE',
      statusCode: 502,
    });
  }
}

async function generateMission(context = {}) {
  console.info('[AI] Gemma mission generation');
  const mission = parseJsonResponse(await generateText(
    `Create one short, safe outdoor walking mission based on this context: ${JSON.stringify(context)}. `
      + 'Return JSON only with string fields "title", "instruction", "description", "type", numeric '
      + '"durationMinutes", and boolean "phoneAway". Do not include markdown. '
      + 'It must be safe in a public outdoor area, avoid roads, traffic, private property, strangers, '
      + 'driving, climbing, water hazards, or collecting plants, and require minimal screen use.',
    { format: 'json' },
  ));

  if (
    typeof mission.title !== 'string'
    || typeof mission.instruction !== 'string'
    || typeof mission.description !== 'string'
    || typeof mission.type !== 'string'
    || typeof mission.durationMinutes !== 'number'
    || typeof mission.phoneAway !== 'boolean'
  ) {
    throw new OllamaError('Ollama returned a mission with an invalid shape.');
  }

  return {
    ...mission,
    estimatedDuration: mission.durationMinutes,
  };
}

async function generateMissions(context = {}) {
  const missions = parseJsonResponse(await generateText(
    `Create three short, distinct, safe outdoor walking missions based on this context: ${JSON.stringify(context)}. `
      + 'Return a JSON array of exactly three objects. Each object must contain string fields "title", '
      + '"instruction", "description", "type", numeric "durationMinutes", and boolean "phoneAway". '
      + 'Do not include markdown. Avoid roads, traffic, private property, strangers, driving, climbing, '
      + 'water hazards, collecting plants, and excessive screen use.',
    {
      format: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            instruction: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string' },
            durationMinutes: { type: 'number' },
            phoneAway: { type: 'boolean' },
          },
          required: ['title', 'instruction', 'description', 'type', 'durationMinutes', 'phoneAway'],
        },
      },
      options: { num_predict: 384, temperature: 0.1 },
      keep_alive: OLLAMA_KEEP_ALIVE,
    },
  ));
  if (!Array.isArray(missions) || missions.length !== 3 || missions.some((mission) => (
    typeof mission.title !== 'string'
    || typeof mission.instruction !== 'string'
    || typeof mission.description !== 'string'
    || typeof mission.type !== 'string'
    || typeof mission.durationMinutes !== 'number'
    || typeof mission.phoneAway !== 'boolean'
  ))) {
    throw new OllamaError('Ollama returned missions with an invalid shape.');
  }
  return missions.map((mission) => ({ ...mission, estimatedDuration: mission.durationMinutes }));
}

function safeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeMicroMission(value) {
  if (typeof value === 'string') {
    return value.trim() ? { title: 'Tiny field mission', instruction: value.trim() } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const instruction = safeText(value.instruction);
  if (!instruction) return null;
  return {
    title: safeText(value.title, 'Tiny field mission'),
    instruction,
    estimatedMinutes: Number.isFinite(Number(value.estimatedMinutes))
      ? Math.max(1, Math.min(10, Math.round(Number(value.estimatedMinutes))))
      : 2,
    difficulty: value.difficulty === 'medium' ? 'medium' : 'easy',
  };
}

function normalizeNextMission(value) {
  if (typeof value === 'string') {
    return value.trim() ? { type: 'discovery', instruction: value.trim() } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const instruction = safeText(value.instruction);
  if (!instruction) return null;
  return { type: safeText(value.type, 'discovery'), instruction };
}

function safeConfidence(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  // Gemma sometimes returns a 0-1 score and sometimes a percentage.
  const percentage = numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, Math.round(percentage)));
}

function normalizeDiscovery(analysis) {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    throw new OllamaError('Local Gemma returned a discovery that was not a JSON object.', undefined, {
      code: 'GEMMA_INVALID_RESPONSE',
      statusCode: 502,
    });
  }
  const title = safeText(analysis.title, safeText(analysis.name));
  const observation = safeText(analysis.observation, safeText(analysis.description));
  const whyInteresting = safeText(analysis.whyInteresting, safeText(analysis.interestingFact));
  const lookCloser = safeText(analysis.lookCloser);
  const microMission = normalizeMicroMission(analysis.microMission);
  const nextMission = normalizeNextMission(analysis.nextMission);
  const uncertain = typeof analysis.uncertain === 'boolean'
    ? analysis.uncertain
    : safeConfidence(analysis.confidence) < 55;
  const confidence = safeConfidence(analysis.confidence);

  if (!title || !observation) {
    throw new OllamaError('Local Gemma returned an incomplete discovery analysis. Please retry the image.', undefined, {
      code: 'GEMMA_INVALID_RESPONSE',
      statusCode: 502,
    });
  }
  return {
    title,
    name: safeText(analysis.name, title),
    category: safeText(analysis.category, 'outdoor detail'),
    observation,
    description: observation,
    whyInteresting,
    interestingFact: whyInteresting,
    lookCloser,
    microMission,
    nextMission,
    uncertain,
    confidence,
  };
}

async function analyzeDiscovery(image) {
  const analysis = await generateVision(
    {
      system: 'You are Roamly, a concise outdoor visual guide. Describe visible evidence; be uncertain when needed. Do not invent facts or advise touching, tasting, collecting, climbing, trespassing, or approaching wildlife or strangers.',
      user: 'Analyze this image for a walking discovery. Return JSON only: title, observation (1-2 sentences), whyInteresting, lookCloser, microMission (title, instruction, estimatedMinutes 1-10, difficulty easy|medium, or null), nextMission (type, instruction, or null), category, uncertain, confidence (0-100). Use empty optional strings when unsure.',
    },
    image,
  );
  return normalizeDiscovery(analysis);
}

async function generateWalkSummary(walkData) {
  console.info('[AI] Gemma walk summary');
  const summary = parseJsonResponse(await generateText(
    `Create a concise title for this completed walk: ${JSON.stringify(walkData)}. `
      + 'Return JSON only with one string field called "title". Do not include markdown.',
    { format: 'json' },
  ));

  if (typeof summary.title !== 'string' || !summary.title.trim()) {
    throw new OllamaError('Ollama returned a walk summary with an invalid shape.');
  }

  return { title: summary.title.trim() };
}

module.exports = {
  getAIHealthStatus,
  generateMission,
  generateMissions,
  analyzeDiscovery,
  generateWalkSummary,
  generateText,
  generateVision,
};
