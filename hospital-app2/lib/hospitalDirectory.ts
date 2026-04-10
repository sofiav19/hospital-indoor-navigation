export type DirectoryCategoryKey = "recent" | "specialties" | "diagnostics" | "services" | "entrances";

export type DirectoryCategory = {
  key: DirectoryCategoryKey;
  chipLabel: string;
  sectionTitle: string;
  searchPlaceholder: string;
};

export type HospitalDirectoryEntry = {
  id: string;
  category: DirectoryCategoryKey;
  name: string;
  street?: string;
  doctor?: string;
  roomNumber?: string;
  floor: number;
  destinationNodeId: string;
  keywords: string[];
};

export type HospitalDirectoryLoadResult = {
  source: "backend" | "local-fallback";
  categoriesCount: number;
  entriesCount: number;
  error?: string | null;
};

// backend endpoint
const DIRECTORY_URL = process.env.EXPO_PUBLIC_DIRECTORY_URL || "http://localhost:4000/api/directory";
const DIRECTORY_TIMEOUT_MS = 3000;

// Local fallback data
const LOCAL_DIRECTORY_CATEGORIES: DirectoryCategory[] = [
  {
    key: "recent",
    chipLabel: "Recientes",
    sectionTitle: "Destinos recientes",
    searchPlaceholder: "Buscar reciente",
  },
  {
    key: "specialties",
    chipLabel: "Especialidad",
    sectionTitle: "Especialidades",
    searchPlaceholder: "Buscar especialidad",
  },
  {
    key: "diagnostics",
    chipLabel: "Prueba diagnostica",
    sectionTitle: "Pruebas medicas",
    searchPlaceholder: "Buscar prueba medica",
  },
  {
    key: "services",
    chipLabel: "Servicios",
    sectionTitle: "Servicios",
    searchPlaceholder: "Buscar servicio",
  },
  {
    key: "entrances",
    chipLabel: "Entradas",
    sectionTitle: "Entradas",
    searchPlaceholder: "Buscar entrada",
  },
];

const LOCAL_HOSPITAL_DIRECTORY: HospitalDirectoryEntry[] = [
  {
    id: "spec-gynecology-f1",
    category: "specialties",
    name: "Ginecologia",
    doctor: "Dra. Lucia Martin",
    roomNumber: "101",
    floor: 1,
    destinationNodeId: "n_car_door_1",
    keywords: ["ginecologia", "obstetrica", "mujer", "101"],
  },
  {
    id: "spec-ultrasound-f1",
    category: "specialties",
    name: "Ecografia",
    doctor: "Dr. Javier Ortega",
    roomNumber: "102",
    floor: 1,
    destinationNodeId: "n_car_door_2",
    keywords: ["ultrasonido", "ecografia", "imagen", "102"],
  },
  {
    id: "spec-medical-tests-f1",
    category: "specialties",
    name: "Pruebas medicas",
    doctor: "Dra. Elena Ruiz",
    roomNumber: "103",
    floor: 1,
    destinationNodeId: "n_car_door_3",
    keywords: ["pruebas", "medicas", "tests", "103"],
  },
  {
    id: "spec-radiology-f1",
    category: "specialties",
    name: "Radiologia",
    doctor: "Dr. Carlos Vega",
    roomNumber: "201",
    floor: 1,
    destinationNodeId: "n_neu_door_1",
    keywords: ["radiologia", "rayos x", "imagen", "201"],
  },
  {
    id: "spec-pediatrics-f1",
    category: "specialties",
    name: "Pediatria",
    doctor: "Dra. Marta Sanchez",
    roomNumber: "203",
    floor: 1,
    destinationNodeId: "n_neu_door_3",
    keywords: ["pediatria", "ninos", "infantil", "203"],
  },
  {
    id: "spec-cardiology-1-f0",
    category: "specialties",
    name: "Cardiologia general",
    doctor: "Dr. Alvaro Perez",
    roomNumber: "001",
    floor: 0,
    destinationNodeId: "n_car_door_1_f0",
    keywords: ["cardiologia", "corazon", "cardio", "001"],
  },
  {
    id: "spec-cardiology-2-f0",
    category: "specialties",
    name: "Cardiologia preventiva",
    doctor: "Dra. Paula Gomez",
    roomNumber: "002",
    floor: 0,
    destinationNodeId: "n_car_door_2_f0",
    keywords: ["cardiologia", "corazon", "cardio", "002"],
  },
  {
    id: "spec-cardiology-3-f0",
    category: "specialties",
    name: "Cardiologia de arritmias",
    doctor: "Dr. Sergio Navarro",
    roomNumber: "003",
    floor: 0,
    destinationNodeId: "n_car_door_3_f0",
    keywords: ["cardiologia", "corazon", "cardio", "003"],
  },
  {
    id: "spec-cardiology-4-f0",
    category: "specialties",
    name: "Consulta de insuficiencia cardiaca",
    doctor: "Dra. Irene Lozano",
    roomNumber: "004",
    floor: 0,
    destinationNodeId: "n_car_door_4_f0",
    keywords: ["cardiologia", "corazon", "cardio", "004"],
  },
  {
    id: "spec-cardiology-5-f0",
    category: "specialties",
    name: "Consulta de revision cardiologica",
    doctor: "Dr. Ruben Molina",
    roomNumber: "005",
    floor: 0,
    destinationNodeId: "n_car_door_5_f0",
    keywords: ["cardiologia", "corazon", "cardio", "005"],
  },
  {
    id: "spec-neurology-1-f0",
    category: "specialties",
    name: "Neurologia general",
    doctor: "Dra. Ana Torres",
    roomNumber: "021",
    floor: 0,
    destinationNodeId: "n_neu_door_1_f0",
    keywords: ["neurologia", "neuro", "sistema nervioso", "021"],
  },
  {
    id: "spec-neurology-2-f0",
    category: "specialties",
    name: "Neurologia de cefaleas",
    doctor: "Dr. Pablo Herrera",
    roomNumber: "022",
    floor: 0,
    destinationNodeId: "n_neu_door_2_f0",
    keywords: ["neurologia", "neuro", "sistema nervioso", "022"],
  },
  {
    id: "spec-neurology-3-f0",
    category: "specialties",
    name: "Neurologia de enfermedades neurologicas",
    doctor: "Dra. Clara Romero",
    roomNumber: "023",
    floor: 0,
    destinationNodeId: "n_neu_door_3_f0",
    keywords: ["neurologia", "neuro", "sistema nervioso", "023"],
  },
  {
    id: "serv-waiting-room-f0",
    category: "services",
    name: "Sala de espera",
    floor: 0,
    destinationNodeId: "n_wr_door_1_f0",
    keywords: ["sala de espera", "espera", "wr"],
  },
  {
    id: "diag-laboratory-f1",
    category: "diagnostics",
    name: "Analisis de laboratorio",
    doctor: "Dra. Sofia Gil",
    roomNumber: "202",
    floor: 1,
    destinationNodeId: "n_neu_door_2",
    keywords: ["laboratorio", "analisis", "sangre", "202"],
  },
  {
    id: "serv-pharmacy-f1",
    category: "services",
    name: "Farmacia",
    floor: 1,
    destinationNodeId: "n_wr_door_1",
    keywords: ["farmacia", "medicinas", "medicamentos"],
  },
  {
    id: "serv-bathroom-f1",
    category: "services",
    name: "Aseos",
    floor: 1,
    destinationNodeId: "n_car_door_4",
    keywords: ["bano", "aseo", "sanitarios"],
  },
  {
    id: "serv-cafeteria-f1",
    category: "services",
    name: "Cafeteria",
    floor: 1,
    destinationNodeId: "n_car_door_5",
    keywords: ["cafeteria", "comida", "cafe"],
  },
  {
    id: "serv-elevator-f0",
    category: "services",
    name: "Ascensor",
    floor: 0,
    destinationNodeId: "elevator_001_f0",
    keywords: ["ascensor", "elevador"],
  },
  {
    id: "serv-stairs-f0",
    category: "services",
    name: "Escaleras",
    floor: 0,
    destinationNodeId: "stair_001_f0",
    keywords: ["escaleras", "stairs"],
  },
  {
    id: "ent-main-f0",
    category: "entrances",
    name: "Entrada principal",
    street: "Calle de la Mancha, 14",
    floor: 0,
    destinationNodeId: "n_hospital_entrance_f0",
    keywords: ["entrada", "principal", "acceso"],
  },
  {
    id: "ent-south-f0",
    category: "entrances",
    name: "Entrada sur",
    street: "Avenida de Almeria, 8",
    floor: 0,
    destinationNodeId: "n_hospital_entrance_2_f0",
    keywords: ["entrada", "sur", "acceso"],
  },
];

async function fetchDirectoryWithTimeout() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DIRECTORY_TIMEOUT_MS);

  try {
    const response = await fetch(DIRECTORY_URL, { signal: controller.signal });
    if (!response.ok) { throw new Error(`Backend returned ${response.status}`); }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
export let DIRECTORY_CATEGORIES: DirectoryCategory[] = [...LOCAL_DIRECTORY_CATEGORIES];
export let HOSPITAL_DIRECTORY: HospitalDirectoryEntry[] = [...LOCAL_HOSPITAL_DIRECTORY];
let directoryLoadPromise: Promise<HospitalDirectoryLoadResult> | null = null;

export async function loadHospitalDirectory() {
  if (!directoryLoadPromise) {
    // fetch from backend
    directoryLoadPromise = fetchDirectoryWithTimeout()
      .then((data) => {
        const categories = Array.isArray(data?.categories)
          ? data.categories
          : [...LOCAL_DIRECTORY_CATEGORIES];
        const entries = Array.isArray(data?.entries)
          ? data.entries
          : [...LOCAL_HOSPITAL_DIRECTORY];

        DIRECTORY_CATEGORIES = categories;
        HOSPITAL_DIRECTORY = entries;

        console.log("[HospitalDirectory] Loaded directory from backend", { source: "backend", categories: categories.length, entries: entries.length,});
        return {
          source: "backend" as const,
          categoriesCount: categories.length,
          entriesCount: entries.length,
        };
      })
      .catch((error) => {
        // use local fallback when error
        const categories = [...LOCAL_DIRECTORY_CATEGORIES];
        const entries = [...LOCAL_HOSPITAL_DIRECTORY];
        DIRECTORY_CATEGORIES = categories;
        HOSPITAL_DIRECTORY = entries;
        console.log("[HospitalDirectory] Backend directory fetch failed, using local fallback", {source: "local-fallback", url: DIRECTORY_URL, error: error?.message || String(error), categories: categories.length, entries: entries.length,});
        return {
          source: "local-fallback",
          categoriesCount: categories.length,
          entriesCount: entries.length,
          error: error?.message || String(error),
        };
      });
  }
  return directoryLoadPromise;
}

// Have a function for future integration with hospitals to refetch when updates happen
export function clearHospitalDirectoryCache() {
  directoryLoadPromise = null;
}

// remove accents, case, extra spaces so search matches easily
export function normalizeSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
