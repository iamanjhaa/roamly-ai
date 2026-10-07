export type Mood = 'stressed' | 'tired' | 'bored' | 'happy' | 'thinking' | 'energetic' | 'peace';

export interface UserPreferences {
  mood: Mood;
  customMood?: string;
  duration: number; // in minutes
  distance: number; // in km
  difficulty: 'easy' | 'moderate' | 'challenging';
  environment: 'nature' | 'quiet' | 'scenic' | 'urban';
  crowdLevel: 'low' | 'medium' | 'doesnt-matter';
}

export interface WalkExperience {
  experienceTitle: string;
  recommendedPlaceType: string;
  reason: string;
  experienceGoal: string;
  preferredCharacteristics: string[];
}

export interface RoutePoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description?: string;
}

export interface Destination {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description?: string;
  characteristics?: string[];
  category?: string;
  distance?: number;
  walkingDuration?: number;
  popularityScore?: number;
  moodFitScore?: number;
  publicAccess?: boolean;
  isRecommended?: boolean;
}

export interface Route {
  id: string;
  title: string;
  duration: number; // in minutes
  distance: number; // in km
  difficulty: 'easy' | 'moderate' | 'challenging';
  greenery: 'low' | 'medium' | 'high';
  crowd: 'low' | 'medium' | 'high';
  startPoint: RoutePoint;
  destination: Destination;
  destinations?: Destination[];
  primaryDestination?: Destination;
  checkpoints: RoutePoint[];
  aiReasoning: string;
  geometry: [number, number][];
  steps?: unknown[];
  destinationAddress?: string;
  experience?: WalkExperience;
}

export type GpsStatus = 'idle' | 'starting' | 'active' | 'weak' | 'permission-denied' | 'unavailable' | 'timeout' | 'error';

export interface TrackingLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface WalkTrackingState {
  status: GpsStatus;
  isActive: boolean;
  isPaused: boolean;
  isEnded: boolean;
  accuracy: number | null;
  location: TrackingLocation | null;
  walkedPath: TrackingLocation[];
  distanceWalkedKm: number;
  completedRouteDistanceKm: number;
  remainingDistanceKm: number;
  progress: number;
  elapsedSeconds: number;
  walkStartedAt: number | null;
  offRoute: boolean;
  arrived: boolean;
}

export interface Mission {
  id: string;
  number: number;
  instruction: string;
  duration: number; // in minutes
  phoneAway: boolean;
  title?: string;
  description?: string;
  type?: string;
}

export interface Discovery {
  id: string;
  missionId: string;
  title: string;
  confidence: number; // 0-100
  description: string;
  interestingFact: string;
  observation?: string;
  whyInteresting?: string;
  lookCloser?: string;
  microMission?: {
    title: string;
    instruction: string;
    estimatedMinutes?: number;
    difficulty?: 'easy' | 'medium';
  } | null;
  nextMission?: {
    type: string;
    instruction: string;
  } | null;
  photoUrl?: string;
  name?: string;
  category?: string;
  uncertain?: boolean;
}

export interface WalkSession {
  id: string;
  startTime: Date;
  endTime?: Date;
  preferences: UserPreferences;
  route: Route;
  missions: Mission[];
  discoveries: Discovery[];
  distanceCovered: number;
  timeSpent: number;
  phoneFreeMins: number;
}

export interface WalkReflection {
  walkId: string;
  moodBefore: Mood;
  moodAfter: Mood;
  notes?: string;
  score: number; // 0-100
}

export interface WalkHistory {
  id: string;
  date: Date;
  title: string;
  duration: number;
  distance: number;
  moodBefore: Mood;
  moodAfter: Mood;
  discoveries: number;
  score: number;
  missionCount: number;
}

export interface UserStats {
  totalWalks: number;
  totalMinutesOutside: number;
  totalDistance: number;
  totalDiscoveries: number;
  averageScore: number;
  streakDays: number;
  missionsCompleted?: number;
}

export interface AppState {
  currentScreen: 'home' | 'mood' | 'preferences' | 'route' | 'walk' | 'mission' | 'discovery' | 'reflection' | 'complete' | 'history' | 'profile';
  preferences?: UserPreferences;
  route?: Route;
  currentWalk?: WalkSession;
  currentMissionIndex: number;
  walks: WalkHistory[];
  stats: UserStats;
  theme: 'light' | 'dark';
}
