'use client'

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Route, TrackingLocation } from '@/lib/types'

type Coordinates = [number, number]

interface RoamlyMapProps {
  route: Route
  location: TrackingLocation | null
  walkedPath: TrackingLocation[]
  compact?: boolean
}

const routeSourceId = 'roamly-route'
const walkedSourceId = 'roamly-walked-path'
const routeLayerId = 'roamly-route-line'
const walkedLayerId = 'roamly-walked-line'

function validCoordinates(value: Coordinates | undefined): value is Coordinates {
  return Boolean(value
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180 && value[0] <= 180
    && value[1] >= -90 && value[1] <= 90)
}

function routeCoordinates(route: Route): Coordinates[] {
  return route.geometry.map(([latitude, longitude]) => [longitude, latitude])
}

function makeMarker(label: string, className: string) {
  const element = document.createElement('div')
  element.className = className
  element.setAttribute('aria-label', label)
  element.title = label
  return element
}

export default function RoamlyMap({ route, location, walkedPath, compact = false }: RoamlyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const routeMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const nearbyMarkersRef = useRef<mapboxgl.Marker[]>([])
  const locationRef = useRef(location)
  const routeRef = useRef(route)
  const [mapError, setMapError] = useState('')

  const start: Coordinates = [route.startPoint.lng, route.startPoint.lat]
  const destination: Coordinates = [route.destination.lng, route.destination.lat]
  const destinationName = route.destination.name.trim()

  useEffect(() => {
    routeRef.current = route
    const map = mapRef.current
    if (!map || !validCoordinates(destination)) return

    const routeData = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: routeCoordinates(route) },
    }
    const source = map.getSource(routeSourceId) as mapboxgl.GeoJSONSource | undefined
    if (source) source.setData(routeData)
    routeMarkerRef.current
      ?.setLngLat(destination)
      .setPopup(new mapboxgl.Popup({ offset: 18 }).setText(destinationName))
  }, [route, destination[0], destination[1]])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    nearbyMarkersRef.current.forEach((marker) => marker.remove())
    nearbyMarkersRef.current = (route.destinations || [])
      .filter((place) => place.id !== route.destination.id && Number.isFinite(place.lat) && Number.isFinite(place.lng))
      .map((place) => new mapboxgl.Marker({ element: makeMarker(place.name, 'roamly-nearby-marker') })
        .setLngLat([place.lng, place.lat])
        .setPopup(new mapboxgl.Popup({ offset: 18 }).setText(`${place.name} · ${place.category || 'public outdoor place'} · ${place.distance ?? ''} km`))
        .addTo(map))
    return () => {
      nearbyMarkersRef.current.forEach((marker) => marker.remove())
      nearbyMarkersRef.current = []
    }
  }, [route.destinations, route.destination.id])

  useEffect(() => {
    locationRef.current = location
    const map = mapRef.current
    if (!map) return
    const updateMarker = () => {
      const currentLocation = locationRef.current
      if (!currentLocation) return
      const coordinates: Coordinates = [currentLocation.longitude, currentLocation.latitude]
      if (!validCoordinates(coordinates)) return
      if (!userMarkerRef.current) {
        userMarkerRef.current = new mapboxgl.Marker({ element: makeMarker('You are here', 'roamly-user-marker') })
          .setLngLat(coordinates)
          .addTo(map)
      } else {
        userMarkerRef.current.setLngLat(coordinates)
      }
      console.info('[GPS] marker updated')
    }
    if (map.isStyleLoaded()) updateMarker()
    else map.once('load', updateMarker)
  }, [location])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const updateWalkedPath = () => {
      const source = map.getSource(walkedSourceId) as mapboxgl.GeoJSONSource | undefined
      if (!source) return
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: walkedPath.map((point): Coordinates => [point.longitude, point.latitude]),
        },
      })
    }
    if (map.isStyleLoaded()) updateWalkedPath()
    else map.once('load', updateWalkedPath)
  }, [walkedPath])

  useEffect(() => {
    if (!containerRef.current) return
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim()
    if (!token) {
      setMapError('Mapbox access token is missing. Add NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to .env.local and restart the app.')
      return
    }
    if (!token.startsWith('pk.')) {
      setMapError('Mapbox public access token is invalid.')
      return
    }
    if (!mapboxgl.supported()) {
      setMapError('Mapbox GL is not supported by this browser/device.')
      return
    }
    if (!destinationName || !validCoordinates(start) || !validCoordinates(destination) || route.geometry.length < 2) {
      setMapError('Destination unavailable — please try again.')
      return
    }

    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      center: start,
      zoom: compact ? 15 : 13,
      attributionControl: true,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right')

    const routeData = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: routeCoordinates(routeRef.current) },
    }
    const walkedData = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: [] as Coordinates[] },
    }

    map.on('load', () => {
      console.log('[MAPBOX] map loaded')
      map.addSource(routeSourceId, { type: 'geojson', data: routeData })
      map.addLayer({
        id: routeLayerId,
        type: 'line',
        source: routeSourceId,
        paint: { 'line-color': '#365947', 'line-width': 5, 'line-opacity': 0.9 },
      })
      map.addSource(walkedSourceId, { type: 'geojson', data: walkedData })
      map.addLayer({
        id: walkedLayerId,
        type: 'line',
        source: walkedSourceId,
        paint: { 'line-color': '#d8ad60', 'line-width': 4, 'line-opacity': 0.8 },
      })
      routeMarkerRef.current = new mapboxgl.Marker({ element: makeMarker(destinationName, 'roamly-destination-marker') })
        .setLngLat(destination)
        .setPopup(new mapboxgl.Popup({ offset: 18 }).setText(destinationName))
        .addTo(map)
      nearbyMarkersRef.current = (routeRef.current.destinations || [])
        .filter((place) => place.id !== routeRef.current.destination.id && Number.isFinite(place.lat) && Number.isFinite(place.lng))
        .map((place) => new mapboxgl.Marker({ element: makeMarker(place.name, 'roamly-nearby-marker') })
          .setLngLat([place.lng, place.lat])
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setText(`${place.name} · ${place.category || 'public outdoor place'} · ${place.distance ?? ''} km`))
          .addTo(map))
      if (locationRef.current) {
        userMarkerRef.current = new mapboxgl.Marker({ element: makeMarker('You are here', 'roamly-user-marker') })
          .setLngLat([locationRef.current.longitude, locationRef.current.latitude])
          .addTo(map)
        console.info('[GPS] marker updated')
      }
      const bounds = new mapboxgl.LngLatBounds()
      routeCoordinates(routeRef.current).forEach((coordinate) => bounds.extend(coordinate))
      map.fitBounds(bounds, { padding: compact ? 50 : 80, duration: 0 })
    })
    map.on('error', (event) => {
      const message = event.error?.message || 'Unknown Mapbox error'
      console.error('[MAPBOX] map error', event.error)
      const category = /401|unauthorized|access.token|token/i.test(message)
        ? 'MAPBOX_AUTH_ERROR'
        : /style|tile|source/i.test(message)
          ? 'MAPBOX_STYLE_OR_TILE_ERROR'
          : /webgl|context/i.test(message)
            ? 'MAPBOX_WEBGL_ERROR'
            : 'MAPBOX_ERROR'
      setMapError(`${category}: ${message}`)
    })

    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)
    requestAnimationFrame(() => map.resize())

    return () => {
      resizeObserver.disconnect()
      userMarkerRef.current?.remove()
      routeMarkerRef.current?.remove()
      userMarkerRef.current = null
      routeMarkerRef.current = null
      nearbyMarkersRef.current.forEach((marker) => marker.remove())
      nearbyMarkersRef.current = []
      map.remove()
      mapRef.current = null
    }
  // The map must be created once for this walk; route and location updates use sources/markers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (mapError) return <div className="map-error" role="alert">{mapError}</div>
  return <div className={`roamly-map ${compact ? 'map-compact' : ''}`} ref={containerRef} aria-label="Live Roamly walking map" />
}
