export type ShellPattern =
  | 'peony'
  | 'chrysanthemum'
  | 'dahlia'
  | 'willow'
  | 'kamuro'
  | 'palm'
  | 'ring'
  | 'saturn'
  | 'heart'
  | 'star'
  | 'spiral'
  | 'crossette'
  | 'crackle'
  | 'strobe'
  | 'pistil'
  | 'changer'
  | 'fish'
  | 'waterfall'
  | 'multibreak'
  | 'brocade'
  | 'salute'

export type PatternId = ShellPattern | 'random'

export const SHELL_PATTERNS: ShellPattern[] = [
  'peony',
  'chrysanthemum',
  'dahlia',
  'willow',
  'kamuro',
  'palm',
  'ring',
  'saturn',
  'heart',
  'star',
  'spiral',
  'crossette',
  'crackle',
  'strobe',
  'pistil',
  'changer',
  'fish',
  'waterfall',
  'multibreak',
  'brocade',
  'salute',
]

export const PATTERN_IDS: PatternId[] = ['random', ...SHELL_PATTERNS]

export const PATTERN_LABELS: Record<PatternId, { ko: string; en: string }> = {
  random: { ko: '무작위', en: 'Random' },
  peony: { ko: '모란', en: 'Peony' },
  chrysanthemum: { ko: '국화', en: 'Chrysanthemum' },
  dahlia: { ko: '달리아', en: 'Dahlia' },
  willow: { ko: '버드나무', en: 'Willow' },
  kamuro: { ko: '카무로', en: 'Kamuro' },
  palm: { ko: '야자수', en: 'Palm' },
  ring: { ko: '고리', en: 'Ring' },
  saturn: { ko: '토성', en: 'Saturn' },
  heart: { ko: '하트', en: 'Heart' },
  star: { ko: '별', en: 'Star' },
  spiral: { ko: '나선', en: 'Spiral' },
  crossette: { ko: '크로셋', en: 'Crossette' },
  crackle: { ko: '딱딱이', en: 'Crackle' },
  strobe: { ko: '점멸', en: 'Strobe' },
  pistil: { ko: '이중심', en: 'Pistil' },
  changer: { ko: '변색', en: 'Color Change' },
  fish: { ko: '물고기', en: 'Fish' },
  waterfall: { ko: '폭포', en: 'Horsetail' },
  multibreak: { ko: '다단', en: 'Multi-break' },
  brocade: { ko: '비단', en: 'Brocade' },
  salute: { ko: '뇌성', en: 'Salute' },
}

/** Rough "how big" each shell reads, used by the show director for pacing. */
export const PATTERN_WEIGHT: Record<ShellPattern, number> = {
  peony: 1,
  chrysanthemum: 1.2,
  dahlia: 1,
  willow: 1.4,
  kamuro: 1.6,
  palm: 1,
  ring: 0.8,
  saturn: 1.1,
  heart: 0.8,
  star: 0.8,
  spiral: 1,
  crossette: 1.1,
  crackle: 1,
  strobe: 0.9,
  pistil: 1.2,
  changer: 1,
  fish: 0.7,
  waterfall: 1.3,
  multibreak: 1.3,
  brocade: 1.3,
  salute: 0.5,
}

export interface Palette {
  id: string
  name: string
  colors: string[]
}

export const RANDOM_PALETTE_ID = 'random'

/**
 * Real pyrotechnic star colours: strontium red, calcium/sodium orange,
 * charcoal gold, sodium yellow, barium green, copper blue, Sr+Cu purple,
 * magnesium/titanium silver.
 */
export const PYRO = {
  red: '#ff2414',
  orange: '#ff6a12',
  gold: '#ffa040',
  yellow: '#ffd03a',
  green: '#3cff52',
  blue: '#2f5cff',
  aqua: '#33c8ff',
  purple: '#a03cff',
  pink: '#ff4a8a',
  silver: '#eef0ff',
} as const

export const PALETTES: Palette[] = [
  { id: RANDOM_PALETTE_ID, name: 'Mix', colors: [PYRO.red, PYRO.green, PYRO.gold, PYRO.blue, PYRO.silver] },
  { id: 'classic', name: 'Classic', colors: [PYRO.red, PYRO.green, PYRO.silver, PYRO.gold] },
  { id: 'gold', name: 'Gold', colors: [PYRO.gold, PYRO.yellow, '#ffc070'] },
  { id: 'crimson', name: 'Crimson', colors: [PYRO.red, PYRO.orange, PYRO.pink] },
  { id: 'emerald', name: 'Emerald', colors: [PYRO.green, '#9dff4a', PYRO.silver] },
  { id: 'azure', name: 'Azure', colors: [PYRO.blue, PYRO.aqua, PYRO.silver] },
  { id: 'royal', name: 'Royal', colors: [PYRO.purple, PYRO.pink, PYRO.gold] },
  { id: 'silver', name: 'Silver', colors: [PYRO.silver, '#cfd8ff'] },
]

export const GOLD = '#ffa040'
export const SILVER = '#eef0ff'
