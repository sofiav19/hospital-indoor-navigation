// src/store/navStore.ts
import { create } from "zustand";
import {
  DEFAULT_TRACKING_CALIBRATION,
  applyTrackingCalibration,
  type TrackingCalibration,
} from "../lib/coords/trackingCalibration";

type NavDataState = {
  nodes: any | null;
  edges: any | null;
  floorplan: any | null;
  renderNodes: any | null;
  renderEdges: any | null;
  renderFloorplan: any | null;
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

type NavigationUiState = {
  isStarted: boolean;
  prefer: NavigationPreference;
  mapViewMode: MapViewMode;
  soundEnabled: boolean;
  activeStepIndex: number;
  navigationFloor: number | null;
  hasDismissedHomeHero: boolean;
};

type StartState = {
  nodeId: string | null;
  coords: [number, number] | null;
};

type LivePositionProvider = "none" | "simulated" | "optitrack";

type LivePositionState = {
  provider: LivePositionProvider;
  coords: [number, number] | null;
  floor: number | null;
  stepMeters: number;
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
  setStartNode: (nodeId: string) => void;
  setStartCoords: (coords: [number, number]) => void;
  setLivePositionProvider: (provider: LivePositionProvider) => void;
  setLivePosition: (coords: [number, number] | null, floor?: number | null) => void;
  setLiveFloor: (floor: number | null) => void;
  nudgeLivePosition: (delta: [number, number]) => void;
  setLiveStepMeters: (stepMeters: number) => void;
  resetLivePositionToStart: () => void;
  setTrackingCalibration: (partial: Partial<TrackingCalibration>) => void;
  ingestTrackedSample: (coords: [number, number], floor?: number | null) => void;

  setDestinationId: (id: string) => void;
  setPostNavStartOverrideId: (id: string | null) => void;
  clearPostNavStartOverride: () => void;

  setRoute: (route: Partial<RouteState>) => void;
  resetRoute: () => void;
  setNavigationStarted: (started: boolean) => void;
  setNavigationPreference: (prefer: NavigationPreference) => void;
  setMapViewMode: (mode: MapViewMode) => void;
  toggleNavigationPreference: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  setActiveStepIndex: (index: number) => void;
  setNavigationFloor: (floor: number | null) => void;
  setHomeHeroDismissed: (dismissed: boolean) => void;
};

export const useNavStore = create<Store>((set, get) => ({
  navData: {
    nodes: null,
    edges: null,
    floorplan: null,
    renderNodes: null,
    renderEdges: null,
    renderFloorplan: null,
    isLoaded: false,
    validationErrors: [],
  },

  start: { nodeId: "n_hospital_entrance_f0", coords: null },
  livePosition: {
    provider: "none",
    coords: null,
    floor: 0,
    stepMeters: 1,
    calibration: DEFAULT_TRACKING_CALIBRATION,
  },
  destinationId: null,
  postNavStartOverrideId: null,

  route: {
    ok: false,
    geojson: null,
    currentFloorGeojson: null,
    futureFloorGeojson: null,
    routeNodesGeojson: null,
    summary: null,
    reason: null,
  },
  navigationUi: {
    isStarted: false,
    prefer: "stairs",
    mapViewMode: "navigate",
    soundEnabled: true,
    activeStepIndex: 0,
    navigationFloor: 0,
    hasDismissedHomeHero: false,
  },

  setNavData: (partial) =>
    set((s) => ({
      navData: { ...s.navData, ...partial },
    })),

  setStartNode: (nodeId) => set((s) => ({ start: { ...s.start, nodeId, coords: null } })),
  setStartCoords: (coords) => set((s) => ({ start: { ...s.start, coords } })),
  setLivePositionProvider: (provider) =>
    set((s) => ({
      livePosition: {
        ...s.livePosition,
        provider,
        coords: provider === "none" ? null : s.livePosition.coords,
      },
    })),
  setLivePosition: (coords, floor = null) =>
    set((s) => ({
      livePosition: {
        ...s.livePosition,
        coords,
        floor: floor ?? s.livePosition.floor,
      },
    })),
  setLiveFloor: (floor) =>
    set((s) => ({
      livePosition: {
        ...s.livePosition,
        floor,
      },
    })),
  nudgeLivePosition: (delta) =>
    set((s) => {
      const baseCoords = s.livePosition.coords || s.start.coords || [0, 0];
      return {
        livePosition: {
          ...s.livePosition,
          coords: [baseCoords[0] + delta[0], baseCoords[1] + delta[1]],
        },
      };
    }),
  setLiveStepMeters: (stepMeters) =>
    set((s) => ({
      livePosition: { ...s.livePosition, stepMeters: Math.max(0.1, stepMeters) },
    })),
  resetLivePositionToStart: () =>
    set((s) => {
      const startNode = s.navData.nodes?.features?.find(
        (feature: any) => feature.properties?.id === s.start.nodeId
      );
      return {
        livePosition: {
          ...s.livePosition,
          coords: s.start.coords || startNode?.geometry?.coordinates || null,
          floor: startNode?.properties?.floor ?? s.livePosition.floor,
        },
      };
    }),
  setTrackingCalibration: (partial) =>
    set((s) => ({
      livePosition: {
        ...s.livePosition,
        calibration: { ...s.livePosition.calibration, ...partial },
      },
    })),
  ingestTrackedSample: (coords, floor = null) =>
    set((s) => ({
      livePosition: {
        ...s.livePosition,
        provider: "optitrack",
        coords: applyTrackingCalibration(coords, s.livePosition.calibration),
        floor: floor ?? s.livePosition.floor,
      },
    })),

  setDestinationId: (id) => set({ destinationId: id }),
  setPostNavStartOverrideId: (id) => set({ postNavStartOverrideId: id }),
  clearPostNavStartOverride: () => set({ postNavStartOverrideId: null }),

  setRoute: (partial) => set((s) => ({ route: { ...s.route, ...partial } })),
  resetRoute: () =>
    set({
      route: {
        ok: false,
        geojson: null,
        currentFloorGeojson: null,
        futureFloorGeojson: null,
        routeNodesGeojson: null,
        summary: null,
        reason: null,
      },
    }),
  setNavigationStarted: (started) =>
    set((s) => ({
      navigationUi: {
        ...s.navigationUi,
        isStarted: started,
        activeStepIndex: started ? s.navigationUi.activeStepIndex : 0,
      },
    })),
  setNavigationPreference: (prefer) =>
    set((s) => ({ navigationUi: { ...s.navigationUi, prefer } })),
  setMapViewMode: (mode) =>
    set((s) => ({ navigationUi: { ...s.navigationUi, mapViewMode: mode } })),
  toggleNavigationPreference: () =>
    set((s) => ({
      navigationUi: {
        ...s.navigationUi,
        prefer: s.navigationUi.prefer === "stairs" ? "elevator" : "stairs",
      },
    })),
  setSoundEnabled: (enabled) =>
    set((s) => ({ navigationUi: { ...s.navigationUi, soundEnabled: enabled } })),
  setActiveStepIndex: (index) =>
    set((s) => ({ navigationUi: { ...s.navigationUi, activeStepIndex: Math.max(0, index) } })),
  setNavigationFloor: (floor) =>
    set((s) => ({ navigationUi: { ...s.navigationUi, navigationFloor: floor } })),
  setHomeHeroDismissed: (dismissed) =>
    set((s) => ({ navigationUi: { ...s.navigationUi, hasDismissedHomeHero: dismissed } })),
}));
