(() => {
  const U = hwa.ui, C = hwa.cv;
  const JSFILL = '#e7f5ff', JSLINE = '#74c0fc';

  // request on a 1 vCPU node: one server alone, then two servers at the same rate, swept up to 1000m each.
  // Line: share of the CPU each server wanted but did not get. Both servers: request 500m, limit 1000m.
  {
    const TAU = Math.PI * 2;
    const W = 10, PER = 100, DT = 0.5, ARR = 4, SHOW = 1, CAP = 6000;
    // Light fill on the clock and the map, strong colour for the line and the numbers.
    const TONE = { A: ['#74c0fc', U.blue], B: ['#ffa8a8', U.red] };

    const arrivals = (n, seed) => {
      const a = [];
      for (let p = 0; p < ARR; p++) for (let i = 0; i < n; i++) a.push(p * PER + ((i + 0.5 + 0.3 * Math.sin((i + 1) * 12.9898 + p * 78.233 + seed * 3.7)) * PER) / n);
      return a.sort((x, y) => x - y);
    };
    // Servers with equal requests share 1 vCPU in 3ms turns (CFS splits its 6ms latency target between two). On 1 vCPU no server can pass limit 1000m, so nothing throttles.
    const simShare = (rates) => {
      const pods = Object.entries(rates).map(([id, r], k) => ({ id, rate: r, arr: arrivals(r, k), ai: 0, q: [], all: [] })), snaps = [];
      let cur = null, left = 0;
      for (let s = 0; s < CAP / DT; s++) {
        const m = s * DT;
        pods.forEach((p) => { while (p.ai < p.arr.length && p.arr[p.ai] <= m) { const r = { arrive: p.arr[p.ai++], rem: W, start: -1, end: -1 }; p.q.push(r); p.all.push(r); } });
        const ready = pods.filter((p) => p.q.length);
        if (!cur || !cur.q.length || (left <= 0 && ready.length > 1)) {
          const nxt = ready.filter((p) => p !== cur)[0] || (cur && cur.q.length ? cur : null);
          if (nxt !== cur || left <= 0) left = 3;
          cur = nxt;
        }
        snaps.push({ run: cur ? cur.id : null });
        if (cur) { const r = cur.q[0]; if (r.start < 0) r.start = m; r.rem -= DT; left -= DT; if (r.rem <= 1e-6) { r.end = m + DT; cur.q.shift(); } }
        if (pods.every((p) => p.ai >= p.arr.length && !p.q.length)) break;
      }
      return { snaps, pods };
    };
    // One step of the sweep over two periods from the one on the clock: each server's CPU time against what its requests
    // wanted, and how much longer each request took from its first turn on the vCPU to done than its 10ms of CPU.
    const step = (n, rates) => {
      const S = simShare(rates), p0 = SHOW * PER, win = S.snaps.slice(p0 / DT, (p0 + 2 * PER) / DT), out = {};
      S.pods.forEach((p) => {
        const used = win.filter((s) => s.run === p.id).length * DT, mine = p.all.filter((r) => r.arrive >= p0 && r.arrive < p0 + 2 * PER);
        const share = Math.max(0, 1 - used / (2 * p.rate * W));
        // shortcut: under 3% is arrival jitter across the period edge, shown as 0; lengthen the window to measure it.
        out[p.id] = { share: share < 0.03 ? 0 : share, ratio: mine.reduce((a, r) => a + r.end - r.start, 0) / mine.length / W };
      });
      return { n, snaps: S.snaps, s: out };
    };

    const clock = (ctx, cx, cy, R, snaps, m) => {
      const p0 = Math.floor(m / PER) * PER, i0 = p0 / DT, steps = Math.floor((m - p0) / DT);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
      for (let k = 0; k < steps;) {
        const run = (snaps[i0 + k] || {}).run;
        let e = k + 1;
        while (e < steps && (snaps[i0 + e] || {}).run === run) e++;
        if (run) {
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, R, -Math.PI / 2 + (k * DT / PER) * TAU, -Math.PI / 2 + (e * DT / PER) * TAU);
          ctx.closePath(); ctx.fillStyle = TONE[run][0]; ctx.fill();
        }
        k = e;
      }
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.strokeStyle = '#ced4da'; ctx.stroke();
      const an = -Math.PI / 2 + ((m - p0) / PER) * TAU;
      C.line(ctx, [[cx, cy], [cx + Math.cos(an) * R, cy + Math.sin(an) * R]], U.text, 1.8);
    };
    const user = (ctx, x, y, w, h) => {
      C.box(ctx, x, y, w, h, { fill: '#fff', r: 8 });
      const cx = x + w / 2, cy = y + h / 2;
      ctx.fillStyle = '#adb5bd';
      ctx.beginPath(); ctx.arc(cx, cy - 7, 5.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy + 8, 9, 6, 0, Math.PI, 0); ctx.fill();
    };
    const stat = (ctx, x, y, label, value, color, sub) => {
      C.text(ctx, label, x, y, { size: 10, align: 'center' });
      C.text(ctx, value, x, y + 24, { size: 22, weight: 700, color, align: 'center' });
      if (sub) C.text(ctx, sub, x, y + 40, { size: 10, weight: 600, color, align: 'center' });
    };
    // Request dots flowing along a path: n dots per lap, so a higher rate shows as a denser stream.
    const flow = (ctx, pts, n, time, color, off = 0) => {
      const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), L = seg.reduce((a, b) => a + b, 0);
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        let d = (((time * 40) / L + (i + off) / n) % 1) * L, k = 0;
        while (k < seg.length - 1 && d > seg[k]) d -= seg[k++];
        const [a, b] = [pts[k], pts[k + 1]], f = Math.min(1, d / seg[k]);
        ctx.beginPath(); ctx.arc(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 2.2, 0, TAU); ctx.fill();
      }
    };
    const server = (ctx, x, y, w, h, id) => {
      C.box(ctx, x, y, w, h, { fill: '#fff', r: 8 });
      C.box(ctx, x, y, 5, h, { fill: TONE[id][0], stroke: TONE[id][0], r: 2 });
      C.text(ctx, `서버 ${id}`, x + w / 2 + 2, y + h / 2 + 0.5, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
    };

    // Sweep: each load plays one 100ms period on the clock while the lines and the numbers ease toward that load.
    const sweep = (name, { ids, map, stamp, notes }) => document.querySelectorAll(`[data-figure="${name}"]`).forEach((root) => {
      const STEPS = [2, 4, 5, 6, 7, 8, 9, 10];
      const PTS = STEPS.map((n) => step(n, Object.fromEntries(ids.map((id) => [id, n])))), LAP = 0.9, HOLD = 2.5, RUN = PTS.length * LAP;
      const ZERO = { n: 0, s: Object.fromEntries(ids.map((id) => [id, { share: 0, ratio: 1 }])) };
      hwa.scene(root, {
        height: 330, still: RUN + 0.5, notes,
        frame: (ctx, w, h, time, say) => {
          const u = time % (RUN + HOLD), j = Math.min(PTS.length - 1, Math.floor(u / LAP)), lap = u >= RUN ? 1 : (u - j * LAP) / LAP;
          const P = PTS[j], prev = j ? PTS[j - 1] : ZERO, g = hwa.smooth(lap), m = SHOW * PER + Math.min(lap * PER, PER - DT);
          const val = (id, key) => prev.s[id][key] + (P.s[id][key] - prev.s[id][key]) * g;
          clock(ctx, map(ctx, P.n * 10, time), 32, 20, P.snaps, m);
          const wide = w >= 460, sy = wide ? 12 : 76;
          const xs = wide ? [w - 120, w - 40] : [w * 0.3, w * 0.72];
          if (ids.length === 1) {
            const sh = val('A', 'share') * 100, r = val('A', 'ratio');
            stat(ctx, xs[0], sy, '못 쓴 CPU', `${Math.round(sh)}%`, sh >= 1 ? U.blue : U.text);
            stat(ctx, xs[1], sy, '처리 시간', `×${r.toFixed(1)}`, r > 1.15 ? U.blue : U.text);
          } else ids.forEach((id, k) => {
            const sh = val(id, 'share') * 100, r = val(id, 'ratio');
            stat(ctx, xs[k], sy, `${id} 못 쓴 CPU`, `${Math.round(sh)}%`, sh >= 1 ? TONE[id][1] : U.text, `처리 시간 ×${r.toFixed(1)}`);
          });
          const px = 34, py = wide ? 86 : 136, pw = w - px - 8, ph = h - py - 34, maxX = 100;
          const Y = C.panel(ctx, px, py, pw, ph, { title: '', max: 100, ticks: [[0, '0%'], [50, '50%'], [100, '100%']] });
          const X = (rps) => px + (rps / maxX) * pw;
          C.dashed(ctx, X(50), py, X(50), py + ph, '#ced4da');
          C.text(ctx, 'request 500m', X(50) - 4, py + 12, { size: 9, align: 'right' });
          C.text(ctx, 'limit 1000m', X(100) - 4, py + 12, { size: 9, align: 'right' });
          // B is dashed on top of A, so both stay visible where the two lines meet.
          ids.forEach((id, k) => {
            const pts = PTS.slice(0, j).map((p) => [X(p.n * 10), Y(p.s[id].share * 100)]), tip = [X((prev.n + (P.n - prev.n) * g) * 10), Y(val(id, 'share') * 100)];
            ctx.save();
            if (k) ctx.setLineDash([6, 5]);
            C.line(ctx, [[X(0), Y(0)], ...pts, tip], TONE[id][1], 2);
            ctx.restore();
            C.dot(ctx, ...tip, TONE[id][1]);
          });
          if (stamp && u >= RUN) C.stamp(ctx, px + pw / 2, py + ph * 0.35, stamp[0], stamp[1], (u - RUN) / 0.4);
          [0, 50, 100].forEach((v) => C.text(ctx, `${v}`, X(v), py + ph + 14, { size: 10, align: 'center' }));
          C.text(ctx, '서버마다 초당 요청', px + pw, py + ph + 28, { size: 10, align: 'right' });
          say(`초당 요청 ${P.n * 10}: ` + ids.map((id) => `서버 ${id}는 원한 CPU의 ${Math.round(P.s[id].share * 100)}%를 못 쓰고 요청 처리 시간이 평소의 ${P.s[id].ratio.toFixed(1)}배`).join(', '));
        },
      });
    });

    // Normal: user, server A alone on the 1 vCPU node.
    sweep('cpu-share-alone', {
      ids: ['A'], stamp: ['초당 100까지 0%', 'ok'], notes: ['혼자면 vCPU를 다 써서, 초당 100까지 원하는 CPU를 모두 받는다.'],
      map: (ctx, rps, time) => {
        user(ctx, 0, 6, 46, 46);
        C.arrow(ctx, [[48, 29], [104, 29]], 1, '#ced4da');
        flow(ctx, [[50, 29], [100, 29]], rps / 10, time, TONE.A[1]);
        C.text(ctx, `초당 ${rps}`, 76, 18, { size: 10, weight: 600, color: U.text, align: 'center' });
        server(ctx, 106, 6, 64, 46, 'A');
        C.arrow(ctx, [[172, 29], [188, 29]], 1, '#ced4da');
        C.box(ctx, 190, 0, 112, 58, { fill: '#fff', r: 10 });
        C.text(ctx, 'vCPU 1개', 198, 14, { size: 9 });
        return 276;
      },
    });
    // Contention: the same rate to servers A and B on the same vCPU; each gets only its turns.
    sweep('cpu-share-contend', {
      ids: ['A', 'B'], stamp: ['둘 다 50% 못 씀', 'bad'], notes: ['둘이면 초당 50(request 500m)부터 둘 다 원하는 CPU를 못 받는다.'],
      map: (ctx, rps, time) => {
        user(ctx, 0, 6, 46, 46);
        C.arrow(ctx, [[48, 29], [70, 29], [70, 15], [104, 15]], 1, '#ced4da');
        C.arrow(ctx, [[70, 29], [70, 43], [104, 43]], 1, '#ced4da');
        flow(ctx, [[50, 29], [70, 29], [70, 15], [100, 15]], rps / 10, time, TONE.A[1]);
        flow(ctx, [[50, 29], [70, 29], [70, 43], [100, 43]], rps / 10, time, TONE.B[1], 0.5);
        C.text(ctx, `서버마다 초당 ${rps}`, 0, 68, { size: 10, weight: 600, color: U.text });
        server(ctx, 106, 3, 64, 24, 'A');
        server(ctx, 106, 31, 64, 24, 'B');
        C.arrow(ctx, [[172, 15], [180, 15], [180, 29], [188, 29]], 1, '#ced4da');
        C.line(ctx, [[172, 43], [180, 43], [180, 29]], '#ced4da', 1);
        C.box(ctx, 190, 0, 112, 58, { fill: '#fff', r: 10 });
        C.text(ctx, 'vCPU 1개', 198, 14, { size: 9 });
        return 276;
      },
    });
  }

  // Group: CFS period and quota.
  {

    // limit 500m on a time axis: each cfs_period_us starts with a cfs_quota_us block, and the rest of the period is throttled.
    // Data: docs.kernel.org/scheduler/sched-bwc.html
    document.querySelectorAll('[data-figure="cpu-cfs"]').forEach((root) => {
      const PER = 100, Q = 50, SEC = 7, HOLD = 2;
      // Double-headed arrow along y from x0 to x1.
      const dbl = (ctx, x0, x1, y, color) => {
        if (x1 - x0 < 4) return;
        C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
        [[x0, 1], [x1, -1]].forEach(([x, d]) => {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 7 * d, y - 4); ctx.lineTo(x + 7 * d, y + 4); ctx.closePath();
          ctx.fillStyle = color; ctx.fill();
        });
      };
      hwa.scene(root, {
        height: 240, still: SEC,
        frame: (ctx, w, h, time, say) => {
          const N = w < 500 ? 2 : 3, SPAN = N * PER, { k } = hwa.loop(time, SEC, HOLD, 1), t = k * SPAN;
          C.pill(ctx, 0, 0, 'limit 500m', 'warn');
          const x0 = 10, x1 = w - 34, top = 40, base = 172, X = (ms) => x0 + (ms / SPAN) * (x1 - x0);
          C.line(ctx, [[x0, top - 6], [x0, base], [x1 + 14, base]], U.text, 1.4);
          C.text(ctx, '시간', w, base - 8, { size: 10, align: 'right' });
          for (let p = 0; p < N; p++) {
            const s = p * PER;
            if (t <= s) break;
            // Quota block grows while the task runs; then the throttled gap grows to the end of the period.
            const bx = X(s) + 4, bw = X(Math.min(t, s + Q)) - bx;
            ctx.beginPath(); ctx.roundRect(bx, top, Math.max(0, bw), base - top - 8, 10); ctx.fillStyle = U.blue; ctx.fill();
            if (t >= s + Q) {
              C.text(ctx, 'cfs_quota_us', (bx + X(s + Q)) / 2, (top + base) / 2 - 8, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
              C.text(ctx, `${Q}ms`, (bx + X(s + Q)) / 2, (top + base) / 2 + 9, { size: 12, weight: 700, color: '#fff', align: 'center', base: 'middle' });
              dbl(ctx, X(s + Q) + 6, X(Math.min(t, s + PER)) - 6, (top + base) / 2, U.red);
              if (t >= s + PER - 10) C.text(ctx, '쓰로틀', X(s + Q + (PER - Q) / 2), (top + base) / 2 + 16, { size: 10, weight: 600, color: U.red, align: 'center' });
            }
            // Period arrow under the axis grows with time; the tick and its label land when the period ends.
            dbl(ctx, X(s) + 2, X(Math.min(t, s + PER)) - 2, base + 32, U.text);
            if (t >= s + PER) {
              C.line(ctx, [[X(s + PER), base - 4], [X(s + PER), base + 4]], U.muted, 1);
              C.text(ctx, `${s + PER}ms`, X(s + PER), base + 16, { size: 10, align: 'center' });
              C.text(ctx, 'cfs_period_us', X(s + PER / 2), base + 50, { size: 10, weight: 600, color: U.text, align: 'center' });
            }
          }
          C.dashed(ctx, X(t), top - 6, X(t), base, U.now);
          say(`limit 500m: 100ms 주기(cfs_period_us)마다 처음 50ms(cfs_quota_us)만 CPU를 쓰고 나머지 50ms는 쓰로틀된다. 지금 ${Math.round(t)}ms.`);
        },
      });
    });

  }

  // Group: timeline figures. Lanes on a time axis, blocks for CPU work, labelled arrows for waits.
  {
    const FILL = { cpu: U.blue, cpu2: U.purple, db: '#868e96', heavy: U.orange, sw: U.red, s1: U.blue, s2: U.purple, s3: '#12b886', s4: U.orange };
    const ARC = { wait: '#adb5bd', idle: '#ced4da', thr: U.red, late: U.red };
    const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
    const dbl = (ctx, x0, x1, y, color) => {
      if (x1 - x0 < 6) return;
      C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
      [[x0, 1], [x1, -1]].forEach(([x, d]) => {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
      });
    };
    const LH = 50;

    // demo: scenes become modes the reader picks, and the run button plays the chosen one once.
    const tl = (name, scenes, { SEC = 7, HOLD = 1.8, demo } = {}) => document.querySelectorAll(`[data-figure="${name}"]`).forEach((root) => {
      const maxL = Math.max(...scenes.map((s) => s.lanes.length)), n = scenes.length;
      const hasBelow = scenes.some((s) => s.below), height = 44 + maxL * LH + 26 + (hasBelow ? 40 : 4);
      hwa.scene(root, {
        height, still: (n - 1) * (SEC + HOLD) + SEC,
        scenes: n > 1 && !demo ? hwa.loopScenes(SEC, HOLD, n) : undefined,
        notes: scenes.map((x) => x.say), demo,
        frame: (ctx, w, h, time, say, ui) => {
          const auto = hwa.loop(time, SEC, HOLD, n), i = demo ? ui.mode : auto.i, s = scenes[i];
          const run = demo ? (ui.runAt === null ? -1 : time - ui.runAt) : (time % ((SEC + HOLD) * n)) - auto.i * (SEC + HOLD), k = Math.max(0, Math.min(1, run / SEC)), t = k * s.span;
          C.pill(ctx, 0, 0, s.pill, s.tone);
          if (s.legend) {
            let lx = w;
            s.legend.slice().reverse().forEach(([kind, label]) => {
              lx -= tw(ctx, label, 10) + 4;
              C.text(ctx, label, lx, 11.5, { size: 10, base: 'middle' });
              lx -= 14;
              ctx.fillStyle = FILL[kind] || ARC[kind];
              ctx.beginPath(); ctx.roundRect(lx, 6, 10, 10, 2); ctx.fill();
              lx -= 10;
            });
          }
          const lw = Math.min(72, w * 0.2), x0 = lw, x1 = w - 8, top = 40, base = top + s.lanes.length * LH + 4;
          const X = (v) => x0 + (Math.max(0, Math.min(v, s.span)) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
          s.lanes.forEach((name, j) => C.text(ctx, name, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
          C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
          C.text(ctx, '시간', x1, base - 6, { size: 9, align: 'right' });
          (s.ticks || []).forEach(([v, label]) => {
            if (t < v) return;
            C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
            C.text(ctx, label, X(v), base + 14, { size: 9, align: v >= s.span ? 'right' : 'center' });
          });
          (s.arcs || []).forEach(([j, a, b, kind, label]) => {
            if (t <= a) return;
            const y = ly(j) + LH / 2, xe = X(Math.min(t, b));
            // Throttled time is a hatched red block, labelled by a small chip once it is complete.
            if (kind === 'thr') {
              const by = ly(j) + 8, bx = X(a) + 1, bw = xe - bx - 1;
              if (bw > 0) { ctx.fillStyle = '#fff5f5'; ctx.fillRect(bx, by, bw, LH - 16); ctx.fillStyle = C.hatch(ctx, '#fa5252'); ctx.fillRect(bx, by, bw, LH - 16); }
              if (t >= b && label && tw(ctx, label, 10, 700) + 16 < X(b) - X(a)) { ctx.font = U.font(10, 700); C.tag(ctx, (X(a) + X(b)) / 2 - (ctx.measureText(label).width + 16) / 2, y - 10, label, 'bad'); }
              return;
            }
            dbl(ctx, X(a) + 2, xe - 2, y, ARC[kind]);
            if (t >= b && label && tw(ctx, label, 9, 600) < X(b) - X(a)) C.text(ctx, label, (X(a) + X(b)) / 2, y + 13, { size: 9, weight: 600, color: ARC[kind], align: 'center' });
          });
          (s.segs || []).forEach(([j, a, b, kind, label]) => {
            if (t <= a) return;
            const y = ly(j) + 8, bx = X(a) + 1, bw = X(Math.min(t, b)) - bx - 1;
            if (bw <= 0) return;
            ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 16, Math.min(3, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
            if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 16) / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
          });
          (s.below || []).forEach(([a, b, label]) => {
            if (t <= a) return;
            dbl(ctx, X(a) + 2, X(Math.min(t, b)) - 2, base + 26, U.text);
            if (t >= b && tw(ctx, label, 9, 600) < X(b) - X(a)) C.text(ctx, label, (X(a) + X(b)) / 2, base + 40, { size: 9, weight: 600, color: U.text, align: 'center' });
          });
          if (s.event && t >= s.event[0]) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
          if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
          if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, top + (base - top) / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
          if (demo && run < 0) C.text(ctx, `${demo.run} 버튼을 눌러 보자`, (x0 + x1) / 2, top + (base - top) / 2, { size: 12, align: 'center', base: 'middle' });
          say(`${s.pill}. ${s.say || ''}`);
        },
      });
    });

    // Figure 4. One request: a little CPU at each end, a long wait for the DB in between.
    tl('cpu-os-threads', [
      { pill: '요청 하나', tone: 'info', span: 100, lanes: ['스레드', 'DB'], ticks: [[50, '50ms'], [100, '100ms']], segs: [[0, 0, 6, 'cpu', '읽기'], [1, 10, 80, 'db', '쿼리 실행'], [0, 88, 96, 'cpu', '응답']], arcs: [[0, 6, 88, 'wait', 'DB 응답 대기']], event: [10, '쿼리 보냄'], stamp: ['CPU 14ms, 대기 82ms', 'info'], say: '스레드는 처음과 끝에만 CPU를 쓰고 나머지는 DB를 기다린다.' },
    ], { SEC: 6 });

    // Figure 17. Node.js under limit 1000m: the JS thread and the V8 helper spend one quota together.
    tl('cpu-node-limit', [
      { pill: '평소', tone: 'ok', span: 100, lanes: ['JS 메인', 'V8 헬퍼'], ticks: [[50, '50ms'], [100, '100ms']], below: [[0, 100, 'cfs_period_us 100ms']], segs: [[0, 0, 30, 'cpu', 'JS'], [0, 45, 70, 'cpu', 'JS'], [1, 30, 42, 'cpu2', 'GC']], stamp: ['67ms, 쿼터 안', 'ok'], say: 'JS와 GC를 합쳐 67ms라 쿼터 100ms 안에서 끝난다.' },
      { pill: '부하, 50ms 만에 쿼터 소진', tone: 'bad', span: 100, lanes: ['JS 메인', 'V8 헬퍼'], ticks: [[50, '50ms'], [100, '100ms']], below: [[0, 100, 'cfs_period_us 100ms']], segs: [[0, 0, 50, 'cpu', 'JS'], [1, 0, 50, 'cpu2', 'GC']], arcs: [[0, 50, 100, 'thr', '쓰로틀'], [1, 50, 100, 'thr', '쓰로틀']], event: [50, '쿼터 소진'], stamp: ['50ms 멈춤', 'bad'], say: '둘이 같이 돌아 50ms 만에 100ms어치를 쓰고 나머지 50ms를 멈춘다.' },
    ]);

    // Demo: one heavy callback holds the main thread; chunking it lets B in between the pieces.
    const chunks = Array.from({ length: 8 }, (_, j) => [0, j ? 8 + (j - 1) * 5.6 : 0, (j ? 8 + (j - 1) * 5.6 : 0) + 5, 'heavy', '']);
    tl('cpu-eventloop', [
      { pill: '통째로 계산', tone: 'bad', span: 60, lanes: ['메인 스레드', '요청 B'], ticks: [[20, '20ms'], [40, '40ms'], [60, '60ms']], segs: [[0, 0, 40, 'heavy', 'A 무거운 계산'], [0, 40, 43, 'cpu2', 'B'], [0, 43, 47, 'cpu', 'C']], arcs: [[1, 3, 40, 'late', 'B 밀린 시간']], event: [3, 'B 도착'], stamp: ['B 37ms 밀림', 'bad'], say: 'A가 40ms 동안 메인 스레드를 잡아, 3ms에 온 B가 37ms를 기다린다.' },
      { pill: '쪼개서 계산', tone: 'ok', span: 60, lanes: ['메인 스레드', '요청 B'], ticks: [[20, '20ms'], [40, '40ms'], [60, '60ms']], segs: [...chunks, [0, 5, 8, 'cpu2', 'B']], arcs: [[1, 3, 5, 'wait', '']], event: [3, 'B 도착'], stamp: ['B 2ms 대기', 'ok'], say: 'A를 5ms씩 나눠 사이마다 메인 스레드를 놓아 주면, B는 2ms만 기다린다. A가 끝나는 시각은 거의 같다.' },
    ], { demo: { modes: ['통째로 계산', '쪼개서 계산'], run: '무거운 요청 보내기' } });

    // Demo: a burst under limit 1000m stops at the quota and finishes in the next period; without a limit it just runs.
    const per = [[0, 100, '주기'], [100, 200, '주기'], [200, 300, '주기']], bt = [[100, '100ms'], [200, '200ms'], [300, '300ms']];
    tl('cpu-burst', [
      { pill: 'limit 1000m', tone: 'bad', span: 300, lanes: ['작업 1', '작업 2'], ticks: bt, below: per, segs: [[0, 0, 20, 'cpu', ''], [0, 100, 150, 'cpu', '50ms'], [1, 100, 150, 'cpu2', '50ms'], [0, 200, 230, 'cpu', ''], [1, 200, 230, 'cpu2', '']], arcs: [[0, 150, 200, 'thr', '쓰로틀'], [1, 150, 200, 'thr', '쓰로틀']], event: [100, '요청 몰림'], stamp: ['130ms 만에 끝남', 'bad'], say: '몰린 일을 두 작업이 나눠 50ms 만에 쿼터를 다 쓰고, 50ms 멈췄다가 다음 주기에 마저 끝낸다.' },
      { pill: 'limit 없음', tone: 'ok', span: 300, lanes: ['작업 1', '작업 2'], ticks: bt, below: per, segs: [[0, 0, 20, 'cpu', ''], [0, 100, 180, 'cpu', '80ms'], [1, 100, 180, 'cpu2', '80ms']], event: [100, '요청 몰림'], stamp: ['80ms 만에 끝남', 'ok'], say: '쿼터가 없으면 두 작업이 80ms 동안 쉬지 않고 돌아 같은 일을 80ms에 끝낸다.' },
    ], { demo: { modes: ['limit 1000m', 'limit 없음'], run: '요청 몰리게 하기' } });
  }

  // Node.js process: main thread, kernel, libuv pool and V8 helpers. Each scene traces one job through them.
  document.querySelectorAll('[data-figure="cpu-node-arch"]').forEach((root) => {
    const STEP = 0.9, HOLD = 1.6, PHASES = ['timers', 'poll', 'check'];
    const scenes = [
      { pill: 'DB 쿼리 한 건', tone: 'info', note: '네트워크는 메인 스레드가 epoll로 직접 기다린다. 기다리는 동안 메인 스레드는 대기 상태라 CPU를 안 쓴다.', steps: [
        ['v8', 'bind', 'JS가 쿼리를 보낸다'], ['bind', 'sock', 'write(21)로 소켓에 쓰고 바로 돌아온다'],
        ['loop', 'epoll', 'epoll_wait를 부르고 대기한다', 'sleep'], ['sock', 'epoll', '응답이 오면 fd 21이 준비됨이 된다', 'sleep'],
        ['epoll', 'loop', 'epoll이 메인 스레드를 깨운다'], ['loop', 'v8', '콜백을 실행한다'],
      ] },
      { pill: '파일 읽기', tone: 'warn', note: '파일 읽기는 epoll로 기다릴 수 없어서 libuv 스레드 풀이 대신 블로킹 read를 한다. 끝나면 이벤트 루프에 알린다.', steps: [
        ['v8', 'bind', 'JS가 fs.readFile을 부른다'], ['bind', 'pool', '스레드 풀에 일을 넘긴다'],
        ['pool', 'sock', '워커가 블로킹 read를 한다'], ['pool', 'epoll', '끝나면 완료를 알린다'],
        ['epoll', 'loop', 'epoll이 메인 스레드를 깨운다'], ['loop', 'v8', '콜백을 실행한다'],
      ] },
      { pill: 'GC와 JIT', tone: 'ok', note: '메인 스레드가 JS를 도는 동안 GC와 JIT 컴파일은 V8 헬퍼 스레드가 따로 돌린다. JS 실행은 하나여도 CPU는 그보다 더 쓴다.', steps: [
        ['v8', 'gc', 'GC가 메인 스레드와 같이 돈다', 'keep'], ['v8', 'jit', '자주 도는 코드를 기계어로 바꾼다', 'keep'],
      ] },
    ];
    const LEN = scenes.map((s) => s.steps.length * STEP + HOLD), TOTAL = LEN.reduce((a, b) => a + b, 0);
    hwa.scene(root, {
      scenes: { n: scenes.length, at: (i) => LEN.slice(0, i).reduce((a, b) => a + b, 0), of: (t) => { let x = t % TOTAL, i = 0; while (x >= LEN[i] && i < LEN.length - 1) x -= LEN[i++]; return i; } },
      height: 392,
      still: LEN[0] - HOLD / 2,
      frame: (ctx, w, h, time, say) => {
        let t = time % TOTAL, si = 0;
        while (t >= LEN[si]) t -= LEN[si++];
        const sc = scenes[si], n = sc.steps.length, cur = Math.min(n - 1, Math.floor(t / STEP)), f = Math.min(1, hwa.smooth((t - cur * STEP) / (STEP * 0.7)));
        const step = sc.steps[cur], sleeping = step[3] === 'sleep';
        const R = w - 18, g = 24, ix = 12, bw = (R - 2 * ix - 2 * g) / 3, col = (i) => ix + i * (bw + g), cx = (i) => col(i) + bw / 2;
        const poolX = col(1) - ix, ww = (R - poolX - 34) / 4, gw = (poolX - 28) / 2;
        const workers = [0, 1, 2, 3].map((i) => ({ x: poolX + 8 + i * (ww + 6), y: 238, w: ww, h: 40, t: `워커 ${i + 1}` }));
        const B = {
          v8: { x: col(0), y: 58, w: bw, h: 62, t: 'V8', s: 'JS 실행' },
          loop: { x: col(1), y: 58, w: bw, h: 62, t: '이벤트 루프' },
          bind: { x: col(2), y: 58, w: bw, h: 62, t: 'C++ 바인딩', s: 'net, fs, http' },
          epoll: { x: col(1), y: 168, w: bw, h: 44, t: 'epoll', s: '감시 목록' },
          sock: { x: col(2), y: 168, w: bw, h: 44, t: '소켓, 파일', s: '커널 버퍼' },
          gc: { x: 8, y: 238, w: gw, h: 40, t: 'GC' },
          jit: { x: 14 + gw, y: 238, w: gw, h: 40, t: 'JIT' },
          pool: workers[3],
        };
        const wx = B.pool.x + ww / 2, gcx = B.gc.x + gw / 2, jitx = B.jit.x + gw / 2;
        const P = {
          'v8>bind': [[cx(0), 120], [cx(0), 128], [cx(2) - 14, 128], [cx(2) - 14, 120]],
          'bind>sock': [[cx(2) + 10, 120], [cx(2) + 10, 168]],
          'loop>epoll': [[cx(1) - 10, 120], [cx(1) - 10, 168]],
          'sock>epoll': [[col(2), 190], [col(1) + bw, 190]],
          'epoll>loop': [[cx(1) + 10, 168], [cx(1) + 10, 120]],
          'loop>v8': [[col(1), 89], [col(0) + bw, 89]],
          'bind>pool': [[col(2) + bw, 89], [w - 8, 89], [w - 8, 258], [R, 258]],
          'pool>sock': [[wx, 238], [wx, 212]],
          'pool>epoll': [[wx - 16, 238], [wx - 16, 222], [cx(1) + 22, 222], [cx(1) + 22, 212]],
          'v8>gc': [[cx(0) - 8, 120], [cx(0) - 8, 224], [gcx, 224], [gcx, 238]],
          'v8>jit': [[cx(0) + 8, 120], [cx(0) + 8, 228], [jitx, 228], [jitx, 238]],
        };
        const lit = new Set([step[0]]);
        if (f > 0.95) lit.add(step[1]);
        sc.steps.forEach((s, i) => { if (s[3] === 'keep' && i < cur) lit.add(s[1]); });
        if (si === 2) lit.add('v8');
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        C.text(ctx, 'Node.js 프로세스 하나', w, 11, { size: 10, align: 'right', base: 'middle' });
        C.group(ctx, 0, 34, R, 100, '메인 스레드', 49);
        if (sleeping) C.text(ctx, '대기, CPU 0', R - 10, 49, { size: 10, weight: 600, color: U.muted, align: 'right' });
        ['v8', 'loop', 'bind'].forEach((k) => C.card(ctx, B[k], { lit: lit.has(k), dim: sleeping, fill: k === 'v8' ? JSFILL : '#fff', stroke: k === 'v8' ? JSLINE : U.grid }));
        const phase = sleeping || (si < 2 && cur >= 2) ? 'poll' : PHASES[Math.floor(time * 1.5) % 3], L = B.loop;
        ctx.font = hwa.ui.font(10, 600);
        const chips = PHASES.map((p) => ctx.measureText(p).width + 12), cw = chips.reduce((a, b) => a + b, 0) + 8;
        if (cw < L.w - 12) {
          let x = L.x + (L.w - cw) / 2;
          PHASES.forEach((p, i) => {
            ctx.beginPath();
            ctx.roundRect(x, L.y + 36, chips[i], 17, 8);
            ctx.fillStyle = p === phase ? '#e7f5ff' : U.cell;
            ctx.fill();
            C.text(ctx, p, x + chips[i] / 2, L.y + 45, { size: 10, weight: 600, color: p === phase ? '#1971c2' : U.muted, align: 'center', base: 'middle' });
            x += chips[i] + 4;
          });
        } else C.text(ctx, `${phase} 단계`, L.x + L.w / 2, L.y + 45, { size: 10, weight: 600, color: '#1971c2', align: 'center', base: 'middle' });
        ctx.save();
        ctx.setLineDash([4, 4]);
        C.line(ctx, [[0, 146], [R, 146]], '#ced4da', 1);
        ctx.restore();
        C.text(ctx, '커널', 0, 162, { weight: 600 });
        ['epoll', 'sock'].forEach((k) => C.card(ctx, B[k], { lit: lit.has(k), fill: U.cell }));
        C.group(ctx, 0, 228, poolX - 6, 78, 'V8 헬퍼', 298);
        C.group(ctx, poolX, 228, R - poolX, 78, 'libuv 스레드 풀', 298);
        ['gc', 'jit'].forEach((k) => C.card(ctx, B[k], { lit: lit.has(k) }));
        workers.forEach((wk, i) => C.card(ctx, wk, { lit: i === 3 && lit.has('pool') }));
        sc.steps.forEach((s, i) => {
          if (i > cur) return;
          const pts = P[`${s[0]}>${s[1]}`], on = i === cur;
          C.arrow(ctx, pts, on ? f : 1, on ? U.accent : '#ced4da', { width: on ? 2 : 1.5 });
          const key = `${s[0]}>${s[1]}`;
          C.badge(ctx, pts, i + 1, on, { 'v8>bind': 'down', 'bind>pool': 'left', 'v8>gc': 'left' }[key], key === 'v8>bind' ? 0.25 : 0.5);
        });
        C.text(ctx, `${cur + 1}. ${step[2]}`, 0, 332, { size: 12, weight: 600, color: U.text, base: 'middle' });
        C.wrap(ctx, sc.note, w / 2, 360, w - 20, { color: U.tones[sc.tone][1] });
        say(`${sc.pill}: ${sc.note}`);
      },
    });
  });
  // One DB query as a sequence: the JS thread works only at the two ends and sleeps in epoll_wait in between.
  document.querySelectorAll('[data-figure="cpu-request-flow"]').forEach((root) => {
    const SEC = 7, HOLD = 1.8, Y0 = 102, Y1 = 352;
    const lanes = [['JS 스레드', '이벤트 루프'], ['epoll', '감시 목록'], ['소켓', '송수신 큐'], ['MySQL', ':3306']];
    const acts = [[0, 108, 146, 'run'], [2, 120, 146], [3, 140, 256], [1, 168, 304, 'watch'], [0, 176, 296, 'sleep'], [2, 256, 286], [0, 312, 346, 'run']];
    const arrows = [[0, 2, 124, 'write(21, 쿼리)'], [2, 3, 140, '쿼리 전송'], [0, 1, 164, 'epoll_wait'], [3, 2, 256, '응답 패킷', 'dash'], [2, 1, 280, 'fd 21 준비됨'], [1, 0, 304, 'wake_up', 'wake']];
    const steps = [
      ['① 보냄', 108, 160, '쿼리를 write(21)로 소켓에 쓰고, 기다리지 않고 바로 돌아온다.'],
      ['② 대기', 160, 256, 'epoll_wait를 부르고 대기한다. 대기하는 동안 CPU를 하나도 안 쓴다.'],
      ['③ 도착', 256, 296, '응답이 오면 커널이 수신 큐에 넣고 fd 21을 준비됨으로 올린다.'],
      ['④ 깨움', 296, 312, 'epoll이 대기 중인 메인 스레드를 깨운다.'],
      ['⑤ 콜백', 312, 352, 'read(21)로 응답을 가져와 콜백을 실행한다.'],
    ];
    hwa.scene(root, {
      height: 402,
      still: SEC,
      frame: (ctx, w, h, time, say) => {
        const y = Y0 + (Y1 - Y0) * hwa.loop(time, SEC, HOLD).k;
        const x0 = 52, lw = (w - x0) / 4, LX = (i) => x0 + lw * (i + 0.5), m = lw < 90 ? 3 : 8;
        const found = steps.findIndex((s) => y < s[2]), si = found < 0 ? steps.length - 1 : found;
        C.pill(ctx, 0, 0, steps[si][0], si === 1 ? 'ok' : 'info');
        C.text(ctx, 'DB 쿼리 한 건, 커넥션 fd 21', w, 11, { size: 10, align: 'right', base: 'middle' });
        C.group(ctx, LX(1) - lw / 2 + 4, 30, lw * 2 - 8, 330, '커널', 45);
        lanes.forEach(([t, s], i) => {
          C.card(ctx, { x: LX(i) - lw / 2 + m, y: 54, w: lw - 2 * m, h: 40, t, s, size: lw < 90 ? 11 : 12 }, { fill: i === 0 ? JSFILL : '#fff', stroke: i === 0 ? JSLINE : U.grid });
          ctx.save();
          ctx.setLineDash([3, 4]);
          C.line(ctx, [[LX(i), 94], [LX(i), 356]], '#ced4da', 1);
          ctx.restore();
        });
        steps.forEach(([label, a, b], i) => C.text(ctx, label, 0, (a + b) / 2, { size: 11, weight: i === si ? 700 : 500, color: i === si ? U.accent : i < si ? U.text : '#ced4da', base: 'middle' }));
        acts.forEach(([lane, a, b, kind]) => {
          if (a >= y) return;
          const e = Math.min(b, y), x = LX(lane);
          if (kind === 'sleep') {
            const sw = Math.min(lw - 12, 76);
            ctx.fillStyle = U.cell;
            ctx.fillRect(x - sw / 2, a, sw, e - a);
            if (e - a > 44) {
              C.text(ctx, '대기', x, a + (e - a) / 2 - 8, { size: 11, weight: 700, color: U.muted, align: 'center', base: 'middle' });
              C.text(ctx, 'CPU 0', x, a + (e - a) / 2 + 9, { size: 10, color: U.muted, align: 'center', base: 'middle' });
            }
            return;
          }
          ctx.fillStyle = kind === 'run' ? U.blue : kind === 'watch' ? '#e9ecef' : '#fff';
          ctx.fillRect(x - 6, a, 12, e - a);
          ctx.strokeStyle = kind === 'run' ? U.blue : '#adb5bd';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 5.5, a + 0.5, 11, Math.max(0, e - a - 1));
        });
        arrows.forEach(([from, to, ay, label, style]) => {
          const k = Math.max(0, Math.min(1, (y - ay) / 14));
          if (!k) return;
          const dir = Math.sign(LX(to) - LX(from)), color = style === 'wake' ? U.blue : '#868e96';
          C.arrow(ctx, [[LX(from) + dir * 7, ay], [LX(to) - dir * 7, ay]], k, color, { dash: style === 'dash' ? [4, 3] : null });
          ctx.globalAlpha = k;
          C.text(ctx, label, (LX(from) + LX(to)) / 2, ay - 7, { size: 10, color: style === 'wake' ? U.blue : U.text, align: 'center' });
          ctx.globalAlpha = 1;
        });
        C.dashed(ctx, x0 - 6, y, w, y, '#a5d8ff');
        C.wrap(ctx, steps[si][3], w / 2, 380, w - 20, { color: U.text });
        say(steps[si][3]);
      },
    });
  });
})();
