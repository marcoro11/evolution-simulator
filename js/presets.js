// Static data: genes, starting organisms, biomes, terrains, events and
// the little bits of Latin used to name new species.

// Every gene is a number in [0, 1]. The simulation maps genes to phenotypes.
export const GENES = [
  { key: 'size', label: 'Size', icon: '📏', color: '#f4a261', lo: 'tiny', hi: 'huge' },
  { key: 'speed', label: 'Speed', icon: '💨', color: '#2ec4b6', lo: 'sluggish', hi: 'swift' },
  { key: 'sense', label: 'Senses', icon: '👁️', color: '#ffd166', lo: 'dim', hi: 'keen' },
  { key: 'insulation', label: 'Fur / fat', icon: '🧥', color: '#a8dadc', lo: 'bare', hi: 'woolly' },
  { key: 'heatTol', label: 'Heat tolerance', icon: '🔥', color: '#ff6b4a', lo: 'heat-sensitive', hi: 'heat-proof' },
  { key: 'drought', label: 'Drought tolerance', icon: '🏜️', color: '#d4a373', lo: 'thirsty', hi: 'camel-like' },
  { key: 'armor', label: 'Armor', icon: '🛡️', color: '#9aa7c7', lo: 'soft', hi: 'armored' },
  { key: 'diet', label: 'Carnivory', icon: '🥩', color: '#ef476f', lo: 'herbivore', hi: 'carnivore' },
  { key: 'fertility', label: 'Litter size', icon: '🥚', color: '#f9c74f', lo: 'few young', hi: 'many young' },
  { key: 'longevity', label: 'Longevity', icon: '⏳', color: '#c9a0dc', lo: 'short-lived', hi: 'long-lived' },
  { key: 'hue', label: 'Hue', icon: '🎨', color: '#c77dff', lo: '', hi: '', hidden: true },
  { key: 'lightness', label: 'Brightness', icon: '🌗', color: '#e9ecef', lo: 'dark', hi: 'pale' },
];
export const GENE_INDEX = Object.fromEntries(GENES.map((g, i) => [g.key, i]));

// Extra derived metrics that can be charted like traits.
export const METRICS = [
  ...GENES.filter((g) => !g.hidden).map((g) => ({ key: g.key, label: g.label, icon: g.icon, color: g.color })),
  { key: 'camo', label: 'Camouflage', icon: '🦎', color: '#80ed99' },
];

// Body plans the renderer knows how to draw.
export const PLANS = ['microbe', 'insect', 'mammal', 'reptile', 'amphibian', 'bird'];

const g = (o) => GENES.map((x) => o[x.key]);

export const ORGANISMS = [
  {
    id: 'protocell', name: 'Protocell', emoji: '🦠', plan: 'microbe',
    genus: 'Protobion', epithet: 'primus',
    tag: 'microbe · breeds fast', plural: 'protocells',
    blurb: 'A tiny single cell. Breeds like crazy, mutates fast.',
    genome: g({ size: 0.04, speed: 0.3, sense: 0.12, insulation: 0.08, heatTol: 0.45, drought: 0.35, armor: 0.12, diet: 0.08, fertility: 0.75, longevity: 0.04, hue: 0.86, lightness: 0.62 }),
    mods: { lifeMul: 0.7, ecto: true, skinMul: 1.2, insect: false },
    look: {},
  },
  {
    id: 'beetle', name: 'Beetle', emoji: '🪲', plan: 'insect',
    genus: 'Coleops', epithet: 'vulgaris',
    tag: 'insect · armored', plural: 'beetles',
    blurb: 'Small, armored bug. Oxygen limits how big insects can get…',
    genome: g({ size: 0.1, speed: 0.35, sense: 0.25, insulation: 0.05, heatTol: 0.5, drought: 0.5, armor: 0.5, diet: 0.15, fertility: 0.7, longevity: 0.12, hue: 0.08, lightness: 0.28 }),
    mods: { lifeMul: 0.85, ecto: true, skinMul: 0.7, insect: true },
    look: {},
  },
  {
    id: 'rabbit', name: 'Rabbit', emoji: '🐇', plan: 'mammal',
    genus: 'Lepus', epithet: 'originalis',
    tag: 'herbivore · many babies', plural: 'rabbits',
    blurb: 'Fast-breeding herbivore. Great prey, great survivor.',
    genome: g({ size: 0.28, speed: 0.55, sense: 0.4, insulation: 0.35, heatTol: 0.3, drought: 0.3, armor: 0.04, diet: 0.04, fertility: 0.72, longevity: 0.25, hue: 0.08, lightness: 0.55 }),
    mods: { lifeMul: 1, ecto: false, skinMul: 1, insect: false },
    look: { ears: 'long', tail: 'fluffy' },
  },
  {
    id: 'lizard', name: 'Lizard', emoji: '🦎', plan: 'reptile',
    genus: 'Saurus', epithet: 'antiquus',
    tag: 'reptile · cold-blooded', plural: 'lizards',
    blurb: 'Cold-blooded: cheap to run in the heat, sluggish in the cold.',
    genome: g({ size: 0.26, speed: 0.45, sense: 0.35, insulation: 0.04, heatTol: 0.65, drought: 0.65, armor: 0.3, diet: 0.2, fertility: 0.5, longevity: 0.4, hue: 0.25, lightness: 0.42 }),
    mods: { lifeMul: 1.1, ecto: true, skinMul: 0.6, insect: false },
    look: {},
  },
  {
    id: 'frog', name: 'Frog', emoji: '🐸', plan: 'amphibian',
    genus: 'Rana', epithet: 'humida',
    tag: 'amphibian · loves water', plural: 'frogs',
    blurb: 'Loves humidity — dry air is its worst enemy.',
    genome: g({ size: 0.2, speed: 0.35, sense: 0.35, insulation: 0.04, heatTol: 0.35, drought: 0.05, armor: 0.05, diet: 0.22, fertility: 0.9, longevity: 0.22, hue: 0.3, lightness: 0.4 }),
    mods: { lifeMul: 0.9, ecto: true, skinMul: 2.2, insect: false },
    look: {},
  },
  {
    id: 'finch', name: 'Finch', emoji: '🐦', plan: 'bird',
    genus: 'Fringilla', epithet: 'insularis',
    tag: 'bird · seed-eater', plural: 'finches',
    blurb: 'A nimble seed-eater. Watch its beak and wings change.',
    genome: g({ size: 0.15, speed: 0.62, sense: 0.5, insulation: 0.3, heatTol: 0.35, drought: 0.35, armor: 0.02, diet: 0.18, fertility: 0.5, longevity: 0.3, hue: 0.12, lightness: 0.5 }),
    mods: { lifeMul: 1, ecto: false, skinMul: 1, insect: false },
    look: {},
  },
  {
    id: 'grazer', name: 'Grazer', emoji: '🦬', plan: 'mammal',
    genus: 'Megaherbus', epithet: 'placidus',
    tag: 'herbivore · huge', plural: 'grazers',
    blurb: 'Big, slow, long-lived plant-eater. Too large for most predators.',
    genome: g({ size: 0.62, speed: 0.32, sense: 0.32, insulation: 0.42, heatTol: 0.35, drought: 0.45, armor: 0.15, diet: 0.02, fertility: 0.15, longevity: 0.7, hue: 0.07, lightness: 0.34 }),
    mods: { lifeMul: 1, ecto: false, skinMul: 1, insect: false },
    look: { ears: 'round', tail: 'short', horns: true },
  },
  {
    id: 'wolf', name: 'Wolf', emoji: '🐺', plan: 'mammal',
    genus: 'Canis', epithet: 'venator',
    tag: 'hunter · needs prey', plural: 'wolves',
    blurb: 'A hunter. Eats other species — pair it with a herbivore!',
    genome: g({ size: 0.45, speed: 0.66, sense: 0.65, insulation: 0.45, heatTol: 0.3, drought: 0.35, armor: 0.04, diet: 0.72, fertility: 0.12, longevity: 0.45, hue: 0.07, lightness: 0.45 }),
    mods: { lifeMul: 1, ecto: false, skinMul: 1, insect: false },
    look: { ears: 'pointy', tail: 'long' },
  },
];
export const ORGANISM_BY_ID = Object.fromEntries(ORGANISMS.map((o) => [o.id, o]));

// Ground colours. Camouflage = how close an organism's colour is to the ground.
export const TERRAINS = {
  grass: { label: 'Grassland', ground: '#6e9a4a', plant: '#c5e86c', accent: '#5b8a3c' },
  forest: { label: 'Forest floor', ground: '#2f4f2c', plant: '#7bd389', accent: '#24401f' },
  sand: { label: 'Sand dunes', ground: '#d8bd84', plant: '#7a9a3a', accent: '#c7a96c' },
  snow: { label: 'Snow', ground: '#e6edf2', plant: '#7aa37a', accent: '#cdd9e2' },
  rock: { label: 'Bare rock', ground: '#7c7a74', plant: '#a3c46b', accent: '#6b6963' },
  ash: { label: 'Volcanic ash', ground: '#38312f', plant: '#9bd35a', accent: '#2a2422' },
  swamp: { label: 'Swamp mud', ground: '#4a5636', plant: '#a7d36b', accent: '#3b4529' },
  red: { label: 'Red regolith', ground: '#a4532f', plant: '#d5f07a', accent: '#8a4325' },
};

// Environment settings. Ranges are shared by the UI and the simulation.
export const ENV_FIELDS = [
  { key: 'temperature', label: 'Temperature', icon: '🌡️', min: -30, max: 50, step: 1, unit: '°C' },
  { key: 'seasonality', label: 'Seasonal swing', icon: '🍂', min: 0, max: 30, step: 1, unit: '±°C' },
  { key: 'humidity', label: 'Humidity', icon: '💧', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'food', label: 'Plant growth', icon: '🌿', min: 0, max: 200, step: 5, unit: '%' },
  { key: 'predators', label: 'Predators', icon: '🐾', min: 0, max: 10, step: 1, unit: '' },
  { key: 'oxygen', label: 'Oxygen', icon: '🫁', min: 10, max: 35, step: 1, unit: '%' },
  { key: 'radiation', label: 'Radiation (mutation)', icon: '☢️', min: 0, max: 10, step: 0.5, unit: '×' },
];

export const BIOMES = [
  { id: 'meadow', name: 'Temperate meadow', emoji: '🌼', env: { temperature: 15, seasonality: 12, humidity: 60, food: 100, predators: 3, oxygen: 21, radiation: 1, terrain: 'grass' } },
  { id: 'tundra', name: 'Arctic tundra', emoji: '🧊', env: { temperature: -10, seasonality: 10, humidity: 40, food: 100, predators: 2, oxygen: 21, radiation: 1, terrain: 'snow' } },
  { id: 'desert', name: 'Scorching desert', emoji: '🏜️', env: { temperature: 35, seasonality: 8, humidity: 12, food: 70, predators: 2, oxygen: 21, radiation: 1.5, terrain: 'sand' } },
  { id: 'jungle', name: 'Tropical rainforest', emoji: '🌴', env: { temperature: 27, seasonality: 2, humidity: 95, food: 170, predators: 6, oxygen: 22, radiation: 1, terrain: 'forest' } },
  { id: 'volcano', name: 'Volcanic island', emoji: '🌋', env: { temperature: 30, seasonality: 4, humidity: 50, food: 80, predators: 1, oxygen: 19, radiation: 3, terrain: 'ash' } },
  { id: 'carboniferous', name: 'Carboniferous swamp', emoji: '🪵', env: { temperature: 24, seasonality: 3, humidity: 90, food: 140, predators: 2, oxygen: 33, radiation: 1, terrain: 'swamp' } },
  { id: 'hunting', name: 'Predator paradise', emoji: '🐆', env: { temperature: 20, seasonality: 6, humidity: 55, food: 120, predators: 10, oxygen: 21, radiation: 1, terrain: 'rock' } },
  { id: 'mars', name: 'Terraformed Mars', emoji: '🔴', env: { temperature: -4, seasonality: 16, humidity: 20, food: 70, predators: 0, oxygen: 17, radiation: 4, terrain: 'red' } },
];
export const BIOME_BY_ID = Object.fromEntries(BIOMES.map((b) => [b.id, b]));

// Disasters / interventions the user can unleash while a run is going.
// shape: 'plateau' ramps in, holds, ramps out. 'decay' hits instantly, fades.
export const EVENTS = {
  meteor: { icon: '☄️', name: 'Meteor strike', duration: 800, shape: 'decay', dT: -12, foodMul: 0.3, desc: 'Wipes out a region and causes an impact winter.' },
  iceage: { icon: '❄️', name: 'Ice age', duration: 3000, shape: 'plateau', dT: -18, desc: 'Global cooling for ~15 years.' },
  warming: { icon: '🔥', name: 'Global warming', duration: 3000, shape: 'plateau', dT: 14, desc: 'Global heating for ~15 years.' },
  drought: { icon: '🌵', name: 'Great drought', duration: 2000, shape: 'plateau', dHum: -0.6, foodMul: 0.6, desc: 'The air dries up for ~10 years.' },
  bloom: { icon: '🌸', name: 'Super bloom', duration: 600, shape: 'decay', foodMul: 3.5, desc: 'A burst of plant growth.' },
  plague: { icon: '🦠', name: 'Plague', duration: 200, shape: 'decay', desc: 'Hits the most common species hardest.' },
  invasion: { icon: '🐾', name: 'Predator invasion', duration: 2000, shape: 'plateau', dPred: 8, desc: 'A wave of new predators arrives.' },
};

// Species naming: genus comes from the starting organism, the epithet from
// the trait that changed the most when the species branched off.
export const EPITHETS = {
  size: ['minimus', 'giganteus'],
  speed: ['tardus', 'velox'],
  sense: ['caecus', 'oculatus'],
  insulation: ['nudus', 'lanatus'],
  heatTol: ['frigidus', 'ignifer'],
  drought: ['aquaticus', 'deserti'],
  armor: ['mollis', 'armatus'],
  diet: ['herbivorus', 'ferox'],
  fertility: ['parcus', 'fecundus'],
  longevity: ['brevis', 'longaevus'],
  hue: ['versicolor', 'mutabilis'],
  lightness: ['niger', 'albus'],
};

// Categorical palette for species lines in the tree / charts.
export const SPECIES_COLORS = [
  '#4cc9f0', '#f72585', '#b5e48c', '#ffb703', '#9d4edd', '#06d6a0',
  '#fb8500', '#e5383b', '#90e0ef', '#ff99c8', '#c0fdff', '#e9ff70',
];

// One-click experiments that show off a specific evolutionary idea.
const env = (id, over = {}) => ({ ...BIOME_BY_ID[id].env, ...over, biome: Object.keys(over).length ? 'custom' : id });
export const SCENARIOS = [
  {
    id: 'bergmann', emoji: '🧊', name: 'Cold makes you big & furry',
    desc: 'Rabbits in a meadow vs the arctic. Watch fur, size and coat color diverge (Bergmann’s rule).',
    organisms: ['rabbit'], compare: true, envA: env('meadow'), envB: env('tundra'),
  },
  {
    id: 'camo', emoji: '🎨', name: 'Camouflage',
    desc: 'Same climate, lots of predators — only the ground color differs. Coats evolve to match.',
    organisms: ['rabbit'], compare: true,
    envA: env('meadow', { temperature: 18, seasonality: 4, food: 110, predators: 9, radiation: 1.5, terrain: 'snow' }),
    envB: env('meadow', { temperature: 18, seasonality: 4, food: 110, predators: 9, radiation: 1.5, terrain: 'forest' }),
  },
  {
    id: 'insects', emoji: '🪲', name: 'Giant insects',
    desc: 'Beetles in normal air vs oxygen-rich Carboniferous air, where bigger bodies pay off.',
    organisms: ['beetle'], compare: true, envA: env('meadow'), envB: env('carboniferous'),
  },
  {
    id: 'armsrace', emoji: '🐺', name: 'Predator–prey arms race',
    desc: 'Wolves and rabbits. Prey get faster, bigger or sneakier; hunters must keep up.',
    organisms: ['wolf', 'rabbit'], compare: false, envA: env('meadow'), envB: env('jungle'),
  },
  {
    id: 'desert', emoji: '🏜️', name: 'Desert vs jungle',
    desc: 'Finches in scorching dry sand vs humid rainforest: heat & drought tolerance diverge.',
    organisms: ['finch'], compare: true, envA: env('desert'), envB: env('jungle'),
  },
  {
    id: 'mars', emoji: '🔴', name: 'Life on Mars',
    desc: 'Cold, thin air, harsh radiation. Most lineages die — survivors change fast.',
    organisms: ['rabbit', 'beetle', 'lizard'], compare: false, envA: env('mars'), envB: env('meadow'),
  },
];
