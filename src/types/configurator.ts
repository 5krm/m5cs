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
