// Minimal canvas charts: a line chart with hover read-out and event markers,
// plus the species family tree.
import { YEAR } from './sim.js';
import { drawCreature } from './render.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(10, Math.round(rect.width)), h = Math.max(10, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function niceStep(range, target) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export class LineChart {
  constructor(canvas, { yMin = null, yMax = null, yFormat = (v) => String(Math.round(v)), yLabel = '' } = {}) {
    this.canvas = canvas;
    this.opts = { yMin, yMax, yFormat, yLabel };
    this.series = [];
    this.markers = [];
    this.hoverX = null;
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
      this.draw();
    });
    canvas.addEventListener('mouseleave', () => {
      this.hoverX = null;
      this.draw();
    });
  }

  set(series, markers = []) {
    this.series = series;
    this.markers = markers;
    this.draw();
  }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const text = css('--muted') || '#999', grid = css('--grid') || 'rgba(255,255,255,0.08)', fg = css('--fg') || '#eee';
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 40, r: 12, t: 16, b: 22 };
    let xMax = 1, yMin = Infinity, yMax = -Infinity;
    for (const s of this.series) {
      for (const p of s.points) {
        if (p.y == null) continue;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
    }
    if (this.opts.yMin != null) yMin = this.opts.yMin;
    if (this.opts.yMax != null) yMax = this.opts.yMax;
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    if (yMax - yMin < 1e-6) { yMax = yMin + 1; }
    const span = yMax - yMin;
    if (this.opts.yMin == null) yMin -= span * 0.05;
    if (this.opts.yMax == null) yMax += span * 0.08;
    const X = (x) => pad.l + (x / xMax) * (w - pad.l - pad.r);
    const Y = (y) => h - pad.b - ((y - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);

    // grid + axes labels
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = text;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const ys = niceStep(yMax - yMin, 4);
    for (let v = Math.ceil(yMin / ys) * ys; v <= yMax; v += ys) {
      ctx.beginPath();
      ctx.moveTo(pad.l, Y(v));
      ctx.lineTo(w - pad.r, Y(v));
      ctx.stroke();
      ctx.fillText(this.opts.yFormat(v), pad.l - 6, Y(v));
    }
    const years = xMax / YEAR;
    const xs = niceStep(Math.max(years, 1), Math.max(2, Math.floor(w / 90)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = 0; v <= years + 1e-9; v += xs) {
      ctx.fillText(`${Math.round(v * 10) / 10}y`, X(v * YEAR), h - pad.b + 5);
    }

    // event markers
    ctx.textBaseline = 'top';
    for (const m of this.markers) {
      const x = X(m.tick);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, h - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '11px sans-serif';
      ctx.fillText(m.icon, x, 1);
    }

    // lines
    for (const s of this.series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width || 2;
      ctx.globalAlpha = s.alpha ?? 1;
      ctx.setLineDash(s.dash || []);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (const p of s.points) {
        if (p.y == null) { started = false; continue; }
        if (!started) { ctx.moveTo(X(p.x), Y(p.y)); started = true; }
        else ctx.lineTo(X(p.x), Y(p.y));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // hover read-out
    if (this.hoverX != null && this.hoverX > pad.l && this.series.length) {
      const tx = ((this.hoverX - pad.l) / (w - pad.l - pad.r)) * xMax;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(this.hoverX, pad.t);
      ctx.lineTo(this.hoverX, h - pad.b);
      ctx.stroke();
      const rows = [];
      for (const s of this.series) {
        if (s.noTooltip) continue;
        let best = null, bd = Infinity;
        for (const p of s.points) {
          const d = Math.abs(p.x - tx);
          if (d < bd) { bd = d; best = p; }
        }
        if (best && best.y != null) {
          rows.push({ s, v: best.y });
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(X(best.x), Y(best.y), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      rows.sort((a, b) => b.v - a.v);
      const shown = rows.slice(0, 10);
      const bw = 170, lh = 15, bh = shown.length * lh + 22;
      let bx = this.hoverX + 10;
      if (bx + bw > w) bx = this.hoverX - bw - 10;
      const by = pad.t;
      ctx.fillStyle = 'rgba(12,14,22,0.92)';
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 6);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = fg;
      ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(`Year ${(tx / YEAR).toFixed(1)}`, bx + 8, by + 5);
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      shown.forEach((r, i) => {
        const y = by + 20 + i * lh;
        ctx.fillStyle = r.s.color;
        ctx.fillRect(bx + 8, y + 4, 8, 3);
        ctx.fillStyle = fg;
        const label = r.s.label.length > 18 ? r.s.label.slice(0, 17) + '…' : r.s.label;
        ctx.fillText(label, bx + 20, y);
        ctx.textAlign = 'right';
        ctx.fillText(this.opts.yFormat(r.v), bx + bw - 8, y);
        ctx.textAlign = 'left';
      });
    }
  }
}

// --------------------------------------------------------------- family tree

export function drawTree(canvas, world, time = 0) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  // Hide tiny dead-end offshoots so the tree stays readable.
  const parents = new Set(world.species.map((s) => s.parentId));
  const species = world.species.filter((s) => s.extinct == null || s.peak >= 15 || parents.has(s.id) || s.parentId == null);
  const text = css('--muted') || '#999', fg = css('--fg') || '#eee';
  if (!species.length) return;
  const kids = new Map();
  const roots = [];
  for (const s of species) {
    if (s.parentId == null || !species.some((p) => p.id === s.parentId)) roots.push(s);
    else {
      if (!kids.has(s.parentId)) kids.set(s.parentId, []);
      kids.get(s.parentId).push(s);
    }
  }
  const order = [];
  const visit = (s, depth) => {
    order.push({ s, depth });
    (kids.get(s.id) || []).sort((a, b) => a.born - b.born).forEach((c) => visit(c, depth + 1));
  };
  roots.forEach((r) => visit(r, 0));

  const now = Math.max(world.tick, 1);
  const pad = { l: 14, r: 190, t: 14, b: 24 };
  const rowH = Math.min(30, (h - pad.t - pad.b) / Math.max(order.length, 1));
  const X = (t) => pad.l + (t / now) * (w - pad.l - pad.r);
  const yOf = new Map();
  order.forEach(({ s }, i) => yOf.set(s.id, pad.t + rowH * (i + 0.5)));

  // time axis
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const years = now / YEAR;
  const xs = niceStep(Math.max(years, 1), Math.max(2, Math.floor((w - pad.r) / 90)));
  for (let v = 0; v <= years; v += xs) ctx.fillText(`${Math.round(v * 10) / 10}y`, X(v * YEAR), h - pad.b + 6);

  for (const { s } of order) {
    const y = yOf.get(s.id);
    const end = s.extinct ?? now;
    const alive = s.extinct == null;
    // connector from parent
    if (s.parentId != null && yOf.has(s.parentId)) {
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X(s.born), yOf.get(s.parentId));
      ctx.lineTo(X(s.born), y);
      ctx.stroke();
    }
    ctx.globalAlpha = alive ? 1 : 0.45;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = alive ? Math.min(9, 2 + Math.sqrt(s.count) * 0.45) : 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(X(s.born), y);
    ctx.lineTo(Math.max(X(end), X(s.born) + 2), y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const lx = Math.max(X(end), X(s.born) + 2);
    if (alive && s.centroid && rowH >= 14) {
      drawCreature(ctx, s.centroid, s.presetId, lx + 14, y, Math.min(rowH * 0.28, 7), 0, time * 0.004 + s.id, { detail: true });
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = alive ? fg : text;
    ctx.font = `${alive ? 'italic 600' : 'italic'} ${rowH < 16 ? 10 : 12}px ui-serif, Georgia, serif`;
    const label = alive ? `${s.name} · ${s.count}` : `† ${s.name}`;
    ctx.fillText(label, lx + (alive && rowH >= 14 ? 28 : 8), y);
  }
}
