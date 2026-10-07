import type { Discovery, Mission, Route, TrackingLocation, UserPreferences, UserStats, WalkHistory } from '@/lib/types'

const API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api')
  .trim()
  .replace(/(?:\/api)+\/?$/i, '')
  .replace(/\/+$/, '')}/api`

interface ApiResponse<T> { success: boolean; data: T; message?: string; code?: string }

interface HealthResponse { status: 'ok'; service: 'roamly-api' }

function getApiUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, '').replace(/^(?:api\/)+/i, '')
  return `${API_URL}/${normalizedPath}`
}

async function fetchJson(path: string, options?: RequestInit): Promise<{ response: Response; payload: unknown }> {
  let response: Response
  try {
    response = await fetch(getApiUrl(path), {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    })
  } catch (error) {
    console.error('[API] Network request failed', path, error)
    throw new Error('Roamly couldn\'t reach the server. Please make sure the backend is running.')
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('json')) {
    console.error('[API] Expected a JSON response', { path, status: response.status, contentType })
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
      GEMMA_UNAVAILABLE: 'Local Gemma AI is unavailable. Please make sure Ollama is running.',
      DATABASE_ERROR: 'Your walk could not be saved. Please try again.',
    }
    const error = new Error(friendlyMessages[code] || message)
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
  if (!response.ok || typeof payload !== 'object' || payload === null
    || !('status' in payload) || payload.status !== 'ok'
    || !('service' in payload) || payload.service !== 'roamly-api') {
    console.error('[API] Health check failed', { status: response.status, payload })
    throw new Error('Roamly backend health check failed.')
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
