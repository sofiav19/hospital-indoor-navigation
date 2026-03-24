export type DirectoryCategoryKey = "specialties" | "diagnostics" | "services" | "entrances";

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
  floor: number;
  destinationNodeId: string;
  keywords: string[];
};

export const DIRECTORY_CATEGORIES: DirectoryCategory[] = [
  {
    key: "specialties",
    chipLabel: "Especialidad",
    sectionTitle: "Especialidades",
    searchPlaceholder: "Buscar Especialidad",
  },
  {
    key: "diagnostics",
    chipLabel: "Prueba Diagnostica",
    sectionTitle: "Pruebas Medicas",
    searchPlaceholder: "Buscar Prueba Medica",
  },
  {
    key: "services",
    chipLabel: "Servicios",
    sectionTitle: "Servicios",
    searchPlaceholder: "Buscar Servicio",
  },
  {
    key: "entrances",
    chipLabel: "Entradas",
    sectionTitle: "Entradas",
    searchPlaceholder: "Buscar Entrada",
  },
];

export const HOSPITAL_DIRECTORY: HospitalDirectoryEntry[] = [
  // Floor 1 - Specialties
  {
    id: "spec-gynecology-f1",
    category: "specialties",
    name: "Ginecologia",
    doctor: "Dra. Lucía Martín",
    floor: 1,
    destinationNodeId: "n_car_door_1",
    keywords: ["gynecologia", "obstetrica", "mujer"],
  },
  {
    id: "spec-ultrasound-f1",
    category: "specialties",
    name: "Ecografia",
    doctor: "Dr. Javier Ortega",
    floor: 1,
    destinationNodeId: "n_car_door_2",
    keywords: ["ultrasonido", "ecografia", "imagen"],
  },
  {
    id: "spec-medical-tests-f1",
    category: "specialties",
    name: "Pruebas Medicas",
    doctor: "Dra. Elena Ruiz",
    floor: 1,
    destinationNodeId: "n_car_door_3",
    keywords: ["pruebas", "medicas", "tests"],
  },
  {
    id: "spec-radiology-f1",
    category: "specialties",
    name: "Radiologia",
    doctor: "Dr. Carlos Vega",
    floor: 1,
    destinationNodeId: "n_neu_door_1",
    keywords: ["radiologia", "rayos x", "imaging"],
  },
  {
    id: "spec-pediatrics-f1",
    category: "specialties",
    name: "Pediatria",
    doctor: "Dra. Marta Sánchez",
    floor: 1,
    destinationNodeId: "n_neu_door_3",
    keywords: ["pediatria", "ninos", "infantil"],
  },
  // Floor 0 - Specialties
  {
    id: "spec-cardiology-1-f0",
    category: "specialties",
    name: "Cardiologia General",
    doctor: "Dr. Álvaro Pérez",
    floor: 0,
    destinationNodeId: "n_car_door_1_f0",
    keywords: ["cardiologia", "corazon", "cardio"],
  },
  {
    id: "spec-cardiology-2-f0",
    category: "specialties",
    name: "Cardiologia Preventiva",
    doctor: "Dra. Paula Gómez",
    floor: 0,
    destinationNodeId: "n_car_door_2_f0",
    keywords: ["cardiologia", "corazon", "cardio"],
  },
  {
    id: "spec-cardiology-3-f0",
    category: "specialties",
    name: "Cardiologia de Arritmias",
    doctor: "Dr. Sergio Navarro",
    floor: 0,
    destinationNodeId: "n_car_door_3_f0",
    keywords: ["cardiologia", "corazon", "cardio"],
  },
  {
    id: "spec-cardiology-4-f0",
    category: "specialties",
    name: "Consulta de Insuficiencia Cardíaca",
    doctor: "Dra. Irene Lozano",
    floor: 0,
    destinationNodeId: "n_car_door_4_f0",
    keywords: ["cardiologia", "corazon", "cardio"],
  },
  {
    id: "spec-cardiology-5-f0",
    category: "specialties",
    name: "Consulta de Revisión Cardiológica",
    doctor: "Dr. Rubén Molina",
    floor: 0,
    destinationNodeId: "n_car_door_5_f0",
    keywords: ["cardiologia", "corazon", "cardio"],
  },
  {
    id: "spec-neurology-1-f0",
    category: "specialties",
    name: "Neurologia General",
    doctor: "Dra. Ana Torres",
    floor: 0,
    destinationNodeId: "n_neu_door_1_f0",
    keywords: ["neurologia", "neuro", "sistema nervioso"],
  },
  {
    id: "spec-neurology-2-f0",
    category: "specialties",
    name: "Neurologia de Cefaleas",
    doctor: "Dr. Pablo Herrera",
    floor: 0,
    destinationNodeId: "n_neu_door_2_f0",
    keywords: ["neurologia", "neuro", "sistema nervioso"],
  },
  {
    id: "spec-neurology-3-f0",
    category: "specialties",
    name: "Neurologia de Enfermedades Neurológicas",
    doctor: "Dra. Clara Romero",
    floor: 0,
    destinationNodeId: "n_neu_door_3_f0",
    keywords: ["neurologia", "neuro", "sistema nervioso"],
  },
  {
    id: "spec-wr-f0",
    category: "specialties",
    name: "Servicio WR",
    doctor: "Dr. Miguel Castro",
    floor: 0,
    destinationNodeId: "n_wr_door_1_f0",
    keywords: ["servicio", "wr"],
  },
  // Diagnostics
  {
    id: "diag-laboratory-f1",
    category: "diagnostics",
    name: "Analisis de Laboratorio",
    doctor: "Dra. Sofía Gil",
    floor: 1,
    destinationNodeId: "n_neu_door_2",
    keywords: ["laboratorio", "analisis", "sangre"],
  },
  // Services
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
    id: "serv-elevator-f1",
    category: "services",
    name: "Ascensor",
    floor: 1,
    destinationNodeId: "elevator_001",
    keywords: ["ascensor", "elevador"],
  },
  {
    id: "serv-stairs-f1",
    category: "services",
    name: "Escaleras",
    floor: 1,
    destinationNodeId: "stair_001",
    keywords: ["escaleras", "stairs"],
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
  // Entrances
  {
    id: "ent-main-f0",
    category: "entrances",
    name: "Entrada Principal",
    street: "Calle de la Mancha, 14",
    floor: 0,
    destinationNodeId: "n_hospital_entrance_f0",
    keywords: ["entrada", "principal", "acceso"],
  },
  {
    id: "ent-south-f0",
    category: "entrances",
    name: "Entrada Sur",
    street: "Avenida de Almeria, 8",
    floor: 0,
    destinationNodeId: "n_hospital_entrance_2_f0",
    keywords: ["entrada", "sur", "acceso"],
  },
];

export function normalizeSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
