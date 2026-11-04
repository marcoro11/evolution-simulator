// The evolution engine. Pure logic, no DOM: it can run in the browser or in
// Node (see tools/headless.mjs) for quick balance checks.
//
// Model in one paragraph: organisms wander a 2D world eating plants (or each
// other), paying an energy cost every tick that depends on their genes and on
// the environment (temperature, humidity, oxygen…). When they have enough
// energy they reproduce asexually; offspring inherit the parent's genome with
// small random mutations. Whoever is better suited to the environment leaves
// more offspring, so the population's average genome drifts over time.
// Environmental predators hunt whoever they can see (camouflage helps), catch
// whoever is slower (speed helps) and fail against armor or large bodies.

import { makeRng } from './rng.js';
import {
  GENES, GENE_INDEX as GI, ORGANISM_BY_ID, TERRAINS, EVENTS, EPITHETS, SPECIES_COLORS,
} from './presets.js';

export const W = 1000;
export const H = 640;
export const YEAR = 200; // ticks per simulated year
export const MAX_POP = 650;
const CELL = 40;
const LAT = 10; // °C difference between the north (top) and south (bottom) edge
const NG = GENES.length;
const MAX_SPECIES = 8;
const SPLIT_T = 0.4;
const PLANT_E = 8.5;
const BODY_SHARE = 0.25; // part of every meal that goes into building body mass
const BODY_PER_MASS = 40;

const { size: SIZE, speed: SPEED, sense: SENSE, insulation: INSUL, heatTol: HEAT, drought: DRY,
  armor: ARMOR, diet: DIET, fertility: FERT, longevity: LONG, hue: HUE, lightness: LIGHT } = GI;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------- colours

export function hslToRgb(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function genomeRgb(g) {
  return hslToRgb(g[HUE], 0.5, 0.1 + g[LIGHT] * 0.8);
}
function contrastWith(rgb, ground) {
  const dr = rgb[0] - ground[0], dg = rgb[1] - ground[1], db = rgb[2] - ground[2];
  return clamp(Math.sqrt(dr * dr + dg * dg + db * db) / 300, 0, 1);
}

// ---------------------------------------------------------------- genetics

export function geneDistance(a, b) {
  let s = 0;
  for (let i = 0; i < NG; i++) {
    let d = Math.abs(a[i] - b[i]);
    if (i === HUE) d = Math.min(d, 1 - d) * 0.6;
    s += d * d;
  }
  return Math.sqrt(s);
}

export function meanGenome(list, pick = (o) => o.g) {
  const m = new Array(NG).fill(0);
  if (!list.length) return m;
  let hs = 0, hc = 0;
  for (const o of list) {
    const g = pick(o);
    for (let i = 0; i < NG; i++) m[i] += g[i];
    hs += Math.sin(g[HUE] * 2 * Math.PI);
    hc += Math.cos(g[HUE] * 2 * Math.PI);
  }
  for (let i = 0; i < NG; i++) m[i] /= list.length;
  m[HUE] = ((Math.atan2(hs, hc) / (2 * Math.PI)) + 1) % 1;
  return m;
}

// Turn genes into the numbers the simulation actually uses.
export function phenotype(g, mods) {
  const sizeF = 0.35 + g[SIZE] * 2.65; // 0.35 .. 3
  const mass = sizeF * sizeF;
  const radius = 2 + sizeF * 3.2;
  const speed = (0.45 + g[SPEED] * 2.1) * (1 - g[ARMOR] * 0.4);
  const sense = 18 + g[SENSE] * 110 + radius;
  const maxAge = (250 + g[LONG] * 1100) * (0.75 + 0.25 * sizeF) * mods.lifeMul;
  const maturity = 30 + maxAge * 0.1;
  const litter = 1 + Math.floor(g[FERT] * 4.99);
  const maxEnergy = 40 * mass + 10;
  const herbEff = Math.pow(1 - g[DIET], 1.15);
  const meatEff = Math.pow(g[DIET], 1.15);
  // Comfort zone: fur & big bodies keep heat in (Bergmann's rule), heat
  // tolerance (big ears, sweat glands…) pushes the upper limit up.
  const coldLimit = 14 - g[INSUL] * 55 - (sizeF - 1) * 6;
  const heatLimit = 27 + g[HEAT] * 24 - g[INSUL] * 14 - (sizeF - 1) * 3;
  const baseCost = 0.032 * Math.pow(mass, 0.75)
    + 0.01 * g[SENSE]
    + 0.028 * g[SPEED] * g[SPEED] * Math.sqrt(mass)
    + 0.03 * g[ARMOR] * Math.sqrt(mass)
    + 0.01 * g[INSUL]
    + 0.01 * g[HEAT]
    + 0.01 * g[DRY]
    + 0.04 * g[LONG];
  return {
    sizeF, mass, radius, speed, sense, maxAge, maturity, litter, maxEnergy,
    herbEff, meatEff, coldLimit, heatLimit, baseCost,
    sqrtMass: Math.sqrt(mass), mass08: Math.pow(mass, 0.8), bite: Math.pow(mass, 0.45),
    ecto: !!mods.ecto, insect: !!mods.insect, skinMul: mods.skinMul ?? 1,
    rgb: genomeRgb(g), contrast: 1, fear: 1,
  };
}

// Temperature the plants like, used for growth.
function plantTempFactor(T) {
  const x = (T - 22) / 28;
  return clamp(Math.exp(-x * x), 0.2, 1);
}

// ---------------------------------------------------------------- world

export class World {
  constructor(opts) {
    this.configure(opts);
  }

  configure({ env, organisms, seed = 1, label = '' }) {
    this.env = { ...env };
    this.organismIds = organisms.slice();
    this.seed = seed;
    this.label = label;
    this.reset();
  }

  reset() {
    const rng = (this.rng = makeRng(this.seed));
    this.tick = 0;
    this.nextId = 1;
    this.orgs = [];
    this.newborns = [];
    this.preds = [];
    this.cols = Math.ceil(W / CELL);
    this.rows = Math.ceil(H / CELL);
    this.plantCells = Array.from({ length: this.cols * this.rows }, () => []);
    this.orgCells = Array.from({ length: this.cols * this.rows }, () => []);
    this.plantCount = 0;
    this.plantAcc = 0;
    this.species = [];
    this.speciesById = new Map();
    this.events = [];
    this.fx = [];
    this.log = [];
    this.markers = [];
    this.history = [];
    this.histEvery = 25;
    this.snapshots = [];
    this.extinct = false;
    this.deaths = { starved: 0, old: 0, predator: 0, eaten: 0, cold: 0, heat: 0, disaster: 0 };
    this.births = 0;
    this.lineageAlive = new Map();
    this.oases = Array.from({ length: 5 }, () => ({ x: rng.range(80, W - 80), y: rng.range(80, H - 80), r: rng.range(50, 90) }));
    this.ground = hexToRgb((TERRAINS[this.env.terrain] || TERRAINS.grass).ground);
    this.computeEnv();

    // Start with a partially grown world.
    const startPlants = Math.min(this.maxPlants() * 0.7, 900);
    for (let i = 0; i < startPlants; i++) this.spawnPlant();

    const ids = this.organismIds.length ? this.organismIds : ['rabbit'];
    const per = Math.round(clamp(110 / ids.length, 25, 60));
    for (const id of ids) {
      const preset = ORGANISM_BY_ID[id];
      if (!preset) continue;
      const sp = this.addSpecies({
        name: `${preset.genus} ${preset.epithet}`,
        presetId: id,
        parentId: null,
        centroid: preset.genome.slice(),
      });
      // Hunters start outnumbered by prey, like in any real food chain.
      const count = preset.genome[DIET] > 0.5 && ids.length > 1 ? Math.round(per * 0.35) : per;
      for (let i = 0; i < count; i++) {
        const g = preset.genome.map((v, k) => (k === HUE ? (v + rng.normal() * 0.01 + 1) % 1 : clamp(v + rng.normal() * 0.02, 0, 1)));
        const o = this.makeOrg(g, preset, sp.id, rng.range(10, W - 10), rng.range(10, H - 10), 0);
        o.energy = o.p.maxEnergy * rng.range(0.4, 0.7);
        o.body = o.p.mass * BODY_PER_MASS * rng.range(0.5, 1);
        o.age = Math.floor(rng() * o.p.maturity * 1.5);
        this.orgs.push(o);
      }
      this.lineageAlive.set(id, count);
    }
    this.initialMean = meanGenome(this.orgs);
    this.narrMean = this.initialMean.slice();
    this.syncPredators(true);
    this.addLog('🌍', `A new world begins with ${ids.map((i) => ORGANISM_BY_ID[i]?.name).join(' + ')}.`);
    this.recordHistory();
    this.takeSnapshot();
  }

  // Change the environment while the simulation is running.
  setEnv(env) {
    const terrainChanged = env.terrain !== this.env.terrain;
    this.env = { ...env };
    if (terrainChanged) {
      this.ground = hexToRgb((TERRAINS[this.env.terrain] || TERRAINS.grass).ground);
      for (const o of this.orgs) o.p.contrast = contrastWith(o.p.rgb, this.ground);
    }
  }

  addSpecies({ name, presetId, parentId, centroid }) {
    const id = this.species.length + 1;
    const sp = {
      id, name, presetId, parentId, centroid,
      born: this.tick, extinct: null, count: 0, peak: 0,
      color: SPECIES_COLORS[(id - 1) % SPECIES_COLORS.length],
    };
    this.species.push(sp);
    this.speciesById.set(id, sp);
    return sp;
  }

  makeOrg(g, preset, spId, x, y, gen) {
    const p = phenotype(g, preset.mods);
    p.contrast = contrastWith(p.rgb, this.ground);
    const o = {
      id: this.nextId++, g, p, preset: preset.id, sp: spId,
      x, y, angle: this.rng() * Math.PI * 2,
      energy: p.maxEnergy * 0.5, age: 0, gen, cool: 0, hunt: 0,
      tgt: null, scan: 0, dead: null, state: 0, chasedBy: null, body: 0,
    };
    p.fear = killChance(o);
    return o;
  }

  // -------------------------------------------------------------- environment

  computeEnv() {
    const e = this.env;
    let T = e.temperature, hum = e.humidity / 100, food = e.food / 100, preds = e.predators;
    for (const ev of this.events) {
      const k = this.eventIntensity(ev);
      const def = EVENTS[ev.type];
      if (def.dT) T += def.dT * k;
      if (def.dHum) hum += def.dHum * k;
      if (def.foodMul) food *= 1 + (def.foodMul - 1) * k;
      if (def.dPred) preds += def.dPred * k;
    }
    const theta = (2 * Math.PI * this.tick) / YEAR;
    const phase = Math.sin(theta);
    const q = Math.floor(((theta + Math.PI / 4) % (2 * Math.PI)) / (Math.PI / 2));
    this.cur = {
      T: T + phase * e.seasonality,
      meanT: T,
      hum: clamp(hum, 0, 1),
      food: Math.max(0, food),
      preds: Math.max(0, preds),
      oxy: e.oxygen,
      rad: e.radiation,
      season: e.seasonality < 2 ? '' : ['spring', 'summer', 'autumn', 'winter'][q],
    };
  }

  eventIntensity(ev) {
    const t = (this.tick - ev.start) / ev.duration;
    if (t < 0 || t > 1) return 0;
    if (EVENTS[ev.type].shape === 'decay') return 1 - t;
    if (t < 0.12) return t / 0.12;
    if (t > 0.8) return (1 - t) / 0.2;
    return 1;
  }

  localTemp(y) {
    return this.cur.T + (y / H - 0.5) * LAT;
  }

  maxPlants() {
    return Math.min(1600, 1100 * this.cur.food);
  }

  spawnPlant() {
    const rng = this.rng;
    const oasisFrac = clamp((0.5 - this.cur.hum) * 2, 0, 0.92);
    let x, y;
    for (let tries = 0; tries < 4; tries++) {
      if (rng() < oasisFrac) {
        const o = rng.pick(this.oases);
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * o.r;
        x = o.x + Math.cos(a) * r;
        y = o.y + Math.sin(a) * r;
      } else {
        x = rng() * W;
        y = rng() * H;
      }
      // Plants also prefer the latitude with the best temperature.
      if (rng() < plantTempFactor(this.localTemp(y)) / plantTempFactor(this.cur.T + 5) || tries === 3) break;
    }
    x = clamp(x, 1, W - 1);
    y = clamp(y, 1, H - 1);
    const c = this.cellOf(x, y);
    this.plantCells[c].push({ x, y });
    this.plantCount++;
  }

  growPlants() {
    const c = this.cur;
    const rate = 8 * c.food * plantTempFactor(c.T) * (0.25 + 0.75 * c.hum);
    this.plantAcc += rate;
    const max = this.maxPlants();
    while (this.plantAcc >= 1) {
      this.plantAcc -= 1;
      if (this.plantCount < max) this.spawnPlant();
    }
    // Plants wither if the world got harsher than it can support.
    if (this.plantCount > max * 1.05 && this.tick % 4 === 0) {
      const cell = this.plantCells[this.rng.int(this.plantCells.length)];
      if (cell.length) {
        cell.pop();
        this.plantCount--;
      }
    }
  }

  cellOf(x, y) {
    const cx = Math.min(this.cols - 1, Math.max(0, (x / CELL) | 0));
    const cy = Math.min(this.rows - 1, Math.max(0, (y / CELL) | 0));
    return cy * this.cols + cx;
  }

  rebuildGrid() {
    for (const c of this.orgCells) c.length = 0;
    for (const o of this.orgs) if (!o.dead) this.orgCells[this.cellOf(o.x, o.y)].push(o);
  }

  // Calls fn(item, dx, dy, d2) for items within radius r of (x, y).
  query(cells, x, y, r, fn) {
    const x0 = Math.max(0, ((x - r) / CELL) | 0), x1 = Math.min(this.cols - 1, ((x + r) / CELL) | 0);
    const y0 = Math.max(0, ((y - r) / CELL) | 0), y1 = Math.min(this.rows - 1, ((y + r) / CELL) | 0);
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cells[cy * this.cols + cx];
        for (let i = 0; i < cell.length; i++) {
          const it = cell[i];
          const dx = it.x - x, dy = it.y - y, d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(it, dx, dy, d2);
        }
      }
    }
  }

  removePlant(pl) {
    const cell = this.plantCells[this.cellOf(pl.x, pl.y)];
    const i = cell.indexOf(pl);
    if (i >= 0) {
      cell[i] = cell[cell.length - 1];
      cell.pop();
      this.plantCount--;
      pl.eaten = true;
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------- predators

  syncPredators(instant = false) {
    const target = Math.round(this.cur.preds * 3.5);
    const rng = this.rng;
    if (this.preds.length < target && (instant || rng() < 0.05)) {
      const n = instant ? target - this.preds.length : 1;
      for (let i = 0; i < n; i++) {
        const edge = rng.int(4);
        this.preds.push({
          x: edge === 0 ? 0 : edge === 1 ? W : rng() * W,
          y: edge === 2 ? 0 : edge === 3 ? H : rng() * H,
          angle: rng() * Math.PI * 2, rest: 0, tgt: null, chase: 0, id: this.nextId++,
        });
      }
    } else if (this.preds.length > target && (instant || rng() < 0.05)) {
      this.preds.pop();
    }
  }

  updatePredators() {
    this.syncPredators();
    const rng = this.rng;
    const range = 150;
    for (const pr of this.preds) {
      if (pr.rest > 0) {
        pr.rest--;
        pr.angle += rng.normal() * 0.2;
        this.moveEntity(pr, 0.3);
        continue;
      }
      if (pr.tgt && ++pr.chase > 90) {
        // Out of breath: the prey got away.
        pr.tgt = null;
        pr.rest = 25;
        continue;
      }
      if (!pr.tgt || pr.tgt.dead) {
        pr.chase = 0;
        let best = null, bestD = Infinity;
        this.query(this.orgCells, pr.x, pr.y, range, (q, dx, dy, d2) => {
          if (q.dead || q.p.fear < 0.02) return;
          // Camouflage shrinks the distance at which you get spotted.
          const vis = (0.18 + 0.82 * q.p.contrast) * (0.55 + 0.45 * Math.min(1, q.p.sizeF / 1.4));
          const r = range * vis;
          if (d2 < r * r && d2 < bestD) {
            bestD = d2;
            best = q;
          }
        });
        pr.tgt = best;
        pr.chase = 0;
      }
      const q = pr.tgt;
      if (q) {
        const dx = q.x - pr.x, dy = q.y - pr.y;
        pr.angle = Math.atan2(dy, dx);
        // Sprint when close: a short pounce.
        this.moveEntity(pr, dx * dx + dy * dy < 625 ? 2.4 : 1.9);
        const reach = 6 + q.p.radius;
        if (dx * dx + dy * dy < reach * reach) {
          if (rng() < killChance(q)) {
            q.dead = 'predator';
            if (this.onKill) this.onKill(q, pr);
            pr.rest = 8;
          } else {
            pr.rest = 6;
          }
          pr.tgt = null;
        }
      } else {
        pr.angle += rng.normal() * 0.25;
        this.moveEntity(pr, 0.8);
      }
    }
  }

  moveEntity(e, spd) {
    e.x += Math.cos(e.angle) * spd;
    e.y += Math.sin(e.angle) * spd;
    if (e.x < 2) { e.x = 2; e.angle = Math.PI - e.angle; }
    else if (e.x > W - 2) { e.x = W - 2; e.angle = Math.PI - e.angle; }
    if (e.y < 2) { e.y = 2; e.angle = -e.angle; }
    else if (e.y > H - 2) { e.y = H - 2; e.angle = -e.angle; }
  }

  // -------------------------------------------------------------- organisms

  updateOrgs() {
    const c = this.cur, rng = this.rng;
    const oxyF = c.oxy / 21;
    const oxyCost = Math.max(0, 1 - oxyF) * 1.6;
    const oxySpeed = Math.min(1.12, Math.pow(oxyF, 0.4));
    const oxyBonus = clamp((oxyF - 1) * 0.6, 0, 0.35);
    const dry = Math.max(0, 0.5 - c.hum) * 2;
    const radCost = Math.max(0, c.rad - 2) * 0.002;
    const crowd = this.orgs.length / MAX_POP;
    const breedChance = 1 - crowd * crowd * crowd;
    const mutSd = 0.02 * Math.pow(Math.max(0.05, c.rad), 0.6);
    const bigMut = 0.004 * c.rad;
    const preds = this.preds;
    // Unseen ambush predation, scaled by the Predators setting. The roaming
    // predators on screen are the visible part of the same pressure.
    const hazard = c.preds * 0.00014;

    for (let idx = 0, n = this.orgs.length; idx < n; idx++) {
      const o = this.orgs[idx];
      if (o.dead) continue;
      const p = o.p, g = o.g;
      o.age++;
      if (o.cool > 0) o.cool--;
      if (o.hunt > 0) o.hunt--;
      const T = this.localTemp(o.y);

      // --- energy bill
      let cost = p.baseCost;
      if (p.insect) cost *= 1 + Math.max(0, p.sizeF - 0.75 * oxyF * oxyF) * 2.2;
      cost *= 1 + oxyCost * Math.sqrt(p.sizeF);
      // Oxygen-rich air fuels big bodies (think giant Carboniferous insects).
      if (oxyBonus > 0) cost *= 1 - oxyBonus * clamp((p.sizeF - 0.5) / 1.5, 0, 1);
      let speedMul = oxySpeed;
      if (p.ecto) {
        if (T < 18) speedMul *= clamp((T + 8) / 26, 0.25, 1);
        cost *= T < 18 ? 0.6 : 0.8;
      }
      const cold = Math.max(0, p.coldLimit - T);
      const heat = Math.max(0, T - p.heatLimit);
      const stress = cold + heat;
      // Cold-blooded creatures slow down instead of burning energy to keep warm.
      cost += (p.ecto ? cold * 0.5 + heat : stress) * 0.006 * p.sqrtMass;
      if (dry > 0) {
        cost += dry * (1 + Math.max(0, T - 25) / 15) * Math.pow(1 - g[DRY], 1.5) * 0.05 * p.sqrtMass * p.skinMul;
      }
      cost += radCost;
      if (hazard > 0 && rng() < hazard * (0.2 + 0.8 * p.contrast) * killChance(o)) {
        o.dead = 'predator';
        o.chasedBy = null;
        continue;
      }

      // --- decide where to go
      let tx = 0, ty = 0, mode = 0;
      const sense = p.sense;
      const s2 = sense * sense * 0.45;
      const fearful = p.fear > 0.25;
      for (let k = 0; fearful && k < preds.length; k++) {
        const pr = preds[k];
        const dx = o.x - pr.x, dy = o.y - pr.y, d2 = dx * dx + dy * dy;
        if (d2 < s2) {
          const inv = 1 / (Math.sqrt(d2) + 1);
          tx += dx * inv;
          ty += dy * inv;
          mode = 2;
        }
      }
      // Being chased by an evolved hunter? Run!
      const ch = o.chasedBy;
      if (ch) {
        const dx = o.x - ch.x, dy = o.y - ch.y, d2 = dx * dx + dy * dy;
        if (ch.dead || ch.tgt !== o || d2 > s2 * 3) o.chasedBy = null;
        else if (d2 < s2 * 0.4) { // hunters stalk: you notice them late
          const inv = 1 / (Math.sqrt(d2) + 1);
          tx += dx * inv;
          ty += dy * inv;
          mode = 2;
        }
      }
      const hungry = o.energy < p.maxEnergy * 0.85;
      if (mode !== 2 && hungry) {
        let t = o.tgt;
        if (t && (t.dead || t.eaten)) t = o.tgt = null;
        if (!t || --o.scan <= 0) {
          o.scan = 6;
          t = this.findFood(o);
          o.tgt = t;
          if (t && t.g) t.chasedBy = o;
        }
        if (t) {
          tx = t.x - o.x;
          ty = t.y - o.y;
          mode = 1;
        }
      } else if (!hungry) {
        o.tgt = null;
      }

      let spd;
      if (mode === 2) {
        o.angle = Math.atan2(ty, tx);
        spd = p.speed;
      } else if (mode === 1) {
        o.angle = Math.atan2(ty, tx);
        const d = Math.sqrt(tx * tx + ty * ty);
        // Hunters pounce when close; grazers just walk over.
        spd = o.tgt.g ? (d < 35 ? p.speed * 1.45 : p.speed * 1.1) : Math.min(p.speed, 0.95);
        if (d < spd) spd = d;
      } else {
        o.angle += rng.normal() * 0.35;
        // Drift toward a more comfortable latitude.
        if (T < p.coldLimit + 3) o.angle += angleDiff(o.angle, Math.PI / 2) * 0.06;
        else if (T > p.heatLimit - 3) o.angle += angleDiff(o.angle, -Math.PI / 2) * 0.06;
        spd = Math.min(p.speed, 0.55);
      }
      spd *= speedMul;
      this.moveEntity(o, spd);
      cost += 0.018 * p.mass08 * Math.pow(spd, 1.6);
      o.state = mode;

      // --- eat
      const t = o.tgt;
      if (mode === 1 && t) {
        const dx = t.x - o.x, dy = t.y - o.y, d2 = dx * dx + dy * dy;
        if (!t.g) {
          const reach = p.radius + 3;
          if (d2 < reach * reach && this.removePlant(t)) {
            this.feed(o, PLANT_E * p.herbEff * p.bite);
            o.tgt = null;
          }
        } else if (o.hunt === 0) {
          const reach = p.radius + t.p.radius + 1;
          if (d2 < reach * reach) this.attack(o, t);
        }
      }

      // --- pay the bill, maybe die
      o.energy -= cost;
      if (o.energy <= 0) {
        o.dead = stress > 6 ? (cold > heat ? 'cold' : 'heat') : 'starved';
        continue;
      }
      if (o.age > p.maxAge) {
        o.dead = 'old';
        continue;
      }
      if (stress > 22 && rng() < 0.002 * (stress - 22)) {
        o.dead = cold > heat ? 'cold' : 'heat';
        continue;
      }

      // --- reproduce
      if (o.cool === 0 && o.age > p.maturity && o.energy > p.maxEnergy * 0.6 && rng() < breedChance) {
        const preset = ORGANISM_BY_ID[o.preset];
        const kids = p.litter;
        const invest = o.energy * 0.55;
        o.energy -= invest;
        const each = (invest * 0.9) / kids;
        for (let k = 0; k < kids; k++) {
          const cg = this.mutate(g, mutSd, bigMut);
          const child = this.makeOrg(cg, preset, o.sp,
            clamp(o.x + rng.normal() * 6, 2, W - 2), clamp(o.y + rng.normal() * 6, 2, H - 2), o.gen + 1);
          child.body = each * 0.4;
          child.energy = Math.min(child.p.maxEnergy, each * 0.6);
          this.newborns.push(child);
        }
        this.births += kids;
        o.cool = Math.round(25 + p.sizeF * 22);
      }
    }
  }

  findFood(o) {
    const p = o.p;
    const r = Math.min(p.sense, 140);
    let best = null, bestScore = 0;
    if (p.herbEff > 0.1) {
      this.query(this.plantCells, o.x, o.y, r, (pl, dx, dy, d2) => {
        const s = p.herbEff / (Math.sqrt(d2) + 8);
        if (s > bestScore) {
          bestScore = s;
          best = pl;
        }
      });
    }
    if (p.meatEff > 0.12 && o.energy < p.maxEnergy * 0.75) {
      this.query(this.orgCells, o.x, o.y, r, (q, dx, dy, d2) => {
        if (q === o || q.dead) return;
        if (q.sp === o.sp) return; // no cannibalism within a species
        if (q.p.sizeF > p.sizeF * 1.25) return;
        // Camouflage works against evolved hunters too.
        const vr = r * (0.3 + 0.7 * q.p.contrast);
        if (d2 > vr * vr) return;
        const value = (q.body + q.energy) / PLANT_E;
        const s = (p.meatEff * Math.min(value, 6)) / (Math.sqrt(d2) + 8) * 0.8;
        if (s > bestScore) {
          bestScore = s;
          best = q;
        }
      });
    }
    return best;
  }

  attack(o, q) {
    const p = o.p, qp = q.p;
    const chance = clamp(
      0.22 + 0.35 * (p.speed - qp.speed) / 2 + 0.25 * (p.sizeF - qp.sizeF) - 0.65 * q.g[ARMOR] + 0.15 * o.g[SENSE],
      0.03, 0.9,
    );
    if (this.rng() < chance) {
      q.dead = 'eaten';
      // You only get back (part of) what the prey ate: no free energy.
      this.feed(o, (Math.max(0, q.energy) + q.body) * p.meatEff);
      o.tgt = null;
    } else {
      o.energy -= 0.5;
      o.hunt = 14;
    }
  }

  feed(o, gain) {
    const bodyCap = o.p.mass * BODY_PER_MASS;
    if (o.body < bodyCap) {
      const b = Math.min(gain * BODY_SHARE, bodyCap - o.body);
      o.body += b;
      gain -= b;
    }
    o.energy = Math.min(o.p.maxEnergy, o.energy + gain);
  }

  mutate(g, sd, bigMut) {
    const rng = this.rng;
    const c = new Array(NG);
    for (let i = 0; i < NG; i++) {
      let v = g[i] + rng.normal() * sd;
      if (rng() < bigMut) v += rng.normal() * 0.18;
      c[i] = i === HUE ? ((v % 1) + 1) % 1 : clamp(v, 0, 1);
    }
    return c;
  }

  // -------------------------------------------------------------- main step

  step() {
    if (this.extinct) return;
    this.tick++;
    this.computeEnv();
    this.growPlants();
    this.rebuildGrid();
    this.updatePredators();
    this.updateOrgs();

    // Remove the dead, add the newborns.
    let alive = 0;
    for (const o of this.orgs) {
      if (o.dead) {
        this.deaths[o.dead] = (this.deaths[o.dead] || 0) + 1;
        o.tgt = null;
        o.chasedBy = null;
      } else {
        this.orgs[alive++] = o;
      }
    }
    this.orgs.length = alive;
    if (this.newborns.length) {
      for (const b of this.newborns) this.orgs.push(b);
      this.newborns.length = 0;
    }

    this.events = this.events.filter((ev) => this.tick - ev.start <= ev.duration);
    this.fx = this.fx.filter((f) => this.tick - f.start < f.life);

    if (this.tick % 150 === 0) this.speciate();
    if (this.tick % this.histEvery === 0) this.recordHistory();
    if (this.tick % 100 === 0) this.takeSnapshot();
    if (this.tick % (YEAR * 10) === 0) this.narrate();

    if (this.orgs.length === 0) {
      this.extinct = true;
      this.speciate();
      this.recordHistory();
      this.addLog('💀', `Life went extinct in year ${this.year().toFixed(1)}.`);
    }
  }

  year() {
    return this.tick / YEAR;
  }

  // -------------------------------------------------------------- species

  speciate() {
    const groups = new Map();
    const lineage = new Map();
    for (const o of this.orgs) {
      let arr = groups.get(o.sp);
      if (!arr) groups.set(o.sp, (arr = []));
      arr.push(o);
      lineage.set(o.preset, (lineage.get(o.preset) || 0) + 1);
    }
    for (const [id, was] of this.lineageAlive) {
      if (was > 0 && !lineage.get(id)) {
        this.addLog('🪦', `The last of the ${ORGANISM_BY_ID[id].name.toLowerCase()} lineage died out.`);
      }
      this.lineageAlive.set(id, lineage.get(id) || 0);
    }
    let aliveCount = 0;
    for (const sp of this.species) {
      if (sp.extinct !== null) continue;
      const members = groups.get(sp.id);
      if (!members || !members.length) {
        sp.extinct = this.tick;
        sp.count = 0;
        this.addLog('✝️', `${sp.name} went extinct (peak population ${sp.peak}).`);
        continue;
      }
      sp.count = members.length;
      sp.peak = Math.max(sp.peak, sp.count);
      sp.centroid = meanGenome(members);
      aliveCount++;
    }
    if (aliveCount >= MAX_SPECIES) return;

    for (const sp of this.species.slice()) {
      if (sp.extinct !== null || aliveCount >= MAX_SPECIES) continue;
      const members = groups.get(sp.id);
      if (!members || members.length < 14) continue;
      // Two-means clustering in gene space: does the species have two camps?
      let c1 = sp.centroid, c2 = null, far = -1;
      for (const m of members) {
        const d = geneDistance(m.g, c1);
        if (d > far) {
          far = d;
          c2 = m.g;
        }
      }
      if (far < SPLIT_T) continue;
      let A = [], B = [];
      for (let it = 0; it < 4; it++) {
        A = [];
        B = [];
        for (const m of members) (geneDistance(m.g, c1) <= geneDistance(m.g, c2) ? A : B).push(m);
        if (!A.length || !B.length) break;
        c1 = meanGenome(A);
        c2 = meanGenome(B);
      }
      const minSize = Math.max(6, members.length * 0.1);
      if (A.length < minSize || B.length < minSize || geneDistance(c1, c2) < SPLIT_T) continue;
      const [stay, go, cStay, cGo] = A.length >= B.length ? [A, B, c1, c2] : [B, A, c2, c1];
      const child = this.addSpecies({
        name: this.nameSpecies(sp, cGo, cStay),
        presetId: sp.presetId,
        parentId: sp.id,
        centroid: cGo,
      });
      for (const m of go) m.sp = child.id;
      child.count = child.peak = go.length;
      sp.count = stay.length;
      sp.centroid = cStay;
      aliveCount++;
      this.addLog('🌱', `New species! ${child.name} branched off from ${sp.name}.`, child.id);
      this.markers.push({ tick: this.tick, icon: '🌱' });
    }
  }

  nameSpecies(parent, cNew, cOld) {
    const preset = ORGANISM_BY_ID[parent.presetId];
    let bestI = 0, bestD = 0;
    for (let i = 0; i < NG; i++) {
      let d = cNew[i] - cOld[i];
      if (i === HUE) d = 0;
      if (Math.abs(d) > Math.abs(bestD)) {
        bestD = d;
        bestI = i;
      }
    }
    const base = `${preset.genus} ${EPITHETS[GENES[bestI].key][bestD > 0 ? 1 : 0]}`;
    let name = base, n = 2;
    const taken = new Set(this.species.map((s) => s.name));
    const roman = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    while (taken.has(name)) name = `${base} ${roman[n] || n}`, n++;
    return name;
  }

  dominantSpecies() {
    let best = null;
    for (const sp of this.species) if (sp.extinct === null && (!best || sp.count > best.count)) best = sp;
    return best;
  }

  // -------------------------------------------------------------- records

  recordHistory() {
    const n = this.orgs.length;
    const traits = n ? meanGenome(this.orgs) : null;
    let camo = 0, gen = 0;
    for (const o of this.orgs) {
      camo += 1 - o.p.contrast;
      gen += o.gen;
    }
    const counts = {};
    for (const o of this.orgs) counts[o.sp] = (counts[o.sp] || 0) + 1;
    for (const sp of this.species) if (sp.extinct === null) sp.count = counts[sp.id] || 0;
    this.history.push({
      t: this.tick,
      pop: n,
      plants: this.plantCount,
      species: this.species.filter((s) => s.extinct === null).length,
      T: this.cur.T,
      meanT: this.cur.meanT,
      season: this.env.seasonality,
      preds: this.preds.length,
      traits,
      camo: n ? camo / n : null,
      gen: n ? gen / n : 0,
      counts,
    });
    if (this.history.length > 1200) {
      this.history = this.history.filter((_, i) => i % 2 === 0);
      this.histEvery *= 2;
    }
  }

  takeSnapshot() {
    if (!this.orgs.length) return;
    const dom = this.dominantSpecies();
    const members = dom ? this.orgs.filter((o) => o.sp === dom.id) : this.orgs;
    if (!members.length) return;
    this.snapshots.push({
      tick: this.tick,
      genome: meanGenome(members),
      presetId: members[0].preset,
      speciesId: dom ? dom.id : null,
      name: dom ? dom.name : '',
      pop: this.orgs.length,
      T: this.cur.meanT,
    });
    if (this.snapshots.length > 600) this.snapshots = this.snapshots.filter((_, i) => i % 2 === 0 || i === this.snapshots.length - 1);
  }

  addLog(icon, text, speciesId = null) {
    this.log.push({ tick: this.tick, icon, text, speciesId });
    if (this.log.length > 300) this.log.shift();
  }

  // Every 10 years, describe the biggest change in the average organism.
  narrate() {
    if (!this.orgs.length) return;
    const now = meanGenome(this.orgs);
    const changes = [];
    for (let i = 0; i < NG; i++) {
      const gene = GENES[i];
      if (gene.hidden) continue;
      const d = now[i] - this.narrMean[i];
      if (Math.abs(d) > 0.06) changes.push({ i, d });
    }
    changes.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    for (const ch of changes.slice(0, 2)) {
      const gene = GENES[ch.i];
      const why = explain(gene.key, ch.d > 0, this.cur, this.env);
      const arrow = ch.d > 0 ? '▲' : '▼';
      this.addLog(gene.icon, `${gene.label} ${arrow}${Math.round(Math.abs(ch.d) * 100)}% — ${why}`);
    }
    this.narrMean = now;
  }

  // -------------------------------------------------------------- events

  triggerEvent(type) {
    const def = EVENTS[type];
    if (!def || this.extinct) return;
    const rng = this.rng;
    this.events.push({ type, start: this.tick, duration: def.duration });
    this.markers.push({ tick: this.tick, icon: def.icon });
    let killed = 0;
    if (type === 'meteor') {
      const x = rng.range(150, W - 150), y = rng.range(120, H - 120), r = 230;
      this.fx.push({ type: 'meteor', x, y, r, start: this.tick, life: 90 });
      for (const o of this.orgs) {
        const dx = o.x - x, dy = o.y - y;
        if (dx * dx + dy * dy < r * r || rng() < 0.2) {
          o.dead = 'disaster';
          killed++;
        }
      }
      for (const cell of this.plantCells) {
        for (let i = cell.length - 1; i >= 0; i--) {
          const pl = cell[i];
          const dx = pl.x - x, dy = pl.y - y;
          if (dx * dx + dy * dy < r * r) {
            cell[i] = cell[cell.length - 1];
            cell.pop();
            this.plantCount--;
          }
        }
      }
    } else if (type === 'plague') {
      const counts = {};
      for (const o of this.orgs) counts[o.sp] = (counts[o.sp] || 0) + 1;
      const total = this.orgs.length || 1;
      this.fx.push({ type: 'plague', start: this.tick, life: 60 });
      for (const o of this.orgs) {
        const share = counts[o.sp] / total;
        if (rng() < 0.1 + 0.55 * share) {
          o.dead = 'disaster';
          killed++;
        }
      }
    } else {
      this.fx.push({ type, start: this.tick, life: 60 });
    }
    this.addLog(def.icon, `${def.name}! ${killed ? `${killed} organisms perished instantly. ` : ''}${def.desc}`);
  }
}

// Probability that a predator attack on this organism succeeds.
function killChance(q) {
  // Armor deflects, agility dodges, sheer size intimidates.
  let p = (1 - q.g[ARMOR] * 0.8) * (1 - clamp((q.p.speed - 0.9) / 1.8, 0, 0.8));
  if (q.p.sizeF > 1.6) p *= Math.max(0.05, 1 - (q.p.sizeF - 1.6) * 0.9);
  // Hunters fight back; true carnivores are apex animals.
  if (q.g[DIET] > 0.35) p *= Math.max(0, 1 - (q.g[DIET] - 0.35) * 5);
  return p;
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Plain-language reasons for a trait change, given the environment.
export function explain(key, up, cur, env) {
  const cold = cur.meanT < 5, hot = cur.meanT > 30, dry = cur.hum < 0.3;
  const preds = cur.preds >= 4, scarce = cur.food < 0.7, oxyHigh = cur.oxy > 25, oxyLow = cur.oxy < 18;
  switch (key) {
    case 'size':
      if (up) return cold ? 'bigger bodies hold heat better (Bergmann’s rule).'
        : preds ? 'grow big enough and predators stop bothering you.'
          : oxyHigh ? 'oxygen-rich air lets bodies grow larger.' : 'bigger bodies store more energy for lean times.';
      return oxyLow ? 'thin air can’t fuel big bodies.' : scarce ? 'smaller bodies need less food.' : hot ? 'small bodies shed heat faster.' : 'smaller, cheaper bodies breed faster.';
    case 'speed':
      return up ? (preds ? 'faster legs to outrun predators.' : 'faster to reach scattered food.') : 'running is expensive — slowing down saves energy.';
    case 'sense':
      return up ? (dry ? 'sharper senses to find rare oases.' : 'keener senses spot food and danger earlier.') : 'big brains and eyes cost energy that isn’t paying off.';
    case 'insulation':
      return up ? 'thicker fur and fat to survive the cold.' : 'shedding insulation to avoid overheating.';
    case 'heatTol':
      return up ? 'better at shedding heat (bigger ears, sweat glands — Allen’s rule).' : 'heat tolerance isn’t needed here, so it fades.';
    case 'drought':
      return up ? 'water-saving skin and kidneys for the dry climate.' : 'plenty of water around — no need to hoard it.';
    case 'armor':
      return up ? 'shells and spikes make them hard to eat.' : 'armor is heavy and slow — dropping it.';
    case 'diet':
      return up ? 'shifting toward a meat-based diet.' : 'becoming more of a plant-eater.';
    case 'fertility':
      return up ? 'more babies per litter (live fast, breed often).' : 'fewer but better-fed babies.';
    case 'longevity':
      return up ? 'living longer to breed more times.' : 'short lives, quick generations.';
    case 'lightness':
      return `coloring is shifting ${up ? 'paler' : 'darker'} — ${preds ? 'camouflage against predators.' : 'drifting with the terrain.'}`;
    default:
      return 'natural selection at work.';
  }
}
