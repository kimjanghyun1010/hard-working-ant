// Design-system figure components: canvas scenes that play while on screen. Post data lives in assets/js/figures/*.js.
window.hwa = window.hwa || {};

hwa.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Playback rate for every figure; below 1 slows all animations so readers can follow each step.
hwa.speed = 0.6;
hwa.smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
// n phases of sec seconds, each followed by hold seconds frozen on its last frame. k is 0..1 within the phase.
hwa.loop = (time, sec, hold = 0, n = 1) => {
  const len = sec + hold, at = time % (len * n), i = Math.floor(at / len), t = Math.min(at - i * len, sec);
  return { i, t, k: t / sec };
};
// n steps revealed one every step seconds, then a hold with all shown. k(i) eases step i in.
hwa.steps = (time, n, step, hold) => {
  const run = n * step, t = time % (run + hold), pos = Math.min(t / step, n), done = t >= run;
  return { run, done, active: done ? -1 : Math.floor(pos), k: (i) => (done ? 1 : hwa.smooth((pos - i) / 0.35)) };
};

const FONT = 'Inter, "Noto Sans KR", system-ui, sans-serif';
hwa.ui = {
  text: '#374151', muted: '#6b7280', grid: '#e5e7eb', plot: '#f8fafc', cell: '#f1f5f9', now: '#94a3b8',
  blue: '#3b82f6', purple: '#8b5cf6', red: '#ef4444', slate: '#64748b',
  accent: '#4f46e5', accentSoft: '#eef2ff', accentLine: '#a5b4fc',
  tones: { ok: ['#dcfce7', '#15803d'], warn: ['#fef3c7', '#b45309'], bad: ['#fee2e2', '#dc2626'], info: ['#dbeafe', '#1d4ed8'] },
  font: (size, weight = 400) => `${weight} ${size}px ${FONT}`,
};

// rAF loop that runs while the figure is on screen; a click pauses or resumes it.
hwa.player = (root, frame) => {
  let raf = 0, last = 0, wanted = !hwa.reduced, visible = false;
  const tick = (now) => {
    frame(Math.max(0, Math.min(now - last, 100)) / 1000);
    last = now;
    raf = requestAnimationFrame(tick);
  };
  const sync = () => {
    const run = wanted && visible;
    root.classList.toggle('is-paused', !wanted);
    if (run && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.25 }).observe(root);
  root.addEventListener('click', () => { wanted = !wanted; sync(); });
  sync();
  return { play: () => { wanted = true; sync(); } };
};

// Scenes of equal length for figures built on hwa.loop(time, sec, hold, n).
hwa.loopScenes = (sec, hold, n) => ({ n, at: (i) => i * (sec + hold), of: (t) => Math.floor((t % ((sec + hold) * n)) / (sec + hold)) });

// A canvas scene sized to its container. frame(ctx, w, h, t, say, ui) draws one frame at time t (seconds).
// scenes = { n, at(i) -> start time, of(t) -> index } adds numbered buttons that show and jump to each scene.
// The figcaption moves inside the card as its one-line note; notes[i] replaces it per scene, numbered ①②③.
// demo = { modes: [labels], run: label } adds mode toggles and a run button; ui = { mode, runAt } reaches frame.
const NUM = '①②③④⑤⑥';
hwa.scene = (root, { height, frame, still = 0, scenes, notes, demo }) => {
  root.insertAdjacentHTML('afterbegin', '<div class="cv-box" title="클릭하면 멈추거나 다시 재생한다"><canvas role="img"></canvas></div>');
  const box = root.querySelector('.cv-box'), canvas = box.querySelector('canvas'), ctx = canvas.getContext('2d');
  let w = 0, t = hwa.reduced ? still : 0, label = '', ctl, shown = -1, noted = -1;
  const say = (text) => { if (text !== label) { label = text; canvas.setAttribute('aria-label', text); } };
  const ui = { mode: 0, runAt: null };
  if (demo) {
    const bar = document.createElement('div'), go = document.createElement('button');
    bar.className = 'cv-demo';
    const modes = document.createElement('div');
    modes.className = 'cv-modes';
    demo.modes.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.setAttribute('aria-pressed', i === 0);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        ui.mode = i;
        if (ui.runAt !== null) ui.runAt = t;
        modes.querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-pressed', j === i));
        render();
      });
      modes.append(b);
    });
    go.type = 'button';
    go.className = 'cv-run';
    go.textContent = demo.run;
    go.addEventListener('click', (e) => { e.stopPropagation(); ui.runAt = t; render(); ctl.play(); });
    bar.append(modes, go);
    box.append(bar);
  }
  const cap = root.querySelector('figcaption');
  if (cap) { cap.classList.add('cv-note'); box.append(cap); }
  const nav = scenes && scenes.n > 1 ? document.createElement('div') : null;
  if (nav) {
    nav.className = 'cv-scenes';
    nav.setAttribute('aria-label', '장면');
    for (let i = 0; i < scenes.n; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = i + 1;
      b.setAttribute('aria-label', `장면 ${i + 1} / ${scenes.n}`);
      b.addEventListener('click', (e) => { e.stopPropagation(); t = scenes.at(i) + 0.001; render(); ctl.play(); });
      nav.append(b);
    }
    box.append(nav);
  }
  const render = () => {
    ctx.clearRect(0, 0, w, height);
    frame(ctx, w, height, t, say, ui);
    const cur = nav ? scenes.of(t) : -1;
    if (cur !== shown) { shown = cur; nav.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-current', i === cur)); }
    const ni = demo ? ui.mode : Math.max(0, cur);
    if (cap && notes && ni !== noted) { noted = ni; cap.textContent = `${notes.length > 1 ? `${NUM[ni]} ` : ''}${notes[ni]}`; }
  };
  const fit = () => {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  };
  new ResizeObserver(fit).observe(box);
  ctl = hwa.player(box, (dt) => { t += dt * hwa.speed; render(); });
  fit();
};

// Drawing helpers shared by every scene.
const cv = hwa.cv = {};
cv.text = (ctx, s, x, y, { size = 11, weight = 400, color = hwa.ui.muted, align = 'left', base = 'alphabetic' } = {}) => {
  ctx.font = hwa.ui.font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(s, x, y);
};
cv.wrap = (ctx, s, cx, y, maxW, opts = {}) => {
  ctx.font = hwa.ui.font(opts.size || 12, opts.weight || 500);
  const lines = [];
  let line = '';
  s.split(' ').forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word; } else line = next;
  });
  if (line) lines.push(line);
  lines.forEach((l, i) => cv.text(ctx, l, cx, y + i * 17, { size: 12, weight: 500, ...opts, align: 'center' }));
};
cv.pill = (ctx, x, y, s, tone) => {
  const [bg, fg] = hwa.ui.tones[tone];
  ctx.font = hwa.ui.font(11, 600);
  const w = ctx.measureText(s).width + 30;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 22, 11);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 12, y + 11, 3.5, 0, Math.PI * 2);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  cv.text(ctx, s, x + 21, y + 11.5, { weight: 600, color: fg, base: 'middle' });
};
cv.legend = (ctx, x, y, items) => {
  let cx = x;
  items.forEach(([s, fill]) => {
    ctx.fillStyle = fill;
    ctx.fillRect(cx, y - 4, 8, 8);
    cv.text(ctx, s, cx + 12, y, { size: 10, base: 'middle' });
    ctx.font = hwa.ui.font(10);
    cx += 24 + ctx.measureText(s).width;
  });
};
// Plot box with a title, grid lines at the ticks, and labels on the left. Returns the value-to-y mapping.
cv.panel = (ctx, x, y, w, h, { title, right, max, ticks }) => {
  if (title) cv.text(ctx, title, x, y - 7, { weight: 600, color: hwa.ui.text });
  if (right) cv.text(ctx, right, x + w, y - 7, { size: 10, align: 'right' });
  ctx.fillStyle = hwa.ui.plot;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = hwa.ui.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const Y = (v) => y + h - Math.max(0, Math.min(v, max)) / max * h;
  ticks.forEach(([v, label]) => {
    const yy = Math.round(Y(v)) + 0.5;
    if (v > 0 && v < max) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
    cv.text(ctx, label, x - 6, yy, { size: 10, align: 'right', base: 'middle' });
  });
  return Y;
};
cv.line = (ctx, pts, color, width = 2) => {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
};
// Fills between a top polyline and either a bottom polyline or a flat baseline y.
cv.area = (ctx, top, bottom, fill) => {
  if (top.length < 2) return;
  ctx.beginPath();
  top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (Array.isArray(bottom)) bottom.slice().reverse().forEach(([x, y]) => ctx.lineTo(x, y));
  else { ctx.lineTo(top[top.length - 1][0], bottom); ctx.lineTo(top[0][0], bottom); }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
};
cv.dashed = (ctx, x0, y0, x1, y1, color = hwa.ui.now) => {
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
};
cv.dot = (ctx, x, y, color, label, ly = y) => {
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (label) cv.text(ctx, label, x + 7, ly, { weight: 600, color, base: 'middle' });
};
const hatches = new Map();
cv.hatch = (ctx, color) => {
  if (!hatches.has(color)) {
    const c = document.createElement('canvas');
    c.width = c.height = 6;
    const g = c.getContext('2d');
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, 6); g.lineTo(6, 0);
    g.moveTo(-1, 1); g.lineTo(1, -1);
    g.moveTo(5, 7); g.lineTo(7, 5);
    g.stroke();
    hatches.set(color, c);
  }
  return ctx.createPattern(hatches.get(color), 'repeat');
};

// Event marker: a dashed vertical line with a short label on top, for the moment something happens.
cv.event = (ctx, x, y0, y1, label, color = hwa.ui.red, align = 'center') => {
  cv.dashed(ctx, x, y0, x, y1, color);
  if (label) cv.text(ctx, label, align === 'left' ? x - 2 : x, y0 - 4, { size: 10, weight: 700, color, align });
};
// Verdict stamp: a large pill laid over the figure at the decisive moment, eased in by k.
cv.stamp = (ctx, cx, cy, s, tone = 'bad', k = 1) => {
  if (k <= 0) return;
  const [bg, fg] = hwa.ui.tones[tone];
  ctx.font = hwa.ui.font(13, 700);
  const w = ctx.measureText(s).width + 28;
  ctx.save();
  ctx.globalAlpha = Math.min(1, k);
  ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - 15, w, 30, 15);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  cv.text(ctx, s, cx, cy + 0.5, { size: 13, weight: 700, color: fg, align: 'center', base: 'middle' });
  ctx.restore();
};

// Diagram components: boxes, value chips, cards, groups, arrows and step badges.
// Region or layer. on tints it as the current step.
cv.box = (ctx, x, y, w, h, { fill = '#fff', stroke = hwa.ui.grid, dash, on = false, r = 8 } = {}) => {
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.fillStyle = on ? hwa.ui.accentSoft : fill;
  ctx.fill();
  ctx.setLineDash(dash || []);
  ctx.strokeStyle = on ? hwa.ui.accentLine : stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
};
cv.chipW = (ctx, s) => { ctx.font = hwa.ui.font(11, 600); return ctx.measureText(s).width + 18; };
// Value chip right-aligned at rx, sliding in as k goes 0 to 1.
cv.chip = (ctx, s, rx, cy, tone = 'info', k = 1) => {
  if (k <= 0) return;
  const [bg, fg] = hwa.ui.tones[tone], cw = cv.chipW(ctx, s), x = rx - cw + (1 - k) * 12;
  ctx.globalAlpha = k;
  ctx.beginPath();
  ctx.roundRect(x, cy - 10, cw, 20, 6);
  ctx.fillStyle = bg;
  ctx.fill();
  cv.text(ctx, s, x + 9, cy + 0.5, { weight: 600, color: fg, base: 'middle' });
  ctx.globalAlpha = 1;
};
// Polyline cut at fraction k of its length.
cv.pathAt = (pts, k) => {
  const len = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = len.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, k));
  const out = [pts[0]];
  for (let i = 1; i < pts.length && left > 0; i++) {
    const f = len[i - 1] ? Math.min(1, left / len[i - 1]) : 1;
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
    left -= len[i - 1];
  }
  return out;
};
// Arrow drawn along pts up to fraction k, so it grows as k animates.
cv.arrow = (ctx, pts, k, color, { width = 1.5, dash } = {}) => {
  if (k <= 0) return;
  const p = cv.pathAt(pts, k), [a, b] = p.slice(-2), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  cv.line(ctx, p, color, width);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  [-0.45, 0.45].forEach((d) => ctx.lineTo(b[0] - 7 * Math.cos(ang + d), b[1] - 7 * Math.sin(ang + d)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
};
// Labelled node b = { x, y, w, h, t, s?, size? }. lit gives it an accent border.
cv.card = (ctx, b, { lit = false, dim = false, fill = '#fff', stroke = hwa.ui.grid, dash } = {}) => {
  ctx.beginPath();
  ctx.roundRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 8);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.setLineDash(dash || []);
  ctx.strokeStyle = lit ? hwa.ui.accent : stroke;
  ctx.lineWidth = lit ? 2 : 1;
  ctx.stroke();
  ctx.setLineDash([]);
  const cy = b.y + b.h / 2;
  cv.text(ctx, b.t, b.x + b.w / 2, b.s ? cy - 7 : cy, { size: b.size || 12, weight: 600, color: dim ? hwa.ui.muted : hwa.ui.text, align: 'center', base: 'middle' });
  if (b.s) cv.text(ctx, b.s, b.x + b.w / 2, cy + 9, { size: 10, align: 'center', base: 'middle' });
};
// Gray container that holds cards, with its label at the top left.
cv.group = (ctx, x, y, w, h, label, ly = y + 16) => {
  cv.box(ctx, x, y, w, h, { fill: hwa.ui.plot, r: 10 });
  if (label) cv.text(ctx, label, x + 10, ly, { weight: 600 });
};
// Step number beside an arrow's midpoint, off the line so short arrows stay visible.
cv.badge = (ctx, pts, n, on, side, at = 0.5) => {
  const p = cv.pathAt(pts, at), [a, b] = p.slice(-2);
  side = side || (Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 'up' : 'right');
  const x = b[0] + ({ left: -12, right: 12 }[side] || 0), y = b[1] + ({ up: -12, down: 12 }[side] || 0);
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = on ? hwa.ui.accent : '#fff';
  ctx.fill();
  ctx.strokeStyle = on ? hwa.ui.accent : '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.stroke();
  cv.text(ctx, String(n), x, y + 0.5, { size: 10, weight: 700, color: on ? '#fff' : hwa.ui.muted, align: 'center', base: 'middle' });
};
