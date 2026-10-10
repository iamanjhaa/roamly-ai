import type { Discovery, Mission, Route, TrackingLocation, UserPreferences, UserStats, WalkHistory } from '@/lib/types'

const API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api')
  .trim()
  .replace(/(?:\/api)+\/?$/i, '')
  .replace(/\/+$/, '')}/api`
const API_REQUEST_TIMEOUT_MS = 150_000
const API_PROBE_TIMEOUT_MS = 2_000

interface ApiResponse<T> { success: boolean; data: T; message?: string; code?: string }

interface HealthResponse { ok: true; status: 'healthy' }

function getSafeUrl(url: string): string {
  const safeUrl = new URL(url)
  safeUrl.username = ''
  safeUrl.password = ''
  safeUrl.search = ''
  safeUrl.hash = ''
  return safeUrl.toString()
}

function getApiUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, '').replace(/^(?:api\/)+/i, '')
  try {
    return new URL(normalizedPath, `${API_URL}/`).toString()
  } catch {
    throw new Error('The configured NEXT_PUBLIC_API_URL is invalid.')
  }
}

async function isApiReachableWithoutCors(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), API_PROBE_TIMEOUT_MS)
  try {
    // A resolved opaque response confirms transport without depending on the API's CORS headers.
    await fetch(getApiUrl('/health'), {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return true
  } catch (error) {
    console.warn('[API] Opaque reachability probe failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJson(path: string, options?: RequestInit): Promise<{ response: Response; payload: unknown }> {
  const url = getApiUrl(path)
  if (path === '/health' && process.env.NODE_ENV === 'development') {
    console.info('[API] Health check request', getSafeUrl(url))
  }

  const controller = new AbortController()
  const callerSignal = options?.signal
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, API_REQUEST_TIMEOUT_MS)
  const abortFromCaller = () => controller.abort()
  if (callerSignal?.aborted) controller.abort()
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })

  let response: Response
  try {
    response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(`The Roamly API request timed out after ${API_REQUEST_TIMEOUT_MS / 1000} seconds.`)
      timeoutError.name = 'API_TIMEOUT'
      console.error('[API] Request timed out', { path, url: getSafeUrl(url) })
      throw timeoutError
    }
    if (callerSignal?.aborted) throw error

    const apiReachable = await isApiReachableWithoutCors()
    const errorName = apiReachable ? 'CORS_ERROR' : 'CONNECTION_ERROR'
    const origin = typeof window === 'undefined' ? 'the current origin' : window.location.origin
    const message = apiReachable
      ? `The Roamly API is reachable, but the browser blocked this request. Check the backend CORS configuration for ${origin}.`
      : `Could not connect to the Roamly API at ${getSafeUrl(url)}. The backend may be stopped or the connection refused; also check browser and network policies.`
    console.error('[API] Network request failed', {
      path,
      url: getSafeUrl(url),
      errorName,
      causeName: error instanceof Error ? error.name : 'UnknownError',
    })
    const requestError = new Error(message)
    requestError.name = errorName
    throw requestError
  } finally {
    clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }

  if (path === '/health' && !response.ok) {
    console.error('[API] Health check returned an HTTP error', { status: response.status })
    throw new Error(`The backend health check returned HTTP ${response.status}.`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('json')) {
    console.error('[API] Expected a JSON response', { path, status: response.status, contentType })
    if (!response.ok) {
      const httpError = new Error(`The Roamly API returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`)
      httpError.name = `HTTP_${response.status}`
      throw httpError
    }
    throw new Error('Roamly received a non-JSON response. Check that NEXT_PUBLIC_API_URL points to the backend URL ending in /api.')
  }

  try {
    return { response, payload: await response.json() as unknown }
  } catch (error) {
    console.error('[API] Invalid JSON response', path, error)
    throw new Error('Roamly received an invalid JSON response from the backend.')
  }
}

function isApiResponse<T>(payload: unknown): payload is ApiResponse<T> {
  return typeof payload === 'object' && payload !== null
    && 'success' in payload && typeof payload.success === 'boolean'
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { response, payload: responsePayload } = await fetchJson(path, options)
  if (!isApiResponse<T>(responsePayload)) {
    console.error('[API] Unexpected response shape', { path, status: response.status })
    throw new Error('Roamly received an unexpected response from the backend.')
  }
  const payload = responsePayload

  if (path === '/walks' && options?.method === 'POST') {
    console.info(`[DEBUG] POST /api/walks status=${response.status}`)
    console.info('[DEBUG] POST /api/walks response=', { success: payload.success, code: payload.code, hasData: Boolean(payload.data) })
  }
  if (!response.ok || !payload.success) {
    const message = payload.message || 'Request failed'
    const code = payload.code || 'NETWORK_ERROR'
    console.error('[API] request failed', { path, status: response.status, code, diagnostic: message })
    const friendlyMessages: Record<string, string> = {
      LOCATION_REQUIRED: 'Location is required to create a real walking route.',
      INVALID_COORDINATES: 'Please enter valid latitude and longitude values.',
      REAL_ROUTE_UNAVAILABLE: 'No real walking route is available from this location. Try again nearby.',
      REAL_PLACE_UNAVAILABLE: 'Roamly couldn\'t find a suitable nearby outdoor place right now. Please try again.',
      NO_PUBLIC_DESTINATION_AVAILABLE: 'Roamly couldn\'t find a public recreational destination within your selected walking range. Please try again nearby.',
      PLACE_PROVIDER_UNAVAILABLE: 'OpenStreetMap could not verify nearby public places right now. Please retry in a moment.',
      GEMMA_UNAVAILABLE: 'Local Gemma AI is unavailable. Please make sure Ollama is running.',
      GEMMA_TIMEOUT: 'Local Gemma took too long to analyze this image. Try again with a smaller image.',
      GEMMA_CONTEXT_LIMIT: 'Local Gemma could not fit this image analysis into its context window. Try a smaller image.',
      GEMMA_INVALID_RESPONSE: 'Local Gemma returned an unreadable analysis. Please retry the image.',
      GEMMA_REQUEST_FAILED: 'Local Gemma could not analyze this image. Please retry.',
      INVALID_IMAGE: 'Choose a readable JPEG, PNG, or WebP image no larger than 12 MB.',
      DATABASE_ERROR: 'Your walk could not be saved. Please try again.',
    }
    const friendlyMessage = friendlyMessages[code]
    const detail = friendlyMessage && friendlyMessage !== message ? `: ${message}` : ''
    const error = new Error(`${friendlyMessage || message} (HTTP ${response.status}${detail})`)
    error.name = code
    throw error
  }
  return payload.data
}

export interface BackendWalk {
  _id: string
  route: Route
  missions: Mission[]
  preferences: UserPreferences
  status: string
  createdAt: string
  distanceTravelled?: number
  activeDurationSeconds?: number
}

export interface WalkCompletionSummary {
  distanceTravelled: number
  activeDurationSeconds: number
}

export interface RecommendationContext {
  preferences: UserPreferences
  location: { latitude: number; longitude: number }
}

function requireRealDestination(walk: BackendWalk): BackendWalk {
  const destination = walk.route?.destination
  if (!destination || typeof destination.name !== 'string' || !destination.name.trim()
    || !Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    throw new Error('Destination unavailable — please try again.')
  }
  return walk
}

export const createWalk = async (preferences: UserPreferences, location: { latitude: number; longitude: number }) => (
  requireRealDestination(await request<BackendWalk>('/walks', {
    method: 'POST',
    body: JSON.stringify({ preferences, location }),
  }))
)
export const checkHealth = async (): Promise<HealthResponse> => {
  const { response, payload } = await fetchJson('/health')
  if (typeof payload !== 'object' || payload === null) {
    console.error('[API] Health check returned an invalid response', { status: response.status })
    throw new Error('Roamly received an invalid health response from the backend.')
  }
  if ('ok' in payload && payload.ok === false) {
    console.error('[API] Backend reported an unhealthy response', { status: response.status })
    throw new Error('Roamly backend health check failed.')
  }
  if (!('ok' in payload) || payload.ok !== true
    || !('status' in payload) || payload.status !== 'healthy') {
    console.error('[API] Health check returned an unexpected response shape', { status: response.status })
    throw new Error('Roamly received an unexpected health response from the backend.')
  }
  return payload as HealthResponse
}
export const getWalk = (id: string) => request<BackendWalk>(`/walks/${id}`)
export const startWalk = (id: string) => request<BackendWalk>(`/walks/${id}/start`, { method: 'POST' })
export const completeWalk = (id: string, summary?: WalkCompletionSummary) => request<BackendWalk>(`/walks/${id}/complete`, {
  method: 'POST',
  body: JSON.stringify(summary || {}),
})
export const saveLocation = (id: string, location: TrackingLocation) => request<BackendWalk>(`/walks/${id}/location`, { method: 'POST', body: JSON.stringify(location) })
export const rerouteWalk = (id: string, location: { latitude: number; longitude: number }) => request<BackendWalk>(`/walks/${id}/reroute`, { method: 'POST', body: JSON.stringify(location) })
export const getMissions = (walkId: string) => request<Mission[]>(`/walks/${walkId}/missions`)
export const completeMission = (missionId: string) => request<Mission>(`/missions/${missionId}/complete`, { method: 'POST' })
export const createDiscovery = (walkId: string, discovery: Partial<Discovery> & { image: string }) => request<Discovery>(`/walks/${walkId}/discoveries`, { method: 'POST', body: JSON.stringify(discovery) })
export const analyzeDiscoveryImage = (image: string) => request<Discovery>('/discoveries/analyze', {
  method: 'POST',
  body: JSON.stringify({ image }),
})
export const getDiscoveries = (walkId: string) => request<Discovery[]>(`/walks/${walkId}/discoveries`)
export const saveReflection = (walkId: string, reflection: object) => request('/walks/' + walkId + '/reflection', { method: 'POST', body: JSON.stringify(reflection) })
export const getWalkHistory = async () => {
  const walks = await request<Array<BackendWalk & { _id: string; createdAt: string; distance?: number; availableTime?: number; mood?: string }>>('/walks')
  return walks.map((walk): WalkHistory => ({
    id: walk._id,
    date: new Date(walk.createdAt),
    title: walk.route?.title || 'Roamly walk',
    duration: walk.activeDurationSeconds !== undefined
      ? Math.round(walk.activeDurationSeconds / 60)
      : walk.route?.duration || walk.availableTime || 0,
    distance: walk.activeDurationSeconds !== undefined
      ? walk.distanceTravelled ?? 0
      : walk.distanceTravelled || walk.route?.distance || walk.distance || 0,
    moodBefore: walk.preferences?.mood || (walk.mood as WalkHistory['moodBefore']) || 'peace',
    moodAfter: 'peace',
    discoveries: 0,
    score: 0,
    missionCount: walk.missions?.length || 0,
  }))
}
export const getProfileStats = () => request<UserStats>('/profile/stats')
