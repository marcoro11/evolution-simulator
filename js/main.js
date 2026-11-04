// UI controller: builds the sidebar, runs the animation loop, renders worlds,
// the timelapse, charts, family tree and journal.
import { World, YEAR, W, H, meanGenome, genomeRgb, phenotype, killChance } from './sim.js';
import {
  ORGANISMS, ORGANISM_BY_ID, BIOMES, BIOME_BY_ID, ENV_FIELDS, TERRAINS, EVENTS,
  GENES, GENE_INDEX, METRICS, SCENARIOS, GEOGRAPHIES, GEO_BY_ID, PLAN_INFO, PLANS, makeCustomOrganism,
} from './presets.js';
import { drawWorld, drawCreature, pickOrganism, PLAN_EXTENT } from './render.js';
import { LineChart, drawTree } from './charts.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const WORLD_COLOR = { A: '#4cc9f0', B: '#ff9f1c' };
const SPEEDS = [
  { v: 1, label: '1×' }, { v: 4, label: '4×' }, { v: 16, label: '16×' }, { v: 64, label: '64×' }, { v: 'max', label: 'MAX' },
];
const VISIBLE_GENES = GENES.map((g, i) => ({ ...g, i })).filter((g) => !g.hidden);

// ------------------------------------------------------------------ state

const randomSeed = () => Math.floor(Math.random() * 1e6);
const envFromBiome = (id) => ({ ...BIOME_BY_ID[id].env, geo: 'open', biome: id });
const MAX_CUSTOM = 6;

const state = {
  organisms: ['rabbit'],
  customs: [], // designer-made organisms: { id, name, plan, genome, look }
  sexual: false,
  compare: false,
  seed: randomSeed(),
  env: { A: envFromBiome('meadow'), B: envFromBiome('tundra') },
  editing: 'A',
  speed: 4,
  running: false,
  traitKeys: ['size', 'speed', 'insulation', 'heatTol', 'camo'],
  tab: 'pop',
  treeWorld: 'A',
  eventTarget: 'both',
  scrub: null, // null = live, otherwise a tick
  replay: null,
};

let worlds = {}; // { A: World, B?: World }
const views = {}; // per world key: DOM refs + selection

// ------------------------------------------------------------------ persistence

function encodeConfig() {
  const strip = (e) => Object.fromEntries(Object.entries(e));
  const cfg = configObject();
  cfg.a = strip(cfg.a);
  cfg.b = strip(cfg.b);
  return btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function configObject() {
  // only include designs that are in use, so share links stay short
  const x = state.customs.filter((c) => state.organisms.includes(c.id));
  return { o: state.organisms, c: state.compare ? 1 : 0, m: state.sexual ? 1 : 0, s: state.seed, a: state.env.A, b: state.env.B, x };
}

function validCustom(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^c\d{1,9}$/.test(c.id)) return null;
  if (!PLAN_INFO[c.plan] || !Array.isArray(c.genome) || c.genome.length !== GENES.length) return null;
  if (!c.genome.every((v) => typeof v === 'number' && isFinite(v))) return null;
  const look = {};
  if (c.look && typeof c.look === 'object') {
    if (['round', 'pointy', 'long'].includes(c.look.ears)) look.ears = c.look.ears;
    if (['long', 'fluffy', 'short'].includes(c.look.tail)) look.tail = c.look.tail;
    if (c.look.horns === true) look.horns = true;
  }
  return { id: c.id, name: String(c.name || 'Custom').slice(0, 18), plan: c.plan, genome: c.genome.map((v) => clamp(v, 0, 1)), look };
}

function registerCustom(c) {
  const i = state.customs.findIndex((x) => x.id === c.id);
  if (i >= 0) state.customs[i] = c;
  else state.customs.push(c);
  makeCustomOrganism(c);
}

function applyConfig(cfg, { mergeCustoms = false } = {}) {
  if (!cfg || typeof cfg !== 'object') return;
  if (Array.isArray(cfg.x)) {
    if (!mergeCustoms) state.customs = [];
    for (const raw of cfg.x.slice(0, MAX_CUSTOM * 2)) {
      const c = validCustom(raw);
      if (c) registerCustom(c);
    }
  }
  const validEnv = (e, fallback) => {
    if (!e || typeof e !== 'object') return fallback;
    const out = { ...fallback };
    for (const f of ENV_FIELDS) if (typeof e[f.key] === 'number') out[f.key] = clamp(e[f.key], f.min, f.max);
    if (TERRAINS[e.terrain]) out.terrain = e.terrain;
    out.geo = GEO_BY_ID[e.geo] ? e.geo : 'open';
    out.biome = BIOME_BY_ID[e.biome] ? e.biome : 'custom';
    return out;
  };
  if (Array.isArray(cfg.o)) {
    const o = cfg.o.filter((id) => ORGANISM_BY_ID[id]);
    if (o.length) state.organisms = o;
  }
  state.compare = !!cfg.c;
  state.sexual = !!cfg.m;
  if (Number.isFinite(cfg.s)) state.seed = Math.abs(Math.floor(cfg.s)) % 1e9;
  state.env.A = validEnv(cfg.a, state.env.A);
  state.env.B = validEnv(cfg.b, state.env.B);
}

function loadConfig() {
  const m = location.hash.match(/cfg=([\w-]+)/);
  if (m) {
    try {
      const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
      // keep the visitor's own designs too
      try {
        const saved = JSON.parse(localStorage.getItem('primordia:cfg') || 'null');
        if (saved && Array.isArray(saved.x)) for (const raw of saved.x) { const c = validCustom(raw); if (c) registerCustom(c); }
      } catch (e) { /* ignore */ }
      applyConfig(JSON.parse(json), { mergeCustoms: true });
      return;
    } catch (e) { /* ignore broken links */ }
  }
  try {
    const saved = localStorage.getItem('primordia:cfg');
    if (saved) applyConfig(JSON.parse(saved));
  } catch (e) { /* storage may be unavailable */ }
}

function saveConfig() {
  try {
    localStorage.setItem('primordia:cfg', JSON.stringify({ ...configObject(), x: state.customs }));
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ toast

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ canvas helpers

function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== hh) {
    canvas.width = w;
    canvas.height = hh;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { ctx, w, h: hh, dpr };
}

function lerpGenome(a, b, t) {
  return a.map((v, i) => {
    if (i === GENE_INDEX.hue) {
      let d = b[i] - v;
      if (d > 0.5) d -= 1;
      if (d < -0.5) d += 1;
      return (v + d * t + 1) % 1;
    }
    return v + (b[i] - v) * t;
  });
}

// Genome of the dominant form at a given tick, interpolated between snapshots.
function snapshotAt(world, tick) {
  const s = world.snapshots;
  if (!s.length) return null;
  if (tick <= s[0].tick) return s[0];
  if (tick >= s[s.length - 1].tick) return s[s.length - 1];
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid].tick <= tick) lo = mid;
    else hi = mid;
  }
  const a = s[lo], b = s[hi];
  const t = (tick - a.tick) / (b.tick - a.tick || 1);
  const same = a.presetId === b.presetId;
  return { ...a, tick, genome: same ? lerpGenome(a.genome, b.genome, t) : (t < 0.5 ? a.genome : b.genome), presetId: t < 0.5 ? a.presetId : b.presetId, name: t < 0.5 ? a.name : b.name };
}

// Background swatch matching the terrain, so camouflage is visible.
function portraitBg(ctx, x, y, w, hh, terrain) {
  const t = TERRAINS[terrain] || TERRAINS.grass;
  const g = ctx.createRadialGradient(x + w / 2, y + hh / 2, 0, x + w / 2, y + hh / 2, Math.max(w, hh) * 0.7);
  g.addColorStop(0, t.ground);
  g.addColorStop(1, t.accent);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, hh);
}

function drawPortrait(ctx, genome, presetId, cx, cy, box, phase, angle = -0.25) {
  const plan = ORGANISM_BY_ID[presetId]?.plan || 'mammal';
  const maxR = box / 2 / PLAN_EXTENT[plan];
  const r = maxR * (0.45 + genome[GENE_INDEX.size] * 0.55);
  drawCreature(ctx, genome, presetId, cx, cy, r, angle, phase, { detail: true });
}

// ------------------------------------------------------------------ sidebar

function buildSpeed() {
  const el = $('#speed');
  el.innerHTML = '';
  SPEEDS.forEach((s, i) => {
    el.append(h('button', {
      class: state.speed === s.v ? 'on' : '', title: `Speed ${s.label} (${i + 1})`,
      onclick: () => setSpeed(s.v),
    }, s.label));
  });
}
function setSpeed(v) {
  state.speed = v;
  $$('#speed button').forEach((b, i) => b.classList.toggle('on', SPEEDS[i].v === v));
}

function buildOrganisms() {
  const el = $('#organisms');
  el.innerHTML = '';
  const all = [...ORGANISMS, ...state.customs.map((c) => ORGANISM_BY_ID[c.id]).filter(Boolean)];
  for (const o of all) {
    const c = h('canvas', { width: 260, height: 120 });
    const on = state.organisms.includes(o.id);
    const card = o.custom
      ? h('div', {
        class: `org ${on ? 'on' : ''}`, 'data-id': o.id, role: 'button', tabindex: '0', title: 'Your design',
        'aria-pressed': on ? 'true' : 'false',
        onclick: () => toggleOrganism(o.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOrganism(o.id); } },
      }, c, h('b', {}, `${o.emoji} ${o.name}`), h('small', {}, o.tag),
      h('div', { class: 'org-actions' },
        h('span', { role: 'button', tabindex: '0', title: 'Edit design', 'aria-label': `Edit ${o.name}`, onclick: (e) => { e.stopPropagation(); openDesigner(o.id); } }, '✏️'),
        h('span', { role: 'button', tabindex: '0', title: 'Delete design', 'aria-label': `Delete ${o.name}`, onclick: (e) => { e.stopPropagation(); deleteCustom(o.id); } }, '🗑️')))
      : h('button', {
        class: `org ${on ? 'on' : ''}`, 'data-id': o.id, title: o.blurb,
        'aria-pressed': on ? 'true' : 'false',
        onclick: () => toggleOrganism(o.id),
      }, c, h('b', {}, `${o.emoji} ${o.name}`), h('small', {}, o.tag));
    el.append(card);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 120);
    g.addColorStop(0, '#1d2536');
    g.addColorStop(1, '#121825');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 260, 120);
    drawPortrait(ctx, o.genome, o.id, 130, 62, 150, 0.6, -0.35);
  }
  if (state.customs.length < MAX_CUSTOM) {
    el.append(h('button', { class: 'org design', title: 'Build your own creature', onclick: () => openDesigner(null) },
      h('b', {}, '＋'), h('span', {}, 'Design your own')));
  }
}

function deleteCustom(id) {
  const c = state.customs.find((x) => x.id === id);
  if (!c || !window.confirm(`Delete “${c.name}”?`)) return;
  const inUse = state.organisms.includes(id);
  if (inUse && !confirmRestart()) return;
  state.customs = state.customs.filter((x) => x.id !== id);
  if (inUse) {
    state.organisms = state.organisms.filter((x) => x !== id);
    if (!state.organisms.length) state.organisms = ['rabbit'];
  }
  buildOrganisms();
  saveConfig();
  if (inUse) restart();
}

// ------------------------------------------------------------------ reproduction

function refreshRepro() {
  $$('#repro button').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'mate') === state.sexual));
  $('#repro-hint').textContent = state.sexual
    ? 'Parents need a partner of their own species; babies mix both genomes. New species mostly form when groups are separated.'
    : 'Every baby is a mutated copy of one parent. Simple and fast — species split easily.';
}
function buildRepro() {
  $$('#repro button').forEach((b) => {
    b.onclick = () => {
      state.sexual = b.dataset.mode === 'mate';
      for (const w of Object.values(worlds)) w.setSexual(state.sexual);
      refreshRepro();
      saveConfig();
      uiDirty = true;
    };
  });
  refreshRepro();
}

function toggleOrganism(id) {
  const has = state.organisms.includes(id);
  if (has && state.organisms.length === 1) {
    toast('Keep at least one organism 🙂');
    return;
  }
  if (!confirmRestart()) return;
  state.organisms = has ? state.organisms.filter((x) => x !== id) : [...state.organisms, id];
  syncOrgCards();
  const meat = state.organisms.filter((x) => ORGANISM_BY_ID[x].genome[GENE_INDEX.diet] > 0.5);
  if (meat.length && meat.length === state.organisms.length) toast('Hunters alone have nothing to eat — add some prey!', 3500);
  restart();
}

function syncOrgCards() {
  $$('#organisms .org').forEach((b) => {
    const on = state.organisms.includes(b.dataset.id);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function confirmRestart() {
  const longest = Math.max(0, ...Object.values(worlds).map((w) => w.tick));
  if (longest > YEAR * 3) return window.confirm('This starts a new run (the current one will be lost). Continue?');
  return true;
}

function buildEnvPanel() {
  $('#biomes').innerHTML = '';
  for (const b of BIOMES) {
    $('#biomes').append(h('button', { class: 'biome', 'data-id': b.id, title: b.name, onclick: () => setBiome(b.id) }, `${b.emoji} ${b.name}`));
  }
  $('#biomes').append(h('span', { class: 'biome custom', 'data-id': 'custom', hidden: true }, '✏️ Custom'));
  $('#geos').innerHTML = '';
  for (const g of GEOGRAPHIES) {
    $('#geos').append(h('button', { class: 'biome', 'data-geo': g.id, title: g.desc, onclick: () => setGeo(g.id) }, `${g.emoji} ${g.name}`));
  }

  const sl = $('#env-sliders');
  sl.innerHTML = '';
  for (const f of ENV_FIELDS) {
    const val = h('span', {}, '');
    const input = h('input', {
      type: 'range', min: f.min, max: f.max, step: f.step, 'data-key': f.key,
      oninput: (e) => {
        const env = state.env[state.editing];
        env[f.key] = Number(e.target.value);
        env.biome = 'custom';
        refreshEnvPanel();
        applyEnv(state.editing);
      },
    });
    sl.append(h('div', { class: 'slider' }, h('label', {}, h('span', {}, `${f.icon} ${f.label}`), val), input));
  }
  const ts = $('#terrain');
  ts.innerHTML = '';
  for (const [k, t] of Object.entries(TERRAINS)) ts.append(h('option', { value: k }, t.label));
  ts.onchange = () => {
    const env = state.env[state.editing];
    env.terrain = ts.value;
    env.biome = 'custom';
    refreshEnvPanel();
    applyEnv(state.editing);
  };

  $$('#env-tabs button[data-world]').forEach((b) => {
    b.onclick = () => {
      state.editing = b.dataset.world;
      refreshEnvPanel();
    };
  });
  $('#copy-env').onclick = () => {
    state.env.B = { ...state.env.A };
    applyEnv('B');
    refreshEnvPanel();
    toast('Copied World A’s environment into World B');
  };

  const seed = $('#seed');
  seed.value = state.seed;
  seed.onchange = () => {
    const v = parseInt(seed.value, 10);
    if (!Number.isFinite(v)) {
      seed.value = state.seed;
      return;
    }
    if (!confirmRestart()) {
      seed.value = state.seed;
      return;
    }
    state.seed = Math.abs(v) % 1e9;
    restart();
  };
  $('#seed-dice').onclick = () => {
    if (!confirmRestart()) return;
    state.seed = randomSeed();
    seed.value = state.seed;
    restart();
  };
}

function setBiome(id) {
  const env = state.env[state.editing];
  Object.assign(env, BIOME_BY_ID[id].env, { biome: id });
  refreshEnvPanel();
  applyEnv(state.editing);
  if (worlds[state.editing]?.tick > 0) toast(`${BIOME_BY_ID[id].emoji} Climate shifted to “${BIOME_BY_ID[id].name}” — evolution will follow.`);
}

function setGeo(id) {
  const env = state.env[state.editing];
  if ((env.geo || 'open') === id) return;
  env.geo = id;
  refreshEnvPanel();
  applyEnv(state.editing);
  if (worlds[state.editing]?.tick > 0) toast(`${GEO_BY_ID[id].emoji} The land reshapes: ${GEO_BY_ID[id].name.toLowerCase()}.`);
  uiDirty = true;
}

function fmtEnv(f, v) {
  if (f.key === 'temperature') return `${v > 0 ? '+' : ''}${v}${f.unit}`;
  if (f.key === 'predators') return v === 0 ? 'none' : `${v}/10`;
  return `${v}${f.unit}`;
}

function refreshEnvPanel() {
  const env = state.env[state.editing];
  $$('#biomes .biome[data-id]').forEach((b) => {
    const on = b.dataset.id === env.biome;
    b.classList.toggle('on', on);
    if (b.dataset.id === 'custom') b.hidden = env.biome !== 'custom';
  });
  $$('#env-sliders .slider').forEach((s, i) => {
    const f = ENV_FIELDS[i];
    const input = $('input', s);
    input.value = env[f.key];
    $('label span:last-child', s).textContent = fmtEnv(f, env[f.key]);
  });
  $('#terrain').value = env.terrain;
  $$('#geos .biome').forEach((b) => b.classList.toggle('on', b.dataset.geo === (env.geo || 'open')));
  $('#env-tabs').hidden = !state.compare;
  $$('#env-tabs button[data-world]').forEach((b) => b.classList.toggle('on', b.dataset.world === state.editing));
  for (const k of Object.keys(views)) updateWorldTitle(k);
  saveConfig();
}

function applyEnv(key) {
  const w = worlds[key];
  if (w) w.setEnv(state.env[key]);
  updateWorldTitle(key);
  saveConfig();
}

function buildEvents() {
  const el = $('#events');
  el.innerHTML = '';
  for (const [id, ev] of Object.entries(EVENTS)) {
    el.append(h('button', { class: 'event', title: ev.desc, onclick: () => fireEvent(id) }, h('span', {}, ev.icon), ev.name));
  }
  $$('#event-target button').forEach((b) => {
    b.onclick = () => {
      state.eventTarget = b.dataset.target;
      $$('#event-target button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
}

function fireEvent(id) {
  const keys = !state.compare || state.eventTarget === 'both' ? Object.keys(worlds) : [state.eventTarget];
  let fired = 0;
  for (const k of keys) {
    const w = worlds[k];
    if (w && !w.extinct) {
      w.triggerEvent(id);
      fired++;
    }
  }
  if (!fired) return toast('Nothing alive to meddle with.');
  if (!state.running) toast(`${EVENTS[id].icon} ${EVENTS[id].name} — press Run to see the aftermath.`);
  else toast(`${EVENTS[id].icon} ${EVENTS[id].name}!`);
  uiDirty = true;
}

function buildScenarios() {
  const el = $('#scenarios');
  el.innerHTML = '';
  for (const s of SCENARIOS) {
    el.append(h('button', { class: 'scenario', onclick: () => loadScenario(s) },
      h('b', {}, `${s.emoji} ${s.name}`), h('small', {}, s.desc)));
  }
}

function loadScenario(s) {
  if (!confirmRestart()) return;
  state.organisms = s.organisms.slice();
  state.compare = s.compare;
  state.sexual = !!s.sexual;
  refreshRepro();
  state.env.A = { ...s.envA };
  state.env.B = { ...s.envB };
  state.editing = 'A';
  $('#compare').checked = state.compare;
  syncOrgCards();
  restart();
  setRunning(true);
  toast(`${s.emoji} ${s.name} — running!`);
  if (window.innerWidth < 900) $('#worlds').scrollIntoView({ behavior: 'smooth' });
}

// ------------------------------------------------------------------ worlds

function worldTitle(key) {
  const env = state.env[key];
  const geo = env.geo && env.geo !== 'open' ? ` · ${GEO_BY_ID[env.geo].emoji} ${GEO_BY_ID[env.geo].name}` : '';
  if (env.biome !== 'custom' && BIOME_BY_ID[env.biome]) return `${BIOME_BY_ID[env.biome].emoji} ${BIOME_BY_ID[env.biome].name}${geo}`;
  return `✏️ Custom · ${TERRAINS[env.terrain]?.label || ''}${geo}`;
}
function updateWorldTitle(key) {
  const v = views[key];
  if (!v) return;
  v.title.textContent = worldTitle(key);
  if (v.tlBiome) v.tlBiome.textContent = worldTitle(key);
}

function buildWorldPanel(key) {
  const canvas = h('canvas', { 'aria-label': `World ${key}` });
  const stats = h('div', { class: 'stats' });
  const climate = h('div', { class: 'climate' });
  const overlay = h('div', { class: 'overlay-msg', hidden: true });
  const inspector = h('div', { class: 'inspector', hidden: true });
  const title = h('span', { class: 'bname' }, worldTitle(key));
  const head = h('div', { class: 'world-head' },
    state.compare ? h('span', { class: `badge ${key}` }, key) : null, title, stats);
  const wrap = h('div', { class: 'canvas-wrap' }, canvas, climate,
    h('div', { class: 'compass' }, '▲ colder north', h('br'), '▼ warmer south'), overlay, inspector);
  const panel = h('div', { class: 'world-panel', 'data-world': key }, head, wrap);
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    const o = pickOrganism(worlds[key], x, y, 30);
    views[key].selected = o;
    views[key].inspectorBuilt = false;
    updateInspector(key);
  });
  return { panel, canvas, stats, climate, overlay, inspector, title, selected: null };
}

function buildTimelapse(key) {
  const portraits = h('canvas');
  const drift = h('div', { class: 'drift' });
  const strip = h('canvas', { class: 'strip', title: 'Click a frame to jump there' });
  const name = h('span', { class: 'tl-name' }, '');
  const sub = h('span', { class: 'tl-sub' }, '');
  const tlBiome = h('span', { class: 'tl-sub' }, worldTitle(key));
  const el = h('div', { class: 'tl', 'data-world': key },
    h('div', { class: 'tl-head' }, state.compare ? h('span', { class: `badge ${key}` }, key) : null, name, sub, tlBiome),
    h('div', { class: 'tl-main' }, h('div', { class: 'tl-portraits' }, portraits), drift),
    strip);
  strip.addEventListener('click', (e) => {
    const w = worlds[key];
    if (!w || !w.snapshots.length) return;
    const r = strip.getBoundingClientRect();
    const frames = stripFrames(w);
    const i = clamp(Math.floor(((e.clientX - r.left) / r.width) * frames.length), 0, frames.length - 1);
    setScrub(frames[i].tick);
  });
  return { el, portraits, drift, strip, name, sub, tlBiome };
}

function restart() {
  setRunning(false);
  const keys = state.compare ? ['A', 'B'] : ['A'];
  worlds = {};
  for (const k of keys) worlds[k] = new World({ env: state.env[k], organisms: state.organisms, seed: state.seed, label: k, sexual: state.sexual });
  for (const k of Object.keys(views)) delete views[k];
  const wEl = $('#worlds'), tEl = $('#timelapses');
  wEl.innerHTML = '';
  tEl.innerHTML = '';
  wEl.classList.toggle('compare', state.compare);
  tEl.classList.toggle('compare', state.compare);
  document.body.classList.toggle('is-compare', state.compare);
  for (const k of keys) {
    const v = buildWorldPanel(k);
    const tl = buildTimelapse(k);
    views[k] = { ...v, ...tl };
    wEl.append(v.panel);
    tEl.append(tl.el);
  }
  if (!state.compare) state.editing = 'A';
  $('#event-target').hidden = !state.compare;
  $('#tree-tabs').hidden = !state.compare;
  if (!state.compare) state.treeWorld = 'A';
  $$('#tree-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.world === state.treeWorld));
  $('#seed').value = state.seed;
  state.scrub = null;
  state.replay = null;
  refreshEnvPanel();
  buildTraitChips();
  lastLogKey = '';
  uiDirty = true;
  updateUI(true);
  saveConfig();
}

function setRunning(on) {
  const anyAlive = Object.values(worlds).some((w) => !w.extinct);
  state.running = on && anyAlive;
  const b = $('#btn-run');
  b.textContent = state.running ? '⏸ Pause' : (Object.values(worlds).some((w) => w.tick > 0) ? '▶ Resume' : '▶ Run');
  b.classList.toggle('running', state.running);
  if (on && !anyAlive) toast('Everything is extinct. Press “New run” to start over.');
}

// ------------------------------------------------------------------ inspector

function updateInspector(key) {
  const v = views[key];
  const o = v.selected;
  const el = v.inspector;
  if (!o) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const w = worlds[key];
  const sp = w.speciesById.get(o.sp);
  const preset = ORGANISM_BY_ID[o.preset];
  if (!v.inspectorBuilt) {
    el.innerHTML = '';
    v.icanvas = h('canvas');
    v.iname = h('div', { class: 'iname' });
    v.imeta = h('div', { class: 'imeta' });
    v.ibars = h('div', { class: 'ibars' });
    el.append(
      h('button', { class: 'close', title: 'Close', onclick: () => { v.selected = null; updateInspector(key); } }, '✕'),
      h('div', { class: 'ihead' }, v.icanvas, h('div', {}, v.iname, v.imeta)), v.ibars);
    for (const g of VISIBLE_GENES) {
      v.ibars.append(h('span', {}, `${g.icon} ${g.label}`), h('div', { class: 'ibar' }, h('i', { style: `width:${Math.round(o.g[g.i] * 100)}%;background:${g.color}` })));
    }
    v.inspectorBuilt = true;
  }
  v.iname.textContent = sp ? sp.name : preset.name;
  const diet = o.g[GENE_INDEX.diet];
  const dietLabel = diet > 0.65 ? 'carnivore' : diet > 0.35 ? 'omnivore' : 'herbivore';
  const status = o.dead ? `† died (${{ starved: 'starved', old: 'old age', predator: 'caught by a predator', eaten: 'eaten', cold: 'froze', heat: 'overheated', disaster: 'disaster' }[o.dead] || o.dead})` : `age ${(o.age / YEAR).toFixed(1)}y / ${(o.p.maxAge / YEAR).toFixed(1)}y`;
  v.imeta.innerHTML = `${preset.emoji} ${dietLabel} · gen ${o.gen}<br>${status}${o.dead ? '' : ` · energy ${Math.round((o.energy / o.p.maxEnergy) * 100)}%`}`;
  const { ctx, w: cw, h: ch } = fit(v.icanvas);
  portraitBg(ctx, 0, 0, cw, ch, w.env.terrain);
  drawPortrait(ctx, o.g, o.preset, cw / 2, ch / 2, Math.min(cw, ch) * 1.0, performance.now() * 0.006, -0.3);
}

// ------------------------------------------------------------------ timelapse

function stripFrames(w) {
  const n = 8;
  const end = w.snapshots[w.snapshots.length - 1]?.tick || 0;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const s = snapshotAt(w, (end * i) / (n - 1));
    if (s) frames.push(s);
  }
  return frames;
}

function viewTick() {
  return state.scrub == null ? null : state.scrub;
}

function drawTimelapse(key, time) {
  const v = views[key];
  const w = worlds[key];
  if (!w.snapshots.length) return;
  const first = w.snapshots[0];
  const t = viewTick();
  let now;
  if (t == null) {
    // live: current dominant species
    const dom = w.dominantSpecies();
    const members = dom ? w.orgs.filter((o) => o.sp === dom.id) : [];
    now = members.length
      ? { genome: meanGenome(members), presetId: members[0].preset, name: dom.name, tick: w.tick }
      : { ...w.snapshots[w.snapshots.length - 1], tick: w.tick, extinct: w.extinct };
  } else now = snapshotAt(w, Math.min(t, w.tick));
  v.cur = now;

  // portraits: ancestor → now
  const { ctx, w: cw, h: ch, dpr } = fit(v.portraits);
  const half = cw / 2;
  portraitBg(ctx, 0, 0, cw, ch, w.env.terrain);
  ctx.fillStyle = 'rgba(8,10,16,0.35)';
  ctx.fillRect(0, 0, half, ch);
  const box = Math.min(half, ch) * 0.95;
  drawPortrait(ctx, first.genome, first.presetId, half * 0.5, ch * 0.52, box * 0.9, time * 0.004);
  ctx.globalAlpha = now.extinct ? 0.35 : 1;
  drawPortrait(ctx, now.genome, now.presetId, half * 1.5, ch * 0.52, box * 0.9, time * 0.004 + 1);
  ctx.globalAlpha = 1;
  ctx.font = `600 ${10.5 * dpr}px Inter, sans-serif`;
  ctx.textBaseline = 'middle';
  const pill = (label, x, right) => {
    const tw = ctx.measureText(label).width + 14 * dpr;
    const px = right ? x - tw : x;
    ctx.fillStyle = 'rgba(8,10,16,0.62)';
    ctx.beginPath();
    ctx.roundRect(px, 6 * dpr, tw, 18 * dpr, 9 * dpr);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, px + 7 * dpr, 15 * dpr);
  };
  pill('ANCESTOR · year 0', 6 * dpr, false);
  pill(`${now.extinct ? 'LAST SEEN' : t == null ? 'NOW' : 'THEN'} · year ${(now.tick / YEAR).toFixed(1)}`, cw - 6 * dpr, true);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `${20 * dpr}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('→', half, ch * 0.52);
  ctx.textAlign = 'left';

  // film strip
  const frames = stripFrames(w);
  const s = fit(v.strip);
  const fw = s.w / frames.length;
  s.ctx.clearRect(0, 0, s.w, s.h);
  const viewT = t == null ? w.tick : t;
  frames.forEach((f, i) => {
    const x = i * fw;
    portraitBg(s.ctx, x + 1, 0, fw - 2, s.h, w.env.terrain);
    s.ctx.fillStyle = 'rgba(8,10,16,0.25)';
    s.ctx.fillRect(x + 1, 0, fw - 2, s.h);
    s.ctx.save();
    s.ctx.beginPath();
    s.ctx.rect(x + 1, 0, fw - 2, s.h);
    s.ctx.clip();
    drawPortrait(s.ctx, f.genome, f.presetId, x + fw / 2, s.h * 0.45, Math.min(fw, s.h) * 0.95, time * 0.004 + i, -0.4);
    s.ctx.restore();
    const active = Math.abs(f.tick - viewT) <= (frames[1]?.tick - frames[0]?.tick || 1) / 2;
    if (active) {
      s.ctx.strokeStyle = '#7ee0a1';
      s.ctx.lineWidth = 2 * s.dpr;
      s.ctx.strokeRect(x + 2, 1, fw - 4, s.h - 2);
    }
    s.ctx.fillStyle = 'rgba(0,0,0,0.55)';
    s.ctx.fillRect(x + 1, s.h - 16 * s.dpr, fw - 2, 16 * s.dpr);
    s.ctx.fillStyle = '#fff';
    s.ctx.font = `${10.5 * s.dpr}px Inter, sans-serif`;
    s.ctx.textAlign = 'center';
    s.ctx.textBaseline = 'middle';
    s.ctx.fillText(`y${(f.tick / YEAR).toFixed(f.tick < YEAR * 10 ? 1 : 0)}`, x + fw / 2, s.h - 8 * s.dpr);
  });
  s.ctx.textAlign = 'left';
}

function updateTimelapseText(key) {
  const v = views[key];
  const w = worlds[key];
  const now = v.cur;
  if (!now) return;
  const first = w.snapshots[0];
  v.name.textContent = now.name || '';
  const t = viewTick();
  v.sub.textContent = w.extinct && t == null ? '· extinct' : t == null ? `· most common species now` : `· most common species in year ${(now.tick / YEAR).toFixed(1)}`;
  // drift bars (rebuilt only when needed)
  if (!v.driftRows) {
    v.drift.innerHTML = '';
    v.driftRows = VISIBLE_GENES.map((g) => {
      const from = h('i', { class: 'from' });
      const bar = h('i', { class: 'bar', style: `background:${g.color}` });
      const to = h('i', { class: 'to', style: `background:${g.color}` });
      const delta = h('span', { class: 'delta' });
      v.drift.append(h('span', { class: 'lbl', title: `${g.lo} ↔ ${g.hi}` }, `${g.icon} ${g.label}`), h('div', { class: 'track', title: `${g.lo} ↔ ${g.hi}` }, bar, from, to), delta);
      return { g, from, bar, to, delta };
    });
  }
  for (const r of v.driftRows) {
    const a = first.genome[r.g.i], b = now.genome[r.g.i];
    r.from.style.left = `${a * 100}%`;
    r.to.style.left = `${b * 100}%`;
    r.bar.style.left = `${Math.min(a, b) * 100}%`;
    r.bar.style.width = `${Math.abs(b - a) * 100}%`;
    const d = Math.round((b - a) * 100);
    r.delta.textContent = d === 0 ? '±0' : `${d > 0 ? '+' : ''}${d}`;
    r.delta.className = `delta ${Math.abs(d) < 4 ? 'flat' : d > 0 ? 'up' : 'down'}`;
    r.delta.title = d > 3 ? `more ${r.g.hi}` : d < -3 ? `more ${r.g.lo}` : 'about the same';
  }
}

function maxTick() {
  return Math.max(1, ...Object.values(worlds).map((w) => w.tick));
}

function setScrub(tick) {
  if (tick == null || tick >= maxTick() - 1) {
    state.scrub = null;
  } else {
    state.scrub = Math.max(0, tick);
    if (state.running) setRunning(false);
  }
  syncScrubber();
  uiDirty = true;
}

function syncScrubber() {
  const s = $('#tl-scrub');
  const mt = maxTick();
  s.value = state.scrub == null ? 1000 : Math.round((state.scrub / mt) * 1000);
  $('#tl-year').textContent = state.scrub == null ? 'live' : `year ${(state.scrub / YEAR).toFixed(1)}`;
}

// ------------------------------------------------------------------ charts

let popChart, tempChart, traitChart;

function buildTraitChips() {
  const el = $('#trait-chips');
  el.innerHTML = '';
  for (const m of METRICS) {
    el.append(h('button', {
      class: `chip ${state.traitKeys.includes(m.key) ? 'on' : ''}`,
      onclick: (e) => {
        state.traitKeys = state.traitKeys.includes(m.key) ? state.traitKeys.filter((k) => k !== m.key) : [...state.traitKeys, m.key];
        e.currentTarget.classList.toggle('on');
        updateCharts();
      },
    }, h('i', { style: `background:${m.color}` }), `${m.icon} ${m.label}`));
  }
}

function allMarkers() {
  const out = [];
  for (const [k, w] of Object.entries(worlds)) for (const m of w.markers) if (m.icon !== '🌱') out.push({ tick: m.tick, icon: state.compare ? `${m.icon}${k}` : m.icon });
  return out;
}

function updateCharts() {
  const keys = Object.keys(worlds);
  const markers = allMarkers();
  if (state.tab === 'pop') {
    const series = [];
    for (const k of keys) {
      const w = worlds[k];
      const dash = k === 'B' ? [6, 4] : [];
      if (!state.compare) {
        for (const sp of w.species) {
          const pts = [];
          for (const hh of w.history) if (hh.t >= sp.born - w.histEvery && (sp.extinct == null || hh.t <= sp.extinct + w.histEvery)) pts.push({ x: hh.t, y: hh.counts[sp.id] || 0 });
          if (pts.length > 1) series.push({ label: sp.name, color: sp.color, points: pts, width: 1.5, alpha: sp.extinct == null ? 0.9 : 0.4 });
        }
      }
      series.push({ label: state.compare ? `World ${k} total` : 'Total population', color: state.compare ? WORLD_COLOR[k] : '#e8ecf4', dash, width: 2.6, points: w.history.map((hh) => ({ x: hh.t, y: hh.pop })) });
    }
    popChart.set(series, markers);
    const temps = [];
    for (const k of keys) {
      const col = state.compare ? WORLD_COLOR[k] : '#ff9f6e';
      const hist = worlds[k].history;
      const sw = worlds[k].env.seasonality;
      temps.push({ label: 'summer', color: col, alpha: 0.25, width: 1, noTooltip: true, dash: [2, 3], points: hist.map((hh) => ({ x: hh.t, y: hh.meanT + (hh.season ?? sw) })) });
      temps.push({ label: 'winter', color: col, alpha: 0.25, width: 1, noTooltip: true, dash: [2, 3], points: hist.map((hh) => ({ x: hh.t, y: hh.meanT - (hh.season ?? sw) })) });
      temps.push({ label: state.compare ? `World ${k} avg` : 'Average', color: col, dash: k === 'B' ? [6, 4] : [], width: 2, points: hist.map((hh) => ({ x: hh.t, y: hh.meanT })) });
    }
    tempChart.set(temps, markers);
  } else if (state.tab === 'traits') {
    const series = [];
    for (const key of state.traitKeys) {
      const m = METRICS.find((x) => x.key === key);
      const gi = GENE_INDEX[key];
      for (const k of keys) {
        series.push({
          label: state.compare ? `${m.label} (${k})` : m.label, color: m.color, dash: k === 'B' ? [6, 4] : [], width: 2.2,
          points: worlds[k].history.map((hh) => ({ x: hh.t, y: key === 'camo' ? hh.camo : hh.traits ? hh.traits[gi] : null })),
        });
      }
    }
    traitChart.set(series, markers);
  } else if (state.tab === 'tree') {
    const w = worlds[state.treeWorld] || worlds.A;
    drawTree($('#chart-tree'), w, performance.now());
  } else if (state.tab === 'log') {
    updateJournal();
  }
}

let lastLogKey = '';
function updateJournal() {
  const keys = Object.keys(worlds);
  const key = keys.map((k) => `${k}${worlds[k].log.length}:${worlds[k].log[worlds[k].log.length - 1]?.tick}`).join('|');
  if (key === lastLogKey) return;
  lastLogKey = key;
  const items = [];
  for (const k of keys) for (const l of worlds[k].log) items.push({ ...l, k });
  items.sort((a, b) => b.tick - a.tick);
  const el = $('#journal');
  el.innerHTML = '';
  // italicise species names
  const names = [...new Set(keys.flatMap((k) => worlds[k].species.map((sp) => sp.name)))].sort((a, b) => b.length - a.length);
  const nameRe = names.length ? new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g') : null;
  for (const it of items.slice(0, 200)) {
    const text = h('span');
    const safe = escapeHtml(it.text);
    text.innerHTML = nameRe ? safe.replace(nameRe, '<em>$1</em>') : safe;
    el.append(h('li', {},
      h('span', { class: 'when' }, state.compare ? h('span', { class: `badge ${it.k}` }, it.k) : null, `y${(it.tick / YEAR).toFixed(1)}`),
      h('span', {}, it.icon), text));
  }
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function setTab(tab) {
  state.tab = tab;
  $$('#insight-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.tab-body').forEach((b) => (b.hidden = b.dataset.tab !== tab));
  updateCharts();
}

// ------------------------------------------------------------------ HUD

function updateHud(key) {
  const v = views[key];
  const w = worlds[key];
  const c = w.cur;
  const alive = w.species.filter((s) => s.extinct == null).length;
  const gen = w.history.length ? w.history[w.history.length - 1].gen : 0;
  v.stats.innerHTML = `<span>📅 Year <b>${w.year().toFixed(1)}</b></span><span>🐾 <b>${w.orgs.length}</b> alive</span><span>🌿 <b>${alive}</b> species</span><span>🔁 gen <b>${Math.round(gen)}</b></span>`;
  const season = { spring: '🌱 spring', summer: '☀️ summer', autumn: '🍂 autumn', winter: '❄️ winter' }[c.season] || '';
  const evs = w.events.map((e) => EVENTS[e.type].icon).join('');
  v.climate.innerHTML = `<span>🌡️ ${c.T > 0 ? '+' : ''}${c.T.toFixed(0)}°C</span>${season ? `<span>${season}</span>` : ''}<span>💧 ${Math.round(c.hum * 100)}%</span>${w.preds.length ? `<span>🐾 ${w.preds.length} predators</span>` : ''}${evs ? `<span>${evs} active</span>` : ''}`;
  if (w.extinct) {
    v.overlay.hidden = false;
    v.overlay.innerHTML = `<div>💀 Extinct in year ${w.year().toFixed(1)}<small>Try a gentler environment, a hardier organism, or press “New run”.</small></div>`;
  } else if (w.tick === 0 && !state.running) {
    v.overlay.hidden = false;
    v.overlay.innerHTML = `<div>Press ▶ Run to start evolving<small>${w.orgs.length} ${state.organisms.map((o) => ORGANISM_BY_ID[o].plural).join(' + ')} are waiting</small></div>`;
  } else v.overlay.hidden = true;
}

let uiDirty = true;
let lastHud = 0, lastCharts = 0;
function updateUI(force = false) {
  const now = performance.now();
  if (force || now - lastHud > 200) {
    lastHud = now;
    for (const k of Object.keys(worlds)) {
      updateHud(k);
      if (views[k].selected) updateInspector(k);
    }
    syncScrubber();
  }
  if (force || uiDirty || now - lastCharts > 600) {
    if (force || uiDirty || state.running) {
      lastCharts = now;
      updateCharts();
      for (const k of Object.keys(worlds)) {
        drawTimelapse(k, now);
        updateTimelapseText(k);
      }
      uiDirty = false;
    }
  }
}

// ------------------------------------------------------------------ designer

const draft = { id: null, name: '', plan: 'mammal', genome: [], look: {} };
let designerAnim = 0;
const RABBIT_COST = phenotype(ORGANISM_BY_ID.rabbit.genome, ORGANISM_BY_ID.rabbit.mods).baseCost;

function buildDesigner() {
  const plans = $('#d-plans');
  plans.innerHTML = '';
  for (const id of PLANS) {
    plans.append(h('button', { type: 'button', 'data-plan': id, onclick: () => { setDraftPlan(id); syncDesigner(); } }, `${PLAN_INFO[id].emoji} ${PLAN_INFO[id].label}`));
  }
  const genes = $('#d-genes');
  genes.innerHTML = '';
  GENES.forEach((g, i) => {
    const val = h('span', {}, '');
    const input = h('input', {
      type: 'range', min: 0, max: 1, step: 0.01, 'data-i': i, 'aria-label': g.hidden ? 'Color hue' : g.label,
      oninput: (e) => { draft.genome[i] = Number(e.target.value); syncDesigner(false); },
    });
    genes.append(h('div', { class: `slider ${g.key === 'hue' ? 'hue' : ''}` },
      h('label', {}, h('span', {}, g.key === 'hue' ? '🎨 Color' : `${g.icon} ${g.label}`), val), input,
      g.key === 'hue' ? null : h('div', { class: 'ends' }, h('span', {}, g.lo), h('span', {}, g.hi))));
  });
  $('#d-name').oninput = (e) => { draft.name = e.target.value; };
  $('#d-base').onchange = (e) => {
    const o = ORGANISM_BY_ID[e.target.value];
    if (!o) return;
    draft.plan = o.plan;
    draft.genome = o.genome.slice();
    draft.look = { ...(o.look || {}) };
    syncDesigner();
  };
  $('#d-cancel').onclick = () => $('#designer').close();
  $('#d-save').onclick = saveDesign;
  $('#designer').addEventListener('close', () => cancelAnimationFrame(designerAnim));
  $('#designer').addEventListener('click', (e) => { if (e.target === $('#designer')) $('#designer').close(); });
}

function setDraftPlan(id) {
  draft.plan = id;
  if (id === 'mammal') draft.look = { ears: draft.look.ears || 'round', tail: draft.look.tail || 'long', horns: !!draft.look.horns };
  else draft.look = {};
}

function openDesigner(id) {
  const c = id ? state.customs.find((x) => x.id === id) : null;
  const base = c || { name: '', plan: 'mammal', genome: ORGANISM_BY_ID.rabbit.genome, look: ORGANISM_BY_ID.rabbit.look };
  Object.assign(draft, { id: c ? c.id : null, name: base.name, plan: base.plan, genome: base.genome.slice(), look: { ...base.look } });
  const sel = $('#d-base');
  sel.innerHTML = '';
  sel.append(h('option', { value: '' }, '— pick a template —'));
  for (const o of [...ORGANISMS, ...state.customs.map((x) => ORGANISM_BY_ID[x.id]).filter(Boolean)]) sel.append(h('option', { value: o.id }, `${o.emoji} ${o.name}`));
  $('#d-name').value = draft.name;
  $('#d-save').textContent = c ? 'Save changes' : 'Save & add';
  $('#designer h2').textContent = c ? `✏️ Edit “${c.name}”` : '✏️ Design an organism';
  syncDesigner();
  $('#designer').showModal();
  const tick = (ts) => {
    drawDesignerPreview(ts);
    designerAnim = requestAnimationFrame(tick);
  };
  designerAnim = requestAnimationFrame(tick);
}

function syncDesigner(full = true) {
  makeCustomOrganism({ id: '__draft', name: draft.name || 'Draft', plan: draft.plan, genome: draft.genome, look: draft.look });
  if (full) {
    $$('#d-plans button').forEach((b) => b.classList.toggle('on', b.dataset.plan === draft.plan));
    $$('#d-genes input').forEach((inp) => { inp.value = draft.genome[Number(inp.dataset.i)]; });
    const look = $('#d-look');
    look.innerHTML = '';
    if (draft.plan === 'mammal') {
      const sel = (key, opts, label) => {
        const s = h('select', { onchange: (e) => { draft.look[key] = e.target.value; syncDesigner(false); } },
          opts.map((o) => h('option', { value: o, selected: draft.look[key] === o }, o)));
        return h('label', { class: 'field' }, label, s);
      };
      look.append(sel('ears', ['round', 'pointy', 'long'], 'Ears'), sel('tail', ['long', 'fluffy', 'short'], 'Tail'),
        h('label', { class: 'field' }, 'Horns', h('select', { onchange: (e) => { draft.look.horns = e.target.value === 'yes'; syncDesigner(false); } },
          h('option', { value: 'no', selected: !draft.look.horns }, 'no'), h('option', { value: 'yes', selected: !!draft.look.horns }, 'yes'))));
    }
  }
  $$('#d-genes .slider').forEach((el, i) => {
    $('label span:last-child', el).textContent = GENES[i].key === 'hue' ? '' : `${Math.round(draft.genome[i] * 100)}%`;
  });
  // what these genes mean in practice
  const info = PLAN_INFO[draft.plan];
  const p = phenotype(draft.genome, info.mods);
  const odds = 1 - killChance({ g: draft.genome, p });
  const diet = draft.genome[GENE_INDEX.diet];
  const dietLabel = diet > 0.65 ? 'Carnivore' : diet > 0.35 ? 'Omnivore' : 'Herbivore';
  const items = [
    `🌡️ Comfortable from <b>${p.coldLimit.toFixed(0)}°C</b> to <b>${p.heatLimit.toFixed(0)}°C</b>${info.mods.ecto ? ' (cold-blooded)' : ''}`,
    `💨 Top speed <b>${p.speed.toFixed(2)}</b> <span class="muted">— predators run 1.9</span>`,
    `🍽️ <b>${dietLabel}</b>: plants ${Math.round(p.herbEff * 100)}% · meat ${Math.round(p.meatEff * 100)}%`,
    `🥚 <b>${p.litter}</b> ${p.litter === 1 ? 'baby' : 'babies'} per litter · adult at <b>${(p.maturity / YEAR).toFixed(1)}</b> years`,
    `⏳ Lives about <b>${(p.maxAge / YEAR).toFixed(1)}</b> years`,
    `⚡ Burns <b>${(p.baseCost / RABBIT_COST).toFixed(1)}×</b> a rabbit’s energy`,
    `🛡️ Survives <b>${Math.round(odds * 100)}%</b> of predator attacks`,
  ];
  if (diet > 0.5) items.push('⚠️ Hunters need other species to eat — add some prey too.');
  $('#d-stats').innerHTML = items.map((x) => `<li>${x}</li>`).join('');
}

function drawDesignerPreview(ts) {
  const { ctx, w: cw, h: ch } = fit($('#d-preview'));
  const g = ctx.createRadialGradient(cw / 2, ch * 0.55, 0, cw / 2, ch * 0.55, cw * 0.7);
  g.addColorStop(0, '#2a3550');
  g.addColorStop(1, '#121825');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(cw / 2, ch * 0.78, cw * 0.28, ch * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  drawPortrait(ctx, draft.genome, '__draft', cw / 2, ch * 0.5, Math.min(cw, ch) * 0.95, ts * 0.006, -0.3);
}

function saveDesign() {
  const info = PLAN_INFO[draft.plan];
  const c = validCustom({
    id: draft.id || `c${Date.now() % 1e9}`,
    name: (draft.name || '').trim() || `My ${info.label.toLowerCase()}`,
    plan: draft.plan, genome: draft.genome, look: draft.look,
  });
  if (!c) return;
  const editing = !!draft.id;
  const inUse = state.organisms.includes(c.id);
  registerCustom(c);
  $('#designer').close();
  if (!editing || inUse) {
    if (confirmRestart()) {
      if (!inUse) state.organisms = [...state.organisms, c.id];
      buildOrganisms();
      restart();
      toast(`${info.emoji} ${c.name} ${editing ? 'updated' : 'joins the world'}! Press ▶ Run.`);
    } else buildOrganisms();
  } else buildOrganisms();
  saveConfig();
}

// ------------------------------------------------------------------ main loop

let lastFrame = 0;
function loop(ts) {
  const ws = Object.values(worlds);
  if (state.running && ws.length) {
    const target = state.speed === 'max' ? Infinity : state.speed;
    const t0 = performance.now();
    let n = 0;
    while (n < target) {
      for (const w of ws) w.step();
      n++;
      if (performance.now() - t0 > 13) break;
    }
    if (ws.every((w) => w.extinct)) {
      setRunning(false);
      toast('💀 Everything went extinct.');
      uiDirty = true;
    }
  }
  if (state.replay) {
    const k = (ts - state.replay.start) / state.replay.duration;
    if (k >= 1) {
      state.replay = null;
      setScrub(null);
      $('#btn-replay').textContent = '▶ Replay';
    } else {
      state.scrub = k * maxTick();
      syncScrubber();
      uiDirty = true;
    }
  }
  for (const [k, w] of Object.entries(worlds)) {
    const v = views[k];
    const { ctx, w: cw } = fit(v.canvas);
    drawWorld(ctx, w, { scale: cw / W, selectedId: v.selected?.id, time: ts });
  }
  // portraits animate even when paused, but at a gentle rate
  if (!state.running && ts - lastFrame > 120 && !uiDirty) {
    for (const k of Object.keys(worlds)) drawTimelapse(k, ts);
    lastFrame = ts;
  }
  updateUI();
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ wiring

function init() {
  loadConfig();
  buildSpeed();
  buildOrganisms();
  buildRepro();
  buildEnvPanel();
  buildDesigner();
  buildEvents();
  buildScenarios();
  popChart = new LineChart($('#chart-pop'), { yMin: 0 });
  tempChart = new LineChart($('#chart-temp'), { yFormat: (v) => `${Math.round(v)}°` });
  traitChart = new LineChart($('#chart-traits'), { yMin: 0, yMax: 1, yFormat: (v) => v.toFixed(1) });

  $('#compare').checked = state.compare;
  $('#compare').onchange = (e) => {
    if (!confirmRestart()) {
      e.target.checked = state.compare;
      return;
    }
    state.compare = e.target.checked;
    restart();
    if (state.compare) toast('Two worlds, same starting life, same seed. Tweak World B’s environment and compare!', 4000);
  };
  $('#btn-run').onclick = () => {
    if (state.scrub != null) setScrub(null);
    setRunning(!state.running);
    uiDirty = true;
  };
  $('#btn-reset').onclick = () => {
    if (!confirmRestart()) return;
    restart();
    setRunning(true);
  };
  $('#btn-share').onclick = async () => {
    const url = `${location.origin}${location.pathname}#cfg=${encodeConfig()}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      toast('🔗 Link copied — it recreates this exact setup.');
    } catch (e) {
      toast('Link is in the address bar — copy it from there.');
    }
  };
  $('#btn-help').onclick = () => $('#help').showModal();
  $('#help').addEventListener('click', (e) => { if (e.target === $('#help')) $('#help').close(); });
  $$('#insight-tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $$('#tree-tabs button').forEach((b) => {
    b.onclick = () => {
      state.treeWorld = b.dataset.world;
      $$('#tree-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      updateCharts();
    };
  });
  $('#tl-scrub').addEventListener('input', (e) => {
    state.replay = null;
    $('#btn-replay').textContent = '▶ Replay';
    const v = Number(e.target.value);
    setScrub(v >= 1000 ? null : (v / 1000) * maxTick());
  });
  $('#btn-replay').onclick = () => {
    if (state.replay) {
      state.replay = null;
      setScrub(null);
      $('#btn-replay').textContent = '▶ Replay';
      return;
    }
    if (maxTick() < YEAR) return toast('Let it evolve for a bit first!');
    if (state.running) setRunning(false);
    state.replay = { start: performance.now(), duration: clamp(maxTick() / YEAR * 120, 4000, 12000) };
    $('#btn-replay').textContent = '⏹ Stop';
  };
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      $('#btn-run').click();
    } else if (e.key === 'r' || e.key === 'R') $('#btn-reset').click();
    else if (/^[1-5]$/.test(e.key)) setSpeed(SPEEDS[Number(e.key) - 1].v);
    else if (e.key === 'Escape') for (const k of Object.keys(views)) { views[k].selected = null; updateInspector(k); }
  });
  window.addEventListener('resize', () => { uiDirty = true; });
  if (location.hash.includes('cfg=')) history.replaceState(null, '', location.pathname);

  restart();
  requestAnimationFrame(loop);
}

init();
