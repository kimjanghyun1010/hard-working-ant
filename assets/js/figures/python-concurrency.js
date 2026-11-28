// Python concurrency post: GIL, I/O waits, asyncio event loop, FastAPI thread pool, workers and CPU request.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const FILL = { cpu: U.blue, cpu2: '#8b5cf6', db: '#64748b', heavy: '#f59e0b', gil: '#14b8a6', s1: '#3b82f6', s2: '#8b5cf6', s3: '#14b8a6', s4: '#f59e0b' };
  const ARC = { wait: '#94a3b8', idle: '#cbd5e1', late: U.red };
  const WAIT = ['#fef3c7', '#b45309', '#f59e0b'], BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], OK = ['#dcfce7', '#15803d', '#86efac'];
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  // Chip centred at (x, y). col = [bg, fg, line].
  const tag = (ctx, s, x, y, col, a = 1, size = 10) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, size, 600) + 14;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x - cw / 2, y - 9, cw, 18, 5);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x, y + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  const dbl = (ctx, x0, x1, y, color) => {
    if (x1 - x0 < 6) return;
    C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
    [[x0, 1], [x1, -1]].forEach(([x, d]) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    });
  };
  // Timeline lanes: segs are blocks [lane, from, to, kind, label], arcs are waits drawn as double arrows.
  const LH = 44;
  const tl = (name, scenes, { SEC = 7, HOLD = 1.8, demo } = {}) => document.querySelectorAll(`[data-figure="${name}"]`).forEach((root) => {
    const maxL = Math.max(...scenes.map((s) => s.lanes.length)), n = scenes.length;
    hwa.scene(root, {
      height: 44 + maxL * LH + 30, still: (n - 1) * (SEC + HOLD) + SEC,
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
        if (s.value) { const [v, tone] = s.value(t); C.chip(ctx, v, w, 11, tone); }
        const lw = Math.min(72, w * 0.2), x0 = lw, x1 = w - 8, top = 40, base = top + s.lanes.length * LH + 4;
        const X = (v) => x0 + (Math.max(0, Math.min(v, s.span)) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
        s.lanes.forEach((nm, j) => C.text(ctx, nm, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
        C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
        C.text(ctx, '시간', x1, base - 6, { size: 9, align: 'right' });
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
        if (demo && run < 0) C.text(ctx, `${demo.run} 버튼을 눌러 보자`, (x0 + x1) / 2, top + (base - top) / 2, { size: 12, align: 'center', base: 'middle' });
        say(`${s.pill}. ${s.say || ''}`);
      },
    });
  });

  // GIL: four compute threads on a 4-vCPU server; the GIL passes between them and only its holder runs.
  document.querySelectorAll('[data-figure="python-concurrency-gil"]').forEach((root) => {
    const STEP = 1.3, N = 8, HOLD = 2.4, RUN = STEP * N, JOBS = ['A', 'B', 'C', 'D'], CPU_OF = [0, 2, 3, 1];
    const note = 'GIL을 쥔 스레드 하나만 실행한다. vCPU는 넷이어도 한 번에 하나만 쓴다.';
    hwa.scene(root, {
      height: 262, still: RUN + 1, notes: [note],
      frame: (ctx, w, h, time, say) => {
        const u = time % (RUN + HOLD), step = Math.min(N - 1, Math.floor(u / STEP)), f = u >= RUN ? 1 : (u - step * STEP) / STEP;
        const cur = step % 4, prev = (step + 3) % 4, move = hwa.smooth(f / 0.3);
        const gw = Math.round(w * 0.5) - 14, rx = gw + 36, rw = w - rx, top = 36, ch = 36, rowY = (j) => top + 30 + j * 46;
        C.pill(ctx, 0, 0, `GIL: 스레드 ${JOBS[cur]}`, 'info');
        C.text(ctx, 'vCPU 사용 1 / 4', w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        C.group(ctx, 0, top, gw, 218, 'Python 프로세스', top + 18);
        C.group(ctx, rx, top, rw, 218, 'vCPU 4개', top + 18);
        const on = move >= 1;
        JOBS.forEach((s, j) => {
          const me = j === cur && on;
          C.card(ctx, { x: 10, y: rowY(j), w: gw - 20, h: ch, t: `스레드 ${s}`, s: me ? '실행' : 'GIL 대기' }, { lit: me, dim: !me, fill: me ? BLUE[0] : '#fff' });
        });
        [0, 1, 2, 3].forEach((v) => {
          const busy = on && CPU_OF[cur] === v;
          C.box(ctx, rx + 10, rowY(v), rw - 20, ch, { fill: busy ? BLUE[0] : '#fff', stroke: busy ? U.blue : U.grid });
          C.text(ctx, busy ? `스레드 ${JOBS[cur]}` : '비어 있음', rx + rw / 2, rowY(v) + ch / 2 + 0.5, { size: 10, weight: busy ? 700 : 400, color: busy ? BLUE[1] : '#9ca3af', align: 'center', base: 'middle' });
        });
        const from = [gw - 10, rowY(cur) + ch / 2], to = [rx + 10, rowY(CPU_OF[cur]) + ch / 2];
        C.arrow(ctx, [from, to], ease(f, 0.3, 0.5), U.blue);
        const gy = rowY(prev) + (rowY(cur) - rowY(prev)) * move + ch / 2;
        tag(ctx, 'GIL', gw - 32, gy, ['#ccfbf1', '#0f766e', '#2dd4bf']);
        if (u >= RUN) C.stamp(ctx, w / 2, top + 118, '한 번에 vCPU 1개', 'warn', (u - RUN) / 0.4);
        say(`GIL은 스레드 ${JOBS[cur]}에게 있다. ${note}`);
      },
    });
  });

  // Demo: four 100ms computations as threads (one GIL, taking turns) or as processes (one GIL each).
  {
    const ABCD = ['A', 'B', 'C', 'D'], lanes = ['vCPU 1', 'vCPU 2', 'vCPU 3', 'vCPU 4'];
    const ticks = [[100, '100ms'], [200, '200ms'], [300, '300ms'], [400, '400ms']], legend = ABCD.map((s, j) => [`s${j + 1}`, s]);
    // Turns drawn as 20ms slices; CPython's switch interval is 5ms.
    const turns = Array.from({ length: 20 }, (_, i) => [i % 4, i * 20, i * 20 + 20, `s${(i % 4) + 1}`, '']);
    tl('python-concurrency-workers', [
      { pill: '스레드 4개', tone: 'bad', span: 400, lanes, ticks, legend, segs: turns, stamp: ['400ms에 끝남', 'bad'], say: '스레드 4개는 GIL을 번갈아 쥐어 vCPU가 한 번에 하나만 찬다. 일 400ms어치를 400ms에 끝낸다.' },
      { pill: '프로세스 4개', tone: 'ok', span: 400, lanes, ticks, legend, segs: ABCD.map((s, j) => [j, 0, 100, `s${j + 1}`, s]), stamp: ['100ms에 끝남', 'ok'], say: '프로세스마다 GIL이 따로 있어 vCPU 4개가 동시에 돌고 100ms에 끝난다.' },
    ], { demo: { modes: ['스레드 4개', '프로세스 4개'], run: '계산 4개 보내기' } });
  }

  // Four requests of 5ms CPU, 80ms DB wait, 5ms CPU: one thread in series, four threads overlapping the waits.
  {
    const lanes = ['요청 A', '요청 B', '요청 C', '요청 D', 'GIL'], ticks = [[100, '100ms'], [200, '200ms'], [300, '300ms']];
    const req = (starts, queued) => {
      const segs = [], arcs = [];
      starts.forEach((s, j) => {
        segs.push([j, s, s + 5, 'cpu', ''], [j, s + 85, s + 90, 'cpu', ''], [4, s, s + 5, 'gil', ''], [4, s + 85, s + 90, 'gil', '']);
        arcs.push([j, s + 5, s + 85, 'wait', 'DB 대기']);
        if (queued && s) arcs.push([j, 0, s, 'late', '앞 요청 대기']);
      });
      return { segs, arcs };
    };
    const legend = [['cpu', '계산, GIL 쥠'], ['wait', 'DB 대기, GIL 놓음']];
    tl('python-concurrency-io', [
      { pill: '스레드 1개', tone: 'bad', span: 360, lanes, ticks, legend, ...req([0, 90, 180, 270], true), stamp: ['360ms에 끝남', 'bad'], say: '스레드 하나는 요청을 차례로 처리해 360ms가 걸린다. GIL 줄은 거의 비어 있다.' },
      { pill: '스레드 4개', tone: 'ok', span: 360, lanes, ticks, legend, ...req([0, 5, 10, 15], false), stamp: ['105ms에 끝남', 'ok'], say: 'DB를 기다리는 동안 GIL을 놓아서 스레드 4개가 대기를 겹친다. 105ms에 끝난다.' },
    ]);
  }

  // Three calls of 3, 2 and 1 seconds: one after another, then awaited together on the event loop.
  tl('python-concurrency-loop', [
    { pill: '차례로 호출', tone: 'bad', span: 6.4, lanes: ['호출 A', '호출 B', '호출 C', '스레드'], ticks: [1, 2, 3, 4, 5, 6].map((v) => [v, `${v}초`]),
      segs: [[3, 0, 3, 'heavy', 'A 대기'], [3, 3, 5, 'heavy', 'B 대기'], [3, 5, 6, 'heavy', 'C']],
      arcs: [[0, 0, 3, 'wait', '3초 대기'], [1, 3, 5, 'wait', '2초'], [2, 5, 6, 'wait', ''], [1, 0, 3, 'late', '차례 대기'], [2, 0, 5, 'late', '차례 대기']],
      stamp: ['6초 걸림', 'bad'], say: '하나가 끝나야 다음을 불러 대기가 이어 붙고 6초가 걸린다. 스레드는 그동안 묶여 있다.' },
    { pill: 'await로 함께 대기', tone: 'ok', span: 6.4, lanes: ['호출 A', '호출 B', '호출 C', '스레드'], ticks: [1, 2, 3, 4, 5, 6].map((v) => [v, `${v}초`]),
      segs: [0, 1, 2, 3].map((v) => [3, v, v + 0.08, 'cpu', '']),
      arcs: [[0, 0, 3, 'wait', '3초 대기'], [1, 0, 2, 'wait', '2초 대기'], [2, 0, 1, 'wait', '1초'], [3, 0.1, 3, 'idle', '다른 일 가능']],
      stamp: ['3초에 끝남', 'ok'], say: '세 호출을 함께 기다려 가장 긴 3초에 끝난다. 스레드는 결과가 올 때만 잠깐 돈다.' },
  ], { SEC: 6 });

  // Demo: handler A waits 200ms on the DB; B arrives at 10ms. A sync call holds the loop, await frees it.
  tl('python-concurrency-blocking', [
    { pill: '동기 호출', tone: 'bad', span: 240, lanes: ['이벤트 루프', 'DB', '요청 B'], ticks: [[100, '100ms'], [200, '200ms']], legend: [['cpu', 'A'], ['cpu2', 'B']],
      segs: [[0, 0, 4, 'cpu', ''], [0, 4, 204, 'heavy', 'A 동기 DB 호출'], [0, 204, 208, 'cpu2', ''], [1, 6, 200, 'db', 'A 쿼리']],
      arcs: [[2, 10, 204, 'late', 'B 밀린 시간']], event: [10, 'B 도착'], stamp: ['B 194ms 밀림', 'bad'],
      say: 'A가 동기 호출로 DB를 기다리는 200ms 동안 루프가 멈춰, 10ms에 온 B가 194ms를 기다린다.' },
    { pill: 'await', tone: 'ok', span: 240, lanes: ['이벤트 루프', 'DB', '요청 B'], ticks: [[100, '100ms'], [200, '200ms']], legend: [['cpu', 'A'], ['cpu2', 'B']],
      segs: [[0, 0, 4, 'cpu', ''], [0, 10, 14, 'cpu2', ''], [0, 204, 208, 'cpu', ''], [1, 6, 200, 'db', 'A 쿼리']],
      arcs: [[0, 14, 204, 'idle', '다른 요청 받을 수 있음']], event: [10, 'B 도착'], stamp: ['B 바로 처리', 'ok'],
      say: 'await하면 루프가 A를 내려놓고 B를 바로 처리한다. DB가 쿼리에 쓰는 시간은 같다.' },
  ], { demo: { modes: ['동기 호출', 'await'], run: '요청 A 보내기' } });

  // FastAPI: where request A runs for async def + await, def (thread pool) and async def with a blocking call.
  document.querySelectorAll('[data-figure="python-concurrency-fastapi"]').forEach((root) => {
    const SEC = 6, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3);
    const SC = [
      { pill: 'async def + await', tone: 'ok', stamp: ['B, C 바로 처리', 'ok'], note: 'async def에서 await하면 A는 루프를 비켜 주고, 루프는 B와 C를 바로 처리한다.' },
      { pill: 'def', tone: 'ok', stamp: ['스레드 풀이 대신 대기', 'ok'], note: 'def는 스레드 풀에서 돈다. A가 동기 호출로 기다려도 루프는 비어 있다.' },
      { pill: 'async def + 동기 호출', tone: 'bad', stamp: ['B, C 줄 섬', 'bad'], note: 'async def 안에서 동기 호출을 하면 A가 루프를 붙잡아 B와 C가 줄을 선다.' },
    ];
    hwa.scene(root, {
      height: 290, still: S.at(2) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), run = (time % ((SEC + HOLD) * 3)) - S.at(i), sc = SC[i];
        const top = 34, H = 236, qw = 50, px = qw + 10, dbw = 44, dbx = w - dbw, pw = dbx - 10 - px;
        const L = { x: px + 10, y: top + 28, w: pw - 20, h: 50 }, P = { x: px + 10, y: top + 96, w: pw - 20, h: 128 };
        const blocked = i === 2 && t >= 1.0 && t < 5.2;
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        C.group(ctx, 0, top, qw, H, '요청', top + 18);
        C.group(ctx, px, top, pw, H, 'Uvicorn 프로세스', top + 18);
        C.box(ctx, dbx, top, dbw, H, { fill: U.plot, r: 10 });
        C.text(ctx, 'DB', dbx + dbw / 2, top + H / 2, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
        C.box(ctx, L.x, L.y, L.w, L.h, { fill: blocked ? '#fef2f2' : '#fff', stroke: blocked ? U.red : U.grid });
        C.text(ctx, '이벤트 루프', L.x + 8, L.y + 14, { size: 10, weight: 600, color: U.text });
        if (blocked) C.text(ctx, 'A가 붙잡음', L.x + L.w - 8, L.y + 14, { size: 10, weight: 700, color: U.red, align: 'right' });
        C.box(ctx, P.x, P.y, P.w, P.h, { fill: '#fff' });
        C.text(ctx, w >= 420 ? '스레드 풀 (기본 40개)' : '스레드 풀 40개', P.x + 8, P.y + 14, { size: 10, weight: 600, color: U.text });
        const cs = Math.min(14, (P.w - 16 - 27) / 10), gx = P.x + (P.w - (cs * 10 + 27)) / 2, cell = (c) => [gx + (c % 10) * (cs + 3), P.y + 26 + Math.floor(c / 10) * (cs + 3)];
        const inPool = i === 1 && t >= 1.8 && t < 4.8;
        for (let c = 0; c < 40; c++) {
          const [x, y] = cell(c);
          ctx.fillStyle = c === 0 && inPool ? U.blue : U.cell;
          ctx.beginPath(); ctx.roundRect(x, y, cs, cs, 2); ctx.fill();
        }
        // Request A: in to the loop, then parked (await), into the pool (def), or held in the loop (blocking).
        const home = [qw / 2, top + 46], loopC = [L.x + L.w / 2, L.y + 34], park = [L.x + L.w - 30, L.y + 34], [cx0, cy0] = cell(0), poolC = [cx0 + cs / 2, cy0 + cs / 2];
        let a = mix(home, loopC, ease(t, 0.2, 1.0)), aCol = BLUE, aLabel = 'A';
        if (i === 0 && t >= 1.0) { a = t < 4.8 ? mix(loopC, park, ease(t, 1.0, 1.6)) : mix(park, home, ease(t, 4.8, 5.6)); aLabel = t >= 1.6 && t < 4.8 ? 'A await' : 'A'; }
        if (i === 1 && t >= 1.0) a = t < 4.8 ? mix(loopC, poolC, ease(t, 1.0, 1.8)) : mix(poolC, home, ease(t, 4.8, 5.6));
        if (i === 2 && t >= 5.2) a = mix(loopC, home, ease(t, 5.2, 5.9));
        if (i === 2 && blocked) aCol = ['#fee2e2', U.red, '#fca5a5'];
        const back = (i < 2 && t >= 5.2) || (i === 2 && t >= 5.9);
        tag(ctx, aLabel, a[0], a[1], back ? OK : aCol, back ? 1 - ease(t, 5.6, 6) : 1);
        // The query: from the loop (await, blocking) or from the pool thread (def) to the DB and back.
        const src = i === 1 ? poolC : i === 0 ? park : loopC;
        if (t >= 1.8 && t < 4.6) {
          C.dashed(ctx, src[0] + 14, src[1], dbx, src[1], '#cbd5e1');
          const out = ease(t, 1.8, 2.6), ret = ease(t, 3.8, 4.6), p = t < 3.8 ? mix(src, [dbx + 8, src[1]], out) : mix([dbx + 8, src[1]], src, ret);
          ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fillStyle = U.slate; ctx.fill();
        }
        // B and C: pass through a free loop, or queue up while A holds it.
        [['B', 1.8, top + 74], ['C', 2.6, top + 102]].forEach(([s, at, qy]) => {
          if (t < at) return;
          const q = [qw / 2, qy];
          if (i === 2) { const wait = t >= at + 0.6; tag(ctx, s, ...q, wait ? WAIT : BLUE); return; }
          const inK = ease(t, at + 0.2, at + 0.7), outK = ease(t, at + 1.1, at + 1.6), p = t < at + 1.1 ? mix(q, [loopC[0] - 26, loopC[1]], inK) : mix([loopC[0] - 26, loopC[1]], q, outK);
          tag(ctx, s, ...p, t >= at + 1.1 ? OK : BLUE, t >= at + 1.6 ? 1 - ease(t, at + 1.8, at + 2.2) : 1);
        });
        if (run >= SEC) C.stamp(ctx, px + pw / 2, top + H - 24, sc.stamp[0], sc.stamp[1], (run - SEC) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    });
  });

  // Worker processes against CPU request: idle reserve, workers sharing one vCPU, one worker per pod.
  document.querySelectorAll('[data-figure="python-concurrency-pods"]').forEach((root) => {
    const SEC = 5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3), one = { req: 1, procs: [1] };
    const SC = [
      { pill: '워커 1개, request 4', tone: 'warn', pods: [{ req: 4, procs: [1] }], stamp: ['3 vCPU 놀림', 'warn'], note: '워커 하나는 GIL 때문에 vCPU 하나까지만 쓴다. request 4 중 3은 예약만 하고 논다.' },
      { pill: '워커 4개, request 1, limit 1', tone: 'bad', pods: [{ req: 1, procs: [0.25, 0.25, 0.25, 0.25] }], stamp: ['워커마다 0.25', 'bad'], note: '워커 4개가 vCPU 하나를 나눠 각자 0.25만 쓴다. 나머지 시간은 차례를 기다린다.' },
      { pill: '파드 4개, 워커 1개씩', tone: 'ok', pods: [one, one, one, one], stamp: ['워커마다 vCPU 1', 'ok'], note: '파드마다 워커 하나와 request 1을 두면 프로세스마다 vCPU 하나를 받는다.' },
    ];
    // One cell is one vCPU: a process row can fill at most one (GIL), the request row has req cells.
    const pod = (ctx, x, y, pw, p, g, idle) => {
      const ph = 34 + p.procs.length * 24 + 30, bx = x + 64, cw = Math.min(30, (pw - 64 - 10 - 9) / 4);
      const cellAt = (cx, cy, f, fill, hatch) => {
        ctx.fillStyle = hatch ? C.hatch(ctx, '#fcd34d') : '#fff';
        ctx.fillRect(cx, cy, cw, 14);
        ctx.strokeStyle = U.grid; ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, 13);
        ctx.fillStyle = fill; ctx.fillRect(cx, cy, cw * f, 14);
      };
      C.box(ctx, x, y, pw, ph, { fill: U.plot, r: 10 });
      C.text(ctx, '파드', x + 10, y + 18, { weight: 600 });
      p.procs.forEach((v, j) => {
        const ry = y + 30 + j * 24;
        C.text(ctx, '프로세스', x + 10, ry + 8, { size: 10, base: 'middle' });
        cellAt(bx, ry + 1, v * g, v < 1 ? WAIT[2] : U.blue, false);
        C.text(ctx, (v * g).toFixed(2), bx + cw + 8, ry + 8, { size: 10, weight: 600, color: v < 1 ? WAIT[1] : BLUE[1], base: 'middle' });
      });
      const sy = y + 34 + p.procs.length * 24, used = p.procs.reduce((a, b) => a + b, 0) * g;
      C.text(ctx, 'request', x + 10, sy + 8, { size: 10, base: 'middle' });
      for (let c = 0; c < p.req; c++) {
        const f = Math.max(0, Math.min(1, used - c));
        cellAt(bx + c * (cw + 3), sy + 1, f, U.blue, idle && f === 0);
      }
      return ph;
    };
    hwa.scene(root, {
      height: 262, still: S.at(2) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), run = (time % ((SEC + HOLD) * 3)) - S.at(i), sc = SC[i], g = ease(t, 0.3, 1.8);
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        C.text(ctx, '칸 하나 = vCPU 1', w, 11, { size: 10, align: 'right', base: 'middle' });
        let bottom = h - 50;
        if (sc.pods.length === 1) {
          const pw = Math.min(w, 300);
          bottom = 40 + pod(ctx, (w - pw) / 2, 40, pw, sc.pods[0], g, i === 0 && g >= 1);
        } else {
          const row = w >= 600, pw = row ? (w - 30) / 4 : (w - 10) / 2;
          sc.pods.forEach((p, j) => pod(ctx, row ? j * (pw + 10) : (j % 2) * (pw + 10), 40 + (row ? 0 : Math.floor(j / 2) * 98), pw, p, g, false));
        }
        if (run >= SEC) C.stamp(ctx, w / 2, Math.min(h - 22, bottom + 30), sc.stamp[0], sc.stamp[1], (run - SEC) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    });
  });
})();
