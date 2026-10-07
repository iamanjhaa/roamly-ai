const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const OLLAMA_TIMEOUT_MS = 60000;
const OLLAMA_KEEP_ALIVE = '10m';

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      const error = new Error(`Ollama request timed out after ${timeoutMs / 1000} seconds.`, { cause });
      error.statusCode = 503;
      throw error;
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

class OllamaError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'OllamaError';
    this.code = 'GEMMA_UNAVAILABLE';
    this.statusCode = 503;
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
    && image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!imageMatch || Buffer.from(imageMatch[2], 'base64').length > 1.5 * 1024 * 1024) {
    const error = new Error('A valid JPEG, PNG, or WebP image smaller than 1.5 MB is required.');
    error.statusCode = 400;
    throw error;
  }

  console.info('[AI] Gemma vision discovery');
  const base64Image = imageMatch[2].replace(/\s/g, '');
  let response;
  try {
    response = await fetchWithTimeout(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: prompt, images: [base64Image] }],
        stream: false,
        format: 'json',
      }),
    }, OLLAMA_TIMEOUT_MS);
  } catch (error) {
    throw new OllamaError(`Ollama is unavailable at ${OLLAMA_BASE_URL}.`, error);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new OllamaError(payload?.error || `Ollama returned HTTP ${response.status}`);
  if (!payload?.message?.content) throw new OllamaError('Ollama returned an empty image analysis.');
  return parseJsonResponse(payload.message.content);
}

function parseJsonResponse(text) {
  if (typeof text !== 'string') throw new OllamaError('Ollama returned a non-text JSON response.');
  const normalized = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new OllamaError('Ollama returned a response that was not valid JSON.', error);
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
    throw new OllamaError('Ollama returned a discovery that was not a JSON object.');
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

  if (!title || !observation) throw new OllamaError('Ollama returned an invalid discovery analysis.');
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

async function analyzeDiscovery(image, context = {}) {
  const analysis = await generateVision(
    `You are Roamly, a warm, observant outdoor companion helping someone notice more on a walk.
Analyze the supplied outdoor image in the context below. Focus on what is visibly present, not a
confident species or object identification. Connect the observation to the walker's mood and route
when useful, but never invent facts, locations, history, or safety conditions.

Context:
${JSON.stringify(context)}

Return JSON only (no markdown, no extra keys) with exactly these keys:
title (short string), observation (1-2 sentence string grounded in the image),
whyInteresting (one concise, curiosity-building string; may be empty),
lookCloser (one safe visual detail to notice; may be empty),
microMission (object with title, instruction, estimatedMinutes 1-10, difficulty easy or medium; may be null),
nextMission (object with type and instruction for the next stretch; may be null),
category (short string), uncertain (boolean), confidence (number from 0 to 100; use 0 only when identification is not meaningful).
Keep all optional strings empty rather than guessing. Never suggest touching, tasting, collecting,
climbing, entering private property, approaching wildlife or strangers, crossing roads, or unsafe
movement. If the image is unclear, say so and lower confidence.`,
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
  generateMission,
  generateMissions,
  analyzeDiscovery,
  generateWalkSummary,
  generateText,
  generateVision,
};
