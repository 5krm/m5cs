export type StudioTheme = 'apex' | 'm' | 'night'
export type PaintFinish = 'frozen-deep-green' | 'brands-hatch-grey' | 'frozen-bluestone' | 'sapphire-black'
export type WheelFinish = 'gold-bronze' | 'jet-black' | 'orbit-grey' | 'brilliant-silver'
export type CaliperColor = 'gold' | 'red' | 'blue' | 'yellow'
export type HotspotId = 'engine' | 'cockpit' | 'wheels' | 'aero'

export interface PaintConfig {
  name: string
  nameAr: string
  hex: string
  roughness: number
  metalness: number
  clearcoat: number
}

export const PAINT_CONFIGS: Record<PaintFinish, PaintConfig> = {
  'frozen-deep-green': {
    name: 'Frozen Deep Green',
    nameAr: 'أخضر داكن متجمد',
    hex: '#183124',
    roughness: 0.38,
    metalness: 0.72,
    clearcoat: 0.9,
  },
  'brands-hatch-grey': {
    name: 'Brands Hatch Grey',
    nameAr: 'رمادي براندز هاتش',
    hex: '#69717a',
    roughness: 0.34,
    metalness: 0.82,
    clearcoat: 1.0,
  },
  'frozen-bluestone': {
    name: 'Frozen Bluestone',
    nameAr: 'حجر أزرق متجمد',
    hex: '#3f5060',
    roughness: 0.36,
    metalness: 0.8,
    clearcoat: 0.95,
  },
  'sapphire-black': {
    name: 'Black Sapphire',
    nameAr: 'أسود ياقوتي',
    hex: '#0d0f12',
    roughness: 0.18,
    metalness: 0.92,
    clearcoat: 1.0,
  },
}

export interface WheelConfig {
  name: string
  nameAr: string
  hex: string
  roughness: number
  metalness: number
  clearcoat: number
}

export const WHEEL_CONFIGS: Record<WheelFinish, WheelConfig> = {
  'gold-bronze': {
    name: 'Gold Bronze (CS Signature)',
    nameAr: 'برونزي ذهبي (M5 CS الأيقوني)',
    hex: '#c5a059',
    roughness: 0.22,
    metalness: 0.94,
    clearcoat: 0.85,
  },
  'jet-black': {
    name: 'Jet Black High-Gloss',
    nameAr: 'أسود فاحم لامع (Shadowline)',
    hex: '#111215',
    roughness: 0.12,
    metalness: 0.9,
    clearcoat: 1.0,
  },
  'orbit-grey': {
    name: 'Frozen Orbit Grey',
    nameAr: 'رمادي أوربت متجمد',
    hex: '#484b52',
    roughness: 0.32,
    metalness: 0.88,
    clearcoat: 0.65,
  },
  'brilliant-silver': {
    name: 'Brilliant Silver',
    nameAr: 'فضي متلألئ خفيف الوزن',
    hex: '#d8dadf',
    roughness: 0.16,
    metalness: 0.95,
    clearcoat: 0.9,
  },
}

export interface CaliperConfig {
  name: string
  nameAr: string
  hex: string
  roughness: number
  metalness: number
}

export const CALIPER_CONFIGS: Record<CaliperColor, CaliperConfig> = {
  gold: {
    name: 'M Carbon Ceramic Gold',
    nameAr: 'كربون سيراميك ذهبي M',
    hex: '#e5a93b',
    roughness: 0.22,
    metalness: 0.85,
  },
  red: {
    name: 'M Compound Sport Red',
    nameAr: 'أحمر رياضي كلاسيكي M',
    hex: '#d90429',
    roughness: 0.18,
    metalness: 0.78,
  },
  blue: {
    name: 'M Performance Blue',
    nameAr: 'أزرق إم بيرفورمانس',
    hex: '#0077b6',
    roughness: 0.2,
    metalness: 0.82,
  },
  yellow: {
    name: 'Acid Neon Yellow',
    nameAr: 'أصفر نيون حلبات',
    hex: '#ccff00',
    roughness: 0.24,
    metalness: 0.5,
  },
}

export interface HotspotInfo {
  id: HotspotId
  label: string
  labelAr: string
  sublabel: string
  sublabelAr: string
  localPos: [number, number, number]
  cameraPos: [number, number, number]
  cameraTarget: [number, number, number]
}

export const HOTSPOTS: HotspotInfo[] = [
  {
    id: 'engine',
    label: 'M TwinPower Turbo V8',
    labelAr: 'محرك V8 توين-توربو 4.4L',
    sublabel: '627 HP · Carbon Strut Bracing',
    sublabelAr: 'قوة 627 حصان · دعامات ألياف الكربون',
    localPos: [1.45, 0.85, 0],
    cameraPos: [2.7, 1.8, 1.3],
    cameraTarget: [1.4, 0.75, 0],
  },
  {
    id: 'cockpit',
    label: 'M Carbon Bucket Seats',
    labelAr: 'مقاعد M كربون باكيت والمقصورة',
    sublabel: 'Lightweight Cockpit · Nürburgring Map',
    sublabelAr: 'مقصورة حلبات خفيفة الوزن · شعار نوربورغرينغ',
    localPos: [0.25, 0.95, -0.88],
    cameraPos: [1.1, 1.25, -1.6],
    cameraTarget: [0.1, 0.8, -0.3],
  },
  {
    id: 'wheels',
    label: 'Ceramic Brakes & Wheels',
    labelAr: 'المكابح الكربون سيراميك والجنوط',
    sublabel: '20" Style 863M · 400mm Carbon Rotors',
    sublabelAr: 'جنوط 20 إنش · أقراص كربون سيراميك 400 مم',
    localPos: [1.42, 0.38, 0.88],
    cameraPos: [2.2, 0.55, 1.7],
    cameraTarget: [1.4, 0.35, 0.8],
  },
  {
    id: 'aero',
    label: 'Carbon Aero & Quad Exhaust',
    labelAr: 'الديناميكا الهوائية والعادم الرباعي',
    sublabel: 'CFRP Diffuser · Sport Exhaust',
    sublabelAr: 'مشتت هواء كربون فايبر · عادم رياضي رباعي',
    localPos: [-2.0, 0.75, 0],
    cameraPos: [-3.4, 0.7, 1.6],
    cameraTarget: [-1.9, 0.55, 0],
  },
]

/* ══════════════════════════════════════════════════════════════════════
 * Location scenes — the car stays put, the world around it changes
 * ══════════════════════════════════════════════════════════════════════ */

export type SceneId = 'studio' | 'nurburgring' | 'garage' | 'alpine' | 'tokyo' | 'dubai' | 'monaco' | 'docks'

export interface SceneInfo {
  id: SceneId
  name: string
  tagline: string
  /** small swatch gradient used in the dock */
  swatch: string
}

export const SCENES: SceneInfo[] = [
  { id: 'studio', name: 'Studio', tagline: 'Infinity cove · softbox rig', swatch: 'linear-gradient(135deg,#2a2f3a,#0b0d12)' },
  { id: 'nurburgring', name: 'Nürburgring', tagline: 'Pit lane · dusk', swatch: 'linear-gradient(180deg,#1a1d45 0%,#d8703e 60%,#2b2b30 61%)' },
  { id: 'garage', name: 'Munich Garage', tagline: 'Underground · P2', swatch: 'linear-gradient(180deg,#1a1c20,#3a3d44 55%,#6b6d70)' },
  { id: 'alpine', name: 'Alpine Pass', tagline: 'Golden hour · 2,100 m', swatch: 'linear-gradient(180deg,#4f86c6 0%,#f4d6a4 55%,#4e6070 56%,#3f4a2c)' },
  { id: 'tokyo', name: 'Tokyo Night', tagline: 'Shuto Expressway · Neon rain', swatch: 'linear-gradient(180deg,#0a051b 0%,#e11d48 45%,#06b6d4 75%,#0f172a 100%)' },
  { id: 'dubai', name: 'Dubai Desert', tagline: 'Al Qudra Dunes · Sunset', swatch: 'linear-gradient(180deg,#831843 0%,#ea580c 45%,#f59e0b 65%,#3b1807 100%)' },
  { id: 'monaco', name: 'Monaco Marina', tagline: 'Port Hercule · Grand Prix dusk', swatch: 'linear-gradient(180deg,#0e2238 0%,#1e5b88 45%,#e08c38 65%,#1c222b 100%)' },
  { id: 'docks', name: 'Cargo Docks', tagline: 'Container terminal · Night mist', swatch: 'linear-gradient(180deg,#050b14 0%,#0ea5e9 40%,#f97316 70%,#1e293b 100%)' },
]

export function getRandomSceneId(excludeId?: SceneId): SceneId {
  const pool = excludeId ? SCENES.filter((s) => s.id !== excludeId) : SCENES
  const list = pool.length > 0 ? pool : SCENES
  const idx = Math.floor(Math.random() * list.length)
  return list[idx].id
}

export function getInitialSceneId(): SceneId {
  if (typeof window === 'undefined') return 'studio'
  try {
    const prev = sessionStorage.getItem('m5cs_active_scene') as SceneId | null
    const chosen = getRandomSceneId(prev && SCENES.some((s) => s.id === prev) ? prev : undefined)
    sessionStorage.setItem('m5cs_active_scene', chosen)
    return chosen
  } catch {
    return getRandomSceneId()
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * X-Ray technical specification — counted up while the car is scanned
 * ══════════════════════════════════════════════════════════════════════ */

export interface SpecStat {
  id: string
  label: string
  value: number
  unit: string
  decimals?: number
  /** normalized bar length shown under the number (visual weight only) */
  bar: number
}

export const SPEC_STATS: SpecStat[] = [
  { id: 'power', label: 'Power', value: 627, unit: 'hp', bar: 0.92 },
  { id: 'torque', label: 'Torque', value: 750, unit: 'Nm', bar: 0.86 },
  { id: 'sprint', label: '0–100 km/h', value: 3.0, unit: 's', decimals: 1, bar: 0.34 },
  { id: 'vmax', label: 'Top speed', value: 305, unit: 'km/h', bar: 0.98 },
  { id: 'weight', label: 'Kerb weight (DIN)', value: 1825, unit: 'kg', bar: 0.58 },
  { id: 'displacement', label: 'Displacement', value: 4395, unit: 'cc', bar: 0.66 },
]

/* ══════════════════════════════════════════════════════════════════════
 * Cockpit mode — driver's-eye view and anchored callouts
 * ══════════════════════════════════════════════════════════════════════ */

export type MMode = 'road' | 'm1' | 'm2'

export interface CockpitCallout {
  id: string
  label: string
  sublabel: string
  /** car-local anchor (nose = +X, driver side = −Z, ground = y 0) */
  localPos: [number, number, number]
}

export const COCKPIT_CALLOUTS: CockpitCallout[] = [
  {
    id: 'wheel',
    label: 'M Alcantara Steering Wheel',
    sublabel: 'Red 12 o\u2019clock marker · carbon shift paddles',
    localPos: [0.37, 0.93, -0.36],
  },
  {
    id: 'seat',
    label: 'M Carbon Bucket Seats',
    sublabel: '\u221210 kg each · illuminated CS badge · Merino leather',
    localPos: [0.05, 0.98, 0.36],
  },
]
