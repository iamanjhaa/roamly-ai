'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Brain,
  Camera,
  Check,
  ChevronRight,
  Cloud,
  Compass,
  Flame,
  History,
  Leaf,
  Menu,
  Moon,
  MoreHorizontal,
  Navigation,
  Pause,
  Play,
  Plus,
  Route as RouteIcon,
  Settings,
  Share2,
  Shield,
  Smile,
  Sparkles,
  Sun,
  Target,
  Trees,
  Upload,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import type { AppState, Discovery, Mission, Mood, Route, TrackingLocation, UserPreferences, UserStats, WalkHistory, WalkTrackingState } from '@/lib/types'
import { cn } from '@/lib/utils'
import { checkHealth, completeMission, completeWalk, createDiscovery, createWalk, getMissions, getProfileStats, getWalkHistory, startWalk, saveReflection as saveReflectionApi } from '@/lib/api'
import RoamlyMap from '@/components/roamly-map'

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = Math.PI / 180
  const dLat = (lat2 - lat1) * radians
  const dLng = (lng2 - lng1) * radians
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function routeMetrics(route: Route, latitude: number, longitude: number) {
  const points = route.geometry.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
  if (points.length < 2) return { distance: Number.POSITIVE_INFINITY, completedMeters: 0, totalMeters: 0 }

  const segmentLengths = points.slice(1).map(([lat, lng], index) =>
    haversine(points[index][0], points[index][1], lat, lng))
  const totalMeters = segmentLengths.reduce((total, length) => total + length, 0)
  let closestDistance = Number.POSITIVE_INFINITY
  let completedMeters = 0
  let precedingMeters = 0

  points.slice(1).forEach(([endLat, endLng], index) => {
    const [startLat, startLng] = points[index]
    const latitudeScale = 111_320
    const longitudeScale = 111_320 * Math.cos(latitude * Math.PI / 180)
    const startX = (startLng - longitude) * longitudeScale
    const startY = (startLat - latitude) * latitudeScale
    const endX = (endLng - longitude) * longitudeScale
    const endY = (endLat - latitude) * latitudeScale
    const deltaX = endX - startX
    const deltaY = endY - startY
    const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY
    const projection = segmentLengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      -(startX * deltaX + startY * deltaY) / segmentLengthSquared))
    const projectedX = startX + projection * deltaX
    const projectedY = startY + projection * deltaY
    const distance = Math.hypot(projectedX, projectedY)
    if (distance < closestDistance) {
      closestDistance = distance
      completedMeters = precedingMeters + segmentLengths[index] * projection
    }
    precedingMeters += segmentLengths[index]
  })

  return { distance: closestDistance, completedMeters, totalMeters }
}

function elapsedSecondsNow(previousSeconds: number, activeSince: number | null) {
  return previousSeconds + (activeSince === null ? 0 : Math.max(0, Math.floor((Date.now() - activeSince) / 1000)))
}

function formatElapsedTime(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function gpsDebug(message: string, details?: Record<string, number | string | boolean | null>) {
  if (process.env.NODE_ENV === 'development') console.info(`[GPS] ${message}`, details || '')
}

const moodOptions: { id: Mood; label: string; icon: typeof Cloud; color: string }[] = [
  { id: 'stressed', label: 'Stressed', icon: Cloud, color: 'sage' },
  { id: 'tired', label: 'Tired', icon: Moon, color: 'lavender' },
  { id: 'bored', label: 'Bored', icon: Zap, color: 'amber' },
  { id: 'happy', label: 'Happy', icon: Smile, color: 'peach' },
  { id: 'thinking', label: 'Need to think', icon: Brain, color: 'blue' },
  { id: 'energetic', label: 'Energetic', icon: Flame, color: 'coral' },
  { id: 'peace', label: 'Just want some peace', icon: Leaf, color: 'mint' },
]
const moodLabels: Record<string, string> = Object.fromEntries(moodOptions.map(({ id, label }) => [id, label]))

const prefOptions = {
  duration: ['15 min', '30 min', '45 min', '60 min'],
  distance: ['1 km', '2 km', '3 km', '5 km'],
  difficulty: ['Easy', 'Moderate', 'Challenging'],
  environment: ['Nature', 'Quiet', 'Scenic', 'Urban'],
  crowdLevel: ['Low', 'Medium', 'Doesn\'t matter'],
} as const

const navItems = [
  { id: 'home', label: 'Home', icon: Compass },
  { id: 'walk', label: 'Walk', icon: Navigation },
  { id: 'history', label: 'History', icon: History },
  { id: 'profile', label: 'Profile', icon: UserRound },
] as const

type Screen = AppState['currentScreen']

export default function Page() {
  const [state, setState] = useState<AppState>({
    currentScreen: 'home',
    currentMissionIndex: 0,
    walks: [],
    stats: { totalWalks: 0, totalMinutesOutside: 0, totalDistance: 0, totalDiscoveries: 0, averageScore: 0, streakDays: 0 },
    theme: 'light',
  })
  const [customMood, setCustomMood] = useState('')
  const [selectedAfterMood, setSelectedAfterMood] = useState<Mood | null>(null)
  const [reflection, setReflection] = useState('')
  const [discoveryPreview, setDiscoveryPreview] = useState('')
  const [discovery, setDiscovery] = useState<Discovery | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [error, setError] = useState('')
  const [tracking, setTracking] = useState<WalkTrackingState>({
    status: 'idle', isActive: false, isPaused: false, isEnded: false, accuracy: null, location: null, walkedPath: [],
    distanceWalkedKm: 0, completedRouteDistanceKm: 0, remainingDistanceKm: 0, progress: 0,
    elapsedSeconds: 0, walkStartedAt: null, offRoute: false, arrived: false,
  })
  const watchIdRef = useRef<number | null>(null)
  const lastLocationRef = useRef<TrackingLocation | null>(null)
  const distanceRef = useRef(0)
  const completedRouteDistanceRef = useRef(0)
  const elapsedSecondsRef = useRef(0)
  const activeSinceRef = useRef<number | null>(null)
  const completionRequestRef = useRef(false)
  const completionSavedRef = useRef(false)
  const lastTrackingUiUpdateRef = useRef(0)
  const trackingRunRef = useRef(false)
  const [gpsRetry, setGpsRetry] = useState(0)
  const routeRef = useRef<Route | undefined>(state.route)

  useEffect(() => { routeRef.current = state.route }, [state.route])

  useEffect(() => {
    Promise.all([getWalkHistory(), getProfileStats()])
      .then(([walks, stats]) => setState((current) => ({ ...current, walks, stats })))
      .catch(() => setError('Could not load your latest Roamly data. Please retry.'))
  }, [])

  useEffect(() => {
    if (!tracking.isActive || tracking.isPaused || tracking.isEnded || tracking.arrived) return
    const timer = window.setInterval(() => {
      const elapsedSeconds = elapsedSecondsNow(elapsedSecondsRef.current, activeSinceRef.current)
      setTracking((current) => ({ ...current, elapsedSeconds }))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [tracking.isActive, tracking.isPaused, tracking.isEnded, tracking.arrived])

  useEffect(() => {
    if (!tracking.isActive || tracking.isPaused || tracking.isEnded || tracking.arrived) return
    if (!navigator.geolocation) {
      setTracking((current) => ({ ...current, status: 'unavailable' }))
      return
    }
    trackingRunRef.current = true
    let disposed = false
    setTracking((current) => ({ ...current, status: 'starting' }))

    const onPosition = (position: GeolocationPosition) => {
      if (disposed || !trackingRunRef.current) return
      const { latitude, longitude, accuracy, speed, heading } = position.coords
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
        || !Number.isFinite(position.timestamp)
        || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return

      const safeAccuracy = Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : Number.POSITIVE_INFINITY
      gpsDebug('position received', { latitude, longitude, accuracy: safeAccuracy })
      const next: TrackingLocation = {
        latitude, longitude, accuracy: safeAccuracy, speed: speed ?? null, heading: heading ?? null, timestamp: position.timestamp,
      }
      if (safeAccuracy > 50) {
        gpsDebug('position ignored: weak accuracy', { accuracy: safeAccuracy })
        if (Date.now() - lastTrackingUiUpdateRef.current >= 1000) {
          lastTrackingUiUpdateRef.current = Date.now()
          setTracking((current) => ({ ...current, status: 'weak', accuracy: safeAccuracy }))
        }
        return
      }

      const previous = lastLocationRef.current
      const movedMeters = previous ? haversine(previous.latitude, previous.longitude, latitude, longitude) : 0
      const elapsedBetweenPoints = previous ? Math.max(1, (position.timestamp - previous.timestamp) / 1000) : 0
      const maximumPlausibleMovement = previous
        ? Math.max(80, elapsedBetweenPoints * 8 + Math.min(previous.accuracy, 25) + Math.min(safeAccuracy, 25))
        : Number.POSITIVE_INFINITY
      if (previous && movedMeters > maximumPlausibleMovement) {
        gpsDebug('position ignored: unrealistic jump', { movedMeters, maximumPlausibleMovement })
        setTracking((current) => ({ ...current, status: 'active' }))
        return
      }

      const route = routeRef.current
      const projection = route ? routeMetrics(route, latitude, longitude) : null
      const addsDistance = previous !== null && movedMeters >= 3
      if (addsDistance) distanceRef.current += movedMeters / 1000
      if (projection && Number.isFinite(projection.completedMeters)) {
        completedRouteDistanceRef.current = Math.max(
          completedRouteDistanceRef.current,
          Math.min(projection.totalMeters, projection.completedMeters),
        )
      }
      lastLocationRef.current = next
      const completedRouteDistanceKm = completedRouteDistanceRef.current / 1000
      const totalRouteMeters = projection?.totalMeters ?? 0
      const remainingDistanceKm = Math.max(0, totalRouteMeters / 1000 - completedRouteDistanceKm)
      const progress = totalRouteMeters > 0
        ? Math.max(0, Math.min(1, completedRouteDistanceRef.current / totalRouteMeters))
        : 0
      const offRoute = Boolean(projection && projection.distance > 65)
      const isArrival = Boolean(route
        && safeAccuracy <= 30
        && haversine(latitude, longitude, route.destination.lat, route.destination.lng) <= 40)
      const path = addsDistance || !previous ? next : null

      const shouldUpdateUi = isArrival || !previous || Date.now() - lastTrackingUiUpdateRef.current >= 1000
      if (shouldUpdateUi) {
        lastTrackingUiUpdateRef.current = Date.now()
        gpsDebug('tracking totals updated', {
          distanceWalkedKm: distanceRef.current,
          remainingDistanceKm: isArrival ? 0 : remainingDistanceKm,
          accuracy: safeAccuracy,
        })
        setTracking((current) => ({
          ...current,
          status: 'active',
          accuracy: safeAccuracy,
          location: next,
          walkedPath: path ? [...current.walkedPath.slice(-299), path] : current.walkedPath,
          distanceWalkedKm: distanceRef.current,
          completedRouteDistanceKm,
          remainingDistanceKm: isArrival ? 0 : remainingDistanceKm,
          progress: isArrival ? 1 : progress,
          offRoute,
          arrived: isArrival,
          isActive: isArrival ? false : current.isActive,
          elapsedSeconds: elapsedSecondsNow(elapsedSecondsRef.current, activeSinceRef.current),
        }))
      }

      if (isArrival) {
        trackingRunRef.current = false
        const elapsedSeconds = elapsedSecondsNow(elapsedSecondsRef.current, activeSinceRef.current)
        elapsedSecondsRef.current = elapsedSeconds
        activeSinceRef.current = null
        setState((current) => ({ ...current, currentScreen: 'walk' }))
        void persistWalkCompletion()
      }
    }
    const onError = (positionError: GeolocationPositionError) => {
      if (disposed || !trackingRunRef.current) return
      const status = positionError.code === 1 ? 'permission-denied'
        : positionError.code === 2 ? 'unavailable'
          : positionError.code === 3 ? 'timeout' : 'error'
      gpsDebug('position error', { code: positionError.code, message: positionError.message, status })
      setTracking((current) => ({ ...current, status }))
    }

    try {
      watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: true, maximumAge: 2000, timeout: 10000,
      })
      gpsDebug('watchPosition registered', { watchId: watchIdRef.current })
    } catch (watchError) {
      trackingRunRef.current = false
      setTracking((current) => ({ ...current, status: 'error' }))
      gpsDebug('watchPosition registration failed')
      console.error('[GPS] could not start location watcher', watchError)
    }
    return () => {
      disposed = true
      trackingRunRef.current = false
      if (watchIdRef.current !== null) {
        gpsDebug('watchPosition cleared', { watchId: watchIdRef.current })
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [tracking.isActive, tracking.isPaused, tracking.isEnded, tracking.arrived, gpsRetry])

  const persistWalkCompletion = async () => {
    const walkId = state.currentWalk?.id
    if (!walkId || completionSavedRef.current || completionRequestRef.current) return
    completionRequestRef.current = true
    try {
      await completeWalk(walkId, {
        distanceTravelled: Number.isFinite(distanceRef.current) ? Math.max(0, distanceRef.current) : 0,
        activeDurationSeconds: Math.max(0, elapsedSecondsRef.current),
      })
      completionSavedRef.current = true
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save your walk summary.')
    } finally {
      completionRequestRef.current = false
    }
  }

  const go = (screen: Screen) => {
    setState((current) => ({ ...current, currentScreen: screen }))
    setMobileMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startFlow = () => go('mood')

  const pauseWalk = () => {
    trackingRunRef.current = false
    const elapsedSeconds = elapsedSecondsNow(elapsedSecondsRef.current, activeSinceRef.current)
    elapsedSecondsRef.current = elapsedSeconds
    activeSinceRef.current = null
    lastLocationRef.current = null
    setTracking((current) => ({ ...current, isPaused: true, elapsedSeconds }))
  }

  const resumeWalk = () => {
    trackingRunRef.current = true
    lastLocationRef.current = null
    activeSinceRef.current = Date.now()
    setTracking((current) => ({ ...current, isActive: true, isPaused: false, status: 'starting' }))
  }

  const endWalk = () => {
    trackingRunRef.current = false
    const elapsedSeconds = elapsedSecondsNow(elapsedSecondsRef.current, activeSinceRef.current)
    elapsedSecondsRef.current = elapsedSeconds
    activeSinceRef.current = null
    lastLocationRef.current = null
    setTracking((current) => ({ ...current, isActive: false, isPaused: false, isEnded: true, elapsedSeconds }))
    void persistWalkCompletion()
  }

  const retryGps = () => {
    lastLocationRef.current = null
    setTracking((current) => ({ ...current, status: 'starting' }))
    setGpsRetry((attempt) => attempt + 1)
  }

  const selectMood = (mood: Mood) => {
    setState((current) => ({ ...current, preferences: { ...current.preferences, mood } as UserPreferences }))
  }

  const createPreferences = async (values: { duration: string; distance: string; difficulty: string; environment: string; crowdLevel: string; latitude: string; longitude: string }) => {
    const preferences: UserPreferences = {
      mood: state.preferences?.mood || 'stressed',
      customMood,
      duration: Number.parseInt(values.duration, 10),
      distance: Number.parseFloat(values.distance),
      difficulty: values.difficulty.toLowerCase() as UserPreferences['difficulty'],
      environment: values.environment.toLowerCase() as UserPreferences['environment'],
      crowdLevel: values.crowdLevel === "Doesn't matter" ? 'doesnt-matter' : values.crowdLevel.toLowerCase() as UserPreferences['crowdLevel'],
    }
    setLoading(true)
    setLoadingMessage('Understanding how you feel...')
    setError('')
    let planningTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const manualLatitude = Number(values.latitude)
      const manualLongitude = Number(values.longitude)
      if (!Number.isFinite(manualLatitude) || !Number.isFinite(manualLongitude)
        || manualLatitude < -90 || manualLatitude > 90 || manualLongitude < -180 || manualLongitude > 180) {
        throw new Error('Please enter valid latitude and longitude values.')
      }
      console.info('[DEBUG] latitude finite=', Number.isFinite(manualLatitude), 'longitude finite=', Number.isFinite(manualLongitude))
      console.info('[DEBUG] request body=', { preferences, location: { latitudeFinite: Number.isFinite(manualLatitude), longitudeFinite: Number.isFinite(manualLongitude) } })
      await checkHealth()
      const location = { latitude: manualLatitude, longitude: manualLongitude }
      setLoadingMessage('Finding a place that fits...')
      planningTimer = setTimeout(() => setLoadingMessage('Planning your walk...'), 2500)
      const walk = await createWalk(preferences, location)
      setState((current) => ({ ...current, preferences, route: walk.route, currentWalk: { ...current.currentWalk, id: walk._id, preferences, route: walk.route, missions: walk.missions, discoveries: [], startTime: new Date(), distanceCovered: 0, timeSpent: 0, phoneFreeMins: 0 }, currentScreen: 'route' }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create your walk.')
    } finally {
      if (planningTimer) clearTimeout(planningTimer)
      setLoading(false)
      setLoadingMessage('')
    }
  }

  const beginWalk = async () => {
    if (!state.currentWalk?.id) return
    gpsDebug('Start Walk requested')
    setLoading(true)
    try {
      const [walk, missions] = await Promise.all([startWalk(state.currentWalk.id), getMissions(state.currentWalk.id)])
      const startedAt = Date.now()
      const route = state.route || walk.route
      const totalRouteMeters = routeMetrics(route, route.startPoint.lat, route.startPoint.lng).totalMeters
      distanceRef.current = 0
      completedRouteDistanceRef.current = 0
      elapsedSecondsRef.current = 0
      activeSinceRef.current = startedAt
      lastLocationRef.current = null
      completionRequestRef.current = false
      completionSavedRef.current = false
      trackingRunRef.current = true
      setTracking({
        status: 'starting', isActive: true, isPaused: false, isEnded: false, accuracy: null,
        location: null, walkedPath: [], distanceWalkedKm: 0, completedRouteDistanceKm: 0,
        remainingDistanceKm: totalRouteMeters / 1000, progress: 0, elapsedSeconds: 0,
        walkStartedAt: startedAt, offRoute: false, arrived: false,
      })
      setState((current) => ({ ...current, currentScreen: 'walk', currentMissionIndex: 0, currentWalk: { ...current.currentWalk!, id: walk._id, startTime: new Date(), missions, route: current.route || walk.route, preferences: current.preferences!, discoveries: [], distanceCovered: 0, timeSpent: 0, phoneFreeMins: 0 } }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not start your walk.')
    } finally {
      setLoading(false)
    }
  }

  const finishMission = async () => {
    const mission = state.currentWalk?.missions[state.currentMissionIndex]
    if (mission) {
      try {
        await completeMission(mission.id)
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not save mission progress.')
        return
      }
    }
    setDiscoveryPreview('')
    setDiscovery(null)
    go('discovery')
  }

  const continueFromDiscovery = async () => {
    if (!discovery) {
      setError('Capture or upload a photo so Gemma can analyze your discovery.')
      return
    }
    if (state.currentMissionIndex < (state.currentWalk?.missions.length || 0) - 1) {
      if (state.currentWalk?.id) {
        const missions = await getMissions(state.currentWalk.id)
        setState((current) => ({ ...current, currentMissionIndex: current.currentMissionIndex + 1, currentScreen: 'mission', currentWalk: current.currentWalk ? { ...current.currentWalk, missions } : current.currentWalk }))
      }
    } else {
      endWalk()
      setState((current) => ({ ...current, currentScreen: 'walk' }))
    }
  }

  const saveReflection = async () => {
    if (state.currentWalk?.id) {
      try {
        await saveReflectionApi(state.currentWalk.id, { moodBefore: state.preferences?.mood, moodAfter: selectedAfterMood, notes: reflection })
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not save your reflection.')
        return
      }
    }
    try {
      const [walks, stats] = await Promise.all([getWalkHistory(), getProfileStats()])
      setState((current) => ({ ...current, walks, stats }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not refresh your profile.')
    }
    setState((current) => ({
      ...current,
      currentScreen: 'home',
    }))
  }

  const screen = state.currentScreen
  const isFlow = ['mood', 'preferences', 'route', 'walk', 'mission', 'discovery', 'reflection', 'complete'].includes(screen)

  return (
    <div className={cn('app-shell', state.theme === 'dark' && 'dark')}>
      <aside className={cn('sidebar', mobileMenuOpen && 'sidebar-open')}>
        <div className="brand" onClick={() => go('home')} role="button" tabIndex={0}>
          <span className="brand-mark"><Leaf /></span>
          <span>Roamly<span className="brand-dot">.</span></span>
        </div>
        <div className="sidebar-tagline">A reason to step outside.</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = (item.id === 'home' && screen === 'home') || (item.id === 'walk' && isFlow) || screen === item.id
            return <button key={item.id} onClick={() => go(item.id)} className={cn('nav-item', active && 'nav-item-active')}><Icon />{item.label}{active && <span className="nav-active-dot" />}</button>
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="tiny-streak"><Flame /><div><strong>{state.stats.streakDays} day streak</strong><span>Keep the rhythm going</span></div></div>
          <button className="nav-item" onClick={() => go('profile')}><Settings /> Settings</button>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open menu" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}><Menu /></button>
          <button className="mobile-brand" onClick={() => go('home')}><span className="brand-mark"><Leaf /></span>Roamly<span className="brand-dot">.</span></button>
          <div className="topbar-spacer" />
          <button className="theme-toggle" onClick={() => setState((s) => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' }))} aria-label="Toggle theme">{state.theme === 'light' ? <Moon /> : <Sun />}</button>
          <div className="avatar">AR</div>
        </header>
        <main className="content">
          {screen === 'home' && <HomeScreen stats={state.stats} onStart={startFlow} onHow={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })} />}
          {screen === 'mood' && <MoodScreen selected={state.preferences?.mood} onSelect={selectMood} customMood={customMood} setCustomMood={setCustomMood} onBack={() => go('home')} onContinue={() => go('preferences')} />}
          {screen === 'preferences' && <PreferencesScreen onBack={() => go('mood')} onCreate={createPreferences} loading={loading} loadingMessage={loadingMessage} />}
          {screen === 'route' && state.route && <RouteScreen route={state.route} tracking={tracking} onBack={() => go('preferences')} onStart={beginWalk} onChange={() => go('preferences')} />}
          {screen === 'walk' && state.currentWalk && <ActiveWalkScreen mission={state.currentWalk.missions[state.currentMissionIndex] || null} route={state.currentWalk.route} tracking={tracking} onMission={finishMission} onPause={pauseWalk} onResume={resumeWalk} onEnd={endWalk} onRetryGps={retryGps} onFinish={() => go('complete')} />}
          {screen === 'mission' && state.currentWalk?.missions[state.currentMissionIndex] && <MissionScreen mission={state.currentWalk.missions[state.currentMissionIndex]} missionIndex={state.currentMissionIndex} onComplete={finishMission} />}
          {screen === 'discovery' && <DiscoveryScreen preview={discoveryPreview} result={discovery} onUpload={async (file) => {
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
            if (!allowedTypes.includes(file.type) || file.size > 1.5 * 1024 * 1024) {
              setError('Please choose a JPEG, PNG, or WebP image smaller than 1.5 MB.')
              return
            }
            const reader = new FileReader()
            reader.onload = async () => {
              const image = String(reader.result)
              setDiscoveryPreview(image)
              if (state.currentWalk?.id) {
                setLoading(true)
                try {
                  const saved = await createDiscovery(state.currentWalk.id, { image, missionId: state.currentWalk.missions[state.currentMissionIndex]?.id })
                  setDiscovery(saved)
                } catch (requestError) {
                  setError(requestError instanceof Error ? requestError.message : 'Could not analyze discovery.')
                } finally { setLoading(false) }
              }
            }
            reader.readAsDataURL(file)
          }} onRemove={() => { setDiscoveryPreview(''); setDiscovery(null); setError('') }} onContinue={continueFromDiscovery} />}
          {screen === 'complete' && <CompleteScreen onReflect={() => go('reflection')} />}
          {screen === 'reflection' && <ReflectionScreen selected={selectedAfterMood} setSelected={setSelectedAfterMood} value={reflection} setValue={setReflection} onSave={saveReflection} />}
          {screen === 'history' && <HistoryScreen walks={state.walks} onStart={startFlow} />}
          {screen === 'profile' && <ProfileScreen stats={state.stats} />}
        </main>
        {loading && <div className="fixed bottom-5 right-5 z-50 rounded-full bg-black px-4 py-2 text-sm text-white">{loadingMessage || 'Saving…'}</div>}
        {error && <div className="fixed bottom-5 left-5 z-50 flex items-center gap-3 rounded-lg bg-red-700 px-4 py-2 text-sm text-white"><span>{error}</span><button onClick={() => window.location.reload()}>Retry</button><button onClick={() => setError('')}>×</button></div>}
        <MobileNav screen={screen} onNavigate={go} />
      </div>
    </div>
  )
}

function EmotionalJourney() {
  const faces = ['😔', '😐', '😌', '😊']
  const [faceIndex, setFaceIndex] = useState(0)
  const [celebrate, setCelebrate] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setFaceIndex((index) => (index + 1) % faces.length), 2600)
    return () => window.clearInterval(timer)
  }, [])

  return <div className="emotion-journey">
    <div className="emoji-orbit orbit-one">🍃</div><div className="emoji-orbit orbit-two">🌿</div><div className="emoji-orbit orbit-three">🌸</div>
    <div className="emotion-glow" aria-hidden="true" />
    <button className={cn('main-emotion', faceIndex === 3 && 'main-emotion-happy', celebrate && 'main-emotion-celebrate')} onClick={() => { setCelebrate(false); requestAnimationFrame(() => setCelebrate(true)) }} aria-label="Animated emotional journey">
      <span key={faceIndex} className="emotion-face">{faces[faceIndex]}</span>
    </button>
    <div className="emotion-copy"><span>{faceIndex < 3 ? 'From stressed...' : '...to refreshed.'}</span><div className="emotion-dots">{faces.map((face, index) => <i key={face} className={index === faceIndex ? 'active' : ''} />)}</div></div>
    {celebrate && <div className="celebration-burst" aria-hidden="true"><span>🍃</span><span>🌱</span><span>🦋</span><span>☀️</span></div>}
  </div>
}

function NatureLove() {
  return <section className="nature-love" aria-label="Reconnect with nature">
    <div className="nature-love-sequence"><span>🌱</span><b>↓</b><span>🌿</span><b>↓</b><span>🌸</span><b>↓</b><span>❤️</span></div>
    <div><div className="section-label">The way back</div><h3>Fall back in love with the world outside.</h3></div>
  </section>
}

function PhoneAway() {
  return <section className="phone-away"><div className="phone-story"><span className="phone-emoji">📱</span><b>↓</b><span className="phone-fade">📱</span><b>↓</b><div className="nature-pop">🌳 <span>🦋</span> 🌿 ☀️</div></div><p>Your best AI interaction might be walking away.</p></section>
}

function OutdoorJourney() {
  const stages = [['😫', 'Feeling stressed'], ['🥾', 'Start walking'], ['🌳', 'Discover nature'], ['🐦', 'Notice the little things'], ['🌿', 'Put your phone away'], ['😊', 'Feel refreshed']]
  const [active, setActive] = useState(0)
  useEffect(() => { const timer = window.setInterval(() => setActive((index) => (index + 1) % stages.length), 1900); return () => window.clearInterval(timer) }, [])
  return <section className="outdoor-journey"><div className="section-label">A small outdoor journey</div><div className="journey-steps">{stages.map(([emoji, label], index) => <div className={cn('journey-stage', index === active && 'journey-stage-active')} key={label}><span>{emoji}</span><strong>{label}</strong>{index < stages.length - 1 && <b>↓</b>}</div>)}</div></section>
}

function HomeScreen({ stats, onStart, onHow }: { stats: AppState['stats']; onStart: () => void; onHow: () => void }) {
  return <div className="home-page">
    <section className="hero-section">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-line" /> Open-source outdoor AI</div>
        <h1>Your AI-powered<br /><em>reason to step outside.</em></h1>
        <p className="hero-subtitle">Tell us how you feel.<br />We&apos;ll plan the way out.</p>
        <div className="hero-actions"><button className="button button-primary button-large" onClick={onStart}>Start My Walk <ArrowRight /></button><button className="button button-ghost" onClick={onHow}>How It Works <ChevronRight /></button></div>
        <div className="hero-note"><span className="pulse-dot" /> The best AI interaction is sometimes walking away from the screen.</div>
      </div>
      <div className="hero-art" aria-label="Illustration of a peaceful trail"><div className="floating-emoji float-leaf">🍃</div><div className="floating-emoji float-butterfly">🦋</div><div className="floating-emoji float-bird">🐦</div><div className="floating-emoji float-flower">🌸</div><div className="floating-emoji float-sun">☀️</div><EmotionalJourney />
        <div className="sun-disc" /><div className="hill hill-back" /><div className="hill hill-front" /><div className="trail-line" /><div className="art-tree tree-one"><span /><span /><span /></div><div className="art-tree tree-two"><span /><span /><span /></div><div className="art-tree tree-three"><span /><span /><span /></div><div className="art-person"><div className="person-head" /><div className="person-body" /><div className="person-leg leg-a" /><div className="person-leg leg-b" /></div><div className="art-badge"><Sparkles /><span>made for<br /><strong>real life</strong></span></div>
      </div>
    </section>
    <NatureLove />
    <OutdoorJourney />
    <PhoneAway />
    <section className="flow-section" id="how-it-works"><div className="section-label">A different kind of AI</div><h2>Less screen. <em>More world.</em></h2><p className="section-intro">Roamly uses AI to make the outside feel a little more interesting — then gets out of your way.</p><div className="flow-steps">{([{ num: '01', label: 'Mood', Icon: Smile }, { num: '02', label: 'Route', Icon: RouteIcon }, { num: '03', label: 'Mission', Icon: Target }, { num: '04', label: 'Discovery', Icon: Leaf }, { num: '05', label: 'Reflect', Icon: Sparkles }]).map(({ num, label, Icon }) => <div className="flow-step" key={label}><span className="flow-num">{num}</span><div className="flow-icon"><Icon /></div><strong>{label}</strong>{label !== 'Reflect' && <ArrowRight className="flow-arrow" />}</div>)}</div></section>
    <section className="stats-strip"><div><strong>{stats.totalWalks.toLocaleString()}</strong><span>walks completed</span></div><div><strong>{stats.totalMinutesOutside.toLocaleString()}</strong><span>minutes outside</span></div><div><strong>{stats.totalDiscoveries.toLocaleString()}</strong><span>discoveries made</span></div><div className="stats-quote">“Go outside. We&apos;ll be here when you return.”</div></section>
    <section className="home-cta"><div className="cta-leaf"><Leaf /></div><h2>Ready for your next<br /><em>little adventure?</em></h2><button className="button button-dark button-large" onClick={onStart}>Start My Walk <ArrowRight /></button></section>
  </div>
}

function PageHeader({ eyebrow, title, description, onBack }: { eyebrow?: string; title: string; description?: string; onBack?: () => void }) {
  return <div className="page-header">{onBack && <button className="back-button" onClick={onBack}><ArrowLeft /> Back</button>}{eyebrow && <div className="eyebrow"><span className="eyebrow-line" /> {eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
}

function MoodScreen({ selected, onSelect, customMood, setCustomMood, onBack, onContinue }: { selected?: Mood; onSelect: (mood: Mood) => void; customMood: string; setCustomMood: (value: string) => void; onBack: () => void; onContinue: () => void }) {
  return <div className="flow-page"><PageHeader eyebrow="Step 01 / 04" title="How are you feeling today?" description="There&apos;s no wrong answer. Your mood helps shape the way out." onBack={onBack} /><div className="mood-grid">{moodOptions.map(({ id, label, icon: Icon, color }) => <button key={id} onClick={() => onSelect(id)} className={cn('mood-card', `mood-${color}`, selected === id && 'mood-selected')}><span className="mood-icon"><Icon /></span><span>{label}</span>{selected === id && <Check className="selected-check" />}</button>)}</div><label className="field-label" htmlFor="custom-mood">Or tell us in your own words</label><textarea id="custom-mood" className="text-area" value={customMood} onChange={(e) => setCustomMood(e.target.value)} placeholder="Example: I feel stressed and want a quiet 30-minute walk." rows={3} /><div className="flow-footer"><span className="step-progress"><span className="step-progress-active" /><span /><span /><span /></span><button className="button button-primary" disabled={!selected} onClick={onContinue}>Continue <ArrowRight /></button></div></div>
}

function PreferencesScreen({ onBack, onCreate, loading, loadingMessage }: { onBack: () => void; onCreate: (values: { duration: string; distance: string; difficulty: string; environment: string; crowdLevel: string; latitude: string; longitude: string }) => void; loading: boolean; loadingMessage: string }) {
  const [values, setValues] = useState({ duration: '30 min', distance: '2 km', difficulty: 'Easy', environment: 'Nature', crowdLevel: 'Low', latitude: '', longitude: '' })
  const [locationState, setLocationState] = useState<'initial' | 'requesting' | 'success' | 'denied' | 'unavailable' | 'timeout'>('initial')
  const [locationError, setLocationError] = useState('')
  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }))
  const useLocation = (continueAfterSuccess = false, allowManualFallback = false) => {
    if (!navigator.geolocation) {
      setLocationState('unavailable')
      setLocationError('Your device could not provide a location. Try again or enter coordinates manually.')
      if (continueAfterSuccess && allowManualFallback && hasLocation) onCreate(values)
      return
    }
    setLocationState('requesting')
    setLocationError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)
          || coords.latitude < -90 || coords.latitude > 90 || coords.longitude < -180 || coords.longitude > 180
          || (coords.latitude === 0 && coords.longitude === 0)) {
          setLocationState('unavailable')
          setLocationError('Your device could not provide a location. Try again or enter coordinates manually.')
          return
        }
        const nextValues = { ...values, latitude: String(coords.latitude), longitude: String(coords.longitude) }
        setValues(nextValues)
        setLocationState('success')
        if (continueAfterSuccess) onCreate(nextValues)
      },
      (positionError) => {
        const nextState = positionError.code === 1 ? 'denied' : positionError.code === 3 ? 'timeout' : 'unavailable'
        setLocationState(nextState)
        setLocationError(nextState === 'denied'
          ? 'Location permission was denied. Allow location for localhost:3000 or enter coordinates manually.'
          : nextState === 'timeout'
            ? 'Location request timed out. Try again or enter coordinates manually.'
            : 'Your device could not provide a location. Try again or enter coordinates manually.')
        if (continueAfterSuccess && allowManualFallback && hasLocation) onCreate(values)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }
  const locationMessage = {
    initial: 'Roamly needs your location to build a real walking route.',
    requesting: 'Getting your location...',
    success: 'Location ready for your walk',
    denied: locationError,
    unavailable: locationError,
    timeout: locationError,
  }[locationState]
  const latitude = Number(values.latitude)
  const longitude = Number(values.longitude)
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0)
  const handleCreate = () => {
    console.info('[DEBUG] create walk clicked', { locationState, hasLocation })
    useLocation(true, hasLocation)
  }
  return <div className="flow-page"><PageHeader eyebrow="Step 02 / 04" title="Build your perfect walk" description="Tune the details. We&apos;ll handle the rest." onBack={onBack} /><div className="preference-grid">{(Object.entries(prefOptions) as [keyof typeof values, readonly string[]][]).map(([key, options]) => <div className="preference-group" key={key}><div className="preference-title">{key === 'duration' ? 'Available time' : key === 'distance' ? 'Distance' : key === 'crowdLevel' ? 'Crowd level' : key.charAt(0).toUpperCase() + key.slice(1)}</div><div className="option-row">{options.map((option) => <button key={option} onClick={() => set(key, option)} className={cn('option-pill', values[key] === option && 'option-selected')}>{option}</button>)}</div></div>)}</div><div className="location-entry"><strong>Location</strong><p>{locationMessage}</p>  <button className="button button-ghost" disabled={locationState === 'requesting' || loading} onClick={() => useLocation()}>{locationState === 'requesting' ? 'Getting your location...' : locationState === 'success' ? 'Location ready for your walk' : locationState === 'initial' ? 'Use My Location' : 'Try Again'}</button>{locationState !== 'success' && <><p>Or enter a location manually if browser permission is unavailable.</p><label htmlFor="latitude">Manual latitude</label><input id="latitude" value={values.latitude} onChange={(event) => set('latitude', event.target.value)} inputMode="decimal" placeholder="Latitude" /><label htmlFor="longitude">Manual longitude</label><input id="longitude" value={values.longitude} onChange={(event) => set('longitude', event.target.value)} inputMode="decimal" placeholder="Longitude" /></>}</div><div className="summary-card"><div className="summary-icon"><RouteIcon /></div><div><div className="summary-kicker">Your walk so far</div><strong>{values.duration} · {values.distance} · {values.environment.toLowerCase()}</strong><p>{values.difficulty} pace, {values.crowdLevel.toLowerCase()} crowds</p></div>  <MoreHorizontal /></div>{loading && <p role="status">{loadingMessage}</p>}<div className="flow-footer"><span className="step-progress"><span className="step-progress-active" /><span className="step-progress-active" /><span /><span /></span>  <button className="button button-primary" disabled={loading} onClick={handleCreate}>{loading ? 'Creating your walk...' : 'Create My Walk'} <Sparkles /></button></div></div>
}

function TrackingStatus({ tracking }: { tracking: WalkTrackingState }) {
  const accuracy = tracking.accuracy !== null && Number.isFinite(tracking.accuracy)
    ? ` · ±${Math.round(tracking.accuracy)}m` : ''
  const message = tracking.isPaused ? 'Walk paused'
    : tracking.status === 'permission-denied' ? 'Location access is required to track your walk.'
      : tracking.status === 'timeout' ? 'GPS signal timed out. Trying again...'
        : tracking.status === 'unavailable' ? 'GPS position is temporarily unavailable.'
          : tracking.status === 'error' ? 'GPS could not be read. Retry to reconnect.'
            : tracking.status === 'weak' ? `Weak GPS signal${accuracy}`
              : tracking.status === 'starting' ? 'Getting GPS location...'
                : tracking.offRoute ? "You're off the planned route."
                  : tracking.arrived ? 'You made it!'
                    : 'GPS connected' + accuracy
  return <div className={cn('tracking-status', tracking.status === 'active' && !tracking.offRoute && 'tracking-active')} role="status">{message}</div>
}

function RouteScreen({ route, tracking, onBack, onStart, onChange }: { route: Route; tracking: WalkTrackingState; onBack: () => void; onStart: () => void; onChange: () => void }) {
  const destinationName = route.destination?.name?.trim()
  const nearby = (route.destinations || []).filter((place) => place.id !== route.destination.id)
  return <div className="flow-page route-page"><PageHeader eyebrow="Step 03 / 04" title="Your recommended roam" description="A little reset, designed around how you feel." onBack={onBack} />{tracking.isActive && <TrackingStatus tracking={tracking} />}<div className="route-layout"><div className="route-map-wrap"><RoamlyMap route={route} location={tracking.location} walkedPath={tracking.walkedPath} /><div className="map-caption"><div><span className="live-dot" /> Real route ready</div><span>{Math.round(tracking.progress * 100)}% complete</span></div></div><div className="route-info"><div className="route-title-row"><div><div className="section-label">Your recommended roam</div><h2>{destinationName ? `Go to: ${destinationName}` : 'Destination unavailable — please try again.'}</h2>{route.destinationAddress && <p>{route.destinationAddress}</p>}</div><span className="route-rating"><Sparkles /> Local Gemma</span></div><div className="route-stats"><div><strong>{route.distance}</strong><span>km</span></div><div><strong>{route.duration}</strong><span>min walk</span></div><div><strong>{Math.round(tracking.progress * 100)}%</strong><span>walk progress</span></div></div><div className="route-tags"><span><Trees /> {route.greenery} greenery</span><span><UsersIcon /> {route.crowd} crowd</span></div><div className="why-card"><div className="why-icon"><Brain /></div><div><strong>Why this place?</strong><p>{route.aiReasoning}</p></div></div>{route.experience?.experienceGoal && <div className="why-card"><div className="why-icon"><Leaf /></div><div><strong>Your experience</strong><p>{route.experience.experienceGoal}</p></div></div>}{nearby.length > 0 && <div className="nearby-options"><div className="section-label">Nearby options</div>{nearby.map((place) => <div className="nearby-option" key={place.id}><div><strong>{place.name}</strong><span>{place.category || 'public outdoor place'} · {place.distance ?? '—'} km · {place.walkingDuration ?? '—'} min walk</span></div><span className="nearby-fit">{place.publicAccess ? 'Public access' : 'Unavailable'}</span></div>)}</div>}<div className="route-actions"><button className="button button-primary" onClick={onStart}>Start Walk <Navigation /></button><button className="button button-ghost" onClick={onChange}>Change route</button></div></div></div></div>
}

function UsersIcon() { return <Activity /> }

function ActiveWalkScreen({ mission, route, tracking, onMission, onPause, onResume, onEnd, onRetryGps, onFinish }: { mission: Mission | null; route: Route; tracking: WalkTrackingState; onMission: () => void; onPause: () => void; onResume: () => void; onEnd: () => void; onRetryGps: () => void; onFinish: () => void }) {
  const totalRouteKm = tracking.completedRouteDistanceKm + tracking.remainingDistanceKm
  const osrmDuration = Number.isFinite(route.duration) && route.duration > 0 ? route.duration : 0
  const estimatedMinutes = totalRouteKm > 0 && osrmDuration > 0
    ? osrmDuration * tracking.remainingDistanceKm / totalRouteKm
    : tracking.remainingDistanceKm / 5 * 60
  const safeEstimatedMinutes = Number.isFinite(estimatedMinutes) ? Math.max(0, estimatedMinutes) : 0
  const summary = tracking.arrived || tracking.isEnded
  const destinationName = route.destination.name.trim()

  return <div className="active-walk-page"><div className="walk-topline"><span className="walk-status"><span className="live-dot" /> {summary ? (tracking.arrived ? 'Walk complete' : 'Walk ended') : 'Walk in progress'}</span></div><TrackingStatus tracking={tracking} /><div className="active-map-wrap"><RoamlyMap route={route} location={tracking.location} walkedPath={tracking.walkedPath} compact /></div>{summary ? <section className="walk-summary" aria-live="polite"><div className="section-label">{tracking.arrived ? 'Destination reached' : 'Walk summary'}</div><h1>{tracking.arrived ? '✓ You made it!' : 'Walk complete'}</h1><div className="walk-summary-stats"><div><strong>{tracking.distanceWalkedKm.toFixed(2)} km</strong><span>Distance walked</span></div><div><strong>{formatElapsedTime(tracking.elapsedSeconds)}</strong><span>Time taken</span></div></div><p><strong>Destination:</strong> {destinationName}</p><button className="button button-dark button-large full-width" onClick={onFinish}>Finish Walk <Check /></button></section> : <><section className="live-walk-dashboard" aria-label="Walk in progress"><div className="live-walk-heading"><div><span className="section-label">Walk in progress</span><strong>{formatElapsedTime(tracking.elapsedSeconds)}</strong><span>Active time</span></div>{tracking.status === 'permission-denied' || tracking.status === 'unavailable' || tracking.status === 'timeout' || tracking.status === 'error' ? <button className="button button-ghost" onClick={onRetryGps}>Retry location</button> : null}</div><div className="live-walk-metrics"><div><strong>{tracking.distanceWalkedKm.toFixed(2)} km</strong><span>Walked</span></div><div><strong>{tracking.remainingDistanceKm.toFixed(2)} km</strong><span>Remaining</span></div><div><strong>{safeEstimatedMinutes > 0 ? `About ${Math.max(1, Math.round(safeEstimatedMinutes))} min` : 'Almost there'}</strong><span>Estimated time left</span></div></div><div className="live-walk-actions">{tracking.isPaused ? <button className="button button-primary" onClick={onResume}><Play /> Resume Walk</button> : <button className="button button-ghost" onClick={onPause}><Pause /> Pause Walk</button>}<button className="button button-ghost" onClick={onEnd}>End Walk</button></div></section>{mission && <div className="mission-card"><div className="mission-top"><span>Mission {String(mission.number).padStart(2, '0')}</span><span className="mission-time"><Activity /> {mission.duration} min</span></div><div className="mission-icon"><Target /></div><h1>{mission.instruction}</h1><div className="put-away"><Pause /> <span><strong>Put your phone away.</strong><br />Explore for a few minutes.</span></div><button className="button button-dark button-large full-width" onClick={onMission}>I Found Something <ArrowRight /></button></div>}{mission && <div className="phone-free-note"><Shield /> Your screen will be here when you get back.</div>}</>}</div>
}

function MissionScreen({ mission, missionIndex, onComplete }: { mission: Mission; missionIndex: number; onComplete: () => void }) { return <div className="mission-full-page"><span className="mission-kicker">Next mission · {String(missionIndex + 1).padStart(2, '0')}</span><div className="mission-big-icon"><Target /></div><h1>{mission.instruction}</h1><p className="mission-big-description">{mission.description}</p><div className="mission-duration"><Activity /> About {mission.duration} minutes</div><div className="mission-quote"><Leaf /> <span>There&apos;s nothing to tap here.<br /><strong>Just go explore.</strong></span></div><button className="button button-dark button-large" onClick={onComplete}>I&apos;m ready <ArrowRight /></button></div> }

function DiscoveryScreen({ preview, result, onUpload, onRemove, onContinue }: { preview: string; result: Discovery | null; onUpload: (file: File) => void; onRemove: () => void; onContinue: () => void }) {
  return <div className="flow-page discovery-page"><PageHeader eyebrow="Real-world discovery" title="What did you discover?" description="Take a photo or upload one to let local Gemma analyze it." /><div className={cn('upload-card', preview && 'upload-card-uploaded')}><div className="upload-visual">{preview ? <img src={preview} alt="Your uploaded discovery" className="discovery-preview" /> : <><Camera /><span>Point your camera at something interesting</span></>}</div>{!preview ? <div className="upload-actions"><label className="button button-primary"><Camera /> Take Photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file) }} /></label><label className="button button-ghost"><Upload /> Upload Photo<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file) }} /></label></div> : <button className="button button-ghost" onClick={onRemove}>Remove or replace image</button>}</div>{result && <div className="discovery-result"><div className="result-top"><span className="ai-label"><Sparkles /> Local Gemma discovery</span>{typeof result.confidence === 'number' && result.confidence >= 55 && <span className="confidence">Gemma estimate · {result.confidence}%</span>}</div><h2><span>🌿</span> {result.title || result.name}</h2><p>{result.observation || result.description}</p>{result.uncertain && result.confidence < 55 && <p className="discovery-uncertainty" role="status">I can&apos;t confidently identify the exact subject, but I can still help you explore what you&apos;re seeing.</p>}{result.whyInteresting && <div className="fact-box"><Sparkles /><div><strong>Why it&apos;s interesting</strong><span>{result.whyInteresting}</span></div></div>}{result.lookCloser && <div className="fact-box"><Compass /><div><strong>Look closer</strong><span>{result.lookCloser}</span></div></div>}{result.microMission?.instruction && <div className="micro-mission"><Target /><div><strong>{result.microMission.title || 'Your next micro-mission'}</strong><span>{result.microMission.instruction}</span>{result.microMission.estimatedMinutes && <small>About {result.microMission.estimatedMinutes} minutes · {result.microMission.difficulty || 'easy'}</small>}</div></div>}{result.nextMission?.instruction && <div className="fact-box"><ArrowRight /><div><strong>How Roamly adapts next</strong><span>{result.nextMission.instruction}</span></div></div>}<p className="discovery-disclaimer">A short glance, then back to the world around you.</p><button className="button button-primary" onClick={onContinue}>Continue Walk <ArrowRight /></button></div>}<div className="discovery-footer"><Shield /> Images are sent to your local Ollama model for analysis.</div></div>
}

function CompleteScreen({ onReflect }: { onReflect: () => void }) { return <div className="complete-page"><div className="complete-mark"><Leaf /></div><div className="eyebrow">That&apos;s a wrap</div><h1>Walk complete <span>🌿</span></h1><p className="complete-subtitle">You made space for something real today.</p><div className="complete-summary"><Sparkles /><p>Your walk is saved. Take a moment to reflect on how it felt.</p></div><button className="button button-dark button-large" onClick={onReflect}>Reflect on my walk <ArrowRight /></button></div> }

function ReflectionScreen({ selected, setSelected, value, setValue, onSave }: { selected: Mood | null; setSelected: (m: Mood) => void; value: string; setValue: (v: string) => void; onSave: () => void }) { const options: { id: Mood; label: string; icon: typeof Smile }[] = [{ id: 'happy', label: 'Better', icon: Smile }, { id: 'thinking', label: 'Same', icon: MoreHorizontal }, { id: 'tired', label: 'Worse', icon: Cloud }]; return <div className="flow-page reflection-page"><PageHeader eyebrow="Last step" title="How do you feel now?" description="A tiny check-in helps your next walk become more personal." /><div className="reflection-options">{options.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setSelected(id)} className={cn('reflection-option', selected === id && 'reflection-selected')}><Icon /><span>{label}</span>{selected === id && <Check />}</button>)}</div><label className="field-label" htmlFor="reflection">Tell us how the walk went...</label><textarea id="reflection" className="text-area" value={value} onChange={(e) => setValue(e.target.value)} placeholder="A thought, a feeling, a small detail you noticed..." rows={5} /><div className="reflection-note"><Sparkles /><span>Your reflections are private and help Roamly understand what kind of walks feel good for you.</span></div><button className="button button-primary button-large" disabled={!selected} onClick={onSave}>Save My Walk <Check /></button></div> }

function HistoryScreen({ walks, onStart }: { walks: WalkHistory[]; onStart: () => void }) { const formatDate = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); return <div className="section-page"><div className="section-page-header"><div><div className="eyebrow"><span className="eyebrow-line" /> Your outdoor archive</div><h1>My walks</h1><p>Small steps add up to a life well lived.</p></div><button className="button button-primary" onClick={onStart}><Plus /> New walk</button></div><div className="history-list">{walks.length === 0 ? <div className="empty-state">No walks yet. Your first one starts outside.</div> : walks.map((walk) => <div className="history-card" key={walk.id}><div className="history-date">{formatDate(walk.date)}<span className="history-dot" /></div><div className="history-main"><div><h2>{walk.title}</h2><p>{walk.duration} min <span>·</span> {walk.distance} km <span>·</span> {walk.missionCount} missions</p></div></div><div className="history-meta"><span><span className="mood-mini"><Smile /></span>{moodLabels[walk.moodBefore]} <ArrowRight /> {moodLabels[walk.moodAfter]}</span><span><Leaf /> {walk.discoveries} discoveries</span><button aria-label="Share walk"><Share2 /></button></div></div>)}</div></div> }

function ProfileScreen({ stats }: { stats: UserStats }) { return <div className="section-page profile-page"><div className="profile-heading"><div className="profile-avatar">AR</div><div><div className="eyebrow"><span className="eyebrow-line" /> Your outdoor self</div><h1>Alex&apos;s profile</h1><p>{stats.streakDays} day streak</p></div><button className="icon-button" aria-label="Settings"><Settings /></button></div><div className="profile-stat-grid"><div><BarChart3 /><strong>{stats.totalWalks.toLocaleString()}</strong><span>Total walks</span></div><div><Activity /><strong>{stats.totalMinutesOutside.toLocaleString()}</strong><span>Minutes outside</span></div><div><RouteIcon /><strong>{stats.totalDistance}</strong><span>Km explored</span></div><div><Leaf /><strong>{stats.totalDiscoveries.toLocaleString()}</strong><span>Discoveries</span></div><div><Sparkles /><strong>{stats.missionsCompleted || 0}</strong><span>Missions</span></div></div><div className="activity-card"><div className="activity-header"><div><div className="section-label">Local open-source AI</div><h2>Powered by local Gemma 3</h2></div></div><p>Roamly uses Ollama on your computer for mission, reflection, and discovery assistance.</p></div></div> }

function MobileNav({ screen, onNavigate }: { screen: Screen; onNavigate: (screen: Screen) => void }) { return <nav className="mobile-nav" aria-label="Mobile navigation">{navItems.map((item) => { const Icon = item.icon; const active = (item.id === 'home' && screen === 'home') || (item.id === 'walk' && ['mood','preferences','route','walk','mission','discovery','complete','reflection'].includes(screen)) || screen === item.id; return <button key={item.id} className={active ? 'mobile-nav-active' : ''} onClick={() => onNavigate(item.id)}><Icon /><span>{item.label}</span></button> })}</nav> }
