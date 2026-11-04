// Drawing: procedural creatures (their look is computed from their genes),
// the world view, and a few effects.
import { GENE_INDEX as GI, TERRAINS, ORGANISM_BY_ID } from './presets.js';
import { W, H, genomeRgb, hexToRgb, geoSample } from './sim.js';
import { makeRng } from './rng.js';

const TAU = Math.PI * 2;
const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
// f < 0 darkens, f > 0 lightens
const shade = (c, f) => (f < 0 ? c.map((v) => Math.round(v * (1 + f))) : c.map((v) => Math.round(v + (255 - v) * f)));

function ell(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
}

function fuzz(ctx, rx, ry, len, col, n, phase) {
  ctx.strokeStyle = rgb(col);
  ctx.lineWidth = Math.max(0.6, len * 0.35);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    const l = len * (0.7 + 0.3 * Math.sin(i * 2.7 + phase * 0.3));
    ctx.moveTo(c * rx * 0.9, s * ry * 0.9);
    ctx.lineTo(c * (rx + l), s * (ry + l));
  }
  ctx.stroke();
}

function spikes(ctx, rx, ry, len, col, n, from = 0, to = TAU) {
  ctx.fillStyle = rgb(col);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = from + ((i + 0.5) / n) * (to - from);
    const c = Math.cos(a), s = Math.sin(a);
    const w = 0.18;
    ctx.moveTo(Math.cos(a - w) * rx * 0.95, Math.sin(a - w) * ry * 0.95);
    ctx.lineTo(c * (rx + len), s * (ry + len));
    ctx.lineTo(Math.cos(a + w) * rx * 0.95, Math.sin(a + w) * ry * 0.95);
  }
  ctx.fill();
}

function eyes(ctx, x, y, spread, r, detail, pupil = '#111') {
  for (const s of [-1, 1]) {
    ctx.fillStyle = pupil;
    ell(ctx, x, y + s * spread, r, r);
    ctx.fill();
    if (detail && r > 1.2) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ell(ctx, x + r * 0.3, y + s * spread - r * 0.3, r * 0.35, r * 0.35);
      ctx.fill();
    }
  }
}

// --------------------------------------------------------------- body plans
// All drawn top-down, facing +x, with r = body radius in pixels.

function mammal(ctx, g, r, ph, look, col, detail) {
  const dark = shade(col, -0.45), light = shade(col, 0.35);
  const rx = r * (1.1 + g[GI.speed] * 0.3), ry = r * 0.78;
  const hx = rx * 0.95, hr = r * 0.58;
  if (detail) {
    // legs
    const len = r * (0.4 + g[GI.speed] * 0.75);
    ctx.strokeStyle = rgb(dark);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, r * 0.26);
    ctx.beginPath();
    [[0.5, 1, 0], [0.5, -1, Math.PI], [-0.55, 1, Math.PI], [-0.55, -1, 0]].forEach(([fx, s, off]) => {
      const sw = Math.sin(ph + off) * len * 0.5;
      ctx.moveTo(rx * fx, s * ry * 0.6);
      ctx.lineTo(rx * fx + sw, s * (ry * 0.75 + len));
    });
    ctx.stroke();
    // tail
    const tail = look.tail || 'long';
    if (tail === 'fluffy') {
      ctx.fillStyle = rgb(shade(col, 0.6));
      ell(ctx, -rx - r * 0.15, 0, r * 0.38, r * 0.38);
      ctx.fill();
    } else {
      ctx.strokeStyle = rgb(col);
      ctx.lineWidth = Math.max(1, r * (tail === 'short' ? 0.2 : 0.3));
      ctx.beginPath();
      ctx.moveTo(-rx * 0.9, 0);
      const tl = tail === 'short' ? r * 0.5 : r * 1.3;
      ctx.quadraticCurveTo(-rx - tl * 0.5, Math.sin(ph * 0.7) * r * 0.5, -rx - tl, Math.sin(ph * 0.7 + 1) * r * 0.4);
      ctx.stroke();
    }
  }
  // insulation: fur halo
  const ins = g[GI.insulation];
  if (ins > 0.12) {
    const fl = r * ins * 0.55;
    ctx.fillStyle = rgb(light, 0.55);
    ell(ctx, 0, 0, rx + fl, ry + fl);
    ctx.fill();
    if (detail) fuzz(ctx, rx, ry, fl * 1.2, light, 26, ph);
  }
  // body
  ctx.fillStyle = rgb(col);
  ell(ctx, 0, 0, rx, ry);
  ctx.fill();
  if (detail) {
    ctx.strokeStyle = rgb(dark, 0.5);
    ctx.lineWidth = Math.max(0.5, r * 0.06);
    ctx.stroke();
  }
  // drought tolerance: a fat-storing hump
  const dr = g[GI.drought];
  if (dr > 0.35 && detail) {
    ctx.fillStyle = rgb(shade(col, 0.18));
    ell(ctx, -r * 0.15, 0, r * (dr - 0.2) * 0.9, r * (dr - 0.2) * 0.75);
    ctx.fill();
  }
  // armor: plates and spines
  const ar = g[GI.armor];
  if (ar > 0.12 && detail) {
    const n = 2 + Math.round(ar * 5);
    ctx.strokeStyle = rgb(shade(col, -0.35));
    ctx.lineWidth = Math.max(0.8, r * 0.07 * (1 + ar * 2));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = -rx * 0.65 + (i / (n - 1 || 1)) * rx * 1.15;
      ctx.moveTo(x - r * 0.12, -ry * 0.92);
      ctx.quadraticCurveTo(x + r * 0.15, 0, x - r * 0.12, ry * 0.92);
    }
    ctx.stroke();
    if (ar > 0.5) spikes(ctx, rx, ry, r * ar * 0.5, shade(col, -0.5), 14, Math.PI * 0.55, Math.PI * 1.45);
  }
  // head
  ctx.fillStyle = rgb(col);
  ell(ctx, hx, 0, hr, hr * 0.92);
  ctx.fill();
  if (detail) {
    // ears grow with heat tolerance (Allen's rule)
    const es = r * (0.16 + g[GI.heatTol] * 0.8);
    const style = look.ears || 'round';
    for (const s of [-1, 1]) {
      ctx.fillStyle = rgb(shade(col, -0.1));
      if (style === 'long') ell(ctx, hx - hr * 0.6 - es * 0.6, s * hr * 0.55, es * 1.5, es * 0.42, s * 0.25);
      else if (style === 'pointy') {
        ctx.beginPath();
        ctx.moveTo(hx - hr * 0.1, s * hr * 0.45);
        ctx.lineTo(hx - hr * 0.5 - es * 0.6, s * (hr * 0.8 + es));
        ctx.lineTo(hx - hr * 0.7, s * hr * 0.25);
      } else ell(ctx, hx - hr * 0.35, s * (hr * 0.75 + es * 0.25), es * 0.8, es * 0.65);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,170,170,0.55)';
      if (style === 'long') ell(ctx, hx - hr * 0.6 - es * 0.6, s * hr * 0.55, es * 1.1, es * 0.2, s * 0.25);
      else ell(ctx, hx - hr * 0.35, s * (hr * 0.75 + es * 0.15), es * 0.4, es * 0.3);
      ctx.fill();
    }
    if (look.horns) {
      ctx.strokeStyle = '#efe6d2';
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.beginPath();
      for (const s of [-1, 1]) {
        ctx.moveTo(hx, s * hr * 0.5);
        ctx.quadraticCurveTo(hx + hr * 0.2, s * hr * 1.5, hx + hr * 0.9, s * hr * 1.2);
      }
      ctx.stroke();
    }
    eyes(ctx, hx + hr * 0.45, 0, hr * 0.45, r * (0.06 + g[GI.sense] * 0.12), detail);
    const diet = g[GI.diet];
    ctx.fillStyle = diet > 0.5 ? '#2b1d1d' : '#e79aa6';
    ell(ctx, hx + hr * 0.92, 0, r * 0.11, r * 0.13);
    ctx.fill();
    if (diet > 0.45) {
      ctx.fillStyle = '#fff';
      const fs = r * 0.3 * diet;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        ctx.moveTo(hx + hr * 0.8, s * hr * 0.3);
        ctx.lineTo(hx + hr * 0.8 + fs, s * hr * 0.22);
        ctx.lineTo(hx + hr * 0.75, s * hr * 0.12);
      }
      ctx.fill();
    }
  }
}

function insect(ctx, g, r, ph, look, col, detail) {
  const dark = shade(col, -0.5);
  if (detail) {
    const len = r * (0.6 + g[GI.speed] * 0.9);
    ctx.strokeStyle = rgb(dark);
    ctx.lineWidth = Math.max(0.8, r * 0.12);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) {
        const tripod = (i % 2 === 0) === (s > 0) ? 0 : Math.PI;
        const sw = Math.sin(ph * 1.6 + tripod) * 0.35;
        const base = (i - 1) * 0.75 + sw;
        const ax = r * 0.25 + (1 - i) * r * 0.2, ay = s * r * 0.3;
        const kx = ax + Math.sin(base) * len * 0.5 + (1 - i) * len * 0.2, ky = ay + s * len * 0.55;
        ctx.moveTo(ax, ay);
        ctx.lineTo(kx, ky);
        ctx.lineTo(kx + (1 - i) * len * 0.45 + Math.sin(base) * len * 0.2, ky + s * len * 0.3);
      }
    }
    ctx.stroke();
    // antennae ~ senses
    const al = r * (0.4 + g[GI.sense] * 1.6);
    ctx.lineWidth = Math.max(0.6, r * 0.07);
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(r * 1.0, s * r * 0.12);
      ctx.quadraticCurveTo(r * 1.1 + al * 0.5, s * (r * 0.2 + al * 0.15), r * 1.0 + al, s * (r * 0.3 + al * 0.45));
    }
    ctx.stroke();
  }
  const ins = g[GI.insulation];
  if (ins > 0.15 && detail) fuzz(ctx, r * 1.1, r * 0.6, r * ins * 0.5, shade(col, 0.3), 24, ph);
  // abdomen, thorax, head
  ctx.fillStyle = rgb(col);
  ell(ctx, -r * 0.5, 0, r * 0.85, r * 0.62);
  ctx.fill();
  ctx.fillStyle = rgb(shade(col, -0.15));
  ell(ctx, r * 0.3, 0, r * 0.42, r * 0.42);
  ctx.fill();
  ctx.fillStyle = rgb(shade(col, -0.25));
  ell(ctx, r * 0.85, 0, r * 0.3, r * 0.3);
  ctx.fill();
  if (!detail) return;
  // wings for the fast ones
  if (g[GI.speed] > 0.45) {
    const wl = r * (0.5 + g[GI.speed]);
    ctx.fillStyle = 'rgba(220,240,255,0.28)';
    for (const s of [-1, 1]) {
      ell(ctx, -r * 0.3, s * r * 0.35, wl, r * 0.32, s * (0.35 + Math.sin(ph * 4) * 0.08));
      ctx.fill();
    }
  }
  const ar = g[GI.armor];
  if (ar > 0.15) {
    ctx.strokeStyle = rgb(shade(col, -0.45));
    ctx.lineWidth = Math.max(0.6, r * 0.06 * (1 + ar * 2));
    ctx.beginPath();
    ctx.moveTo(r * 0.3, 0);
    ctx.lineTo(-r * 1.3, 0);
    const n = 1 + Math.round(ar * 4);
    for (let i = 0; i < n; i++) {
      const x = -r * 0.1 - (i + 1) * (r * 1.1) / (n + 1);
      ctx.moveTo(x, -r * 0.55);
      ctx.quadraticCurveTo(x - r * 0.15, 0, x, r * 0.55);
    }
    ctx.stroke();
    if (ar > 0.55) {
      ctx.save();
      ctx.translate(-r * 0.5, 0);
      spikes(ctx, r * 0.85, r * 0.62, r * ar * 0.45, shade(col, -0.55), 10);
      ctx.restore();
    }
  }
  // glossy shell (water-tight cuticle)
  ctx.fillStyle = `rgba(255,255,255,${0.12 + g[GI.drought] * 0.3})`;
  ell(ctx, -r * 0.35, -r * 0.22, r * 0.45, r * 0.14, -0.15);
  ctx.fill();
  if (g[GI.diet] > 0.35) {
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = Math.max(0.8, r * 0.12);
    ctx.beginPath();
    const m = r * (0.2 + g[GI.diet] * 0.35);
    for (const s of [-1, 1]) {
      ctx.moveTo(r * 1.05, s * r * 0.15);
      ctx.quadraticCurveTo(r * 1.1 + m, s * r * 0.3, r * 1.1 + m * 0.7, -s * r * 0.02);
    }
    ctx.stroke();
  }
  eyes(ctx, r * 0.98, 0, r * 0.2, r * (0.06 + g[GI.sense] * 0.1), detail);
}

function microbe(ctx, g, r, ph, look, col, detail) {
  const dark = shade(col, -0.45);
  if (detail) {
    // flagella ~ speed
    const n = 1 + Math.floor(g[GI.speed] * 3);
    const len = r * (1 + g[GI.speed] * 1.8);
    ctx.strokeStyle = rgb(dark, 0.8);
    ctx.lineWidth = Math.max(0.6, r * 0.09);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.35;
      ctx.moveTo(-r * 0.9, off * r);
      for (let k = 1; k <= 8; k++) {
        const t = k / 8;
        ctx.lineTo(-r * 0.9 - t * len, off * r * (1 + t) + Math.sin(ph * 3 + t * 6 + i) * r * 0.25 * t);
      }
    }
    ctx.stroke();
    if (g[GI.insulation] > 0.2) fuzz(ctx, r, r, r * g[GI.insulation] * 0.45, shade(col, 0.4), 30, ph);
    if (g[GI.armor] > 0.5) spikes(ctx, r, r, r * g[GI.armor] * 0.5, shade(col, -0.3), 12);
  }
  // blobby membrane
  ctx.fillStyle = rgb(col, 0.9);
  ctx.beginPath();
  const pts = 14;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * TAU;
    const w = detail ? 1 + 0.07 * Math.sin(a * 3 + ph) + 0.04 * Math.sin(a * 5 - ph * 1.3) : 1;
    const x = Math.cos(a) * r * w * 1.08, y = Math.sin(a) * r * w * 0.92;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.fill();
  if (!detail) return;
  ctx.strokeStyle = rgb(dark);
  ctx.lineWidth = Math.max(0.6, r * (0.06 + g[GI.armor] * 0.3));
  ctx.stroke();
  ctx.fillStyle = rgb(shade(col, -0.3), 0.8);
  ell(ctx, -r * 0.2, r * 0.1, r * 0.35, r * 0.3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ell(ctx, r * 0.25, -r * 0.35, r * 0.25, r * 0.12);
  ctx.fill();
  // eyespot ~ senses
  ctx.fillStyle = '#e63946';
  ell(ctx, r * 0.65, 0, r * (0.07 + g[GI.sense] * 0.16), r * (0.07 + g[GI.sense] * 0.16));
  ctx.fill();
  if (g[GI.diet] > 0.4) {
    ctx.fillStyle = rgb(dark);
    ctx.beginPath();
    ctx.moveTo(r * 1.08, 0);
    ctx.lineTo(r * 0.7, r * 0.25 * g[GI.diet] * 2);
    ctx.lineTo(r * 0.7, -r * 0.25 * g[GI.diet] * 2);
    ctx.fill();
  }
}

function reptile(ctx, g, r, ph, look, col, detail) {
  const dark = shade(col, -0.45);
  const rx = r * 1.25, ry = r * 0.62;
  const sway = Math.sin(ph) * 0.35;
  if (detail) {
    // splayed legs
    const len = r * (0.45 + g[GI.speed] * 0.55);
    ctx.strokeStyle = rgb(dark);
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    [[0.55, 1, 0], [0.55, -1, Math.PI], [-0.5, 1, Math.PI], [-0.5, -1, 0]].forEach(([fx, s, off]) => {
      const sw = Math.sin(ph + off) * len * 0.5;
      const ax = rx * fx, ay = s * ry * 0.6;
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + sw * 0.5, ay + s * len * 0.8);
      ctx.lineTo(ax + sw + len * 0.4 * (fx > 0 ? 1 : -0.3), ay + s * len * 1.05);
    });
    ctx.stroke();
  }
  // tail
  const tl = r * (1.4 + g[GI.speed] * 0.6);
  ctx.fillStyle = rgb(col);
  ctx.beginPath();
  ctx.moveTo(-rx * 0.7, -ry * 0.55);
  ctx.quadraticCurveTo(-rx - tl * 0.5, sway * r, -rx - tl, sway * r * 2);
  ctx.quadraticCurveTo(-rx - tl * 0.5, sway * r + r * 0.1, -rx * 0.7, ry * 0.55);
  ctx.fill();
  if (g[GI.insulation] > 0.15 && detail) fuzz(ctx, rx, ry, r * g[GI.insulation] * 0.6, shade(col, 0.4), 22, ph);
  ctx.fillStyle = rgb(col);
  ell(ctx, 0, 0, rx, ry);
  ctx.fill();
  // frill ~ heat tolerance (radiator)
  const hx = rx * 1.05;
  if (detail && g[GI.heatTol] > 0.3) {
    const fr = r * (g[GI.heatTol] - 0.1) * 1.1;
    ctx.fillStyle = rgb(shade(col, 0.25), 0.85);
    ctx.beginPath();
    ctx.arc(hx - r * 0.25, 0, fr + r * 0.3, Math.PI * 0.5, Math.PI * 1.5, true);
    ctx.fill();
    ctx.strokeStyle = rgb(dark, 0.6);
    ctx.lineWidth = Math.max(0.5, r * 0.05);
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * 0.5 + (i / 6) * Math.PI;
      ctx.moveTo(hx - r * 0.25, 0);
      ctx.lineTo(hx - r * 0.25 - Math.cos(a) * (fr + r * 0.3), Math.sin(a) * (fr + r * 0.3));
    }
    ctx.stroke();
  }
  ctx.fillStyle = rgb(shade(col, -0.05));
  ell(ctx, hx, 0, r * 0.6, r * 0.42);
  ctx.fill();
  if (!detail) return;
  // scales ~ drought tolerance
  const dr = g[GI.drought];
  if (dr > 0.2) {
    ctx.fillStyle = rgb(dark, 0.25 + dr * 0.4);
    const rng = makeRng(7);
    for (let i = 0; i < 6 + dr * 18; i++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * 0.85;
      ell(ctx, Math.cos(a) * rx * d, Math.sin(a) * ry * d, r * 0.09, r * 0.07);
      ctx.fill();
    }
  }
  // spines ~ armor
  const ar = g[GI.armor];
  if (ar > 0.2) {
    ctx.fillStyle = rgb(shade(col, -0.55));
    const n = 3 + Math.round(ar * 6);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = -rx * 0.9 + (i / (n - 1)) * rx * 1.6;
      const s = r * (0.1 + ar * 0.25);
      ctx.moveTo(x - s, 0);
      ctx.lineTo(x, -s * 0.9);
      ctx.lineTo(x + s, 0);
      ctx.lineTo(x, s * 0.9);
    }
    ctx.fill();
  }
  eyes(ctx, hx + r * 0.15, 0, r * 0.28, r * (0.06 + g[GI.sense] * 0.11), detail, '#1a1405');
  if (g[GI.diet] > 0.45) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      const x = hx + r * 0.05 + k * r * 0.15;
      ctx.moveTo(x, s * r * 0.38);
      ctx.lineTo(x + r * 0.07, s * r * (0.38 + 0.18 * g[GI.diet]));
      ctx.lineTo(x + r * 0.14, s * r * 0.38);
    }
    ctx.fill();
  }
}

function amphibian(ctx, g, r, ph, look, col, detail) {
  const dark = shade(col, -0.45);
  const rx = r * 1.0, ry = r * 0.85;
  if (detail) {
    const hind = r * (0.6 + g[GI.speed] * 0.9);
    ctx.strokeStyle = rgb(shade(col, -0.15));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, r * 0.3);
    ctx.beginPath();
    const kick = Math.max(0, Math.sin(ph)) * 0.6;
    for (const s of [-1, 1]) {
      ctx.moveTo(-rx * 0.5, s * ry * 0.5);
      ctx.lineTo(-rx * 0.2 + hind * 0.2, s * (ry + hind * 0.35));
      ctx.lineTo(-rx * 0.9 - hind * kick, s * (ry + hind * 0.5));
      ctx.moveTo(rx * 0.45, s * ry * 0.5);
      ctx.lineTo(rx * 0.75, s * (ry + r * 0.3));
    }
    ctx.stroke();
  }
  if (g[GI.insulation] > 0.15 && detail) fuzz(ctx, rx, ry, r * g[GI.insulation] * 0.5, shade(col, 0.4), 24, ph);
  ctx.fillStyle = rgb(col);
  ell(ctx, 0, 0, rx, ry);
  ctx.fill();
  ell(ctx, rx * 0.7, 0, r * 0.62, r * 0.68);
  ctx.fill();
  if (!detail) return;
  // spots
  ctx.fillStyle = rgb(dark, 0.45);
  const rng = makeRng(11);
  for (let i = 0; i < 7; i++) {
    ell(ctx, (rng() - 0.6) * rx * 1.2, (rng() - 0.5) * ry * 1.3, r * 0.14, r * 0.12);
    ctx.fill();
  }
  // warts ~ drought, ridges ~ armor
  const dr = g[GI.drought];
  if (dr > 0.2) {
    ctx.fillStyle = rgb(shade(col, 0.25));
    for (let i = 0; i < dr * 20; i++) {
      ell(ctx, (rng() - 0.55) * rx * 1.5, (rng() - 0.5) * ry * 1.5, r * 0.07, r * 0.07);
      ctx.fill();
    }
  }
  const ar = g[GI.armor];
  if (ar > 0.2) {
    ctx.strokeStyle = rgb(shade(col, -0.5));
    ctx.lineWidth = Math.max(0.8, r * 0.07 * (1 + ar * 2));
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(-rx * 0.8, s * ry * 0.35);
      ctx.quadraticCurveTo(0, s * ry * 0.55, rx * 0.7, s * ry * 0.3);
    }
    ctx.stroke();
    if (ar > 0.55) spikes(ctx, rx, ry, r * ar * 0.4, shade(col, -0.5), 12, Math.PI * 0.6, Math.PI * 1.4);
  }
  // bulging eyes ~ senses
  const er = r * (0.17 + g[GI.sense] * 0.16);
  for (const s of [-1, 1]) {
    ctx.fillStyle = rgb(shade(col, 0.2));
    ell(ctx, rx * 0.85, s * r * 0.42, er * 1.15, er * 1.15);
    ctx.fill();
    ctx.fillStyle = '#e9c46a';
    ell(ctx, rx * 0.9, s * r * 0.45, er * 0.8, er * 0.8);
    ctx.fill();
    ctx.fillStyle = '#111';
    ell(ctx, rx * 0.92, s * r * 0.45, er * 0.6, er * 0.25);
    ctx.fill();
  }
}

function bird(ctx, g, r, ph, look, col, detail) {
  const dark = shade(col, -0.45);
  const rx = r * 1.05, ry = r * 0.72;
  // tail fan
  ctx.fillStyle = rgb(shade(col, -0.2));
  ctx.beginPath();
  ctx.moveTo(-rx * 0.6, 0);
  ctx.lineTo(-rx - r * 0.9, -r * 0.55);
  ctx.lineTo(-rx - r * 1.05, 0);
  ctx.lineTo(-rx - r * 0.9, r * 0.55);
  ctx.fill();
  if (detail) {
    // wings ~ speed
    const span = r * (0.9 + g[GI.speed] * 1.6);
    const flap = Math.sin(ph * 2.2) * 0.35;
    ctx.fillStyle = rgb(shade(col, -0.12));
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.35, s * ry * 0.5);
      ctx.quadraticCurveTo(r * 0.4, s * (ry + span * (0.7 + flap)), -r * 0.6, s * (ry + span * (0.85 + flap)));
      ctx.quadraticCurveTo(-r * 0.55, s * (ry + span * 0.3), -r * 0.6, s * ry * 0.4);
      ctx.fill();
      ctx.strokeStyle = rgb(dark, 0.45);
      ctx.lineWidth = Math.max(0.5, r * 0.05);
      ctx.beginPath();
      for (let k = 1; k <= 3; k++) {
        ctx.moveTo(-r * 0.1 * k, s * ry * 0.6);
        ctx.lineTo(-r * 0.15 * k - r * 0.2, s * (ry + span * (0.6 + flap) * (1 - k * 0.12)));
      }
      ctx.stroke();
    }
  }
  const ins = g[GI.insulation];
  if (ins > 0.12) {
    ctx.fillStyle = rgb(shade(col, 0.35), 0.5);
    ell(ctx, 0, 0, rx + r * ins * 0.5, ry + r * ins * 0.5);
    ctx.fill();
  }
  ctx.fillStyle = rgb(col);
  ell(ctx, 0, 0, rx, ry);
  ctx.fill();
  const hx = rx * 0.9, hr = r * 0.5;
  ell(ctx, hx, 0, hr, hr);
  ctx.fill();
  if (!detail) return;
  // crest ~ armor
  const ar = g[GI.armor];
  if (ar > 0.15) {
    ctx.fillStyle = rgb(shade(col, -0.4));
    ctx.beginPath();
    const n = 2 + Math.round(ar * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i - (n - 1) / 2) * 0.28;
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx + Math.cos(a) * hr * (1.2 + ar * 1.4), Math.sin(a) * hr * (1.2 + ar * 1.4));
      ctx.lineTo(hx + Math.cos(a + 0.12) * hr * 0.6, Math.sin(a + 0.12) * hr * 0.6);
    }
    ctx.fill();
  }
  // beak: short & conical for seeds, long & hooked for meat
  const diet = g[GI.diet];
  const bl = r * (0.35 + diet * 0.55 + g[GI.drought] * 0.1);
  ctx.fillStyle = diet > 0.5 ? '#4a4a52' : '#f4a261';
  ctx.beginPath();
  ctx.moveTo(hx + hr * 0.75, -hr * (0.45 - diet * 0.2));
  ctx.quadraticCurveTo(hx + hr * 0.8 + bl, -hr * 0.15, hx + hr * 0.7 + bl, diet > 0.5 ? hr * 0.25 : 0);
  ctx.lineTo(hx + hr * 0.75, hr * (0.45 - diet * 0.2));
  ctx.fill();
  eyes(ctx, hx + hr * 0.35, 0, hr * 0.5, r * (0.06 + g[GI.sense] * 0.1), detail);
}

const PLAN_FN = { mammal, insect, microbe, reptile, amphibian, bird };

// Public: draw one creature.
export function drawCreature(ctx, g, presetId, x, y, r, angle = 0, phase = 0, opts = {}) {
  const preset = ORGANISM_BY_ID[presetId] || ORGANISM_BY_ID.rabbit;
  const col = opts.rgb || genomeRgb(g);
  const detail = opts.detail ?? r >= 4.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  (PLAN_FN[preset.plan] || mammal)(ctx, g, r, phase, preset.look || {}, col, detail);
  ctx.restore();
}

// Size of a creature in portrait space: map body size gene to radius.
export function portraitRadius(g, max) {
  return max * (0.42 + g[GI.size] * 0.58);
}

// Rough bounding scale so a plan fits: legs/wings/tails stick out.
export const PLAN_EXTENT = { mammal: 2.3, insect: 2.6, microbe: 2.5, reptile: 3.0, amphibian: 2.3, bird: 2.6 };

// --------------------------------------------------------------- world view

const bgCache = new Map();
function background(world) {
  const key = `${world.env.terrain}|${world.seed}|${world.env.geo || 'open'}`;
  if (bgCache.has(key)) return bgCache.get(key);
  const t = TERRAINS[world.env.terrain] || TERRAINS.grass;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const x = c.getContext('2d');
  x.fillStyle = t.ground;
  x.fillRect(0, 0, W, H);
  const rng = makeRng(world.seed ^ 0x9e3779b9);
  const acc = hexToRgb(t.accent), gr = hexToRgb(t.ground);
  for (let i = 0; i < 260; i++) {
    const f = rng() < 0.5 ? acc : shade(gr, 0.12);
    x.fillStyle = rgb(f, 0.18 + rng() * 0.2);
    ell(x, rng() * W, rng() * H, 10 + rng() * 60, 6 + rng() * 30, rng() * TAU);
    x.fill();
  }
  for (let i = 0; i < 1400; i++) {
    x.fillStyle = rgb(rng() < 0.5 ? shade(gr, -0.18) : shade(gr, 0.18), 0.35);
    x.fillRect(rng() * W, rng() * H, 1.5, 1.5);
  }
  drawGeography(x, world.env.geo || 'open', rng);
  // north is colder, south warmer
  const grad = x.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(160,200,255,0.16)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(255,170,90,0.12)');
  x.fillStyle = grad;
  x.fillRect(0, 0, W, H);
  if (bgCache.size > 20) bgCache.clear();
  bgCache.set(key, c);
  return c;
}

// Water, shores, mountains and snow caps, painted once into the background.
function drawGeography(x, geo, rng) {
  if (geo === 'open') return;
  const S = 4;
  const kindAt = (px, py) => geoSample(geo, px, py)[0];
  for (let py = 0; py < H; py += S) {
    for (let px = 0; px < W; px += S) {
      const [k, dT] = geoSample(geo, px + S / 2, py + S / 2);
      if (k === 1) {
        let shore = 0;
        for (const [ox, oy] of [[10, 0], [-10, 0], [0, 10], [0, -10], [20, 0], [-20, 0], [0, 20], [0, -20]]) if (!kindAt(px + ox, py + oy)) shore++;
        x.fillStyle = shore >= 3 ? '#5fb3d6' : shore ? '#3f8fbf' : '#2b6ca3';
        x.fillRect(px, py, S + 0.5, S + 0.5);
      } else if (k === 2) {
        const n = rng();
        x.fillStyle = dT < -11.3 ? (n < 0.5 ? '#f1f5f9' : '#dfe7ee') : n < 0.33 ? '#7a756e' : n < 0.66 ? '#6c6760' : '#86817a';
        x.fillRect(px, py, S + 0.5, S + 0.5);
      } else {
        // sandy beaches next to water, frosty foothills next to peaks
        if (geo !== 'mountains') {
          for (const [ox, oy] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
            if (kindAt(px + ox, py + oy) === 1) {
              x.fillStyle = 'rgba(232,214,160,0.75)';
              x.fillRect(px, py, S + 0.5, S + 0.5);
              break;
            }
          }
        } else if (dT < -3) {
          x.fillStyle = `rgba(240,245,250,${Math.min(0.55, (-dT - 3) / 12)})`;
          x.fillRect(px, py, S + 0.5, S + 0.5);
        }
      }
    }
  }
  // little waves
  if (geo !== 'mountains') {
    x.strokeStyle = 'rgba(255,255,255,0.22)';
    x.lineWidth = 1.2;
    x.beginPath();
    for (let i = 0; i < 500; i++) {
      const px = rng() * W, py = rng() * H;
      if (kindAt(px, py) !== 1 || kindAt(px + 8, py) !== 1) continue;
      x.moveTo(px, py);
      x.quadraticCurveTo(px + 3, py - 2, px + 6, py);
    }
    x.stroke();
  }
}

export function drawWorld(ctx, world, view) {
  const { scale, selectedId, time } = view;
  const cur = world.cur;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.drawImage(background(world), 0, 0);

  // climate overlays
  const top = cur.T - 5, bottom = cur.T + 5;
  if (top < 3) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(245,250,255,${Math.min(0.6, (3 - top) / 22)})`);
    g.addColorStop(1, `rgba(245,250,255,${Math.max(0, Math.min(0.6, (3 - bottom) / 22))})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (bottom > 32) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(255,120,40,${Math.max(0, Math.min(0.28, (top - 32) / 45))})`);
    g.addColorStop(1, `rgba(255,120,40,${Math.min(0.28, (bottom - 32) / 45)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (cur.hum < 0.5) {
    const a = (0.5 - cur.hum) * 1.2;
    for (const o of world.oases) {
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 0.9);
      g.addColorStop(0, `rgba(70,150,210,${0.55 * a})`);
      g.addColorStop(0.5, `rgba(80,170,200,${0.35 * a})`);
      g.addColorStop(1, 'rgba(80,170,200,0)');
      ctx.fillStyle = g;
      ell(ctx, o.x, o.y, o.r * 0.9, o.r * 0.75);
      ctx.fill();
    }
  }

  // plants
  const t = TERRAINS[world.env.terrain] || TERRAINS.grass;
  ctx.fillStyle = t.plant;
  ctx.beginPath();
  for (const cell of world.plantCells) {
    for (let i = 0; i < cell.length; i++) {
      const p = cell[i];
      ctx.moveTo(p.x + 2.2, p.y);
      ctx.arc(p.x, p.y, 2.2, 0, TAU);
    }
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  for (const cell of world.plantCells) {
    for (let i = 0; i < cell.length; i++) {
      const p = cell[i];
      ctx.moveTo(p.x + 1.6, p.y + 1);
      ctx.arc(p.x + 0.6, p.y + 1, 1, 0, TAU);
    }
  }
  ctx.fill();

  // organisms
  const pxPerUnit = scale;
  let selected = null;
  for (const o of world.orgs) {
    const r = o.p.radius;
    const phase = time * 0.008 * (1 + o.p.speed) + o.id;
    // soft shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ell(ctx, o.x + 1.2, o.y + 1.6, r * 1.1, r * 0.8);
    ctx.fill();
    drawCreature(ctx, o.g, o.preset, o.x, o.y, r, o.angle, phase, { rgb: o.p.rgb, detail: r * pxPerUnit >= 4.2 });
    if (o.id === selectedId) selected = o;
  }

  // predators
  for (const pr of world.preds) {
    const resting = pr.rest > 0;
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(pr.angle);
    ctx.globalAlpha = resting ? 0.55 : 0.95;
    ctx.fillStyle = '#17121c';
    ell(ctx, -6, 0, 8, 4.2);
    ctx.fill();
    ell(ctx, 3, 0, 4.2, 3.6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-13, 0);
    ctx.quadraticCurveTo(-18, Math.sin(time * 0.01 + pr.id) * 4, -21, 2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#17121c';
    ctx.stroke();
    ctx.fillStyle = resting ? '#6b2b2b' : '#ff3b3b';
    ell(ctx, 5.2, -1.6, 1.1, 1.1);
    ctx.fill();
    ell(ctx, 5.2, 1.6, 1.1, 1.1);
    ctx.fill();
    ctx.restore();
  }

  if (selected) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / scale * 1.4;
    ctx.setLineDash([4, 3]);
    ell(ctx, selected.x, selected.y, selected.p.radius + 7, selected.p.radius + 7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ell(ctx, selected.x, selected.y, selected.p.sense, selected.p.sense);
    ctx.stroke();
  }

  // effects
  for (const f of world.fx) {
    const k = (world.tick - f.start) / f.life;
    if (f.type === 'meteor') {
      ctx.fillStyle = `rgba(255,200,120,${0.6 * (1 - k)})`;
      ell(ctx, f.x, f.y, f.r * (0.3 + k), f.r * (0.3 + k));
      ctx.fill();
      ctx.strokeStyle = `rgba(255,110,40,${1 - k})`;
      ctx.lineWidth = 6;
      ell(ctx, f.x, f.y, f.r * (0.5 + k * 0.8), f.r * (0.5 + k * 0.8));
      ctx.stroke();
      ctx.fillStyle = `rgba(40,25,20,${0.5 * (1 - k * 0.5)})`;
      ell(ctx, f.x, f.y, f.r * 0.35, f.r * 0.3);
      ctx.fill();
    } else {
      const tint = { plague: '120,255,120', iceage: '180,220,255', warming: '255,140,60', drought: '255,210,120', bloom: '255,160,220', invasion: '255,60,60' }[f.type];
      if (tint) {
        ctx.fillStyle = `rgba(${tint},${0.3 * (1 - k)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }
  ctx.restore();
}

// Find the organism nearest to a world-space point.
export function pickOrganism(world, x, y, maxD = 25) {
  let best = null, bd = maxD * maxD;
  for (const o of world.orgs) {
    const dx = o.x - x, dy = o.y - y, d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}
