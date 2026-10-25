// Design-system figure components: canvas scenes that play while on screen. Post data lives in assets/js/figures/*.js.
window.hwa = window.hwa || {};

hwa.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
hwa.smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

const FONT = 'Inter, "Noto Sans KR", system-ui, sans-serif';
hwa.ui = {
  text: '#374151', muted: '#6b7280', grid: '#e5e7eb', plot: '#f8fafc', cell: '#f1f5f9', now: '#94a3b8',
  blue: '#3b82f6', purple: '#8b5cf6', red: '#ef4444', slate: '#64748b',
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
    if (run && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.25 }).observe(root);
  root.addEventListener('click', () => { wanted = !wanted; sync(); });
  sync();
};

// A canvas scene sized to its container. frame(ctx, w, h, t, say) draws one frame at time t (seconds).
hwa.scene = (root, { height, frame, still = 0 }) => {
  root.insertAdjacentHTML('afterbegin', '<div class="cv-box" title="클릭하면 멈추거나 다시 재생한다"><canvas role="img"></canvas></div>');
  const box = root.querySelector('.cv-box'), canvas = box.querySelector('canvas'), ctx = canvas.getContext('2d');
  let w = 0, t = hwa.reduced ? still : 0, label = '';
  const say = (text) => { if (text !== label) { label = text; canvas.setAttribute('aria-label', text); } };
  const render = () => {
    ctx.clearRect(0, 0, w, height);
    frame(ctx, w, height, t, say);
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
  hwa.player(box, (dt) => { t += dt; render(); });
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
