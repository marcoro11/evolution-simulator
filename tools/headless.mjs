// Run the simulation without a browser to check balance.
// Usage: node tools/headless.mjs [years] [organism,...] [biome,...] [seeds]
// Env vars: SEXUAL=1 (mating), GEO=river|mountains|lake|islands, GRADIENT=<°C>.
// Prints, per biome, how many seeds survived and the average trait change.
import { World, YEAR, meanGenome } from '../js/sim.js';
import { BIOMES, BIOME_BY_ID, GENES } from '../js/presets.js';

const years = Number(process.argv[2] || 60);
const orgs = (process.argv[3] || 'rabbit').split(',');
const biomes = process.argv[4] && process.argv[4] !== 'all' ? process.argv[4].split(',') : BIOMES.map((b) => b.id);
const seeds = Number(process.argv[5] || 3);
const show = ['size', 'speed', 'sense', 'insulation', 'heatTol', 'drought', 'armor', 'diet', 'fertility', 'longevity', 'lightness'];
const idx = show.map((k) => GENES.findIndex((g) => g.key === k));

for (const id of biomes) {
  let survived = 0, pop = 0, species = 0, ms = 0, ticks = 0;
  const sum = new Array(show.length).fill(0);
  const ext = [];
  for (let s = 1; s <= seeds; s++) {
    const env = { ...BIOME_BY_ID[id].env, geo: process.env.GEO || 'open', ...(process.env.GRADIENT ? { gradient: Number(process.env.GRADIENT) } : {}) };
    const w = new World({ env, organisms: orgs, seed: s * 7919, sexual: !!process.env.SEXUAL });
    const start = meanGenome(w.orgs);
    const t0 = performance.now();
    while (w.tick < years * YEAR && !w.extinct) w.step();
    ms += performance.now() - t0;
    ticks += w.tick;
    if (w.extinct) {
      ext.push(w.year().toFixed(0));
      continue;
    }
    survived++;
    pop += w.orgs.length;
    species += w.species.filter((x) => x.extinct === null).length;
    const m = meanGenome(w.orgs);
    idx.forEach((gi, k) => (sum[k] += m[gi] - start[gi]));
  }
  const diffs = survived
    ? show.map((k, i) => {
      const d = sum[i] / survived;
      return `${k.slice(0, 5)}:${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
    }).join(' ')
    : '';
  console.log(`${id.padEnd(14)} alive ${survived}/${seeds}${ext.length ? ` (died y${ext.join(',y')})` : ''} pop~${survived ? Math.round(pop / survived) : 0} sp~${survived ? (species / survived).toFixed(1) : 0} ${(ms / ticks).toFixed(2)}ms/t`);
  if (diffs) console.log(`   ${diffs}`);
}
