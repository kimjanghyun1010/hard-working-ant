(() => {
  const U = hwa.ui, C = hwa.cv;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const fig = (id, fn) => document.querySelectorAll(`[data-figure="${id}"]`).forEach(fn);
  // Scenes of unequal length, each followed by the same hold (as in cpu-flow.js).
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, still: at(lens.length - 1) + lens[lens.length - 1] + 0.8, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  // Moves along pts; times[j] = [start, end] of segment j. seg is -1 before the first segment starts.
  const walk = (pts, times, t) => {
    for (let j = times.length - 1; j >= 0; j--) if (t >= times[j][0]) return { p: mix(pts[j], pts[j + 1], ease(t, times[j][0], times[j][1])), seg: j };
    return { p: pts[0], seg: -1 };
  };
  const BLUE = ['#eff6ff', '#1d4ed8', '#93c5fd'], WAIT = ['#fef3c7', '#b45309', '#fcd34d'], BAD = ['#fee2e2', '#dc2626', '#fca5a5'];
  const OK = ['#dcfce7', '#15803d', '#86efac'], PROXY = ['#f5f3ff', '#6d28d9', '#c4b5fd'], L4 = ['#f0fdfa', '#0f766e', '#5eead4'], PLAIN = ['#fff', '#475569', '#cbd5e1'];
  // Bordered chip centred on (cx, cy); returns its width.
  const tag = (ctx, s, cx, cy, [bg, fg, line], a = 1) => {
    const cw = tw(ctx, s, 10, 600) + 14;
    if (a <= 0) return cw;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(cx - cw / 2, cy - 9, cw, 18, 5);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, cx, cy + 0.5, { size: 10, weight: 600, color: fg, align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
    return cw;
  };
  const ball = (ctx, [x, y], color, r = 5) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  const tone = (t) => ({ fill: t[0], stroke: t[2] });
  const hint = (ctx, s, x, y) => C.text(ctx, s, x, y, { size: 12, align: 'center', base: 'middle' });

  // One request from pod A's app to pod B's app: iptables sends it to Envoy on each side, the hop between nodes is mTLS.
  fig('istio-path', (root) => {
    const S = seq([5.5, 5.5], 1.6);
    const notes = [
      '앱의 연결은 iptables가 Envoy 15001로 돌리고, UID 1337인 Envoy가 mTLS로 감싼 연결은 그대로 나간다.',
      '파드 B의 iptables가 들어온 연결을 Envoy 15006으로 돌리고, Envoy가 TLS를 풀어 앱 8080에 넘긴다.',
    ];
    hwa.scene(root, {
      height: 266, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, i ? '들어오는 길' : '나가는 길', 'info');
        const pw = Math.min(230, (w - 56) / 2), y0 = 32, ph = 196, aw = pw - 46;
        const P = [0, w - pw].map((x, side) => {
          const sx = side ? x + 6 : x + pw - 18, cx = side ? x + 36 + aw / 2 : x + 10 + aw / 2;
          return { x, sx, cx, app: { x: cx - aw / 2, y: y0 + 34, w: aw, h: 46 }, env: { x: cx - aw / 2, y: y0 + 120, w: aw, h: 46 } };
        });
        const ey = y0 + 143, ay = y0 + 57, mid = w / 2;
        let hit = -1, lit = -1, chip = null;
        if (i === 0) {
          const pts = [[P[0].cx, ay], [P[0].sx, ay], [P[0].cx, ey], [P[0].sx + 12, ey], [mid, ey]];
          const m = walk(pts, [[0.3, 1.1], [1.4, 2.2], [2.6, 3.2], [3.2, 4.4]], t);
          hit = m.seg === 0 && t > 1.0 && t < 1.8 ? 0 : -1;
          lit = m.seg >= 1 && t < 3.0 ? 0 : -1;
          chip = { p: m.p, s: m.seg >= 2 ? 'mTLS' : 'HTTP', c: m.seg >= 2 ? OK : BLUE };
        } else {
          const pts = [[mid, ey], [P[1].sx, ey], [P[1].cx, ey], [P[1].cx, ay]];
          const m = walk(pts, [[0.3, 1.2], [1.5, 2.3], [2.8, 3.8]], t);
          hit = m.seg === 0 && t > 1.1 && t < 1.9 ? 1 : -1;
          lit = m.seg === 1 || (m.seg === 2 && t < 3.0) ? 1 : -1;
          chip = { p: m.p, s: m.seg >= 2 ? 'HTTP' : 'mTLS', c: m.seg >= 2 ? BLUE : OK };
        }
        P.forEach((p, side) => {
          const on = side === i;
          C.box(ctx, p.x, y0, pw, ph, { fill: U.plot, stroke: on ? U.accentLine : U.grid });
          C.text(ctx, side ? '파드 B (결제)' : '파드 A (주문)', side ? p.x + 36 : p.x + 10, y0 + 18, { size: 11, weight: 600, color: U.text });
          C.card(ctx, { ...p.app, t: '앱', s: side ? ':8080 받음' : 'payments 호출' });
          C.card(ctx, { ...p.env, t: 'Envoy', s: side ? '15006 들어옴' : '15001 나감' }, { ...tone(PROXY), lit: lit === side });
          ctx.fillStyle = hit === side ? U.accentSoft : '#fff';
          ctx.strokeStyle = hit === side ? U.accent : '#cbd5e1';
          ctx.beginPath(); ctx.roundRect(p.sx, y0 + 28, 12, ph - 38, 4); ctx.fill(); ctx.stroke();
          ctx.save();
          ctx.translate(p.sx + 6, y0 + ph / 2 + 4);
          ctx.rotate(-Math.PI / 2);
          C.text(ctx, 'iptables', 0, 0, { size: 9, weight: 600, color: hit === side ? U.accent : U.muted, align: 'center', base: 'middle' });
          ctx.restore();
        });
        C.dashed(ctx, P[0].x + pw, ey, P[1].x, ey, '#94a3b8');
        C.text(ctx, '노드 사이', mid, ey + 26, { size: 10, align: 'center' });
        if (chip && !(i === 1 && t > 4.0)) tag(ctx, chip.s, chip.p[0], chip.p[1], chip.c);
        C.stamp(ctx, mid, y0 + ph + 22, i ? '프록시 두 번 지남' : '앱 모르게 Envoy로', 'info', (run - 5.5) / 0.4);
        say(notes[i]);
      },
    });
  });

  // istiod pushes config and signs certificates; when it stops, requests between Envoys keep flowing.
  fig('istio-xds', (root) => {
    const S = seq([6, 6, 6.5], 1.8);
    const PILL = [['설정 배포', 'info'], ['인증서 발급', 'info'], ['istiod 멈춤', 'bad']];
    const notes = [
      'VirtualService가 바뀌면 istiod가 API 서버에서 보고 xDS로 모든 Envoy에 밀어 넣는다.',
      '파드의 istio-agent가 서명 요청(CSR)을 보내면 istiod가 서명한 인증서를 돌려준다.',
      'istiod가 멈춰도 Envoy는 받은 설정으로 요청을 계속 나른다. 새 설정과 인증서 갱신만 멈춘다.',
    ];
    hwa.scene(root, {
      height: 290, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, PILL[i][0], PILL[i][1]);
        const iw = Math.min(130, w * 0.32), aw = Math.min(110, w * 0.28), ix = Math.min(w * 0.5 - iw / 2, w - aw - iw - 22), ax = w - aw - 8;
        C.group(ctx, 0, 30, w, 84, '컨트롤 플레인', 48);
        const ist = { x: ix, y: 56, w: iw, h: 46, t: 'istiod', s: i === 2 ? '멈춤' : 'xDS, CA' };
        C.card(ctx, ist, i === 2 ? { dash: [4, 3], stroke: U.red, dim: true } : { lit: (i === 0 && t > 1.6 && t < 2.6) || (i === 1 && t > 1.6 && t < 2.4) });
        C.card(ctx, { x: ax, y: 56, w: aw, h: 46, t: 'API 서버' });
        C.group(ctx, 0, 132, w, 122, '데이터 플레인', 150);
        const g = 18, pw = (w - 16 - 2 * g) / 3, py = 162, phh = 82, pc = (j) => 8 + j * (pw + g) + pw / 2;
        if (i === 0 && t < 2) {
          const m = walk([[ax + 14, 79], [ix + iw - 6, 79]], [[0.5, 1.6]], t);
          if (m.seg >= 0) tag(ctx, 'VS', m.p[0], m.p[1], WAIT);
        }
        [0, 1, 2].forEach((j) => {
          const x = pc(j) - pw / 2;
          C.box(ctx, x, py, pw, phh, { fill: '#fff' });
          C.text(ctx, `파드 ${j + 1}`, x + 8, py + 16, { size: 10, weight: 600, color: U.text });
          let s = 'Envoy', c = PROXY;
          if (i === 0 && t > 3.4 + j * 0.15) { s = '새 라우팅'; c = OK; }
          if (i === 1 && t > 3.6 + j * 0.15) { s = '인증서'; c = OK; }
          tag(ctx, s, pc(j), py + 52, c);
          const top = [ix + iw / 2 + (j - 1) * 24, 104], up = [[pc(j), py - 2], top], down = [top, [pc(j), py + 40]];
          if (i === 0) { const m = walk(down, [[2.2 + j * 0.15, 3.4 + j * 0.15]], t); if (m.seg >= 0 && t < 3.4 + j * 0.15) ball(ctx, m.p, PROXY[1]); }
          if (i === 1) {
            const a = walk(up, [[0.4 + j * 0.2, 1.6 + j * 0.15]], t);
            if (a.seg >= 0 && t < 1.7 + j * 0.15) tag(ctx, 'CSR', a.p[0], a.p[1], PLAIN);
            const b = walk(down, [[2.4 + j * 0.15, 3.6 + j * 0.15]], t);
            if (b.seg >= 0 && t < 3.6 + j * 0.15) ball(ctx, b.p, OK[1]);
          }
        });
        if (i === 2) {
          [0, 1].forEach((j) => {
            const y = py + 72, a = [pc(j) + 16, y], b = [pc(j + 1) - 16, y];
            C.arrow(ctx, [a, b], 1, '#cbd5e1', { width: 1.2 });
            [0, 0.5].forEach((o) => ball(ctx, mix(a, b, (t * 0.5 + o + j * 0.25) % 1), U.blue, 3.5));
          });
          C.text(ctx, '새 설정 반영 안 됨', ix + iw / 2, 118, { size: 10, weight: 600, color: U.red, align: 'center' });
          C.stamp(ctx, w / 2, 272, '요청은 계속 흐름', 'ok', (run - 6.5) / 0.4);
        }
        if (i === 0) C.stamp(ctx, w / 2, 272, '파드 3개에 같이 반영', 'info', (run - 6) / 0.4);
        if (i === 1) C.stamp(ctx, w / 2, 272, '서명은 istiod가', 'info', (run - 6) / 0.4);
        say(`${PILL[i][0]}. ${notes[i]}`);
      },
    });
  });

  // Lanes on a time axis: blocks for work, arrows for waits (a slim version of the timeline in cpu.js).
  const FILL = { slow: '#f59e0b', ok: U.blue };
  const ARC = { wait: '#94a3b8', late: U.red };
  const dbl = (ctx, x0, x1, y, color) => {
    if (x1 - x0 < 6) return;
    C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
    [[x0, 1], [x1, -1]].forEach(([x, d]) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    });
  };
  const timeline = (id, scenes, { SEC = 6, HOLD = 1.8, LH = 46, lw = 84 } = {}) => fig(id, (root) => {
    const n = scenes.length, maxL = Math.max(...scenes.map((s) => s.lanes.length));
    hwa.scene(root, {
      height: 44 + maxL * LH + 30, still: (n - 1) * (SEC + HOLD) + SEC + 0.8,
      scenes: n > 1 ? hwa.loopScenes(SEC, HOLD, n) : undefined, notes: scenes.map((s) => s.say),
      frame: (ctx, w, h, time, say) => {
        const { i } = hwa.loop(time, SEC, HOLD, n), s = scenes[i], run = (time % ((SEC + HOLD) * n)) - i * (SEC + HOLD);
        const k = Math.max(0, Math.min(1, run / SEC)), t = k * s.span;
        C.pill(ctx, 0, 0, s.pill, s.tone);
        const x0 = Math.min(lw, w * 0.26), x1 = w - 8, top = 40, base = top + s.lanes.length * LH + 4;
        const X = (v) => x0 + (Math.max(0, Math.min(v, s.span)) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
        s.lanes.forEach((name, j) => C.text(ctx, name, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
        C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
        (s.ticks || []).forEach(([v, label]) => {
          if (t < v) return;
          C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
          C.text(ctx, label, X(v), base + 14, { size: 9, align: v >= s.span ? 'right' : 'center' });
        });
        (s.arcs || []).forEach(([j, a, b, kind, label]) => {
          if (t <= a) return;
          const y = ly(j) + LH / 2;
          dbl(ctx, X(a) + 2, X(Math.min(t, b)) - 2, y, ARC[kind]);
          if (t >= b && label && tw(ctx, label, 9, 600) < X(b) - X(a)) C.text(ctx, label, (X(a) + X(b)) / 2, y + 13, { size: 9, weight: 600, color: ARC[kind], align: 'center' });
        });
        (s.segs || []).forEach(([j, a, b, kind, label]) => {
          if (t <= a) return;
          const y = ly(j) + 8, bx = X(a) + 1, bw = X(Math.min(t, b)) - bx - 1;
          if (bw <= 0) return;
          ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 16, Math.min(6, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
          if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 16) / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
        });
        if (s.event && t >= s.event[0]) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
        if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
        if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, top + (base - top) / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
        say(`${s.pill}. ${s.say}`);
      },
    });
  });

  // Default (no timeout) waits out a slow pod; perTryTimeout cuts it at 500ms and the retry lands on a healthy pod.
  const rt = [[1000, '1s'], [2000, '2s'], [3000, '3s']], rl = ['주문', '결제 파드 1', '결제 파드 2'];
  timeline('istio-retry', [
    { pill: '타임아웃 없음', tone: 'bad', span: 3000, lanes: rl, ticks: rt, segs: [[1, 0, 3000, 'slow', '느린 응답']], arcs: [[0, 0, 3000, 'late', '응답 대기']], stamp: ['3초 대기', 'bad'], say: '타임아웃이 없으면 느린 파드에 걸린 요청을 끝까지 기다린다.' },
    { pill: 'perTryTimeout 500ms, 재시도', tone: 'ok', span: 3000, lanes: rl, ticks: rt, segs: [[1, 0, 500, 'slow', ''], [2, 530, 650, 'ok', '']], arcs: [[0, 0, 650, 'wait', '']], event: [500, '시도 끊음'], stamp: ['650ms에 성공', 'ok'], say: '500ms에 첫 시도를 끊고 다시 보내, 다른 파드가 받아 650ms에 끝난다.' },
  ]);

  // Demo: pod 2 answers 503 after 3s. Without outlier detection its requests hold the order service's threads; with it, pod 2 is ejected after 3 errors in a row.
  fig('istio-breaker', (root) => {
    const SLOTS = 6, GAP = 0.2, N = 50, FAST = 0.3, SLOW = 3, TRIP = 3, END = 11, DT = 0.01;
    const sim = (breaker) => {
      const reqs = Array.from({ length: N }, (_, n) => ({ arrive: 0.3 + n * GAP, start: -1, end: -1, pod: -1 }));
      let rr = 0, streak = 0, eject = Infinity;
      for (let s = 0; s * DT < END; s++) {
        const m = s * DT + 1e-9;
        reqs.forEach((r) => {
          if (r.start < 0 || r.end >= 0 || m < r.start + (r.pod ? SLOW : FAST)) return;
          r.end = r.start + (r.pod ? SLOW : FAST);
          if (r.pod && breaker && ++streak >= TRIP && eject === Infinity) eject = r.end;
        });
        let busy = reqs.filter((r) => r.start >= 0 && r.end < 0).length;
        for (const r of reqs) {
          if (busy >= SLOTS) break;
          if (r.start >= 0 || r.arrive > m) continue;
          r.start = m;
          r.pod = m >= eject ? 0 : rr++ % 2;
          busy++;
        }
      }
      return { reqs, eject };
    };
    const R = [sim(false), sim(true)];
    const PILL = ['서킷 브레이커 없음', 'outlierDetection'];
    hwa.scene(root, {
      height: 214, still: 0,
      notes: ['파드 2에 간 요청이 3초씩 스레드를 붙잡아, 스레드 6개가 차고 대기 줄이 늘어난다.', '파드 2가 503을 세 번 연달아 내자 부하 분산에서 빠지고, 대기 줄이 금방 빠진다.'],
      demo: { modes: ['서킷 브레이커 없음', '서킷 브레이커 있음'], run: '파드 2 고장 내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const run = ui.runAt === null ? -1 : time - ui.runAt, t = Math.min(run, END), { reqs, eject } = R[ui.mode];
        const on = run >= 0, cut = on && t >= eject;
        const busy = on ? reqs.filter((r) => r.start >= 0 && r.start <= t && (r.end < 0 || r.end > t)).sort((a, b) => a.start - b.start) : [];
        const queue = on ? reqs.filter((r) => r.arrive <= t && (r.start < 0 || r.start > t)).length : 0;
        const failed = on ? reqs.filter((r) => r.pod === 1 && r.end >= 0 && r.end <= t).length : 0;
        C.pill(ctx, 0, 0, PILL[ui.mode], ui.mode ? 'ok' : 'warn');
        C.text(ctx, `대기 ${queue}건`, w, 11, { size: 11, weight: 700, color: queue > 3 ? U.red : U.muted, align: 'right', base: 'middle' });
        const gw = Math.min(240, w * 0.56), y0 = 32, gh = 150;
        C.group(ctx, 0, y0, gw, gh, '주문 파드', y0 + 18);
        C.text(ctx, '스레드 6개', 10, y0 + 40, { size: 10 });
        const s = Math.min(24, (gw - 20 - 5 * 5) / 6);
        for (let k = 0; k < SLOTS; k++) {
          const r = busy[k];
          ctx.fillStyle = !r ? '#fff' : r.pod ? '#f59e0b' : U.blue;
          ctx.strokeStyle = U.grid;
          ctx.beginPath(); ctx.roundRect(10 + k * (s + 5), y0 + 50, s, s, 4); ctx.fill(); ctx.stroke();
        }
        C.text(ctx, '대기 줄', 10, y0 + 98, { size: 10 });
        const fit = Math.floor((gw - 50) / 11);
        for (let k = 0; k < Math.min(queue, fit); k++) ball(ctx, [16 + k * 11, y0 + 118], '#f59e0b', 4);
        if (queue > fit) C.text(ctx, `+${queue - fit}`, gw - 10, y0 + 118, { size: 10, weight: 700, color: WAIT[1], align: 'right', base: 'middle' });
        const pw = Math.min(200, w - gw - 26), px = w - pw, p1 = { x: px, y: y0 + 6, w: pw, h: 48 }, p2 = { x: px, y: y0 + 92, w: pw, h: 48 };
        const n1 = busy.filter((r) => r.pod === 0).length, n2 = busy.filter((r) => r.pod === 1).length;
        C.arrow(ctx, [[gw + 2, y0 + 62], [px - 2, p1.y + 24]], 1, '#cbd5e1', { width: 1.2 });
        C.arrow(ctx, [[gw + 2, y0 + 62], [px - 2, p2.y + 24]], 1, cut ? '#e5e7eb' : '#cbd5e1', { width: 1.2, dash: cut ? [3, 3] : undefined });
        C.card(ctx, { ...p1, t: '결제 파드 1', s: `처리 중 ${n1}` });
        if (on) { ctx.beginPath(); ctx.roundRect(p2.x, p2.y, p2.w, p2.h, 8); ctx.fillStyle = BAD[0]; ctx.fill(); ctx.fillStyle = C.hatch(ctx, '#fecaca'); ctx.fill(); }
        C.card(ctx, { ...p2, t: '결제 파드 2', s: cut ? (n2 ? `제외, 남은 ${n2}` : '제외 30초') : on ? `503 ${failed}번, 대기 ${n2}` : `처리 중 ${n2}` }, on ? { fill: 'transparent', stroke: BAD[1], dash: [3, 3], dim: cut } : {});
        const es = '503 3번 연속, 제외', ex = Math.min(px + pw / 2, w - tw(ctx, es, 13, 700) / 2 - 16);
        if (cut && t < eject + 1.2) C.stamp(ctx, ex, p2.y - 16, es, 'info', (t - eject) / 0.3);
        if (!on) hint(ctx, '파드 2 고장 내기 버튼을 눌러 보자', w / 2, y0 + gh + 18);
        if (run >= END) C.stamp(ctx, w / 2, y0 + gh + 16, ui.mode ? '파드 2 제외, 대기 0건' : `대기 ${queue}건, 계속 늘어남`, ui.mode ? 'ok' : 'bad', (run - END) / 0.4);
        say(`${PILL[ui.mode]}. 대기 ${queue}건, 파드 2의 503 ${failed}번.`);
      },
    });
  });

  // PeerAuthentication: a meshed pod always gets in over mTLS; a pod without a sidecar sends plain text, accepted in PERMISSIVE and refused in STRICT.
  fig('istio-mtls', (root) => {
    const S = seq([5, 5, 5], 1.8);
    const PILL = [['mTLS', 'info'], ['PERMISSIVE', 'warn'], ['STRICT', 'ok']];
    const notes = [
      '사이드카가 있는 파드끼리는 인증서를 주고받는 mTLS로 연결하고, 받는 쪽이 sa/orders 신원을 확인한다.',
      'PERMISSIVE(기본값)에는 평문용 필터 체인도 있어서, 사이드카 없는 파드의 평문 요청이 앱까지 간다.',
      'STRICT에는 평문용 필터 체인이 없어서, 사이드카 없는 파드의 평문 요청이 Envoy에서 끊긴다.',
    ];
    hwa.scene(root, {
      height: 252, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, PILL[i][0], PILL[i][1]);
        if (i) C.text(ctx, 'PeerAuthentication', w, 11, { size: 10, align: 'right', base: 'middle' });
        const cw = Math.min(150, w * 0.34), gw = Math.min(190, w * 0.4), gx = w - gw, y0 = 34;
        const a = { x: 0, y: 46, w: cw, h: 46, t: '주문 파드', s: '사이드카 있음' }, b = { x: 0, y: 140, w: cw, h: 46, t: '레거시 파드', s: '사이드카 없음' };
        C.card(ctx, a, tone(BLUE));
        C.card(ctx, b, { dash: i ? undefined : [4, 3], dim: !i });
        C.group(ctx, gx, y0, gw, 172, '결제 파드', y0 + 18);
        const env = { x: gx + 10, y: y0 + 32, w: gw - 20, h: 46 }, app = { x: gx + 10, y: y0 + 116, w: gw - 20, h: 46 };
        const ok1 = t > 2.0, rej = i === 2 && t > 2.4;
        C.dashed(ctx, cw + 4, a.y + 23, env.x - 2, env.y + 16, '#cbd5e1');
        if (i) C.dashed(ctx, cw + 4, b.y + 23, env.x - 2, env.y + 34, rej ? BAD[2] : '#cbd5e1');
        C.card(ctx, { ...env, t: 'Envoy', s: ok1 ? 'sa/orders 확인' : i === 2 ? 'mTLS만 받음' : 'mTLS, 평문 받음' }, { ...tone(PROXY), lit: t > 1.8 && t < 3.0 });
        C.card(ctx, { ...app, t: '앱', s: ':8080' });
        const m1 = walk([[cw + 4, a.y + 23], [env.x - 2, env.y + 16], [env.x + env.w / 2 - 20, env.y + 30], [app.x + app.w / 2 - 20, app.y + 10]], [[0.4, 1.8], [2.0, 2.3], [2.5, 3.4]], t);
        if (m1.seg >= 0 && t < 3.6) tag(ctx, m1.seg < 1 ? 'mTLS' : 'HTTP', m1.p[0], m1.p[1], m1.seg < 1 ? OK : BLUE);
        if (i) {
          const pts = [[cw + 4, b.y + 23], [env.x - 2, env.y + 34], [env.x + env.w / 2 + 20, env.y + 30], [app.x + app.w / 2 + 20, app.y + 10]];
          if (i === 1) {
            const m2 = walk(pts, [[0.8, 2.2], [2.4, 2.7], [2.9, 3.8]], t);
            if (m2.seg >= 0 && t < 4.0) tag(ctx, '평문', m2.p[0], m2.p[1], PLAIN);
          } else {
            const m2 = walk(pts.slice(0, 2), [[0.8, 2.2]], t);
            if (m2.seg >= 0 && !rej) tag(ctx, '평문', m2.p[0], m2.p[1], PLAIN);
            if (rej) tag(ctx, '거절', pts[1][0] - 22, pts[1][1] + 6, BAD);
          }
        }
        if (i === 1) C.stamp(ctx, w / 2, 234, '평문도 통과', 'warn', (run - 5) / 0.4);
        if (i === 2) C.stamp(ctx, w / 2, 234, '평문은 Envoy에서 끊김', 'ok', (run - 5) / 0.4);
        say(`${PILL[i][0]}. ${notes[i]}`);
      },
    });
  });

  // Demo: 30 pods on 3 nodes. Sidecar adds a proxy per pod; ambient keeps a ztunnel per node and one waypoint.
  // Data: Istio 1.24 performance summary at 1000 rps (sidecar 60MB, ztunnel 12MB, waypoint 60MB).
  fig('istio-cost', (root) => {
    const N = 30, GAP = 0.2, END = 0.3 + N * GAP + 0.6, PM = 60, ZM = 12, WM = 60;
    hwa.scene(root, {
      height: 232, still: 0,
      notes: ['사이드카는 파드마다 프록시가 하나씩 붙어, 파드 수만큼 메모리가 쌓인다.', 'ambient는 노드마다 ztunnel 하나와 waypoint 하나라, 파드가 늘어도 프록시 수가 그대로다.'],
      demo: { modes: ['사이드카', 'ambient'], run: '파드 30개 띄우기' },
      frame: (ctx, w, h, time, say, ui) => {
        const run = ui.runAt === null ? -1 : time - ui.runAt, amb = ui.mode === 1;
        const pods = run < 0 ? 0 : Math.max(0, Math.min(N, Math.floor((run - 0.3) / GAP) + 1));
        const proxies = amb ? 4 : pods, mem = amb ? 3 * ZM + WM : pods * PM;
        C.pill(ctx, 0, 0, amb ? 'ambient' : '사이드카', amb ? 'ok' : 'warn');
        C.text(ctx, `프록시 ${proxies}개, ${mem >= 1000 ? `${(mem / 1000).toFixed(1)}GB` : `${mem}MB`}`, w, 11, { size: 11, weight: 700, color: !amb && pods > 10 ? U.red : U.text, align: 'right', base: 'middle' });
        const g = 8, nw = (w - 2 * g) / 3, y0 = 32, cw = (nw - 22) / 2, chh = 16;
        [0, 1, 2].forEach((nd) => {
          const x = nd * (nw + g);
          C.group(ctx, x, y0, nw, 190, `노드 ${nd + 1}`, y0 + 16);
          for (let r = 0; r < 10; r++) {
            const n = r * 3 + nd, cx = x + 8 + (r % 2) * (cw + 6), cy = y0 + 26 + Math.floor(r / 2) * (chh + 5);
            if (n >= pods) { ctx.strokeStyle = U.grid; ctx.setLineDash([3, 3]); ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, chh - 1); ctx.setLineDash([]); continue; }
            ctx.fillStyle = '#bfdbfe';
            ctx.beginPath(); ctx.roundRect(cx, cy, cw, chh, 3); ctx.fill();
            if (!amb) { ctx.fillStyle = '#8b5cf6'; ctx.beginPath(); ctx.roundRect(cx + cw - 12, cy, 12, chh, 3); ctx.fill(); }
          }
          if (amb) {
            if (nd === 0) { C.box(ctx, x + 8, y0 + 132, nw - 16, 20, { fill: '#ede9fe', stroke: '#c4b5fd', r: 4 }); C.text(ctx, 'waypoint', x + nw / 2, y0 + 142.5, { size: 10, weight: 600, color: PROXY[1], align: 'center', base: 'middle' }); }
            C.box(ctx, x + 8, y0 + 160, nw - 16, 22, { fill: L4[0], stroke: L4[2], r: 4 });
            C.text(ctx, 'ztunnel', x + nw / 2, y0 + 171.5, { size: 10, weight: 600, color: L4[1], align: 'center', base: 'middle' });
          }
        });
        if (run < 0) hint(ctx, '파드 30개 띄우기 버튼을 눌러 보자', w / 2, y0 + 110);
        if (run >= END) C.stamp(ctx, w / 2, y0 + 100, amb ? '프록시 4개, 96MB' : '프록시 30개, 1.8GB', amb ? 'ok' : 'bad', (run - END) / 0.4);
        say(`${amb ? 'ambient' : '사이드카'}. 파드 ${pods}개, 프록시 ${proxies}개, 메모리 ${mem}MB.`);
      },
    });
  });

  // Ambient: pods without sidecars, a ztunnel per node carrying HBONE between nodes; a waypoint joins only for L7.
  fig('istio-ambient', (root) => {
    const S = seq([6, 6.5], 1.8);
    const notes = [
      '파드에는 사이드카가 없다. 노드의 ztunnel이 요청을 받아 HBONE 터널로 다른 노드의 ztunnel에 넘긴다.',
      'L7 기능이 필요하면 waypoint를 붙인다. ztunnel이 waypoint를 거쳐 보내고, HTTP 규칙은 waypoint가 처리한다.',
    ];
    hwa.scene(root, {
      height: 258, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, i ? 'ztunnel과 waypoint' : 'ztunnel만', 'info');
        const nw = Math.min(220, (w - 84) / 2), y0 = 32, nh = 192, mid = w / 2;
        const N = [0, w - nw].map((x, side) => ({ x, cx: x + nw / 2, pod: { x: x + 10, y: y0 + 32, w: nw - 20, h: 46, t: side ? '파드 B' : '파드 A', s: '사이드카 없음' }, zt: { x: x + 10, y: y0 + 130, w: nw - 20, h: 46, t: 'ztunnel', s: side ? '15008 받음' : '15001 나감' } }));
        const ww = Math.min(140, w - 2 * nw - 12), wp = { x: mid - ww / 2, y: y0 + 72, w: ww, h: 46, t: 'waypoint', s: 'L7' };
        const zy = N[0].zt.y + 23, py = N[0].pod.y + 23;
        let pts, times;
        if (i === 0) { pts = [[N[0].cx, py], [N[0].cx, zy], [N[1].cx, zy], [N[1].cx, py]]; times = [[0.3, 1.3], [1.7, 3.4], [3.8, 4.8]]; }
        else { pts = [[N[0].cx, py], [N[0].cx, zy], [mid, wp.y + 23], [N[1].cx, zy], [N[1].cx, py]]; times = [[0.3, 1.3], [1.7, 2.7], [3.3, 4.3], [4.7, 5.7]]; }
        const m = walk(pts, times, t), seg = m.seg, last = times.length - 1;
        if (i === 1) [[pts[1], pts[2]], [pts[2], pts[3]]].forEach(([a, b]) => C.dashed(ctx, a[0], a[1], b[0], b[1], '#94a3b8'));
        N.forEach((n, side) => {
          C.group(ctx, n.x, y0, nw, nh, `노드 ${side + 1}`, y0 + 18);
          C.card(ctx, n.pod, { lit: (side === 0 && seg === 0 && t < 1.4) || (side === 1 && seg === last && t > times[last][1] - 0.2) });
          const near = side ? seg === last - 1 && t > times[last - 1][1] - 0.3 : seg === 0 && t > times[0][1] - 0.2 && t < times[1][0] + 0.4;
          C.card(ctx, n.zt, { ...tone(L4), lit: near });
        });
        if (i === 1) C.card(ctx, wp, { ...tone(PROXY), lit: seg === 1 && t > times[1][1] - 0.2 && t < times[2][0] + 0.3 });
        else C.dashed(ctx, N[0].x + nw, zy, N[1].x, zy, '#94a3b8');
        if (seg >= 0 && t < times[last][1] + 0.3) {
          const tunnel = seg >= 1 && seg < last;
          tag(ctx, tunnel ? 'HBONE' : 'HTTP', m.p[0], m.p[1], tunnel ? OK : BLUE);
        }
        C.stamp(ctx, mid, y0 + nh + 18, i ? 'L7은 waypoint에서' : '파드 재시작 없이 mTLS', i ? 'info' : 'ok', (run - (i ? 6.5 : 6)) / 0.4);
        say(notes[i]);
      },
    });
  });
})();
