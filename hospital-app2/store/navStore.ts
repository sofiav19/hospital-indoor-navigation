// src/store/navStore.ts
import { create } from "zustand";

type NavDataState = {
  nodes: any | null;
  edges: any | null;
  floorplan: any | null;
  isLoaded: boolean;
  validationErrors: string[];
};

type RouteState = {
  ok: boolean;
  geojson: any | null;
  summary: any | null;
  reason: string | null;
};

type StartState = {
  // For now, default to entrance node. Later: gps/opti -> coords.
  nodeId: string | null;
  coords: [number, number] | null; // local meters (later), or already map coords if you decide
};

type Store = {
  navData: NavDataState;

  start: StartState;
  destinationId: string | null;

  route: RouteState;

  setNavData: (partial: Partial<NavDataState>) => void;
  setStartNode: (nodeId: string) => void;
  setStartCoords: (coords: [number, number]) => void;

  setDestinationId: (id: string) => void;

  setRoute: (route: Partial<RouteState>) => void;
  resetRoute: () => void;
};

export const useNavStore = create<Store>((set, get) => ({
  navData: {
    nodes: null,
    edges: null,
    floorplan: null,
    isLoaded: false,
    validationErrors: [],
  },

  start: { nodeId: "n_hospital_entrance", coords: null },
  destinationId: null,

  route: { ok: false, geojson: null, summary: null, reason: null },

  setNavData: (partial) =>
    set((s) => ({
      navData: { ...s.navData, ...partial },
    })),

  setStartNode: (nodeId) => set((s) => ({ start: { ...s.start, nodeId, coords: null } })),
  setStartCoords: (coords) => set((s) => ({ start: { ...s.start, coords } })),

  setDestinationId: (id) => set({ destinationId: id }),

  setRoute: (partial) => set((s) => ({ route: { ...s.route, ...partial } })),
  resetRoute: () => set({ route: { ok: false, geojson: null, summary: null, reason: null } }),
}));