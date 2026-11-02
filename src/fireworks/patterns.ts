export type PatternId =
  | 'peony'
  | 'chrysanthemum'
  | 'willow'
  | 'ring'
  | 'palm'
  | 'crossette'
  | 'crackle'
  | 'double'
  | 'comet'
  | 'random'

export type PatternFamily = 'sphere' | 'ring' | 'multi' | 'crackle' | 'comet'

export interface BurstSpec {
  family: PatternFamily
  shellCount: number
  count: number
  speed: number
  spread: number
  trailRatio: number
  trailTime: number
  life: number
  sparkle: number
  jitter: number
  crackle: number
  gravityScale: number
}

export const PATTERNS: Record<Exclude<PatternId, 'random'>, BurstSpec> = {
  peony: {
    family: 'sphere',
    shellCount: 1,
    count: 420,
    speed: 26,
    spread: 0.42,
    trailRatio: 0.16,
    trailTime: 0.42,
    life: 2.6,
    sparkle: 0.12,
    jitter: 0.06,
    crackle: 0,
    gravityScale: 1,
  },
  chrysanthemum: {
    family: 'sphere',
    shellCount: 1,
    count: 560,
    speed: 24,
    spread: 0.55,
    trailRatio: 0.55,
    trailTime: 0.9,
    life: 3.1,
    sparkle: 0.2,
    jitter: 0.1,
    crackle: 0,
    gravityScale: 1.15,
  },
  willow: {
    family: 'sphere',
    shellCount: 1,
    count: 340,
    speed: 15,
    spread: 0.28,
    trailRatio: 0.72,
    trailTime: 1.5,
    life: 4.6,
    sparkle: 0.06,
    jitter: 0.04,
    crackle: 0,
    gravityScale: 2.6,
  },
  ring: {
    family: 'ring',
    shellCount: 1,
    count: 380,
    speed: 27,
    spread: 0.06,
    trailRatio: 0.3,
    trailTime: 0.7,
    life: 2.8,
    sparkle: 0.14,
    jitter: 0.03,
    crackle: 0,
    gravityScale: 1,
  },
  palm: {
    family: 'sphere',
    shellCount: 1,
    count: 130,
    speed: 30,
    spread: 0.16,
    trailRatio: 0.8,
    trailTime: 1.8,
    life: 4.2,
    sparkle: 0.04,
    jitter: 0.02,
    crackle: 0,
    gravityScale: 2.2,
  },
  crossette: {
    family: 'multi',
    shellCount: 1,
    count: 140,
    speed: 19,
    spread: 0.5,
    trailRatio: 0.35,
    trailTime: 0.6,
    life: 2.2,
    sparkle: 0.1,
    jitter: 0.06,
    crackle: 0,
    gravityScale: 1,
  },
  crackle: {
    family: 'crackle',
    shellCount: 1,
    count: 260,
    speed: 21,
    spread: 0.5,
    trailRatio: 0.22,
    trailTime: 0.5,
    life: 2.4,
    sparkle: 0.3,
    jitter: 0.12,
    crackle: 0.8,
    gravityScale: 1,
  },
  double: {
    family: 'multi',
    shellCount: 2,
    count: 360,
    speed: 23,
    spread: 0.45,
    trailRatio: 0.4,
    trailTime: 0.8,
    life: 2.7,
    sparkle: 0.15,
    jitter: 0.08,
    crackle: 0,
    gravityScale: 1.1,
  },
  comet: {
    family: 'comet',
    shellCount: 1,
    count: 300,
    speed: 27,
    spread: 0.9,
    trailRatio: 0.55,
    trailTime: 1.1,
    life: 2.9,
    sparkle: 0.25,
    jitter: 0.14,
    crackle: 0.2,
    gravityScale: 1,
  },
}

export const PATTERN_LABELS: Record<PatternId, { ko: string; en: string }> = {
  peony: { ko: '모란', en: 'Peony' },
  chrysanthemum: { ko: '국화', en: 'Chrysanthemum' },
  willow: { ko: '버드나무', en: 'Willow' },
  ring: { ko: '고리', en: 'Ring' },
  palm: { ko: '야자수', en: 'Palm' },
  crossette: { ko: '크로셋', en: 'Crossette' },
  crackle: { ko: '딱딱이', en: 'Crackle' },
  double: { ko: '이중', en: 'Double' },
  comet: { ko: '혜성', en: 'Comet' },
  random: { ko: '무작위', en: 'Random' },
}

export const PATTERN_IDS: PatternId[] = [
  'peony',
  'chrysanthemum',
  'willow',
  'ring',
  'palm',
  'crossette',
  'crackle',
  'double',
  'comet',
  'random',
]

export interface Palette {
  id: string
  name: string
  colors: string[]
}

export const PALETTES: Palette[] = [
  { id: 'ember', name: 'Ember', colors: ['#ffb347', '#ff7a3d', '#ffd8a8', '#ff4f3d'] },
  { id: 'lagoon', name: 'Lagoon', colors: ['#5eead4', '#38bdf8', '#a5f3fc', '#7dd3fc'] },
  { id: 'rose', name: 'Rose', colors: ['#fb7185', '#f472b6', '#fda4af', '#ffe4e6'] },
  { id: 'jade', name: 'Jade', colors: ['#a3e635', '#4ade80', '#d9f99d', '#86efac'] },
  { id: 'crown', name: 'Crown', colors: ['#fde68a', '#fbbf24', '#e2e8f0', '#f8fafc'] },
  { id: 'violet', name: 'Violet', colors: ['#c4b5fd', '#a78bfa', '#e9d5ff', '#93c5fd'] },
]
