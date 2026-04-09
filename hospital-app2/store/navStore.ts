// src/store/navStore.ts
import { create } from "zustand";
import {
  DEFAULT_TRACKING_CALIBRATION,
  applyTrackingCalibration,
  type TrackingCalibration,
} from "../lib/coords/trackingCalibration";

// Types for navigation data and state

type NavDataState = {
  nodes: any | null;
  edges: any | null;
  floorplan: any | null;
  renderNodes: any | null;
  renderEdges: any | null;
  renderFloorplan: any | null;
  version: string | null;
  updatedAt: string | null;
  source: string | null;
  isLoaded: boolean;
  validationErrors: string[];
};

type RouteState = {
  ok: boolean;
  geojson: any | null;
  currentFloorGeojson?: any | null;
  futureFloorGeojson?: any | null;
  routeNodesGeojson?: any | null;
  summary: any | null;
  reason: string | null;
};

type NavigationPreference = "stairs" | "elevator";
type MapViewMode = "navigate" | "ar";
export type TextSizePreset = "small" | "medium" | "large";
type StartSource = "auto-entrance" | "manual-node" | "current-location";

type NavigationUiState = {
  isStarted: boolean;
  routeStartedAtMs: number | null;
  prefer: NavigationPreference;
  mapViewMode: MapViewMode;
  soundEnabled: boolean;
  textSize: TextSizePreset;
  highContrastEnabled: boolean;
  activeStepIndex: number;
  navigationFloor: number | null;
  hasDismissedIntro: boolean;
  recentDestinationIds: string[];
};

type StartState = {
  nodeId: string | null;
  coords: [number, number] | null;
  source: StartSource;
};

type LivePositionProvider = "none" | "optitrack";

type LivePositionState = {
  provider: LivePositionProvider;
  coords: [number, number] | null;
  floor: number | null;
  calibration: TrackingCalibration;
};

type Store = {
  navData: NavDataState;

  start: StartState;
  livePosition: LivePositionState;
  destinationId: string | null;
  postNavStartOverrideId: string | null;

  route: RouteState;
  navigationUi: NavigationUiState;

  setNavData: (partial: Partial<NavDataState>) => void;
  setStartNode: (
    nodeId: string,
    source?: StartSource,
    coords?: [number, number] | null
  ) => void;
  setLivePositionProvider: (provider: LivePositionProvider) => void;
  setLiveFloor: (floor: number | null) => void;
  ingestTrackedSample: (coords: [number, number], floor?: number | null) => void;

  setDestinationId: (id: string) => void;
  setPostNavStartOverrideId: (id: string | null) => void;
  clearPostNavStartOverride: () => void;

  setRoute: (route: Partial<RouteState>) => void;
  setNavigationStarted: (started: boolean) => void;
  setNavigationPreference: (prefer: NavigationPreference) => void;
  setMapViewMode: (mode: MapViewMode) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setTextSize: (size: TextSizePreset) => void;
  setHighContrastEnabled: (enabled: boolean) => void;
  setActiveStepIndex: (index: number) => void;
  setNavigationFloor: (floor: number | null) => void;
  setIntroDismissed: (dismissed: boolean) => void;
};

export const useNavStore = create<Store>((set) => ({
  // Navigation data loaded from backend or local fallback
  navData: {
    nodes: null,
    edges: null,
    floorplan: null,
    renderNodes: null,
    renderEdges: null,
    renderFloorplan: null,
    version: null,
    updatedAt: null,
    source: null,
    isLoaded: false,
    validationErrors: [],
  },

  // Current start position, either set manually or from auto-detected entrance or current location
  start: { nodeId: "n_hospital_entrance_f0", coords: null, source: "auto-entrance" },
  livePosition: {
    provider: "none",
    coords: null,
    floor: 0,
    calibration: DEFAULT_TRACKING_CALIBRATION,
  },
  destinationId: null,
  postNavStartOverrideId: null,

  // Current route and navigation state
  route: {
    ok: false,
    geojson: null,
    currentFloorGeojson: null,
    futureFloorGeojson: null,
    routeNodesGeojson: null,
    summary: null,
    reason: null,
  },
  // UI state for navigation screen
  navigationUi: {
    isStarted: false,
    routeStartedAtMs: null,
    prefer: "stairs",
    mapViewMode: "navigate",
    soundEnabled: false,
    textSize: "medium",
    highContrastEnabled: false,
    activeStepIndex: 0,
    navigationFloor: 0,
    hasDismissedIntro: false,
    recentDestinationIds: [],
  },
  
  // Setters for updating the store

  setNavData: (partial) =>
    set((s) => ({
      navData: { ...s.navData, ...partial },
    })),

  setStartNode: (nodeId, source = "manual-node", coords) =>
    set((s) => ({
      start: {
        ...s.start,
        nodeId,
        source,
        coords:
          coords !== undefined
            ? coords
            : source === "auto-entrance"
              ? null
              : s.start.coords,
      },
    })),
  setLivePositionProvider: (provider) =>
    set((s) => {
      const nextCoords = provider === "none" ? null : s.livePosition.coords;
      if (s.livePosition.provider === provider && s.livePosition.coords === nextCoords) {
        return s;
      }

      return {
        livePosition: {
          ...s.livePosition,
          provider,
          coords: nextCoords,
        },
      };
    }),
  setLiveFloor: (floor) =>
    set((s) => {
      if (s.livePosition.floor === floor) {
        return s;
      }

      return {
        livePosition: {
          ...s.livePosition,
          floor,
        },
      };
    }),
  ingestTrackedSample: (coords, floor = null) =>
    set((s) => ({
      livePosition: {
        ...s.livePosition,
        provider: "optitrack",
        coords: applyTrackingCalibration(coords, s.livePosition.calibration),
        floor: floor ?? s.livePosition.floor,
      },
    })),

  setDestinationId: (id) =>
    set((s) => ({
      destinationId: id,
      navigationUi: {
        ...s.navigationUi,
        recentDestinationIds: [
          id,
          ...s.navigationUi.recentDestinationIds.filter((recentId) => recentId !== id),
        ].slice(0, 6),
      },
    })),
  setPostNavStartOverrideId: (id) => set({ postNavStartOverrideId: id }),
  clearPostNavStartOverride: () => set({ postNavStartOverrideId: null }),

  setRoute: (partial) => set((s) => ({ route: { ...s.route, ...partial } })),
  setNavigationStarted: (started) =>
    set((s) => {
      const nextRouteStartedAtMs = started ? s.navigationUi.routeStartedAtMs ?? Date.now() : null;
      const nextActiveStepIndex = started ? s.navigationUi.activeStepIndex : 0;

      if (
        s.navigationUi.isStarted === started &&
        s.navigationUi.routeStartedAtMs === nextRouteStartedAtMs &&
        s.navigationUi.activeStepIndex === nextActiveStepIndex
      ) {
        return s;
      }

      return {
        navigationUi: {
          ...s.navigationUi,
          isStarted: started,
          routeStartedAtMs: nextRouteStartedAtMs,
          activeStepIndex: nextActiveStepIndex,
        },
      };
    }),
  setNavigationPreference: (prefer) =>
    set((s) =>
      s.navigationUi.prefer === prefer ? s : { navigationUi: { ...s.navigationUi, prefer } }
    ),
  setMapViewMode: (mode) =>
    set((s) =>
      s.navigationUi.mapViewMode === mode ? s : { navigationUi: { ...s.navigationUi, mapViewMode: mode } }
    ),
  setSoundEnabled: (enabled) =>
    set((s) =>
      s.navigationUi.soundEnabled === enabled
        ? s
        : { navigationUi: { ...s.navigationUi, soundEnabled: enabled } }
    ),
  setTextSize: (textSize) =>
    set((s) =>
      s.navigationUi.textSize === textSize
        ? s
        : { navigationUi: { ...s.navigationUi, textSize } }
    ),
  setHighContrastEnabled: (enabled) =>
    set((s) =>
      s.navigationUi.highContrastEnabled === enabled
        ? s
        : { navigationUi: { ...s.navigationUi, highContrastEnabled: enabled } }
    ),
  setActiveStepIndex: (index) =>
    set((s) => {
      const nextIndex = Math.max(0, index);
      return s.navigationUi.activeStepIndex === nextIndex
        ? s
        : { navigationUi: { ...s.navigationUi, activeStepIndex: nextIndex } };
    }),
  setNavigationFloor: (floor) =>
    set((s) =>
      s.navigationUi.navigationFloor === floor
        ? s
        : { navigationUi: { ...s.navigationUi, navigationFloor: floor } }
    ),
  setIntroDismissed: (dismissed) =>
    set((s) =>
      s.navigationUi.hasDismissedIntro === dismissed
        ? s
        : { navigationUi: { ...s.navigationUi, hasDismissedIntro: dismissed } }
    ),
}));
