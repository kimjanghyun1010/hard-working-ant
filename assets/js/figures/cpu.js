(() => {
  const U = hwa.ui, C = hwa.cv;
  const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const bump = (m, a, b, c, d) => hwa.smooth((m - a) / (b - a)) * (1 - hwa.smooth((m - c) / (d - c)));
  // Slow sum of sines in [-1, 1]: metric-like wobble without per-point jitter.
  const wobble = (seed) => { const r = rng(seed), p = [r(), r(), r()].map((x) => x * 6.283); return (m) => 0.5 * Math.sin(m * 0.9 + p[0]) + 0.3 * Math.sin(m * 2.3 + p[1]) + 0.2 * Math.sin(m * 5.3 + p[2]); };
  const dashedLine = (ctx, pts) => { ctx.save(); ctx.setLineDash([4, 4]); C.line(ctx, pts, '#9ca3af', 1); ctx.restore(); };
  // Data: kubelet MilliCPUToShares (milli * 1024 / 1000, min 2).
  const toShares = (milli) => Math.max(2, Math.floor(milli * 1024 / 1000));

  // One setting travelling down the layers: k8s value, cgroup file, kernel time slice, vCPU, hardware.
  document.querySelectorAll('[data-figure="cpu-layers"]').forEach((root) => {
    const rows = [
      { name: '쿠버네티스', unit: 'CPU 단위', value: 'cpu: 500m' },
      { name: '컨테이너 (cgroup)', unit: 'cpu.weight, cpu.max', value: 'cpu.max = 50000 100000' },
      { name: '리눅스 커널', unit: '논리 CPU', value: '100ms마다 50ms만 실행' },
      { name: '클라우드 VM', unit: 'vCPU (노드가 VM일 때)', value: 'vCPU 하나의 절반', optional: true },
      { name: '하드웨어', unit: '소켓, 코어, 하드웨어 스레드', value: '실제로 명령 실행' },
    ];
    const RH = 48, GAP = 18, STEP = 1.1, HOLD = 2.2, RUN = rows.length * STEP;
    hwa.scene(root, {
      height: rows.length * (RH + GAP) - GAP + 2,
      still: RUN,
      frame: (ctx, w, h, time, say) => {
        const t = time % (RUN + HOLD), pos = Math.min(t / STEP, rows.length), active = Math.min(rows.length - 1, Math.floor(pos));
        const narrow = w < 520;
        rows.forEach((r, i) => {
          const y = 1 + i * (RH + GAP), on = i === active && t < RUN;
          ctx.beginPath();
          ctx.roundRect(0.5, y + 0.5, w - 1, RH, 10);
          ctx.fillStyle = on ? '#eef2ff' : '#fff';
          ctx.fill();
          ctx.strokeStyle = on ? '#a5b4fc' : U.grid;
          ctx.lineWidth = 1;
          ctx.setLineDash(r.optional ? [4, 3] : []);
          ctx.stroke();
          ctx.setLineDash([]);
          C.text(ctx, r.name, 16, y + 20, { size: 13, weight: 600, color: U.text });
          if (!narrow) C.text(ctx, r.unit, 16, y + 37, { size: 11 });
          if (i < rows.length - 1) {
            const lit = pos > i + 0.7 ? hwa.smooth((pos - i - 0.7) / 0.3) : 0;
            ctx.fillStyle = lit ? '#6366f1' : '#cbd5e1';
            ctx.fillRect(30, y + RH + 3, 1.5, GAP - 6);
            if (lit > 0 && lit < 1) { ctx.beginPath(); ctx.arc(30.75, y + RH + 3 + lit * (GAP - 6), 3, 0, Math.PI * 2); ctx.fill(); }
          }
          if (pos < i) return;
          const k = i < active || t >= RUN ? 1 : hwa.smooth((pos - i) / 0.35);
          ctx.font = hwa.ui.font(narrow ? 11 : 12, 600);
          const cw = ctx.measureText(r.value).width + 20, cx = w - 14 - cw, cy = narrow ? y + 26 : y + RH / 2 - 12;
          ctx.globalAlpha = k;
          ctx.beginPath();
          ctx.roundRect(cx + (1 - k) * 12, cy, cw, narrow ? 18 : 24, 6);
          ctx.fillStyle = '#eef2ff';
          ctx.fill();
          C.text(ctx, r.value, cx + 10 + (1 - k) * 12, cy + (narrow ? 9 : 12), { size: narrow ? 11 : 12, weight: 600, color: '#4338ca', base: 'middle' });
          ctx.globalAlpha = 1;
        });
        say('쿠버네티스의 cpu 500m이 cgroup의 cpu.max 50000 100000이 되고, 커널은 100ms마다 50ms만 실행시킨다.');
      },
    });
  });

  // One real CPU shared by two VMs: when the other VM gets busy, my VM has to wait its turn (steal).
  document.querySelectorAll('[data-figure="cpu-steal"]').forEach((root) => {
    const WIN = 60, SEC = 4.5, HOLD = 1.2, PHASE = SEC + HOLD, MINE = U.blue, THEIRS = '#f59e0b';
    const cycle = (mine, theirs) => {
      const segs = [];
      for (let s = 0; s < WIN; s += mine + theirs) {
        segs.push({ s, e: Math.min(WIN, s + mine), me: true });
        if (theirs) segs.push({ s: s + mine, e: Math.min(WIN, s + mine + theirs), me: false });
      }
      return segs;
    };
    const phases = [
      { pill: '옆 VM이 쉬는 중', tone: 'ok', busy: false, segs: cycle(WIN, 0), note: '옆 VM이 쉬고 있으면 실제 CPU를 내 VM이 혼자 쓴다. 기다릴 일이 없다.' },
      { pill: '옆 VM도 바쁨', tone: 'bad', busy: true, segs: cycle(6, 3), note: '옆 VM도 CPU를 쓰기 시작하면 실제 CPU를 번갈아 쓴다. 내 VM이 차례를 기다린 시간이 steal이다.' },
    ];
    const card = (ctx, x, y, cw, title, color, status, tone, lit) => {
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, cw, 58, 10);
      ctx.fillStyle = lit ? (color === MINE ? '#eff6ff' : '#fffbeb') : '#fff';
      ctx.fill();
      ctx.strokeStyle = lit ? color : U.grid;
      ctx.lineWidth = lit ? 1.5 : 1;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(x + 12, y + 14, 10, 10);
      C.text(ctx, title, x + 28, y + 19, { size: 13, weight: 600, color: U.text, base: 'middle' });
      C.text(ctx, 'vCPU 1개', x + 28 + 52, y + 19, { size: 10, base: 'middle' });
      const [bg, fg] = U.tones[tone];
      ctx.font = hwa.ui.font(11, 600);
      const sw = ctx.measureText(status).width + 16;
      ctx.beginPath();
      ctx.roundRect(x + 12, y + 32, sw, 18, 9);
      ctx.fillStyle = bg;
      ctx.fill();
      C.text(ctx, status, x + 20, y + 41.5, { weight: 600, color: fg, base: 'middle' });
    };
    hwa.scene(root, {
      height: 300,
      still: PHASE + SEC,
      frame: (ctx, w, h, time, say) => {
        const loop = time % (PHASE * phases.length), i = Math.floor(loop / PHASE), p = phases[i];
        const cur = Math.min((loop - i * PHASE) / SEC, 1) * WIN;
        const now = p.segs.find((g) => cur >= g.s && cur < g.e) || p.segs[p.segs.length - 1], meNow = now.me;
        C.pill(ctx, 0, 0, p.pill, p.tone);
        C.text(ctx, '실제 CPU 1개를 VM 두 대가 나눠 씀', w, 11, { size: 10, align: 'right', base: 'middle' });
        const cw = Math.min(220, w * 0.38), bx = w - cw, by = 66;
        card(ctx, 0, 40, cw, '내 VM', MINE, meNow ? '실행 중' : '기다리는 중', meNow ? 'ok' : 'bad', meNow);
        card(ctx, 0, 112, cw, '옆 VM', THEIRS, p.busy ? (meNow ? '기다리는 중' : '실행 중') : '쉬는 중', p.busy && !meNow ? 'ok' : 'info', !meNow);
        ctx.beginPath();
        ctx.roundRect(bx + 0.5, by + 0.5, cw - 1, 72, 10);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = meNow ? MINE : THEIRS;
        ctx.lineWidth = 2;
        ctx.stroke();
        C.text(ctx, '실제 CPU', bx + 14, by + 22, { size: 13, weight: 600, color: U.text, base: 'middle' });
        C.text(ctx, meNow ? '내 VM이 쓰는 중' : '옆 VM이 쓰는 중', bx + 14, by + 48, { size: 13, weight: 600, color: meNow ? MINE : '#b45309', base: 'middle' });
        [[69, MINE, meNow], [141, THEIRS, !meNow]].forEach(([y, color, on]) => {
          ctx.beginPath();
          ctx.moveTo(cw + 4, y);
          ctx.bezierCurveTo((cw + bx) / 2, y, (cw + bx) / 2, by + 36, bx - 4, by + 36);
          ctx.strokeStyle = on ? color : '#e5e7eb';
          ctx.lineWidth = on ? 2.5 : 1.5;
          ctx.stroke();
        });
        const x0 = 0, x1 = w, ly = 206, X = (t) => x0 + t / WIN * (x1 - x0);
        C.text(ctx, '실제 CPU를 쓴 VM (최근 60ms)', 0, ly - 8, { weight: 600, color: U.text });
        ctx.fillStyle = U.cell;
        ctx.fillRect(x0, ly, x1 - x0, 22);
        let waited = 0;
        p.segs.forEach((g) => {
          if (g.s >= cur) return;
          const e = Math.min(g.e, cur);
          if (!g.me) waited += e - g.s;
          ctx.fillStyle = g.me ? MINE : THEIRS;
          ctx.fillRect(X(g.s), ly, X(e) - X(g.s) - (g.e <= cur ? 1 : 0), 22);
        });
        C.dashed(ctx, X(cur), ly - 4, X(cur), ly + 26);
        C.text(ctx, `내 VM이 기다린 시간 (steal) ${cur ? Math.round(waited / cur * 100) : 0}%`, 0, ly + 46, { size: 12, weight: 600, color: U.text, base: 'middle' });
        C.wrap(ctx, p.note, w / 2, ly + 78, w - 20, { color: U.tones[p.tone][1] });
        say(p.note);
      },
    });
  });

  // Bursty web traffic with no limit vs limit 0.5: the average stays at 0.25, but bursts get cut and stretched.
  document.querySelectorAll('[data-figure="cpu-burst"]').forEach((root) => {
    const DT = 0.05, SPAN = 30, LIMIT = 0.5, SEC = 5, HOLD = 1.4, PHASE = SEC + HOLD, n = Math.round(SPAN / DT) + 1;
    const demand = Array.from({ length: n }, (_, k) => {
      const t = k * DT;
      return [3, 9, 15, 21, 27].reduce((d, c) => d + 0.75 * hwa.smooth((0.45 - Math.abs(t - c)) / 0.1), 0.15);
    });
    // Work is conserved: what the limit can't serve now waits and is served later, which is what stretches the latency.
    const simulate = (limit) => {
      let backlog = 0;
      const use = [], lat = [];
      demand.forEach((d) => {
        backlog += d * DT;
        const served = Math.min(backlog, limit * DT);
        backlog -= served;
        use.push(served / DT);
        lat.push(80 + 40 * (d - 0.15) / 0.75 + 1400 * backlog);
      });
      return { use, lat };
    };
    const phases = [
      { pill: 'limit 없음', tone: 'ok', limit: false, ...simulate(Infinity), note: '요청이 몰리는 순간 CPU를 잠깐 많이 쓰고 바로 끝난다. 응답 시간도 거의 그대로다.' },
      { pill: 'limit 0.5', tone: 'bad', limit: true, ...simulate(LIMIT), note: '평균은 0.25로 limit보다 낮은데도, 몰리는 순간이 0.5에서 잘려 길게 늘어지고 그만큼 응답이 느려진다.' },
    ];
    hwa.scene(root, {
      height: 306,
      still: PHASE + SEC,
      frame: (ctx, w, h, time, say) => {
        const loop = time % (PHASE * phases.length), i = Math.floor(loop / PHASE), p = phases[i];
        const pos = Math.min((loop - i * PHASE) / SEC, 1) * (n - 1), last = Math.floor(pos);
        const x0 = 36, x1 = w - 64, X = (k) => x0 + k / (n - 1) * (x1 - x0);
        C.pill(ctx, 0, 0, p.pill, p.tone);
        C.text(ctx, '평균 사용량은 둘 다 0.25 CPU', w, 11, { size: 10, align: 'right', base: 'middle' });
        const draw = (y, title, right, max, ticks, data, color, fill, label) => {
          const Y = C.panel(ctx, x0, y, x1 - x0, 76, { title, right, max, ticks }), pts = [];
          for (let k = 0; k <= last; k++) pts.push([X(k), Y(data[k])]);
          C.area(ctx, pts, y + 76, fill);
          C.line(ctx, pts, color);
          C.dot(ctx, X(last), Y(data[last]), color, label(data[last]));
          return Y;
        };
        const Y = draw(52, 'CPU 사용량', 'CPU', 1, [[0, '0'], [0.5, '0.5'], [1, '1']], p.use, U.blue, 'rgba(59,130,246,0.14)', (v) => v.toFixed(2));
        if (p.limit) {
          dashedLine(ctx, [[x0, Y(LIMIT)], [x1, Y(LIMIT)]]);
          C.text(ctx, 'limit', x1 - 4, Y(LIMIT) - 6, { size: 10, align: 'right' });
        }
        draw(170, 'P99 응답 시간', '(ms)', 700, [[0, '0'], [300, '300'], [600, '600']], p.lat, U.purple, 'rgba(139,92,246,0.12)', (v) => `${Math.round(v)}ms`);
        C.dashed(ctx, X(pos), 52, X(pos), 246);
        C.wrap(ctx, p.note, w / 2, 282, w - 20, { color: U.tones[p.tone][1] });
        say(p.note);
      },
    });
  });

  // Context switching on one CPU: voluntary (I/O), forced (turn ends), and switching too often.
  document.querySelectorAll('[data-figure="cpu-switch"]').forEach((root) => {
    const WIN = 60, SW = 0.8, STEP = 0.05, SEC = 4.5, HOLD = 1.2, PHASE = SEC + HOLD, GREY = '#94a3b8', IO = '#e2e8f0';
    const COLORS = [U.blue, U.purple];
    // Deterministic schedule for one scene: every time the running thread leaves, SW ms of switching follows.
    const plan = (mode) => {
      const slice = mode === 'many' ? 2 : 8, vol = mode === 'vol', eps = 1e-6;
      const th = [0, 1].map((id) => ({ id, state: 'ready', since: 0, segs: [], left: 8, io: 0 }));
      const queue = [0, 1], cpu = [], events = [];
      let now = 0, cur = -1, state = 'idle', until = 0, turn = 0, start = 0;
      const set = (t, s) => { if (t.state !== s) { t.segs.push({ s: t.since, e: now, state: t.state }); t.state = s; t.since = now; } };
      const run = () => { cur = queue.shift(); set(th[cur], 'run'); state = 'run'; turn = slice; start = now; };
      const leave = () => { cpu.push({ s: start, e: now, tid: cur }); events.push(now); state = 'switch'; until = now + SW; start = now; cur = -1; };
      run();
      while (now < WIN) {
        now += STEP;
        th.forEach((t) => { if (t.state === 'io' && (t.io -= STEP) <= eps) { t.left = 8; set(t, 'ready'); queue.push(t.id); } });
        if (state === 'run') {
          const t = th[cur];
          turn -= STEP;
          if (vol && (t.left -= STEP) <= eps) { t.io = 12; set(t, 'io'); leave(); }
          else if (!vol && turn <= eps) { set(t, 'ready'); queue.push(t.id); leave(); }
        }
        if (state === 'switch' && now >= until - eps) { cpu.push({ s: start, e: now, sw: true }); state = 'idle'; start = now; }
        if (state === 'idle' && queue.length) run();
      }
      if (state === 'run') cpu.push({ s: start, e: now, tid: cur });
      if (state === 'switch') cpu.push({ s: start, e: now, sw: true });
      th.forEach((t) => t.segs.push({ s: t.since, e: now, state: t.state }));
      return { cpu, events, threads: th };
    };
    const phases = [
      { mode: 'vol', pill: '자발적 스위칭', tone: 'ok', tag: 'I/O 대기', note: 'A가 디스크를 기다리느라 CPU를 내려놓으면 그 사이 B가 쓴다. 기다리는 동안 CPU를 비워 주니 낭비가 없다.' },
      { mode: 'inv', pill: '강제 스위칭', tone: 'warn', tag: '차례 끝', note: '둘 다 계속 일하고 싶으면, 차례가 끝날 때 CPU를 뺏어 상대에게 넘긴다. 그동안 다른 쪽은 기다린다.' },
      { mode: 'many', pill: '너무 자주 바뀔 때', tone: 'bad', tag: '', note: '차례가 짧아 너무 자주 바뀌면 바꾸는 데 드는 시간(회색)이 늘어나고, 실제로 일하는 시간은 줄어든다.' },
    ].map((p) => ({ ...p, ...plan(p.mode) }));
    hwa.scene(root, {
      height: 262,
      still: SEC,
      frame: (ctx, w, h, time, say) => {
        const loop = time % (PHASE * phases.length), i = Math.floor(loop / PHASE), p = phases[i];
        const cur = Math.min((loop - i * PHASE) / SEC, 1) * WIN;
        const x0 = 32, x1 = w - 8, X = (t) => x0 + t / WIN * (x1 - x0), span = (g) => [X(g.s), X(Math.min(g.e, cur))];
        C.pill(ctx, 0, 0, p.pill, p.tone);
        C.text(ctx, 'CPU 1개, 스레드 2개', w, 11, { size: 10, align: 'right', base: 'middle' });
        C.legend(ctx, 0, 44, [['A 실행', U.blue], ['B 실행', U.purple], ['전환', GREY], ['CPU 기다림', C.hatch(ctx, U.red)], ['I/O 기다림', IO]]);
        const ly = 74, lh = 26;
        ctx.fillStyle = U.cell;
        ctx.fillRect(x0, ly, x1 - x0, lh);
        C.text(ctx, 'CPU', x0 - 6, ly + lh / 2, { size: 10, align: 'right', base: 'middle' });
        let work = 0, sw = 0;
        p.cpu.forEach((g) => {
          if (g.s >= cur || g.idle) return;
          const [a, b] = span(g);
          if (g.sw) sw += Math.min(g.e, cur) - g.s; else work += Math.min(g.e, cur) - g.s;
          ctx.fillStyle = g.sw ? GREY : COLORS[g.tid];
          ctx.fillRect(a, ly, b - a, lh);
        });
        const shown = p.events.filter((t) => t <= cur);
        if (p.tag) {
          shown.forEach((t) => {
            const x = X(t);
            ctx.beginPath();
            ctx.moveTo(x - 4, ly - 9); ctx.lineTo(x + 4, ly - 9); ctx.lineTo(x, ly - 3);
            ctx.fillStyle = U.text;
            ctx.fill();
            C.text(ctx, p.tag, x + 6, ly - 8, { size: 10, color: U.text, base: 'middle' });
          });
        }
        p.threads.forEach((t, k) => {
          const y = 122 + k * 20;
          ctx.fillStyle = U.cell;
          ctx.fillRect(x0, y, x1 - x0, 12);
          C.text(ctx, k ? 'B' : 'A', x0 - 6, y + 6, { size: 10, align: 'right', base: 'middle' });
          t.segs.forEach((g) => {
            if (g.s >= cur) return;
            const [a, b] = span(g);
            if (b <= a) return;
            ctx.fillStyle = g.state === 'run' ? COLORS[t.id] : g.state === 'ready' ? C.hatch(ctx, U.red) : IO;
            ctx.fillRect(a, y, b - a, 12);
          });
        });
        C.dashed(ctx, X(cur), ly - 2, X(cur), 162);
        C.text(ctx, '0ms', x0, 168, { size: 10, base: 'top' });
        C.text(ctx, '60ms', x1, 168, { size: 10, align: 'right', base: 'top' });
        const pct = (v) => (cur ? Math.round(v / cur * 100) : 0);
        C.text(ctx, `전환 ${shown.length}번    일한 시간 ${pct(work)}%    전환에 쓴 시간 ${pct(sw)}%`, 0, 198, { size: 11, weight: 600, color: U.text, base: 'middle' });
        C.wrap(ctx, p.note, w / 2, 230, w - 20, { color: U.tones[p.tone][1] });
        say(p.note);
      },
    });
  });

  // request: two pods sharing one CPU. Each panel shows what the pod wants (dashed) and what it gets.
  document.querySelectorAll('[data-figure="cpu-shares"]').forEach((root) => {
    const NODE = 1, LOOP = 12, HOLD = 1.2, fa = NODE * toShares(500) / (toShares(500) + toShares(1000));
    const rest = (t) => hwa.smooth((t - 4.5) / 0.6) * (1 - hwa.smooth((t - 8.5) / 0.6));
    const split = (wa, wb) => {
      if (wa + wb <= NODE) return [wa, wb];
      const b = Math.min(wb, NODE - Math.min(wa, NODE * fa));
      return [Math.min(wa, NODE - b), b];
    };
    const at = (t) => { const want = [1, 1 - rest(t)]; return { want, got: split(...want) }; };
    hwa.scene(root, {
      height: 300,
      still: 7,
      frame: (ctx, w, h, time, say) => {
        const t = Math.min(time % (LOOP + HOLD), LOOP), resting = rest(t) > 0.5, tone = resting ? 'ok' : 'bad';
        const x0 = 36, x1 = w - 64, X = (s) => x0 + s / LOOP * (x1 - x0), now = at(t);
        C.pill(ctx, 0, 0, resting ? 'B가 쉬는 중' : '둘 다 바쁨, CPU 모자람', tone);
        C.text(ctx, `CPU 1개 중 ${(now.got[0] + now.got[1]).toFixed(2)} 사용`, w, 11, { size: 10, align: 'right', base: 'middle' });
        C.legend(ctx, 0, 44, [['A 사용', U.blue], ['B 사용', U.purple], ['원하는데 못 쓴 양', C.hatch(ctx, U.red)]]);
        ctx.font = hwa.ui.font(10);
        const lx = 72 + ctx.measureText('A 사용B 사용원하는데 못 쓴 양').width + 4;
        dashedLine(ctx, [[lx, 44], [lx + 14, 44]]);
        C.text(ctx, '원하는 양', lx + 18, 44, { size: 10, base: 'middle' });
        const n = Math.max(2, Math.round(t / LOOP * 160));
        [['파드 A', 'request 500m', U.blue, 'rgba(59,130,246,0.18)', 84], ['파드 B', 'request 1000m', U.purple, 'rgba(139,92,246,0.18)', 172]].forEach(([name, req, color, fill, y], k) => {
          const Y = C.panel(ctx, x0, y, x1 - x0, 58, { title: `${name} 사용량`, right: req, max: NODE, ticks: [[0, '0'], [1, '1']] });
          const got = [], want = [];
          for (let i = 0; i <= n; i++) {
            const s = t * i / n, v = at(s);
            got.push([X(s), Y(v.got[k])]);
            want.push([X(s), Y(v.want[k])]);
          }
          C.area(ctx, got, y + 58, fill);
          C.area(ctx, want, got, C.hatch(ctx, U.red));
          dashedLine(ctx, want);
          C.line(ctx, got, color);
          C.dot(ctx, X(t), Y(now.got[k]), color, now.got[k].toFixed(2));
        });
        C.dashed(ctx, X(t), 84, X(t), 230);
        const note = resting
          ? 'B가 쉬면 B 사용량이 0으로 내려가고, A가 CPU 1개를 다 쓴다. 기다리는 쪽이 없다.'
          : '둘 다 CPU 1개씩 원하는데 CPU는 1개뿐이다. request 비율(1:2)대로 A 0.33, B 0.67로 나누고 나머지는 기다린다.';
        C.wrap(ctx, note, w / 2, 262, w - 20, { color: U.tones[tone][1] });
        say(note);
      },
    });
  });

  // limit: 100ms CFS periods on one CPU across three situations; P99 sits on the same time axis.
  document.querySelectorAll('[data-figure="cpu-quota"]').forEach((root) => {
    const PER = 6, LOOP = 12, HOLD = 1.2;
    const phases = [
      { limit: 0.5, run: 25, throttled: false, tone: 'ok', pill: '부하 낮음', group: 'limit 0.5, 할 일 적음', state: '할 일 25ms, 할당량 안에서 끝남', note: '할 일이 25ms뿐이라 50ms 안에서 끝난다. 쓰로틀도 없고 응답도 빠르다.' },
      { limit: 0.5, run: 50, throttled: true, tone: 'bad', pill: 'CPU를 계속 원함', group: 'limit 0.5, CPU를 계속 원함', state: '50ms 쓰고 나머지 50ms 정지', note: '50ms를 다 쓰면 다음 주기까지 멈춘다. 그동안 들어온 요청은 기다려야 해서 응답이 느려진다.' },
      { limit: 1, run: 100, throttled: false, tone: 'info', pill: 'limit을 1로 올림', group: 'limit 1', state: '주기 내내 실행', note: 'limit 1이면 주기 내내 쓸 수 있어서 멈추지 않는다. 응답도 다시 빨라진다.' },
    ];
    const TOTAL = PER * phases.length, onset = PER + phases[1].run / 100;
    const p99 = (g) => 62 + 190 * hwa.smooth((g - onset) / 0.4) * (1 - hwa.smooth((g - 2 * PER) / 0.4)) + 4 * Math.sin(g * 2.1);
    hwa.scene(root, {
      height: 330,
      still: LOOP * 0.6,
      frame: (ctx, w, h, time, say) => {
        const t = Math.min(time % (LOOP + HOLD), LOOP), g = t / LOOP * TOTAL;
        const ph = phases[Math.min(phases.length - 1, Math.floor(g / PER))];
        const x0 = 36, x1 = w - 64, cw = (x1 - x0) / TOTAL, X = (q) => x0 + q * cw;
        C.pill(ctx, 0, 0, ph.pill, ph.tone);
        C.text(ctx, `limit ${ph.limit} → 주기당 ${ph.limit * 100}ms`, w, 11, { size: 10, align: 'right', base: 'middle' });
        C.text(ctx, 'CFS 주기 (100ms 단위)', x0, 52, { weight: 600, color: U.text });
        C.legend(ctx, x0, 66, [['실행', U.blue], ['쓰로틀 (강제 정지)', C.hatch(ctx, U.red)]]);
        const sy = 96, sh = 30, inner = cw - 2;
        phases.forEach((p, i) => {
          C.text(ctx, p.group, X(i * PER + PER / 2), sy - 8, { size: 10, align: 'center', color: p === ph ? U.text : U.muted, weight: p === ph ? 600 : 400 });
          if (i) C.dashed(ctx, X(i * PER) - 1, sy - 4, X(i * PER) - 1, 266, '#cbd5e1');
        });
        for (let k = 0; k < TOTAL; k++) {
          const p = phases[Math.floor(k / PER)], el = Math.max(0, Math.min(100, (g - k) * 100)), cx = X(k);
          ctx.fillStyle = U.cell;
          ctx.fillRect(cx, sy, inner, sh);
          if (el > 0) { ctx.fillStyle = U.blue; ctx.fillRect(cx, sy, Math.min(el, p.run) / 100 * inner, sh); }
          if (p.throttled && el > p.run) {
            ctx.fillStyle = C.hatch(ctx, U.red);
            ctx.fillRect(cx + p.run / 100 * inner, sy, (el - p.run) / 100 * inner, sh);
          }
        }
        const xc = X(g);
        C.dashed(ctx, xc, sy - 2, xc, 266);
        C.text(ctx, ph.state, Math.min(Math.max(xc, x0 + 80), x1 - 80), sy + sh + 18, { size: 10, align: 'center' });
        const py = 194, phh = 72;
        const Y = C.panel(ctx, x0, py, x1 - x0, phh, { title: 'P99 응답 시간', right: '(ms)', max: 300, ticks: [[0, '0'], [100, '100'], [200, '200'], [300, '300']] });
        const pts = [];
        for (let q = 0; q < g; q += 0.05) pts.push([X(q), Y(p99(q))]);
        pts.push([X(g), Y(p99(g))]);
        C.area(ctx, pts, py + phh, 'rgba(139,92,246,0.12)');
        C.line(ctx, pts, U.purple);
        C.dot(ctx, xc, Y(p99(g)), U.purple, `${Math.round(p99(g))}ms`);
        C.wrap(ctx, ph.note, w / 2, py + phh + 36, w - 20, { color: U.tones[ph.tone][1] });
        say(ph.note);
      },
    });
  });

  // Time slicing on one CPU: short requests give it back while waiting on I/O, streams never do.
  document.querySelectorAll('[data-figure="cpu-threads"]').forEach((root) => {
    const N = 8, SLICE = 3, WIN = 120, STEP = 0.25, SPEED = 30;
    const COLORS = ['#4f46e5', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ec4899', '#a855f7'];
    const st = { mode: 'short', clock: 0, carry: 0, last: 0 }, r = rng(77);
    let sim;
    const set = (t, state) => {
      if (t.state === state) return;
      t.segs.push({ s: t.since, e: sim.now, state: t.state });
      t.state = state;
      t.since = sim.now;
    };
    const release = () => {
      const c = sim.cpu;
      if (c.tid >= 0) sim.segs.push({ s: c.start, e: sim.now, tid: c.tid });
      c.tid = -1;
    };
    const step = () => {
      const s = sim, c = s.cpu;
      s.now += STEP;
      s.threads.forEach((t) => {
        if (t.state === 'io' && (t.io -= STEP) <= 0) { t.burst = 0.4 + r() * 0.6; set(t, 'ready'); s.queue.push(t.id); }
      });
      if (c.tid >= 0) {
        const t = s.threads[c.tid];
        c.slice -= STEP;
        if (st.mode === 'short' && (t.burst -= STEP) <= 0) {
          t.io = 8 + r() * 12;
          set(t, 'io');
          release();
          s.cs.push({ t: s.now, vol: true });
        } else if (c.slice <= 0) {
          if (s.queue.length) {
            set(t, 'ready');
            s.queue.push(t.id);
            release();
            s.cs.push({ t: s.now, vol: false });
          } else c.slice = SLICE;
        }
      }
      if (c.tid < 0 && s.queue.length) {
        c.tid = s.queue.shift();
        c.slice = SLICE;
        c.start = s.now;
        set(s.threads[c.tid], 'run');
      }
      s.samples.push([s.now, c.tid >= 0 ? 1 : 0, s.queue.length]);
      const t0 = s.now - WIN;
      while (s.samples[0][0] < t0) s.samples.shift();
      while (s.cs.length && s.cs[0].t < t0) s.cs.shift();
      while (s.segs.length && s.segs[0].e < t0) s.segs.shift();
      s.threads.forEach((t) => { while (t.segs.length && t.segs[0].e < t0) t.segs.shift(); });
    };
    const reset = () => {
      sim = { now: 0, threads: [], queue: [], cpu: { tid: -1, slice: 0, start: 0 }, segs: [], samples: [], cs: [] };
      for (let i = 0; i < N; i++) {
        const t = { id: i, state: st.mode === 'short' ? 'io' : 'ready', since: 0, segs: [], burst: 0, io: r() * 15 };
        if (t.state === 'ready') sim.queue.push(i);
        sim.threads.push(t);
      }
      while (sim.now < WIN) step();
    };
    reset();
    hwa.scene(root, {
      height: 330,
      frame: (ctx, w, h, time, say) => {
        const dt = Math.max(0, time - st.last);
        st.last = time;
        st.carry += SPEED * dt;
        while (st.carry >= STEP) { step(); st.carry -= STEP; }
        if ((st.clock += dt) > 7) { st.clock = 0; st.mode = st.mode === 'short' ? 'stream' : 'short'; reset(); }
        const short = st.mode === 'short', s = sim, t0 = s.now - WIN;
        const x0 = 44, x1 = w - 4, X = (t) => x0 + (t - t0) / WIN * (x1 - x0), clip = (g) => [X(Math.max(g.s, t0)), X(g.e)];
        C.pill(ctx, 0, 0, short ? '짧은 요청' : '스트림', short ? 'ok' : 'bad');
        C.text(ctx, `CPU 1개, 스레드 ${N}개`, w, 11, { size: 10, align: 'right', base: 'middle' });
        C.text(ctx, 'CPU에서 돈 스레드', x0, 52, { weight: 600, color: U.text });
        ctx.fillStyle = U.cell;
        ctx.fillRect(x0, 62, x1 - x0, 26);
        C.text(ctx, 'CPU', x0 - 8, 75, { size: 10, align: 'right', base: 'middle' });
        s.segs.concat(s.cpu.tid >= 0 ? [{ s: s.cpu.start, e: s.now, tid: s.cpu.tid }] : []).forEach((g) => {
          const [a, b] = clip(g);
          if (b - a > 1.5) { ctx.fillStyle = COLORS[g.tid]; ctx.fillRect(a, 62, b - a - 1.5, 26); }
        });
        C.text(ctx, '스레드별 상태', x0, 116, { weight: 600, color: U.text });
        C.legend(ctx, Math.max(x0 + 100, x1 - 230), 112, [['실행', U.slate], ['CPU 기다림', C.hatch(ctx, U.red)], ['I/O 기다림', '#e2e8f0']]);
        s.threads.forEach((t, i) => {
          const y = 126 + i * 14;
          ctx.fillStyle = U.cell;
          ctx.fillRect(x0, y, x1 - x0, 9);
          C.text(ctx, `T${i + 1}`, x0 - 8, y + 5, { size: 9, align: 'right', base: 'middle' });
          t.segs.concat([{ s: t.since, e: s.now, state: t.state }]).forEach((g) => {
            const [a, b] = clip(g);
            if (b <= a) return;
            ctx.fillStyle = g.state === 'run' ? COLORS[t.id] : g.state === 'ready' ? C.hatch(ctx, U.red) : '#e2e8f0';
            ctx.fillRect(a, y, b - a, 9);
          });
        });
        const ay = 126 + N * 14 + 2;
        C.text(ctx, '120ms 전', x0, ay, { size: 10, base: 'top' });
        C.text(ctx, '지금', x1, ay, { size: 10, align: 'right', base: 'top' });
        let busy = 0, ready = 0;
        s.samples.forEach(([, b, q]) => { busy += b; ready += q; });
        const vol = s.cs.filter((c) => c.vol).length, per = (v) => Math.round(v / WIN * 1000).toLocaleString();
        const util = Math.round(busy / s.samples.length * 100), wait = Math.round(ready / (N * s.samples.length) * 100);
        C.text(ctx, `CPU 사용률 ${util}%    스레드가 CPU를 기다린 시간 ${wait}%    컨텍스트 스위칭 자발 ${per(vol)}/s, 강제 ${per(s.cs.length - vol)}/s`, 0, ay + 36, { size: 11, weight: 600, color: U.text, base: 'middle' });
        const note = short
          ? '요청이 응답을 기다리는 동안 CPU를 내려놓아서, 스레드 8개가 있어도 거의 기다리지 않는다.'
          : '스트림은 CPU를 놓지 않는다. 8개가 돌아가며 쓰니 하나당 12.5%이고 나머지 시간은 기다린다.';
        C.wrap(ctx, note, w / 2, ay + 70, w - 20, { color: U.tones[short ? 'ok' : 'bad'][1] });
        say(note);
      },
    });
  });

  // Throttling seen from the dashboard: usage pinned at limit while the node has room. One point per 10s.
  document.querySelectorAll('[data-figure="cpu-throttle-dash"]').forEach((root) => {
    const PER_MIN = 6, n = 30 * PER_MIN + 1, LOOP = 12, HOLD = 1.5;
    const w1 = wobble(31), w2 = wobble(32), w3 = wobble(33), w4 = wobble(34);
    const usage = [], limit = [], ratio = [], node = [], p99 = [];
    for (let i = 0; i < n; i++) {
      const m = i / PER_MIN, traffic = bump(m, 7, 9, 40, 42), lim = m < 20 ? 0.5 : 1;
      const demand = 0.22 + 0.48 * traffic + 0.02 * w1(m);
      const thr = hwa.smooth((demand / lim - 0.78) / 0.5) * 74 + 2 + 1.5 * w2(m);
      const used = demand > lim * 0.96 ? lim * 0.96 + 0.006 * w3(m) : demand;
      limit.push(lim);
      usage.push(used);
      ratio.push(thr);
      node.push((used + 0.12 + 0.02 * w4(m)) * 100);
      p99.push((0.16 + 0.05 * traffic + 0.95 * (thr - 2) / 74 + 0.02 * w2(m * 1.7)) * 1000);
    }
    const lerp = (arr, pos) => { const i = Math.min(n - 2, Math.floor(pos)); return arr[i] + (arr[i + 1] - arr[i]) * (pos - i); };
    const pad = (v) => String(v).padStart(2, '0');
    const panels = [
      { title: '컨테이너 CPU 사용량', right: 'CPU, 점선은 limit', max: 1.1, ticks: [[0, '0'], [0.5, '0.5'], [1, '1']], data: usage, ref: limit, color: U.blue, fill: 'rgba(59,130,246,0.12)', label: (v, pos) => `${v.toFixed(2)} / ${limit[Math.round(pos)]}` },
      { title: '쓰로틀 비율', right: 'throttled / periods', max: 100, ticks: [[0, '0'], [50, '50'], [100, '100%']], data: ratio, color: U.red, fill: 'rgba(239,68,68,0.10)', label: (v) => `${Math.round(v)}%` },
      { title: '노드 CPU 사용률', max: 100, ticks: [[0, '0'], [50, '50'], [100, '100%']], data: node, color: U.slate, fill: 'rgba(100,116,139,0.10)', label: (v) => `${Math.round(v)}%` },
      { title: 'P99 응답 시간', right: '(ms)', max: 1400, ticks: [[0, '0'], [500, '500'], [1000, '1000']], data: p99, color: U.purple, fill: 'rgba(139,92,246,0.12)', label: (v) => `${Math.round(v)}ms` },
    ];
    const phases = [
      { to: 8 * PER_MIN, label: '정상', tone: 'ok', note: '사용량이 limit의 절반쯤이고 쓰로틀은 거의 없다.' },
      { to: 20 * PER_MIN, label: 'limit에 막힘', tone: 'bad', note: '사용량이 0.5에서 막히고 쓰로틀이 70%를 넘는다. CPU는 40% 남는데 P99가 오른다.' },
      { to: n, label: 'limit 상향', tone: 'info', note: 'limit을 1로 올리자 쓰로틀이 사라지고 P99도 돌아온다.' },
    ];
    hwa.scene(root, {
      height: 414,
      still: LOOP * 0.55,
      frame: (ctx, w, h, time, say) => {
        const t = Math.min(time % (LOOP + HOLD), LOOP), pos = t / LOOP * (n - 1);
        const ph = phases.find((f) => pos < f.to) || phases[phases.length - 1], sec = Math.round(pos * 10);
        const x0 = 44, x1 = w - 84, X = (k) => x0 + k / (n - 1) * (x1 - x0), PH = 50, GAP = 30;
        C.pill(ctx, 0, 0, ph.label, ph.tone);
        C.text(ctx, `14:${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`, w, 11, { size: 11, weight: 600, color: U.text, align: 'right', base: 'middle' });
        let y = 60;
        panels.forEach((p) => {
          const Y = C.panel(ctx, x0, y, x1 - x0, PH, p), pts = [];
          if (p.ref) dashedLine(ctx, p.ref.map((v, k) => [X(k), Y(v)]));
          for (let k = 0; k <= pos; k++) pts.push([X(k), Y(p.data[k])]);
          const v = lerp(p.data, pos);
          pts.push([X(pos), Y(v)]);
          C.area(ctx, pts, y + PH, p.fill);
          C.line(ctx, pts, p.color);
          C.dashed(ctx, X(pos), y, X(pos), y + PH);
          C.dot(ctx, X(pos), Y(v), p.color, p.label(v, pos));
          y += PH + GAP;
        });
        C.wrap(ctx, ph.note, w / 2, y + 4, w - 20, { color: U.tones[ph.tone][1] });
        say(ph.note);
      },
    });
  });
})();
