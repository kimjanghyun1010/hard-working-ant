(() => {
  const U = hwa.ui, C = hwa.cv;
  const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const bump = (m, a, b, c, d) => hwa.smooth((m - a) / (b - a)) * (1 - hwa.smooth((m - c) / (d - c)));
  // Slow sum of sines in [-1, 1]: metric-like wobble without per-point jitter.
  const wobble = (seed) => { const r = rng(seed), p = [r(), r(), r()].map((x) => x * 6.283); return (m) => 0.5 * Math.sin(m * 0.9 + p[0]) + 0.3 * Math.sin(m * 2.3 + p[1]) + 0.2 * Math.sin(m * 5.3 + p[2]); };
  const dashedLine = (ctx, pts) => { ctx.save(); ctx.setLineDash([4, 4]); C.line(ctx, pts, '#9ca3af', 1); ctx.restore(); };
  // Data: kubelet MilliCPUToShares (milli * 1024 / 1000, min 2).
  const toShares = (milli) => Math.max(2, Math.floor(milli * 1024 / 1000));
  const JSFILL = '#eff6ff', JSLINE = '#93c5fd';

  // kubelet reads the Pod spec and writes it into the host kernel's cgroup; then it changes form down to hardware.
  document.querySelectorAll('[data-figure="cpu-layers"]').forEach((root) => {
    const STEP = 1.2, HOLD = 2.4, BH = 52, TOP = 22;
    // Data: request 500m -> shares 512 -> cpu.weight 20, limit 1000m -> quota 100000 per 100000.
    const rows = [
      { step: 0, name: 'Pod 스펙', unit: 'API 서버에 저장된 값', v: ['requests: 500m', 'limits: 1000m'] },
      { step: 2, name: 'cgroup', unit: '/sys/fs/cgroup 아래 파일', v: ['cpu.weight = 20', 'cpu.max = 100000 100000'] },
      { step: 3, name: 'CPU 스케줄러', unit: 'cgroup 값을 보고 시간을 나눈다', v: ['모자랄 때 비율로 나눔', '100ms마다 100ms까지'] },
      { step: 4, name: '하드웨어', unit: 'vCPU 하나 기준', v: ['바빠도 100ms 중 50ms는 받음', '100ms어치를 쓰면 멈춤'], fill: '#ecfdf5', stroke: '#a7f3d0' },
    ];
    const nY = TOP + BH + 18, kubY = nY + 30, kY = kubY + 40 + 18, kH = 30 + BH * 2 + 6 + 8, hwY = kY + kH + 8, nH = hwY + BH + 8 - nY;
    hwa.scene(root, {
      height: nY + nH + 2,
      still: 5 * STEP,
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, 5, STEP, HOLD), KX = Math.round(w / 2);
        const row = (r, x, y, bw) => {
          C.box(ctx, x, y, bw, BH, { fill: r.fill, stroke: r.stroke, on: r.step === s.active });
          C.text(ctx, r.name, x + 12, y + 22, { size: 13, weight: 600, color: U.text });
          const room = bw - 30 - Math.max(...r.v.map((v) => C.chipW(ctx, v)));
          ctx.font = hwa.ui.font(11);
          if (ctx.measureText(r.unit).width < room) C.text(ctx, r.unit, x + 12, y + 40, { size: 11 });
          C.chip(ctx, r.v[0], x + bw - 8, y + 14, 'info', s.k(r.step + 0.3));
          C.chip(ctx, r.v[1], x + bw - 8, y + 38, 'warn', s.k(r.step + 0.5));
        };
        const flow = (i, y0, y1, label, ly) => {
          const on = i === s.active;
          C.arrow(ctx, [[KX, y0], [KX, y1]], s.k(i), on ? U.accent : U.now);
          if (s.k(i) > 0) C.text(ctx, label, KX + 10, ly, { size: 11, color: on ? U.accent : U.muted, base: 'middle' });
        };
        ctx.font = hwa.ui.font(10);
        C.legend(ctx, w - 40 - ctx.measureText('requests limits').width - 16, 8, [['requests', U.tones.info[1]], ['limits', U.tones.warn[1]]]);
        row(rows[0], 0, TOP, w);

        C.box(ctx, 0, nY, w, nH, { fill: U.plot, r: 10 });
        C.text(ctx, '노드 (리눅스 호스트)', 12, nY + 20, { weight: 600, color: U.text });
        C.card(ctx, { x: KX - 60, y: kubY, w: 120, h: 40, t: 'kubelet', s: '노드의 프로세스' }, { lit: s.active === 1 || s.active === 2 });
        C.box(ctx, 8, kY, w - 16, kH, { r: 10 });
        C.text(ctx, '커널', 20, kY + 20, { weight: 600, color: U.text });
        row(rows[1], 16, kY + 30, w - 32);
        row(rows[2], 16, kY + 30 + BH + 6, w - 32);
        row(rows[3], 8, hwY, w - 16);
        flow(1, TOP + BH + 1, kubY - 1, '스펙을 읽는다', TOP + BH + 9);
        flow(2, kubY + 41, kY + 29, 'cgroup 파일에 쓴다', kubY + 49);
        say('kubelet이 Pod 스펙의 requests 500m과 limits 1000m을 읽어 노드 커널의 cgroup 파일에 cpu.weight 20과 cpu.max 100000 100000으로 쓴다. 커널 스케줄러는 CPU가 모자랄 때 비율로 나누고, 100ms마다 100ms어치를 쓰면 멈춘다.');
      },
    });
  });

  // Bursty web traffic with no limit vs limit 0.5: the average stays at 0.25, but bursts get cut and stretched.
  document.querySelectorAll('[data-figure="cpu-burst"]').forEach((root) => {
    const DT = 0.05, SPAN = 30, LIMIT = 1, SEC = 5, HOLD = 1.4, PHASE = SEC + HOLD, n = Math.round(SPAN / DT) + 1;
    const demand = Array.from({ length: n }, (_, k) => {
      const t = k * DT;
      return [3, 9, 15, 21, 27].reduce((d, c) => d + 1.5 * hwa.smooth((0.45 - Math.abs(t - c)) / 0.1), 0.3);
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
        lat.push(80 + 40 * (d - 0.3) / 1.5 + 700 * backlog);
      });
      return { use, lat };
    };
    const phases = [
      { pill: 'limit 없음', tone: 'ok', limit: false, ...simulate(Infinity), note: '요청이 몰리는 순간 CPU를 잠깐 많이 쓰고 바로 끝난다. 응답 시간도 거의 그대로다.' },
      { pill: 'limit 1000m', tone: 'bad', limit: true, ...simulate(LIMIT), note: '평균은 0.5로 limit보다 낮은데도, 스레드 여럿이 몰리는 순간이 1에서 잘려 길게 늘어지고 그만큼 응답이 느려진다.' },
    ];
    hwa.scene(root, {
      scenes: hwa.loopScenes(SEC, HOLD, phases.length),
      height: 306,
      still: PHASE + SEC,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, phases.length), p = phases[i];
        const pos = k * (n - 1), last = Math.floor(pos);
        const x0 = 36, x1 = w - 64, X = (k) => x0 + k / (n - 1) * (x1 - x0);
        C.pill(ctx, 0, 0, p.pill, p.tone);
        C.text(ctx, '평균 사용량은 둘 다 0.5 CPU', w, 11, { size: 10, align: 'right', base: 'middle' });
        const draw = (y, title, right, max, ticks, data, color, fill, label) => {
          const Y = C.panel(ctx, x0, y, x1 - x0, 76, { title, right, max, ticks }), pts = [];
          for (let k = 0; k <= last; k++) pts.push([X(k), Y(data[k])]);
          C.area(ctx, pts, y + 76, fill);
          C.line(ctx, pts, color);
          C.dot(ctx, X(last), Y(data[last]), color, label(data[last]));
          return Y;
        };
        const Y = draw(52, 'CPU 사용량', 'CPU', 2, [[0, '0'], [1, '1'], [2, '2']], p.use, U.blue, 'rgba(59,130,246,0.14)', (v) => v.toFixed(2));
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

  // Server map with real round-trip times from the register; each place keeps its time once visited.
  document.querySelectorAll('[data-figure="cpu-memory"]').forEach((root) => {
  const clock = (ctx, x, y, r, a, color) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    C.line(ctx, [[x, y], [x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2)]], color, 1.5);
  };
  const MAP_H = 170;
  const memMap = (ctx, w, y0, cur, sub) => {
    const ow = Math.min(96, w * 0.22), sw = w - ow - 12, at = {};
    const box = (id, x, y, bw, bh, name) => {
      const [s0, col] = sub(id);
      C.box(ctx, x, y, bw, bh, { fill: '#fff', on: cur === id, r: 6 });
      C.text(ctx, name, x + bw / 2, y + (s0 ? bh / 2 - 6 : bh / 2) + 0.5, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
      if (s0) C.text(ctx, s0, x + bw / 2, y + bh / 2 + 8, { size: 10, weight: col ? 700 : 400, color: col || U.muted, align: 'center', base: 'middle' });
      at[id] = [x + bw / 2, y + bh / 2];
    };
    C.box(ctx, 0, y0, sw, MAP_H, { fill: '#fff', r: 10 });
    C.text(ctx, '서버', 10, y0 + 15, { size: 10, weight: 600 });
    const cx = 10, cy = y0 + 22, cW = sw - 20, wide = cW > 380, coreW = wide ? cW * 0.66 : cW - 16;
    C.box(ctx, cx, cy, cW, 96, { fill: U.plot, r: 8 });
    C.text(ctx, 'CPU 칩', cx + 8, cy + 12, { size: 10, weight: 600 });
    C.box(ctx, cx + 8, cy + 18, coreW, 50, { fill: U.plot, r: 6 });
    C.text(ctx, '코어 0', cx + 14, cy + 28, { size: 9 });
    const cellW = (coreW - 20) / 3;
    [['reg', '레지스터'], ['l1', 'L1'], ['l2', 'L2']].forEach(([id, name], i) => box(id, cx + 14 + i * (cellW + 4), cy + 33, cellW, 31, name));
    if (wide) {
      C.box(ctx, cx + 16 + coreW, cy + 18, cW - coreW - 24, 50, { fill: U.plot, r: 6 });
      C.text(ctx, '다른 코어들', cx + 16 + coreW + (cW - coreW - 24) / 2, cy + 43, { size: 10, align: 'center', base: 'middle' });
    }
    const l3y = cy + 72, [l3s, l3c] = sub('l3');
    C.box(ctx, cx + 8, l3y, cW - 16, 19, { fill: '#fff', on: cur === 'l3', r: 4 });
    C.text(ctx, `L3 (코어들이 같이 씀)  ${l3s}`, cx + cW / 2, l3y + 10, { size: 10, weight: 600, color: l3c || U.text, align: 'center', base: 'middle' });
    at.l3 = [at.reg[0], l3y + 10];
    const ry = cy + 104, rw = (sw - 32) / 3;
    [['mem', '메모리'], ['ssd', 'SSD'], ['nic', '랜카드']].forEach(([id, name], i) => box(id, 10 + i * (rw + 6), ry, rw, 36, name));
    C.line(ctx, [[at.nic[0] + rw / 2, ry + 18], [sw + 12, ry + 18]], '#cbd5e1', 1);
    box('net', sw + 12, ry, ow, 36, '다른 서버');
    at.bus = cy + 100;
    return at;
  };
  // Path a request takes from the register to a place in the map.
  const memPath = (at, id) => {
    const a = at.reg, b = at[id], bus = at.bus;
    if (id === 'reg') return [a, a];
    if (id === 'l1' || id === 'l2' || id === 'l3') return [a, b];
    if (id === 'net') return [a, [a[0], bus], [at.nic[0], bus], at.nic, b];
    return [a, [a[0], bus], [b[0], bus], b];
  };
  const memDot = (ctx, at, id, lp) => {
    const k = lp < 0.45 ? lp / 0.45 : lp < 0.9 ? 1 - (lp - 0.45) / 0.45 : 0;
    if (k <= 0) return;
    const [px, py] = C.pathAt(memPath(at, id), hwa.smooth(k)).pop();
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = U.accent;
    ctx.fill();
  };

    const STEP = 1.6, HOLD = 2.6;
    // Data: common rough latencies, the same values as the table under the figure.
    const LV = [
      ['reg', '레지스터', '0.2ns', 0.2, 'ok'], ['l1', 'L1', '약 1ns', 1, 'ok'], ['l2', 'L2', '약 4ns', 4, 'ok'], ['l3', 'L3', '약 15ns', 15, 'ok'],
      ['mem', '메모리', '약 100ns', 100, 'warn'], ['ssd', 'SSD', '수십에서 100µs', 6e4, 'bad'], ['net', '다른 서버', '0.1에서 0.5ms', 3e5, 'bad'],
    ];
    const fmt = (ns) => (ns < 10 ? `${ns.toFixed(1)}ns` : ns < 1000 ? `${Math.round(ns)}ns` : ns < 1e6 ? `${Math.round(ns / 1000)}µs` : `${(ns / 1e6).toFixed(1)}ms`);
    hwa.scene(root, {
      height: 300,
      still: 4 * STEP + 1.2,
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, LV.length, STEP, HOLD), t = time % (s.run + HOLD), cur = LV[s.active], lp = (t - s.active * STEP) / STEP;
        const p = cur ? hwa.smooth(lp / 0.8) : 1;
        C.pill(ctx, 0, 0, cur ? `${cur[1]}까지 왕복` : '레지스터에서 다녀오는 시간', cur ? cur[4] : 'info');
        const at = memMap(ctx, w, 32, cur && cur[0], (id) => {
          const i = LV.findIndex((l) => l[0] === id), l = LV[i];
          if (!l) return [''];
          const seen = s.done || i < s.active || (i === s.active && p >= 1);
          return seen ? [l[2], U.tones[l[4]][1]] : [''];
        });
        if (cur) memDot(ctx, at, cur[0], lp);
        const y1 = 32 + MAP_H + 24;
        if (cur) {
          const fg = U.tones[cur[4]][1], val = p >= 1 ? cur[2] : fmt(0.2 * (cur[3] / 0.2) ** p), times = Math.round(cur[3] / 0.2);
          C.text(ctx, `레지스터에서 ${cur[1]}까지 왕복`, 0, y1, { size: 12, weight: 600, color: U.text });
          clock(ctx, 8, y1 + 21, 7, -Math.PI / 2 + p * 4 * Math.PI, fg);
          C.text(ctx, val, 22, y1 + 26, { size: 15, weight: 700, color: fg });
          if (times > 1 && p >= 1) C.text(ctx, `레지스터의 ${times.toLocaleString('en-US')}배`, w, y1 + 26, { size: 12, weight: 600, color: fg, align: 'right' });
        } else C.text(ctx, '상자 아래 숫자 = 레지스터에서 다녀오는 시간', 0, y1, { size: 12, weight: 600, color: U.text });
        C.wrap(ctx, '멀어질수록 10배, 1000배씩 느려진다.', w / 2, h - 22, w - 16, { color: U.tones.info[1] });
        say(cur ? `레지스터에서 ${cur[1]}까지 왕복 ${cur[2]}.` : '레지스터, 캐시, 메모리, SSD, 다른 서버 순으로 멀어지고 갈수록 10배에서 1000배씩 느려진다.');
      },
    });
  });
  // 1, 5 and 15 minute load averages during a stress test on a 4-vCPU server, drawn left to right.
  document.querySelectorAll('[data-figure="cpu-load"]').forEach((root) => {
    const MIN = 24, DT = 5, ON = 3, OFF = 12, CPUS = 4, MAX = 6, SEC = 10, HOLD = 2.5;
    const LINES = [['1분 평균', '#db2777', 60], ['5분 평균', U.blue, 300], ['15분 평균', '#f59e0b', 900]];
    // Data: Linux updates loadavg every 5 s as an exponential average of runnable threads.
    const n = Math.round(MIN * 60 / DT) + 1, r = rng(42), w1 = wobble(7);
    const run = Array.from({ length: n }, (_, i) => {
      const m = i * DT / 60, busy = m >= ON && m < OFF;
      return Math.max(0, Math.round((busy ? 4.4 : 0.9) + (busy ? 1.4 : 0.8) * w1(m * 3) + (r() - 0.5) * 1.6));
    });
    const avg = LINES.map(([, , win]) => {
      const e = Math.exp(-DT / win);
      let l = 1;
      return run.map((c) => (l = l * e + c * (1 - e)));
    });
    const phases = [
      { at: 0, pill: '부하 전', tone: 'ok', note: '세 값 모두 1 근처다.' },
      { at: ON, pill: '부하 중', tone: 'bad', note: '1분 평균이 먼저 4를 넘고, 5분과 15분 평균은 천천히 따라온다.' },
      { at: OFF, pill: '부하 끝', tone: 'info', note: '1분 평균은 바로 떨어지지만 15분 평균은 한동안 높게 남는다.' },
    ];
    hwa.scene(root, {
      height: 332,
      still: SEC,
      frame: (ctx, w, h, time, say) => {
        const { k } = hwa.loop(time, SEC, HOLD), last = Math.max(1, Math.floor(k * (n - 1))), m = last * DT / 60;
        const ph = phases.filter((p) => m >= p.at).pop();
        C.pill(ctx, 0, 0, ph.pill, ph.tone);
        C.text(ctx, 'vCPU 4개 서버, 부하 테스트', w, 15, { size: 10, align: 'right' });
        const x0 = 28, x1 = w - 58, X = (i) => x0 + i / (n - 1) * (x1 - x0);
        const Y = C.panel(ctx, x0, 52, x1 - x0, 180, { title: 'load average', right: `${Math.round(m)}분`, max: MAX, ticks: [[0, '0'], [2, '2'], [4, '4'], [6, '6']] });
        // Stress window shading, then the vCPU line.
        ctx.fillStyle = 'rgba(239,68,68,0.06)';
        const sx = X(ON * 60 / DT), ex = X(Math.min(last, OFF * 60 / DT));
        if (m >= ON) ctx.fillRect(sx, 52, ex - sx, 180);
        C.dashed(ctx, x0, Y(CPUS), x1, Y(CPUS), U.red);
        C.text(ctx, 'vCPU 4개', x0 + 4, Y(CPUS) - 5, { size: 10, color: U.red });
        [0, 6, 12, 18, 24].forEach((t) => C.text(ctx, `${t}분`, X(t * 60 / DT), 248, { size: 10, align: t === 0 ? 'left' : t === MIN ? 'right' : 'center' }));
        // Lines, then endpoint labels pushed apart so they do not overlap.
        const ends = avg.map((a, li) => {
          C.line(ctx, a.slice(0, last + 1).map((v, i) => [X(i), Y(v)]), LINES[li][1], li ? 2 : 1.6);
          return { y: Y(a[last]), v: a[last], c: LINES[li][1] };
        });
        ends.slice().sort((a, b) => a.y - b.y).forEach((e, i, arr) => { if (i && e.y - arr[i - 1].ly < 13) e.ly = arr[i - 1].ly + 13; else e.ly = e.y; });
        ends.forEach((e) => C.dot(ctx, X(last), e.y, e.c, e.v.toFixed(2), e.ly));
        C.legend(ctx, x0, 272, LINES.map(([s, c]) => [s, c]));
        C.wrap(ctx, ph.note, w / 2, 300, w - 16, { color: U.tones[ph.tone][1] });
        say(`${ph.pill}, ${Math.round(m)}분. 1분 ${ends[0].v.toFixed(2)}, 5분 ${ends[1].v.toFixed(2)}, 15분 ${ends[2].v.toFixed(2)}. ${ph.note}`);
      },
    });
  });

  // One request from arrival to reply on a server map; each step moves exactly one chip.
  document.querySelectorAll('[data-figure="cpu-os-threads"]').forEach((root) => {
    const MOVE = 1.1, REST = 0.8, DUR = MOVE + REST;
    const tag = (ctx, s, cx, cy, [bg, fg]) => {
      ctx.font = U.font(11, 700);
      const tw = ctx.measureText(s).width + 14;
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2, cy - 10, tw, 20, 6);
      ctx.fillStyle = bg;
      ctx.fill();
      C.text(ctx, s, cx, cy + 0.5, { size: 11, weight: 700, color: fg, align: 'center', base: 'middle' });
    };
    const GREY = ['#f1f5f9', '#475569'];
    const CHIP = { req: '요청', q: '쿼리', dr: 'DB 응답', out: '응답' };
    const COLOR = { req: U.tones.warn, q: ['#e0e7ff', '#4338ca'], dr: U.tones.warn, out: U.tones.ok };
    // [chip, from, to, pill, tone, note]
    const STEPS = [
      ['req', 'user', 'sock', '요청 도착', 'warn', '사용자의 요청이 랜카드를 거쳐 커널의 소켓에 들어온다'],
      ['req', 'sock', 'runq', '실행 대기', 'warn', '커널이 이 요청을 맡은 스레드를 깨워 실행 대기 줄에 세운다'],
      ['req', 'runq', 'cpu', 'USER', 'info', 'vCPU에 올라 요청을 처리한다. 데이터가 필요해서 DB에 물어본다'],
      ['q', 'cpu', 'db', 'DB 쿼리', 'info', 'DB에 쿼리를 보낸다'],
      ['req', 'cpu', 'sleep', '대기', 'ok', 'DB 응답이 올 때까지 대기한다. 그동안 vCPU는 비어서 다른 요청을 처리한다'],
      ['dr', 'db', 'sock', 'DB 응답 도착', 'warn', 'DB 응답이 랜카드를 거쳐 소켓에 들어온다'],
      ['req', 'sleep', 'runq', '실행 대기', 'warn', '응답이 왔으니 커널이 다시 깨워 실행 대기 줄에 세운다'],
      ['req', 'runq', 'cpu', 'USER', 'info', 'vCPU에 다시 오른다'],
      ['dr', 'sock', 'cpu', 'USER', 'info', 'DB 응답을 읽어 와서 사용자에게 줄 응답을 만든다'],
      ['out', 'cpu', 'user', '응답 전송', 'ok', '응답을 사용자에게 보낸다. 요청 하나가 끝난다'],
    ];
    const N = STEPS.length, SC0 = [0, 3, 7], CYCLE = N * DUR + 1;
    // Where every chip sits once step i is over; a chip without a place is hidden.
    const after = [];
    STEPS.reduce((p, [id, , to], i) => {
      const n = { ...p, [id]: to };
      if (id === 'dr' && to === 'sock') delete n.q;
      if (id === 'dr' && to === 'cpu') delete n.dr;
      if (id === 'out') { delete n.out; delete n.req; }
      after[i] = n;
      return n;
    }, {});
    hwa.scene(root, {
      height: 290,
      still: 2 * DUR + MOVE * 0.6,
      scenes: { n: 3, at: (i) => SC0[i] * DUR, of: (t) => { const i = Math.floor((t % CYCLE) / DUR); return i >= 7 ? 2 : i >= 3 ? 1 : 0; } },
      frame: (ctx, w, h, time, say) => {
        const u = time % CYCLE, si = Math.min(N - 1, Math.floor(u / DUR)), t = u - si * DUR, f = hwa.smooth(Math.min(1, t / MOVE));
        const [mover, from, to, pill, tone, note] = STEPS[si], before = si ? after[si - 1] : {};
        // Base map: user and DB on the left, then the server's kernel and hardware.
        const ow = Math.min(96, w * 0.22), sx = ow + 10, bx = sx + 8, bw = w - sx - 16;
        C.box(ctx, sx, 32, w - sx, 182, { fill: '#fff', r: 10 });
        C.text(ctx, '서버', sx + 10, 46, { size: 10, weight: 600, color: U.text });
        const band = (y, bh, label) => { C.box(ctx, bx, y, bw, bh, { fill: U.plot, r: 8 }); C.text(ctx, label, bx + 8, y + 13, { size: 10 }); };
        band(54, 82, '커널');
        const aw = bw - 28, A = [aw * 0.3, aw * 0.35, aw * 0.35], ax = [bx + 8, bx + 14 + A[0], bx + 20 + A[0] + A[1]], ay = 72;
        ['소켓', A[1] < 84 ? '실행 대기' : '실행 대기 줄', '응답 대기'].forEach((s0, i) => {
          C.box(ctx, ax[i], ay, A[i], 56, { fill: '#fff', r: 6 });
          C.text(ctx, s0, ax[i] + A[i] / 2, ay + 12, { size: 10, align: 'center', base: 'middle' });
        });
        band(142, 64, '하드웨어');
        const hy = 160, vx = ax[1], vw = A[1] + 6 + A[2];
        C.box(ctx, ax[0], hy, A[0], 38, { fill: '#fff', r: 6 });
        C.text(ctx, '랜카드', ax[0] + A[0] / 2, hy + 19.5, { size: 10, weight: 600, color: U.text, align: 'center', base: 'middle' });
        C.box(ctx, vx, hy, vw, 38, { fill: '#fff', r: 6 });
        C.text(ctx, 'vCPU 0', vx + 6, hy + 10, { size: 9 });
        const busy = (t >= MOVE ? after[si] : before).req === 'cpu';
        C.text(ctx, busy ? 'USER' : 'IDLE', vx + vw - 8, hy + 10, { size: 9, weight: 700, color: busy ? U.blue : U.muted, align: 'right' });
        const Y = ay + 36, P = {
          user: [ow / 2, 100], db: [ow / 2, hy + 19], nic: [ax[0] + A[0] / 2, hy + 19],
          sock: [ax[0] + A[0] / 2, Y], runq: [ax[1] + A[1] / 2, Y], sleep: [ax[2] + A[2] / 2, Y], cpu: [vx + vw / 2, hy + 23],
        };
        C.box(ctx, 0, 82, ow, 36, { fill: '#fff', r: 6 });
        C.text(ctx, '사용자', P.user[0], P.user[1] + 0.5, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
        C.box(ctx, 0, hy + 1, ow, 36, { fill: '#fff', r: 6 });
        C.text(ctx, 'DB', P.db[0], P.db[1] + 0.5, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
        const lk = ow + 5;
        C.line(ctx, [[ow, P.user[1]], [lk, P.user[1]], [lk, P.nic[1]], [ax[0], P.nic[1]]], '#cbd5e1', 1);
        C.line(ctx, [[ow, P.db[1]], [ax[0], P.db[1]]], '#cbd5e1', 1);
        C.dashed(ctx, P.nic[0], hy, P.nic[0], ay + 56);
        const route = (a, b) => {
          const out = (p) => [p, [lk, p[1]], [lk, P.nic[1]], P.nic];
          if (a === 'user' || a === 'db') return [...out(P[a]), P[b]];
          if (b === 'user' || b === 'db') return [P[a], P.nic, ...out(P[b]).reverse()];
          if (a === 'sock' && b === 'cpu') return [P.sock, P.nic, P.cpu];
          if (b === 'cpu') return [P[a], [P[a][0], P.cpu[1]], P.cpu];
          if (a === 'cpu') return [P.cpu, [P[b][0], P.cpu[1]], P[b]];
          return [P[a], P[b]];
        };
        const color = (id, at) => (id !== 'req' ? COLOR[id] : at === 'cpu' ? U.tones.info : at === 'sleep' ? GREY : U.tones.warn);
        Object.entries(before).forEach(([id, at]) => { if (id !== mover) tag(ctx, CHIP[id], ...P[at], color(id, at)); });
        const [px, py] = C.pathAt(route(from, to), f).pop();
        if (t < MOVE || after[si][mover]) tag(ctx, CHIP[mover], px, py, color(mover, f < 1 ? from : to));
        C.pill(ctx, 0, 0, pill, tone);
        C.text(ctx, `${si + 1} / ${N}`, w, 11, { size: 10, align: 'right', base: 'middle' });
        C.wrap(ctx, note, w / 2, h - 34, w - 16, { color: U.text });
        say(`${si + 1}단계. ${note}.`);
      },
    });
  });
  // epoll in five steps: create, register fds, wait and sleep, data arrives, wake and read.
  document.querySelectorAll('[data-figure="cpu-epoll"]').forEach((root) => {
    const STEP = 1.6, HOLD = 2.4, FD = [21, 22, 23], CW = 46;
    const steps = [
      ['epoll_create1()', '커널에 감시 목록과 준비됨 목록을 만든다.'],
      ['epoll_ctl(ADD)', '소켓 fd 21, 22, 23을 감시 목록에 등록한다.'],
      ['epoll_wait()', '준비된 게 없어서 메인 스레드가 대기한다. 대기하는 동안 CPU를 쓰지 않는다.'],
      ['응답 도착', 'fd 22에 데이터가 오면 커널이 준비됨 목록에 넣는다.'],
      ['깨움', '커널이 메인 스레드를 깨우고, 메인 스레드는 fd 22를 읽는다.'],
    ];
    hwa.scene(root, {
      height: 232,
      still: steps.length * STEP,
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, steps.length, STEP, HOLD), cur = s.done ? steps.length - 1 : s.active;
        C.pill(ctx, 0, 0, steps[cur][0], cur === 2 ? 'ok' : 'info');
        const mw = Math.min(150, Math.round(w * 0.32)), kx = mw + 40, ky = 34, kw = w - kx, wY = 56, rY = 116;
        const asleep = cur === 2 || cur === 3;
        C.card(ctx, { x: 0, y: 70, w: mw, h: 52, t: '메인 스레드', s: asleep ? '대기' : cur === 4 ? 'fd 22 읽는 중' : 'JS 실행' }, { lit: cur === 4, dim: asleep, fill: asleep ? U.cell : '#eff6ff', stroke: asleep ? U.grid : '#93c5fd' });
        C.group(ctx, kx, ky, kw, 132, '커널');
        const k0 = s.k(0);
        ctx.globalAlpha = k0;
        C.box(ctx, kx + 10, wY + 4, kw - 20, 42, { on: cur === 1 });
        C.text(ctx, '감시 목록', kx + 18, wY + 16, { size: 10, weight: 600 });
        C.box(ctx, kx + 10, rY + 4, kw - 20, 40, { on: cur === 3 });
        C.text(ctx, '준비됨 목록', kx + 18, rY + 16, { size: 10, weight: 600 });
        ctx.globalAlpha = 1;
        const fdX = (j) => kx + 18 + j * (CW + 6) + CW / 2;
        const fdChip = (j, y, k, hot) => {
          if (k <= 0) return;
          ctx.globalAlpha = k;
          ctx.beginPath();
          ctx.roundRect(fdX(j) - CW / 2, y - 9, CW, 18, 5);
          ctx.fillStyle = hot ? U.tones.warn[0] : '#fff';
          ctx.fill();
          ctx.strokeStyle = hot ? '#fcd34d' : '#cbd5e1';
          ctx.lineWidth = 1;
          ctx.stroke();
          C.text(ctx, `fd ${FD[j]}`, fdX(j), y + 0.5, { size: 10, weight: 600, color: hot ? U.tones.warn[1] : U.text, align: 'center', base: 'middle' });
          ctx.globalAlpha = 1;
        };
        FD.forEach((_, j) => fdChip(j, wY + 32, s.k(1 + j * 0.25), cur >= 3 && j === 1));
        // Data arrives on fd 22 from the network, then fd 22 is copied into the ready list.
        const k3 = s.k(3);
        if (k3 > 0 && k3 < 1) {
          const px = w - 8 + (fdX(1) - w + 8) * k3, py = 20 + (wY + 32 - 20) * k3;
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fillStyle = U.tones.warn[1];
          ctx.fill();
        }
        if (cur >= 3) C.text(ctx, '네트워크', w - 4, 26, { size: 10, align: 'right' });
        fdChip(1, rY + 32, s.k(3.5), true);
        const ay = 96;
        if (cur <= 2 && s.k(cur) > 0) {
          C.arrow(ctx, [[mw + 4, ay - 10], [kx - 4, ay - 10]], s.k(cur), U.accent);
        }
        if (cur === 4) C.arrow(ctx, [[kx - 4, ay + 12], [mw + 4, ay + 12]], s.k(4), U.tones.warn[1]);
        if (asleep) C.text(ctx, 'z z', mw - 8, 86, { size: 12, weight: 700, color: U.muted, align: 'right' });
        C.wrap(ctx, steps[cur][1], w / 2, 194, w - 16, { color: U.text });
        say(`${steps[cur][0]}: ${steps[cur][1]}`);
      },
    });
  });

  // Node.js under limit 1 vs 2: three threads spend 10 ms tokens from one quota; when it runs out, all of them stop.
  document.querySelectorAll('[data-figure="cpu-node-limit"]').forEach((root) => {
    const SEC = 5, HOLD = 2.2, TOKEN = 10;
    const LANES = [['메인 스레드', 'JS 실행', 0, 80, U.blue], ['V8 GC 스레드', '메모리 정리', 20, 50, U.purple], ['libuv 스레드', '파일, crypto', 40, 60, '#0891b2']];
    const used = (t, on) => LANES.reduce((a, [, , s0, e], r) => a + (on.includes(r) ? Math.max(0, Math.min(t, e) - s0) : 0), 0);
    const scenes = [
      { quota: 100, on: [0, 1, 2], pill: 'limit 1000m, GC와 워커도 돎', tone: 'bad', note: '세 스레드가 같이 써서 55ms 만에 쿼터 100ms를 다 쓴다. 남은 45ms 동안 프로세스 전체가 멈춘다.' },
      { quota: 100, on: [0], pill: 'limit 1000m, 메인 스레드만 돎', tone: 'ok', note: '메인 스레드 하나는 vCPU 하나만 써서 100ms 동안 80ms만 쓴다. GC와 워커가 같이 돌 때만 1을 넘겨 멈춘다.' },
    ];
    hwa.scene(root, {
      scenes: hwa.loopScenes(SEC, HOLD, scenes.length),
      height: 262,
      still: SEC,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, scenes.length), sc = scenes[i], t = k * 100;
        let T = 100;
        for (let x = 0; x <= 100; x += 0.5) if (used(x, sc.on) >= sc.quota) { T = x; break; }
        const stopped = t >= T && T < 100, u = used(Math.min(t, T), sc.on);
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        C.text(ctx, `${Math.round(t)}ms / 100ms`, w, 15, { size: 11, weight: 600, align: 'right' });
        // Thread cards: running, idle, or stopped by the throttle.
        const cw = (w - 16) / 3;
        LANES.forEach(([name, job, s0, e, col], r) => {
          const x = r * (cw + 8), wants = sc.on.includes(r) && t >= s0 && t < e, running = !stopped && wants;
          const state = !sc.on.includes(r) ? 'IDLE' : stopped && wants ? '멈춤 (쓰로틀)' : running ? 'USER' : t < s0 ? '대기' : '끝남';
          C.box(ctx, x, 34, cw, 62, { fill: running ? '#fff' : U.plot, stroke: running ? col : stopped && wants ? U.red : U.grid, r: 8 });
          C.text(ctx, name, x + cw / 2, 52, { size: 11, weight: 700, color: U.text, align: 'center', base: 'middle' });
          C.text(ctx, job, x + cw / 2, 68, { size: 9, align: 'center', base: 'middle' });
          C.text(ctx, state, x + cw / 2, 84, { size: 10, weight: 700, color: running ? col : stopped && wants ? U.red : U.muted, align: 'center', base: 'middle' });
        });
        // Quota tokens, 10 ms each, refilled every 100 ms; spent ones turn hollow.
        const n = sc.quota / TOKEN, spent = Math.min(n, u / TOKEN), perRow = 10, r0 = Math.min(11, (w - 20) / perRow / 2 - 3);
        C.text(ctx, `쿼터: 10ms 토큰 ${n}개`, 0, 122, { size: 11, weight: 600, color: U.text });
        for (let j = 0; j < n; j++) {
          const x = (j % perRow) * (2 * r0 + 6) + r0 + 2, y = 144 + Math.floor(j / perRow) * (2 * r0 + 6), left = Math.max(0, Math.min(1, j + 1 - spent));
          ctx.beginPath();
          ctx.arc(x, y, r0, 0, Math.PI * 2);
          ctx.strokeStyle = U.tones[sc.tone][1];
          ctx.lineWidth = 1.5;
          ctx.stroke();
          if (left > 0) { ctx.globalAlpha = left; ctx.fillStyle = U.tones[sc.tone][1]; ctx.fill(); ctx.globalAlpha = 1; }
        }
        ctx.lineWidth = 1;
        C.text(ctx, `쓴 시간 ${Math.round(u)}ms`, w, 122, { size: 11, weight: 600, color: U.tones[sc.tone][1], align: 'right' });
        C.wrap(ctx, sc.note, w / 2, h - 30, w - 16, { color: U.tones[sc.tone][1] });
        say(`${sc.pill}. ${Math.round(t)}ms 지점, 쓴 시간 ${Math.round(u)}ms. ${sc.note}`);
      },
    });
  });
  // request: two pods sharing one CPU. Each panel shows what the pod wants (dashed) and what it gets.
  document.querySelectorAll('[data-figure="cpu-shares"]').forEach((root) => {
    const NODE = 1, LOOP = 12, HOLD = 1.2, fa = NODE * toShares(500) / (toShares(500) + toShares(500));
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
        const t = hwa.loop(time, LOOP, HOLD).t, resting = rest(t) > 0.5, tone = resting ? 'ok' : 'bad';
        const x0 = 36, x1 = w - 64, X = (s) => x0 + s / LOOP * (x1 - x0), now = at(t);
        C.pill(ctx, 0, 0, resting ? 'B는 IDLE' : '둘 다 바쁨, CPU 모자람', tone);
        C.text(ctx, `CPU 1개 중 ${(now.got[0] + now.got[1]).toFixed(2)} 사용`, w, 11, { size: 10, align: 'right', base: 'middle' });
        C.legend(ctx, 0, 44, [['A 사용', U.blue], ['B 사용', U.purple], ['기다린 양 (CPU 부족)', C.hatch(ctx, '#f59e0b')]]);
        ctx.font = hwa.ui.font(10);
        const lx = 72 + ctx.measureText('A 사용B 사용기다린 양 (CPU 부족)').width + 4;
        dashedLine(ctx, [[lx, 44], [lx + 14, 44]]);
        C.text(ctx, '원하는 양', lx + 18, 44, { size: 10, base: 'middle' });
        const n = Math.max(2, Math.round(t / LOOP * 160));
        [['파드 A', 'request 500m', U.blue, 'rgba(59,130,246,0.18)', 84], ['파드 B', 'request 500m', U.purple, 'rgba(139,92,246,0.18)', 172]].forEach(([name, req, color, fill, y], k) => {
          const Y = C.panel(ctx, x0, y, x1 - x0, 58, { title: `${name} 사용량`, right: req, max: NODE, ticks: [[0, '0'], [1, '1']] });
          const got = [], want = [];
          for (let i = 0; i <= n; i++) {
            const s = t * i / n, v = at(s);
            got.push([X(s), Y(v.got[k])]);
            want.push([X(s), Y(v.want[k])]);
          }
          C.area(ctx, got, y + 58, fill);
          C.area(ctx, want, got, C.hatch(ctx, '#f59e0b'));
          dashedLine(ctx, want);
          C.line(ctx, got, color);
          C.dot(ctx, X(t), Y(now.got[k]), color, now.got[k].toFixed(2));
        });
        C.dashed(ctx, X(t), 84, X(t), 230);
        const note = resting
          ? 'B가 쉬면 B 사용량이 0으로 내려가고, A가 CPU 1개를 다 쓴다. 기다리는 쪽이 없다.'
          : '둘 다 CPU 1개씩 원하는데 CPU는 1개뿐이다. request가 500m로 같아서 0.5씩 나누고 나머지는 기다린다.';
        C.wrap(ctx, note, w / 2, 262, w - 20, { color: U.tones[tone][1] });
        say(note);
      },
    });
  });

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
        ['v8', 'gc', '힙을 훑는 GC가 같이 돈다', 'keep'], ['v8', 'jit', '자주 도는 코드를 기계어로 바꾼다', 'keep'],
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
        if (sleeping) C.text(ctx, '대기, CPU 0', R - 10, 49, { size: 10, weight: 600, color: U.tones.ok[1], align: 'right' });
        ['v8', 'loop', 'bind'].forEach((k) => C.card(ctx, B[k], { lit: lit.has(k), dim: sleeping, fill: k === 'v8' ? JSFILL : '#fff', stroke: k === 'v8' ? JSLINE : U.grid }));
        const phase = sleeping || (si < 2 && cur >= 2) ? 'poll' : PHASES[Math.floor(time * 1.5) % 3], L = B.loop;
        ctx.font = hwa.ui.font(10, 600);
        const chips = PHASES.map((p) => ctx.measureText(p).width + 12), cw = chips.reduce((a, b) => a + b, 0) + 8;
        if (cw < L.w - 12) {
          let x = L.x + (L.w - cw) / 2;
          PHASES.forEach((p, i) => {
            ctx.beginPath();
            ctx.roundRect(x, L.y + 36, chips[i], 17, 8);
            ctx.fillStyle = p === phase ? '#eef2ff' : U.cell;
            ctx.fill();
            C.text(ctx, p, x + chips[i] / 2, L.y + 45, { size: 10, weight: 600, color: p === phase ? '#4338ca' : U.muted, align: 'center', base: 'middle' });
            x += chips[i] + 4;
          });
        } else C.text(ctx, `${phase} 단계`, L.x + L.w / 2, L.y + 45, { size: 10, weight: 600, color: '#4338ca', align: 'center', base: 'middle' });
        ctx.save();
        ctx.setLineDash([4, 4]);
        C.line(ctx, [[0, 146], [R, 146]], '#cbd5e1', 1);
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
          C.arrow(ctx, pts, on ? f : 1, on ? U.accent : '#cbd5e1', { width: on ? 2 : 1.5 });
          const key = `${s[0]}>${s[1]}`;
          C.badge(ctx, pts, i + 1, on, { 'v8>bind': 'down', 'bind>pool': 'left', 'v8>gc': 'left' }[key], key === 'v8>bind' ? 0.25 : 0.5);
        });
        C.text(ctx, `${cur + 1}. ${step[2]}`, 0, 332, { size: 12, weight: 600, color: U.text, base: 'middle' });
        C.wrap(ctx, sc.note, w / 2, 360, w - 20, { color: U.tones[sc.tone][1] });
        say(`${sc.pill}: ${sc.note}`);
      },
    });
  });

  // Waiting for N requests: one sleeping thread per request (A) versus the kernel holding every socket for one thread (B).
  document.querySelectorAll('[data-figure="cpu-wait-model"]').forEach((root) => {
    const SEC = 6, HOLD = 2;
    const note = '기다리는 양은 같다. A는 스레드가 하나씩 대기하고, B는 커널이 대신 기다렸다가 준비된 것만 넘긴다.';
    const cells = (ctx, x, y, w, h, size, gap, share, fill, stroke) => {
      const cols = Math.max(1, Math.floor((w + gap) / (size + gap))), rows = Math.max(1, Math.floor((h + gap) / (size + gap)));
      const want = cols * rows * share, shown = Math.max(1, Math.ceil(want));
      for (let i = 0; i < shown; i++) {
        const cx = x + (i % cols) * (size + gap), cy = y + Math.floor(i / cols) * (size + gap);
        ctx.globalAlpha = i === shown - 1 && want > 1 ? Math.max(0.25, want - Math.floor(want) || 1) : 1;
        ctx.fillStyle = fill;
        ctx.fillRect(cx, cy, size, size);
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, cy + 0.5, size - 1, size - 1); }
      }
      ctx.globalAlpha = 1;
    };
    hwa.scene(root, {
      height: 352,
      still: SEC,
      frame: (ctx, w, h, time, say) => {
        const t = hwa.loop(time, SEC, HOLD).t, share = hwa.smooth(t / SEC), num = Math.round(10 ** (4 * share)).toLocaleString('en-US');
        const pw = (w - 12) / 2;
        C.pill(ctx, 0, 0, `동시 요청 ${num}건`, 'info');
        if (w > 520) C.text(ctx, '요청마다 CPU는 몇백 µs, 나머지는 DB 응답 기다림', w, 11, { size: 10, align: 'right', base: 'middle' });
        [0, 1].forEach((side) => {
          const x = side * (pw + 12), y = 34;
          C.group(ctx, x, y, pw, 250, side ? 'B. 커널에 맡기고 하나가 수거' : 'A. 요청마다 스레드가 기다림', y + 18);
          ctx.save();
          ctx.setLineDash([4, 4]);
          C.line(ctx, [[x + 8, y + 152], [x + pw - 8, y + 152]], '#cbd5e1', 1);
          ctx.restore();
          C.text(ctx, '커널', x + 10, y + 168, { size: 10, weight: 600 });
          if (!side) {
            cells(ctx, x + 12, y + 32, pw - 24, 86, 12, 4, share, '#fff', '#94a3b8');
            C.text(ctx, '전부 read에서 대기', x + 12, y + 136, { size: 11, weight: 600, color: U.tones.bad[1], base: 'middle' });
            C.card(ctx, { x: x + 10, y: y + 176, w: pw - 20, h: 62, t: `소켓 ${num}개`, s: '스레드가 하나씩 붙어 기다림' }, { fill: '#fef2f2', stroke: '#fca5a5', dash: [4, 3] });
          } else {
            const bwid = Math.min(160, pw - 32);
            C.card(ctx, { x: x + (pw - bwid) / 2, y: y + 44, w: bwid, h: 50, t: '메인 스레드', s: '1개' }, { fill: JSFILL, stroke: JSLINE });
            C.arrow(ctx, [[x + pw / 2, y + 94], [x + pw / 2, y + 120]], 1, '#94a3b8');
            C.text(ctx, pw > 240 ? 'epoll_wait 한 번으로 전부 기다림' : 'epoll_wait 한 번', x + 12, y + 136, { size: 11, weight: 600, color: U.tones.ok[1], base: 'middle' });
            C.card(ctx, { x: x + 10, y: y + 176, w: pw - 20, h: 62, t: '' });
            C.text(ctx, 'epoll 감시 목록', x + 20, y + 190, { size: 11, weight: 600, color: U.text, base: 'middle' });
            if (pw > 240) C.text(ctx, `fd ${num}개`, x + pw - 20, y + 190, { size: 10, align: 'right', base: 'middle' });
            cells(ctx, x + 20, y + 202, pw - 40, 28, 6, 3, share, '#a5b4fc');
          }
        });
        C.text(ctx, `스레드 ${num}개`, pw / 2, 300, { size: 12, weight: 700, color: U.tones.bad[1], align: 'center', base: 'middle' });
        C.text(ctx, '스레드 1개', pw + 12 + pw / 2, 300, { size: 12, weight: 700, color: U.tones.ok[1], align: 'center', base: 'middle' });
        C.wrap(ctx, note, w / 2, 328, w - 20, { color: U.text });
        say(note);
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
          C.line(ctx, [[LX(i), 94], [LX(i), 356]], '#cbd5e1', 1);
          ctx.restore();
        });
        steps.forEach(([label, a, b], i) => C.text(ctx, label, 0, (a + b) / 2, { size: 11, weight: i === si ? 700 : 500, color: i === si ? U.accent : i < si ? U.text : '#cbd5e1', base: 'middle' }));
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
          ctx.fillStyle = kind === 'run' ? U.blue : kind === 'watch' ? '#e2e8f0' : '#fff';
          ctx.fillRect(x - 6, a, 12, e - a);
          ctx.strokeStyle = kind === 'run' ? U.blue : '#94a3b8';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 5.5, a + 0.5, 11, Math.max(0, e - a - 1));
        });
        arrows.forEach(([from, to, ay, label, style]) => {
          const k = Math.max(0, Math.min(1, (y - ay) / 14));
          if (!k) return;
          const dir = Math.sign(LX(to) - LX(from)), color = style === 'wake' ? U.blue : '#64748b';
          C.arrow(ctx, [[LX(from) + dir * 7, ay], [LX(to) - dir * 7, ay]], k, color, { dash: style === 'dash' ? [4, 3] : null });
          ctx.globalAlpha = k;
          C.text(ctx, label, (LX(from) + LX(to)) / 2, ay - 7, { size: 10, color: style === 'wake' ? U.blue : U.text, align: 'center' });
          ctx.globalAlpha = 1;
        });
        C.dashed(ctx, x0 - 6, y, w, y, '#c7d2fe');
        C.wrap(ctx, steps[si][3], w / 2, 380, w - 20, { color: U.text });
        say(steps[si][3]);
      },
    });
  });
  // Node.js event loop: one main thread runs every callback; DB waits sit in the kernel. A heavy callback blocks the rest.
  document.querySelectorAll('[data-figure="cpu-eventloop"]').forEach((root) => {
    const WIN = 60, SEC = 5, HOLD = 1.4, PHASE = SEC + HOLD, HEAVY = '#f59e0b', IO = '#e2e8f0';
    const ARR = [1, 5, 9, 13, 18, 24, 30, 36], H = 2, JS = 1, DB = 12, WORK = 30, CHUNK = 5;
    // Main thread is a FIFO queue of ready callbacks; a split job re-queues itself behind whatever became ready meanwhile.
    const plan = (mode) => {
      const reqs = ARR.map((a, id) => ({ id, a, heavy: mode !== 'light' && id === H, segs: [], done: 0 }));
      const main = [], q = ARR.map((a, id) => ({ at: a, id, dur: JS, step: 'start' }));
      let now = 0;
      while (q.length) {
        q.sort((x, y) => x.at - y.at);
        const ev = q.shift(), r = reqs[ev.id], s = Math.max(now, ev.at), e = s + ev.dur;
        if (s > ev.at) r.segs.push({ s: ev.at, e: s, st: 'queue' });
        r.segs.push({ s, e, st: ev.heavy ? 'heavy' : 'run' });
        main.push({ s, e, heavy: !!ev.heavy });
        now = e;
        if (ev.step === 'start' && r.heavy) q.push(mode === 'block' ? { at: e, id: r.id, dur: WORK, heavy: true, step: 'last' } : { at: e, id: r.id, dur: CHUNK, heavy: true, step: 'chunk', left: WORK - CHUNK });
        else if (ev.step === 'start') { r.segs.push({ s: e, e: e + DB, st: 'io' }); q.push({ at: e + DB, id: r.id, dur: JS, step: 'last' }); }
        else if (ev.step === 'chunk' && ev.left > 0) q.push({ at: e, id: r.id, dur: CHUNK, heavy: true, step: 'chunk', left: ev.left - CHUNK });
        else r.done = e;
      }
      return { reqs, main };
    };
    const phases = [
      { mode: 'light', pill: '기다림은 커널에 맡김', tone: 'ok', note: '요청마다 JS는 1ms만 돈다. DB를 기다리는 동안 메인 스레드는 비어 있어서 다른 요청을 바로 받는다.' },
      { mode: 'block', pill: '무거운 계산이 루프를 막음', tone: 'bad', note: '무거운 계산 하나가 메인 스레드를 30ms 잡으면, DB 응답이 와 있어도 꺼내 갈 수 없어 모든 요청이 같이 늦어진다.' },
      { mode: 'split', pill: '무거운 계산을 쪼갬', tone: 'info', note: '계산을 5ms씩 쪼개 중간에 차례를 넘기면 다른 요청이 오래 막히지 않는다. 대신 무거운 요청은 조금 늦게 끝난다.' },
    ].map((p) => ({ ...p, ...plan(p.mode) }));
    const fill = (ctx, st) => (st === 'run' ? U.blue : st === 'heavy' ? HEAVY : st === 'io' ? IO : C.hatch(ctx, U.red));
    hwa.scene(root, {
      scenes: hwa.loopScenes(SEC, HOLD, phases.length),
      height: 350,
      still: PHASE + SEC,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, phases.length), p = phases[i];
        const cur = k * WIN;
        const x0 = 70, x1 = w - 40, X = (t) => x0 + t / WIN * (x1 - x0);
        const bar = (g, y, hh, color) => { if (g.s >= cur) return; const e = Math.min(g.e, cur); ctx.fillStyle = color; ctx.fillRect(X(g.s), y, Math.max(1, X(e) - X(g.s) - (g.e <= cur ? 0.5 : 0)), hh); };
        C.pill(ctx, 0, 0, p.pill, p.tone);
        C.text(ctx, 'JS를 돌리는 메인 스레드 1개', w, 11, { size: 10, align: 'right', base: 'middle' });
        const wide = w > 520;
        C.legend(ctx, 0, 44, [['JS 실행', U.blue], ['무거운 계산', HEAVY], [wide ? 'DB 응답 기다림 (커널)' : 'DB 기다림', IO], [wide ? '메인 스레드 차례 기다림' : '차례 기다림', C.hatch(ctx, U.red)]]);
        ctx.fillStyle = U.cell;
        ctx.fillRect(x0, 66, x1 - x0, 24);
        C.text(ctx, '메인 스레드', x0 - 8, 78, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        p.main.forEach((g) => bar(g, 66, 24, g.heavy ? HEAVY : U.blue));
        const light = [];
        p.reqs.forEach((r, k) => {
          const y = 106 + k * 18;
          ctx.fillStyle = U.cell;
          ctx.fillRect(x0, y, x1 - x0, 12);
          C.text(ctx, r.heavy ? '무거운 요청' : `요청 ${k + 1}`, x0 - 8, y + 6, { size: 10, color: r.heavy ? '#b45309' : U.muted, align: 'right', base: 'middle' });
          r.segs.forEach((g) => bar(g, y, 12, fill(ctx, g.st)));
          if (r.done <= cur) {
            if (!r.heavy) light.push(r.done - r.a);
            C.text(ctx, `${Math.round(r.done - r.a)}ms`, X(r.done) + 4, y + 6, { size: 10, weight: 600, color: r.heavy ? '#b45309' : U.text, base: 'middle' });
          }
        });
        C.dashed(ctx, X(cur), 62, X(cur), 250);
        C.text(ctx, '0ms', x0, 254, { size: 10, base: 'top' });
        C.text(ctx, '60ms', x1, 254, { size: 10, align: 'right', base: 'top' });
        const avg = light.length ? Math.round(light.reduce((a, b) => a + b, 0) / light.length) : 0;
        C.text(ctx, `가벼운 요청 평균 응답 시간 ${avg}ms`, 0, 288, { size: 12, weight: 600, color: U.text, base: 'middle' });
        C.wrap(ctx, p.note, w / 2, 320, w - 20, { color: U.tones[p.tone][1] });
        say(p.note);
      },
    });
  });
  // Response size and CPU: JSON conversion time grows with bytes; a big one holds the vCPU while others queue.
  document.querySelectorAll('[data-figure="cpu-serialize"]').forEach((root) => {
    const MOVE = 1, CELL = 0.22, GAP = 0.35, HOLD = 1.6, SLOTS = 16;
    const tag = (ctx, s, cx, cy, [bg, fg]) => {
      ctx.font = U.font(11, 700);
      const tw = ctx.measureText(s).width + 14;
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2, cy - 10, tw, 20, 6);
      ctx.fillStyle = bg;
      ctx.fill();
      C.text(ctx, s, cx, cy + 0.5, { size: 11, weight: 700, color: fg, align: 'center', base: 'middle' });
    };
    // Actions run one after another: ['mv', id, from, to], ['fill', id, cells], ['out', id].
    const SC = [
      { size: '50KB', pill: '작은 응답 50KB', tone: 'ok', note: '응답이 작으면 JSON 변환이 금방 끝나서 실행 대기 줄이 비어 있다.',
        acts: [['mv', 'A', 'user', 'runq'], ['mv', 'A', 'runq', 'cpu'], ['fill', 'A', 1], ['out', 'A'], ['mv', 'B', 'user', 'runq'], ['mv', 'B', 'runq', 'cpu'], ['fill', 'B', 1], ['out', 'B']] },
      { size: '800KB', pill: '큰 응답 800KB', tone: 'bad', note: '응답이 크면 변환하는 동안 vCPU를 오래 잡는다. 그동안 들어온 요청은 실행 대기 줄에서 기다린다.',
        acts: [['mv', 'A', 'user', 'runq'], ['mv', 'A', 'runq', 'cpu'], ['fill', 'A', 6], ['mv', 'B', 'user', 'runq'], ['fill', 'A', 5], ['mv', 'C', 'user', 'runq'], ['fill', 'A', 5], ['out', 'A']] },
    ];
    const len = (a) => (a[0] === 'fill' ? a[2] * CELL : MOVE);
    SC.forEach((sc) => { sc.T = [0]; sc.acts.forEach((a, i) => sc.T.push(sc.T[i] + len(a) + GAP)); sc.span = sc.T[sc.acts.length] + HOLD; });
    const START = [0, SC[0].span], CYCLE = SC[0].span + SC[1].span;
    // State before action i: where each request is, the run queue order, cells filled by the request on the vCPU.
    const stateAt = (sc, i) => {
      const st = { at: {}, q: [], fill: 0 };
      sc.acts.slice(0, i).forEach(([kind, id, a, b]) => {
        if (kind === 'fill') st.fill += a;
        else if (kind === 'out') delete st.at[id];
        else {
          st.q = st.q.filter((x) => x !== id);
          st.at[id] = b;
          if (b === 'runq') st.q.push(id);
          if (b === 'cpu') st.fill = 0;
        }
      });
      return st;
    };
    hwa.scene(root, {
      height: 300,
      still: START[1] + SC[1].T[5] + MOVE * 0.6,
      scenes: { n: 2, at: (i) => START[i], of: (t) => ((t % CYCLE) < START[1] ? 0 : 1) },
      frame: (ctx, w, h, time, say) => {
        const u = time % CYCLE, si = u < START[1] ? 0 : 1, sc = SC[si], t0 = u - START[si], n = sc.acts.length;
        let ai = 0;
        while (ai < n - 1 && sc.T[ai + 1] <= t0) ai++;
        const ended = t0 >= sc.T[n], act = sc.acts[ai], k = ended ? 1 : Math.min(1, (t0 - sc.T[ai]) / len(act));
        const st = stateAt(sc, ended ? n : ai), live = ended ? null : act;
        // Base map: the user on the left, then the server's kernel and hardware.
        const ow = Math.min(96, w * 0.22), sx = ow + 10, bx = sx + 8, bw = w - sx - 16;
        C.box(ctx, sx, 32, w - sx, 196, { fill: '#fff', r: 10 });
        C.text(ctx, '서버', sx + 10, 46, { size: 10, weight: 600, color: U.text });
        const band = (y, bh, label) => { C.box(ctx, bx, y, bw, bh, { fill: U.plot, r: 8 }); C.text(ctx, label, bx + 8, y + 13, { size: 10 }); };
        band(54, 76, '커널');
        const aw = bw - 22, A = [aw * 0.3, aw * 0.7], ax = [bx + 8, bx + 14 + A[0]], ay = 72;
        ['소켓', '실행 대기 줄'].forEach((s0, i) => {
          C.box(ctx, ax[i], ay, A[i], 50, { fill: '#fff', r: 6 });
          C.text(ctx, s0, ax[i] + A[i] / 2, ay + 11, { size: 10, align: 'center', base: 'middle' });
        });
        band(136, 84, '하드웨어');
        const hy = 152, hh = 62, vx = ax[1], vw = A[1];
        C.box(ctx, ax[0], hy, A[0], hh, { fill: '#fff', r: 6 });
        C.text(ctx, '랜카드', ax[0] + A[0] / 2, hy + hh / 2 + 0.5, { size: 10, weight: 600, color: U.text, align: 'center', base: 'middle' });
        C.box(ctx, vx, hy, vw, hh, { fill: '#fff', r: 6 });
        C.text(ctx, 'vCPU 0', vx + 6, hy + 10, { size: 9 });
        const filling = live && live[0] === 'fill', onCpu = Object.values(st.at).includes('cpu') || (live && live[0] === 'mv' && live[3] === 'cpu' && k >= 1);
        C.text(ctx, filling ? 'USER: JSON 변환' : onCpu ? 'USER' : 'IDLE', vx + vw - 8, hy + 10, { size: 9, weight: 700, color: onCpu || filling ? U.blue : U.muted, align: 'right' });
        // Conversion cells: one cell is the same slice of CPU time.
        const done = st.fill + (filling ? k * live[2] : 0), cw = (vw - 16 - (SLOTS - 1) * 2) / SLOTS;
        for (let j = 0; j < SLOTS; j++) {
          const x = vx + 8 + j * (cw + 2), part = Math.max(0, Math.min(1, done - j));
          ctx.fillStyle = U.cell;
          ctx.fillRect(x, hy + 44, cw, 10);
          if (part > 0) { ctx.globalAlpha = part; ctx.fillStyle = U.blue; ctx.fillRect(x, hy + 44, cw, 10); ctx.globalAlpha = 1; }
        }
        const Y = ay + 32, P = {
          user: [ow / 2, 100], nic: [ax[0] + A[0] / 2, hy + hh / 2], sock: [ax[0] + A[0] / 2, Y], cpu: [vx + vw / 2, hy + 26],
        };
        const qp = (i) => [ax[1] + 34 + i * 58, Y];
        C.box(ctx, 0, 82, ow, 36, { fill: '#fff', r: 6 });
        C.text(ctx, '사용자', P.user[0], P.user[1] + 0.5, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
        const lk = ow + 5;
        C.line(ctx, [[ow, P.user[1]], [lk, P.user[1]], [lk, P.nic[1]], [ax[0], P.nic[1]]], '#cbd5e1', 1);
        C.dashed(ctx, P.nic[0], hy, P.nic[0], ay + 50);
        const at = (id) => (st.at[id] === 'runq' ? qp(st.q.indexOf(id)) : P[st.at[id]]);
        const tone = (where) => (where === 'cpu' ? U.tones.info : U.tones.warn);
        Object.keys(st.at).forEach((id) => { if (!live || live[1] !== id || live[0] === 'fill') tag(ctx, `요청 ${id}`, ...at(id), tone(st.at[id])); });
        if (live && live[0] !== 'fill') {
          const id = live[1], back = [P.nic, [lk, P.nic[1]], [lk, P.user[1]], P.user];
          let path, label = `요청 ${id}`, col = U.tones.warn;
          if (live[0] === 'out') { path = [P.cpu, ...back]; label = `응답 ${sc.size}`; col = U.tones.ok; }
          else if (live[3] === 'runq') path = [...back.slice().reverse(), P.sock, qp(st.q.length)];
          else { const q0 = at(id); path = [q0, [q0[0], P.cpu[1]], P.cpu]; col = k >= 1 ? U.tones.info : U.tones.warn; }
          const [px, py] = C.pathAt(path, hwa.smooth(k)).pop();
          if (!(live[0] === 'out' && k >= 1)) tag(ctx, label, px, py, col);
        }
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        C.text(ctx, '칸 하나 = 50KB 변환 시간', w, 11, { size: 10, align: 'right', base: 'middle' });
        C.wrap(ctx, sc.note, w / 2, h - 34, w - 16, { color: U.tones[sc.tone][1] });
        say(`${sc.pill}. ${sc.note}`);
      },
    });
  });
  // Group: lscpu build-up, context switch cost, hyper-threading (own helpers in this block).
  {
    const TH = { A: ['#dbeafe', '#1d4ed8'], B: ['#ede9fe', '#6d28d9'] }, COL = ['#3b82f6', '#8b5cf6'];

    // Centered rounded label; returns its width.
    const tag = (ctx, s, cx, cy, [bg, fg], { size = 11, h = 20, alpha = 1, stroke } = {}) => {
      ctx.font = U.font(size, 700);
      const tw = ctx.measureText(s).width + 14;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2, cy - h / 2, tw, h, 6);
      ctx.fillStyle = bg;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
      C.text(ctx, s, cx, cy + 0.5, { size, weight: 700, color: fg, align: 'center', base: 'middle' });
      ctx.globalAlpha = 1;
      return tw;
    };
    // Counted cells: cap empty slots, list[i] = { c, k } fills slot i, growing in as k goes 0 to 1.
    const cells = (ctx, x, y, cols, pitch, cap, list, empty = '#eef2f6') => {
      const s = pitch - (pitch < 9 ? 1 : 2);
      for (let i = 0; i < cap; i++) {
        const cx = x + (i % cols) * pitch, cy = y + Math.floor(i / cols) * pitch, it = list[i];
        ctx.fillStyle = empty;
        ctx.fillRect(cx, cy, s, s);
        if (it && it.k > 0) {
          const d = (s * (1 - it.k)) / 2;
          ctx.fillStyle = it.c;
          ctx.fillRect(cx + d, cy + d, s - 2 * d, s - 2 * d);
        }
      }
    };
    const clock = (ctx, x, y, r, a, color) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      C.line(ctx, [[x, y], [x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2)]], color, 1.5);
    };
    const lerp = (a, b, k) => a + (b - a) * k;

    // ---------- cpu-count ----------
    const FORMULA = (ctx, y, lit) => {
      const parts = [['소켓 1', 0], ['×'], ['코어 16', 1], ['×'], ['스레드 2', 2], ['='], ['CPU(s) 32', 3]];
      let x = 0;
      parts.forEach(([s0, idx]) => {
        if (idx === undefined) { C.text(ctx, s0, x + 6, y + 0.5, { size: 12, weight: 600, align: 'center', base: 'middle' }); x += 12; return; }
        const on = idx <= lit;
        ctx.font = U.font(11, 600);
        const cw = ctx.measureText(s0).width + 16;
        ctx.beginPath();
        ctx.roundRect(x, y - 11, cw, 22, 6);
        ctx.fillStyle = on ? U.tones.info[0] : U.cell;
        ctx.fill();
        C.text(ctx, s0, x + 8, y + 0.5, { weight: 600, color: on ? U.tones.info[1] : U.muted, base: 'middle' });
        x += cw + 4;
      });
    };

    document.querySelectorAll('[data-figure="cpu-count"]').forEach((root) => {
      const narrow = root.clientWidth < 600, COLS = narrow ? 4 : 8, ROWS = 16 / COLS, CH = 50, GAP = 6, STEP = 1.5, HOLD = 2.8;
      const SY = 32, SH = 26 + ROWS * (CH + GAP) + 4;
      hwa.scene(root, {
        height: SY + SH + 76,
        still: 0.5 + 2 * STEP + 1,
        frame: (ctx, w, h, time, say) => {
          // The empty socket shows briefly, then cores and vCPUs fill in.
          const t = time % (0.5 + 2 * STEP + HOLD), pos = Math.min(3, t < 0.5 ? t / 0.5 : 1 + (t - 0.5) / STEP), s = { done: pos >= 3, active: Math.min(2, Math.floor(pos)) };
          const kc = (c) => hwa.smooth((pos - 1 - c * 0.04) / 0.2), kv = (c) => hwa.smooth((pos - 2 - c * 0.04) / 0.2);
          let cores = 0;
          for (let c = 0; c < 16; c++) if (kc(c) >= 1) cores++;
          const lit = s.done ? 3 : s.active;
          C.pill(ctx, 0, 0, s.done ? 'CPU(s): 32' : ['Socket(s): 1', `Core(s) per socket: ${cores}`, 'Thread(s) per core: 2'][s.active], 'info');
          C.box(ctx, 0, SY, w, SH, { fill: U.plot, r: 10, on: s.active === 0 });
          C.text(ctx, '소켓 0 (CPU 칩)', 10, SY + 17, { size: 11, weight: 600, color: U.text });
          if (pos >= 2) C.text(ctx, '칸 안 숫자 = vCPU 번호', w - 10, SY + 17, { size: 10, align: 'right' });
          const cw = (w - 20 - (COLS - 1) * GAP) / COLS;
          for (let c = 0; c < 16; c++) {
            const k = kc(c);
            if (k <= 0) continue;
            const x = 10 + (c % COLS) * (cw + GAP), y = SY + 26 + Math.floor(c / COLS) * (CH + GAP);
            ctx.globalAlpha = k;
            C.box(ctx, x, y, cw, CH, { fill: '#fff', stroke: '#cbd5e1', r: 6, on: s.active === 1 });
            C.text(ctx, `코어 ${c}`, x + 6, y + 11, { size: 9, weight: 600, color: U.text, base: 'middle' });
            const v = kv(c), pw = (cw - 16) / 2;
            for (let j = 0; j < 2 && v > 0; j++) {
              const px = x + 6 + j * (pw + 4), py = y + 20;
              ctx.globalAlpha = k * v;
              ctx.beginPath();
              ctx.roundRect(px, py, pw, CH - 26, 4);
              ctx.fillStyle = TH['AB'[j]][0];
              ctx.fill();
              C.text(ctx, String(c * 2 + j), px + pw / 2, py + (CH - 26) / 2 + 0.5, { size: 10, weight: 700, color: TH['AB'[j]][1], align: 'center', base: 'middle' });
            }
            ctx.globalAlpha = 1;
          }
          FORMULA(ctx, SY + SH + 24, lit);
          C.wrap(ctx, 'vCPU는 코어 안에, 코어는 소켓 안에 있다', w / 2, h - 14, w - 16, { color: U.tones.info[1] });
          say(`소켓 1개 안에 코어 ${cores}개, 코어마다 vCPU 2개. lscpu의 CPU(s)는 32다.`);
        },
      });
    });

    // ---------- cpu-switch ----------
    document.querySelectorAll('[data-figure="cpu-switch"]').forEach((root) => {
      const TU = 0.25, N = 24, SEC = N * TU, HOLD = 1.8;
      // Thread run lengths alternate A and B; each switch takes two time units.
      const pat = (work) => {
        const out = [];
        let who = 'A';
        while (out.length < N) {
          for (let i = 0; i < work && out.length < N; i++) out.push(who);
          for (let i = 0; i < 2 && out.length < N; i++) out.push('S');
          who = who === 'A' ? 'B' : 'A';
        }
        return out;
      };
      const SC = [
        { seq: pat(7), pill: '가끔 바꿀 때', tone: 'ok', note: '차례를 길게 주면 전환에 쓰는 칸이 적다' },
        { seq: pat(2), pill: '자주 바꿀 때', tone: 'warn', note: '자주 바꾸면 같은 시간에 USER 칸이 줄어든다' },
      ];
      hwa.scene(root, {
        height: 282,
        still: SEC + HOLD + 1.6,
        scenes: hwa.loopScenes(SEC, HOLD, 2),
        frame: (ctx, w, h, time, say) => {
          const L = hwa.loop(time, SEC, HOLD, 2), sc = SC[L.i], seq = sc.seq, at = L.t / TU, u = Math.min(N - 1, Math.floor(at)), fr = L.t >= SEC ? 1 : at - u, cur = seq[u];
          C.pill(ctx, 0, 0, sc.pill, sc.tone);
          C.text(ctx, '전환 비용은 크게 그림', w, 15, { size: 10, align: 'right' });
          // Base map: the vCPU with its register, and kernel memory with a save slot per thread.
          const cw = Math.min(300, w * 0.46), my = 32, mh = 100;
          C.group(ctx, 0, my, cw, mh, 'CPU');
          C.box(ctx, 10, my + 24, cw - 20, mh - 34, { fill: '#fff', stroke: cur === 'S' ? '#cbd5e1' : COL[cur === 'A' ? 0 : 1], r: 8 });
          C.text(ctx, 'vCPU', 20, my + 40, { size: 10, weight: 600, color: U.text });
          const reg = [cw / 2, my + 66];
          C.box(ctx, reg[0] - 40, reg[1] - 14, 80, 28, { fill: U.plot, dash: [3, 3], r: 6 });
          const mx = cw + 12, mw = w - mx;
          C.group(ctx, mx, my, mw, mh, '메모리 (커널)');
          const slot = { A: [mx + mw - 34, my + 44], B: [mx + mw - 34, my + 78] };
          ['A', 'B'].forEach((k) => {
            C.box(ctx, mx + 10, slot[k][1] - 15, mw - 20, 30, { fill: '#fff', r: 6 });
            C.text(ctx, `${k} 저장칸`, mx + 20, slot[k][1] + 0.5, { size: 10, base: 'middle' });
          });
          // Who sits in the register; during a switch the old state goes out, then the new one comes in.
          let last = 'A';
          for (let i = u; i >= 0; i--) if (seq[i] !== 'S') { last = seq[i]; break; }
          const next = last === 'A' ? 'B' : 'A', other = { A: 'B', B: 'A' };
          if (cur === 'S') {
            const p = (seq[u - 1] === 'S' ? 0.5 : 0) + fr / 2, ps = hwa.smooth(p / 0.5), pl = hwa.smooth((p - 0.5) / 0.5);
            const pos = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
            const pa = pos(reg, slot[last], ps), pb = pos(slot[next], reg, pl);
            tag(ctx, last, pa[0], pa[1], TH[last]);
            tag(ctx, next, pb[0], pb[1], TH[next]);
            C.text(ctx, '전환 중', cw - 20, my + 40, { size: 10, weight: 700, color: U.tones.warn[1], align: 'right' });
          } else {
            tag(ctx, `작업 ${cur}`, reg[0], reg[1], TH[cur]);
            tag(ctx, other[cur], slot[other[cur]][0], slot[other[cur]][1], TH[other[cur]]);
          }
          // Each time unit drops one cell into the work or switch pile.
          const work = [], swc = [];
          for (let i = 0; i <= u; i++) (seq[i] === 'S' ? swc : work).push({ c: seq[i] === 'S' ? '#94a3b8' : COL[seq[i] === 'A' ? 0 : 1], k: i < u ? 1 : hwa.smooth(fr / 0.5) });
          const pitch = Math.min(18, (w - 24) / 16), gy = my + mh + 40;
          [['USER', work, 24, 0], ['SYSTEM (전환)', swc, 12, 1]].forEach(([title, list, cap, j]) => {
            const x = j ? w / 2 + 12 : w / 2 - 12 - pitch * 8;
            C.text(ctx, title, x, gy - 10, { size: 11, weight: 600, color: U.text });
            C.text(ctx, `${list.filter((c) => c.k >= 1).length}`, x + pitch * 8 - 2, gy - 10, { size: 14, weight: 700, color: j ? U.tones.warn[1] : U.text, align: 'right' });
            cells(ctx, x, gy, 8, pitch, cap, list);
          });
          C.wrap(ctx, sc.note, w / 2, h - 22, w - 16, { color: U.tones[sc.tone][1] });
          say(`${sc.pill}: USER ${work.length}칸, SYSTEM(전환) ${swc.length}칸. ${sc.note}.`);
        },
      });
    });

    // ---------- cpu-ht ----------
    // Per time unit: who holds the execution unit and each thread's state (run, memory wait with progress, ready).
    const htSim = (n, cmp, mem, win) => {
      const th = Array.from({ length: n }, (_, i) => ({ need: cmp, left: i && mem ? 5 : 0 })), out = [];
      let last = -1;
      for (let t = 0; t < win; t++) {
        const ready = th.map((x, i) => (x.left === 0 ? i : -1)).filter((i) => i >= 0);
        const id = ready.length > 1 ? ready.find((i) => i !== last) : ready.length ? ready[0] : -1;
        out.push({ id, st: th.map((x, i) => (i === id ? ['run'] : x.left > 0 ? ['wait', (mem - x.left) / mem] : ['ready'])) });
        th.forEach((x, i) => { if (i !== id && x.left > 0) x.left--; });
        if (id >= 0) { const x = th[id]; if (--x.need === 0) { x.need = cmp; x.left = mem; } last = id; }
      }
      return out;
    };
    const htFig = (nodes, SC) => nodes.forEach((root) => {
      const TU = 0.15, WIN = 36, SEC = WIN * TU, HOLD = 1.8, MEM = 8;
      const runs = SC.map((s) => htSim(s.n, 4, s.mem ? MEM : 0, WIN));
      hwa.scene(root, {
        height: 300,
        still: SEC + HOLD + SEC * 0.6,
        scenes: hwa.loopScenes(SEC, HOLD, SC.length),
        frame: (ctx, w, h, time, say) => {
          const L = hwa.loop(time, SEC, HOLD, SC.length), sc = SC[L.i], run = runs[L.i];
          const at = L.t / TU, u = Math.min(WIN - 1, Math.floor(at)), fr = L.t >= SEC ? 1 : at - u, step = run[u];
          C.pill(ctx, 0, 0, sc.n === 1 ? '하이퍼스레딩 끔' : '하이퍼스레딩 켬', sc.n === 1 ? 'info' : 'ok');
          C.text(ctx, sc.mem ? '메모리를 자주 기다리는 일' : '계산만 하는 일', w, 15, { size: 10, align: 'right' });
          const memW = Math.min(110, w * 0.24), cw = w - memW - 28, cy = 32;
          C.group(ctx, 0, cy, cw, 134, '코어 하나');
          const sw = (cw - 28) / 2, sy = cy + 26;
          [0, 1].forEach((i) => {
            const sx = 10 + i * (sw + 8);
            if (i >= sc.n) {
              C.box(ctx, sx, sy, sw, 50, { fill: U.plot, dash: [4, 4], stroke: '#cbd5e1' });
              C.text(ctx, '꺼짐', sx + sw / 2, sy + 25.5, { size: 11, align: 'center', base: 'middle' });
              return;
            }
            const [state] = step.st[i], k = 'AB'[i];
            C.box(ctx, sx, sy, sw, 50, { fill: '#fff', stroke: state === 'run' ? COL[i] : U.grid });
            C.text(ctx, `vCPU ${i}`, sx + 6, sy + 11, { size: 9 });
            tag(ctx, k, sx + sw / 2, sy + 20, TH[k], { h: 18 });
            C.text(ctx, { run: '계산 중', wait: '메모리 기다림', ready: '차례 기다림' }[state], sx + sw / 2, sy + 40, { size: 9, color: state === 'run' ? COL[i] : U.muted, align: 'center', base: 'middle' });
          });
          const ex = 10, ey = sy + 60, ew = cw - 20, own = step.id;
          C.box(ctx, ex, ey, ew, 38, { fill: own >= 0 ? TH['AB'[own]][0] : U.cell, stroke: own >= 0 ? COL[own] : '#cbd5e1' });
          C.text(ctx, own >= 0 ? `실행 장치: ${'AB'[own]} 계산` : '실행 장치: IDLE', ex + ew / 2, ey + 19.5, { size: 11, weight: 700, color: own >= 0 ? COL[own] : U.muted, align: 'center', base: 'middle' });
          // Memory, with each waiting thread's request going out and back.
          const mx = w - memW;
          C.box(ctx, mx, ey - 6, memW, 50, { fill: '#fff' });
          C.text(ctx, '메모리', mx + memW / 2, ey + 9, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
          C.text(ctx, '약 100ns', mx + memW / 2, ey + 27, { size: 9, align: 'center', base: 'middle' });
          const lx0 = cw + 2, lx1 = mx - 2, ly = ey + 19;
          C.dashed(ctx, lx0, ly, lx1, ly);
          step.st.forEach(([state, p], i) => {
            if (state !== 'wait') return;
            const q = Math.min(1, p + fr / MEM), d = q < 0.5 ? q * 2 : 2 - q * 2;
            ctx.beginPath();
            ctx.arc(lerp(lx0, lx1, d), ly + (i ? 6 : -6) * (sc.n - 1), 4.5, 0, Math.PI * 2);
            ctx.fillStyle = COL[i];
            ctx.fill();
          });
          // Each time unit drops one cell into the busy or idle pile.
          const busy = [], idle = [];
          for (let t = 0; t <= u; t++) {
            const id = run[t].id, it = { c: id >= 0 ? COL[id] : '#94a3b8', k: t < u ? 1 : hwa.smooth(fr / 0.5) };
            (id >= 0 ? busy : idle).push(it);
          }
          const pitch = Math.min(13, (w - 24) / 24), gy = cy + 134 + 36;
          [['USER 칸', busy, 0], ['IDLE 칸', idle, 1]].forEach(([title, list, j]) => {
            const x = j ? w / 2 + 12 : w / 2 - 12 - pitch * 12;
            C.text(ctx, title, x, gy - 10, { size: 11, weight: 600, color: U.text });
            C.text(ctx, `${list.filter((c) => c.k >= 1).length}`, x + pitch * 12 - 2, gy - 10, { size: 14, weight: 700, color: j ? U.muted : U.tones.ok[1], align: 'right' });
            cells(ctx, x, gy, 12, pitch, WIN, list);
          });
          C.wrap(ctx, sc.note, w / 2, h - 24, w - 16, { color: U.tones.info[1] });
          say(`${sc.n === 1 ? '하이퍼스레딩을 끄면' : '하이퍼스레딩을 켜면'} 실행 장치가 ${busy.length}칸 일하고 ${idle.length}칸 IDLE이다. ${sc.note}.`);
        },
      });
    });
    const OFF = { n: 1, mem: true, note: '끄면 A가 메모리를 기다리는 동안 실행 장치가 IDLE이다' };
    const ON = { n: 2, mem: true, note: '켜면 A가 기다리는 틈에 B가 계산해서 IDLE 칸이 줄어든다' };
    htFig(document.querySelectorAll('[data-figure="cpu-ht"]'), [OFF, ON, { n: 2, mem: false, note: '계산만 하는 일은 채울 틈이 없다. A와 B가 실행 장치 하나를 나눠 쓴다' }]);
  }

  // Group: CFS run queue, CPU usage cells (own helpers in this block).
  {
    const STY = {
      run: ['#dbeafe', '#1d4ed8', '#93c5fd'], wait: ['#fff', U.text, '#cbd5e1'], sleep: [U.cell, U.muted, U.grid],
      A: ['#dbeafe', '#1d4ed8', '#93c5fd'], B: ['#ede9fe', '#6d28d9', '#c4b5fd'],
    };
    const tchip = (ctx, id, x, y, style, sub, cw = 40) => {
      const [bg, fg, line] = STY[style], ch = sub ? 34 : 20;
      ctx.beginPath();
      ctx.roundRect(x - cw / 2 + 0.5, y - ch / 2 + 0.5, cw - 1, ch - 1, 6);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.stroke();
      C.text(ctx, id, x, sub ? y - 6 : y + 0.5, { weight: 600, color: fg, align: 'center', base: 'middle' });
      if (sub) C.text(ctx, sub, x, y + 9, { size: 10, color: fg, align: 'center', base: 'middle' });
    };
    // Base-map region: thin outline, muted label, so only moving chips carry colour.
    const region = (ctx, x, y, w, h, label, { dash, fill = '#fff', right } = {}) => {
      C.box(ctx, x, y, w, h, { fill, dash });
      if (label) C.text(ctx, label, x + 8, y + 14, { size: 10, weight: 600, color: U.muted });
      if (right) C.text(ctx, right, x + w - 8, y + 14, { size: 10, color: U.muted, align: 'right' });
    };
    const ang = (f) => -Math.PI / 2 + f * Math.PI * 2;
    const arc = (ctx, cx, cy, R, a0, a1, color, lw) => {
      ctx.beginPath();
      ctx.arc(cx, cy, R, ang(a0), ang(a1));
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.lineWidth = 1;
    };
    const cell = (ctx, x, y, s, fill, stroke) => {
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, s, s, 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.stroke();
    };
    const textW = (ctx, s, size = 10, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
    const pillW = (ctx, s) => textW(ctx, s, 11, 600) + 30;
    const corner = (ctx, w, pill, s) => { if (pillW(ctx, pill) + 16 + textW(ctx, s) < w) C.text(ctx, s, w, 15, { size: 10, align: 'right' }); };
    const note = (ctx, w, h, s, tone) => C.wrap(ctx, s, w / 2, h - 28, w - 16, { color: U.tones[tone][1] });
    const lerp = (a, b, f) => a + (b - a) * f;
    const mv = (p, q, f) => [lerp(p[0], q[0], f), lerp(p[1], q[1], f)];

    // Data: CFS runs the leftmost (least vruntime) task next. docs.kernel.org/scheduler/sched-design-CFS.html
    document.querySelectorAll('[data-figure="cpu-hierarchy"]').forEach((root) => {
      const RUN = 1.2, D = 0.4, EV = RUN + 5 * D + 0.3, SL = 4, CW = 46, QY = 224, ZY = 268;
      const states = [{ used: { 작업1: 4, 작업2: 6, 작업3: 10, 작업4: 14, 작업5: 18 }, run: '작업1', q: ['작업2', '작업3', '작업4', '작업5'], sleep: [], last: null }];
      const ins = (s, id) => { const i = s.q.findIndex((x) => s.used[x] > s.used[id]); if (i < 0) s.q.push(id); else s.q.splice(i, 0, id); };
      // Every third turn the thread sleeps on I/O for two turns; otherwise it rejoins the queue by time used.
      const stateAt = (n) => {
        while (states.length <= n) {
          const e = states.length - 1, s = JSON.parse(JSON.stringify(states[e])), cur = s.run, io = e % 3 === 2;
          s.used[cur] += SL;
          s.sleep.filter((z) => z.until <= e).forEach((z) => ins(s, z.id));
          s.sleep = s.sleep.filter((z) => z.until > e);
          if (io) s.sleep.push({ id: cur, until: e + 2 }); else ins(s, cur);
          s.run = s.q.shift();
          s.last = { cur, io, next: s.run };
          states.push(s);
        }
        return states[n];
      };
      hwa.scene(root, {
        height: 356,
        still: EV * 2 + RUN + 0.7,
        frame: (ctx, w, h, time, say) => {
          const n = Math.floor(time / EV), t = time - n * EV, a = stateAt(n), b = stateAt(n + 1);
          const v1W = 64, v0W = w - 58 - v1W, regX = 24 + v0W - 12 - CW / 2, regY = 119;
          const sleepX = 24 + textW(ctx, 'I/O 대기', 10, 600) + 14 + CW / 2;
          const pos = (s, id) => {
            if (s.run === id) return [regX, regY, 'run'];
            const qi = s.q.indexOf(id);
            if (qi >= 0) return [24 + CW / 2 + qi * (CW + 8), QY, 'wait'];
            return [sleepX + s.sleep.findIndex((z) => z.id === id) * (CW + 8), ZY, 'sleep'];
          };
          const pill = t < RUN ? `${a.run} 실행 중, 쓴 시간 증가` : b.last.io ? `${b.last.cur} I/O 대기로 빠짐, ${b.last.next} 올라감` : `${b.last.cur} 차례 끝, ${b.last.next} 올라감`;
          const tone = t < RUN ? 'info' : b.last.io ? 'ok' : 'warn';
          C.pill(ctx, 0, 0, pill, tone);
          corner(ctx, w, pill, '칩 하나 = 실행할 작업 하나');

          region(ctx, 0, 30, w, 276, '서버', { fill: U.plot });
          region(ctx, 8, 50, w - 16, 104, '소켓 (물리 CPU)', { right: '코어 16개 중 1개' });
          region(ctx, 16, 72, w - 32, 76, '코어 0', { fill: U.plot });
          region(ctx, 24, 94, v0W, 48, 'vCPU 0');
          C.box(ctx, regX - CW / 2 - 3, regY - 20, CW + 6, 40, { dash: [3, 3] });
          region(ctx, 34 + v0W, 94, v1W, 48, 'vCPU 1', { dash: [3, 3] });

          region(ctx, 8, 162, w - 16, 136, '메모리, 커널 영역', { fill: U.plot });
          region(ctx, 16, 184, w - 32, 60, 'vCPU 0 실행 대기 줄', { right: '왼쪽일수록 덜 씀' });
          C.box(ctx, 16, 250, w - 32, 40);
          C.text(ctx, 'I/O 대기', 24, ZY + 0.5, { size: 10, weight: 600, color: U.muted, base: 'middle' });

          // One move per stage: open a gap, wakers join, the old task leaves, the next one goes up, the queue closes.
          const ids = Object.keys(a.used), c = b.last.cur, nx = b.last.next, wk = a.sleep.filter((z) => !b.sleep.some((y) => y.id === z.id)).map((z) => z.id);
          const lay = [nx, ...b.q], qp = (id) => [24 + CW / 2 + lay.indexOf(id) * (CW + 8), QY, 'wait'];
          const S = [Object.fromEntries(ids.map((id) => [id, pos(a, id)]))];
          const step = (fn) => { const p = { ...S[S.length - 1] }; fn(p); if (JSON.stringify(p) !== JSON.stringify(S[S.length - 1])) S.push(p); };
          step((p) => b.q.forEach((id) => { if (id !== c && !wk.includes(id)) p[id] = qp(id); }));
          step((p) => wk.forEach((id) => { p[id] = qp(id); }));
          step((p) => { p[c] = b.q.includes(c) ? qp(c) : pos(b, c); });
          step((p) => { p[nx] = pos(b, nx); });
          step((p) => ids.forEach((id) => { p[id] = pos(b, id); }));
          const u = t < RUN ? 0 : (t - RUN) / D, si = Math.min(S.length - 1, Math.floor(u)), fk = si >= S.length - 1 ? 1 : hwa.smooth(u - si);
          const from = S[si], to = S[Math.min(S.length - 1, si + 1)];
          ids.sort((x, y) => (from[x] !== to[x]) - (from[y] !== to[y])).forEach((id) => {
            const [x0, y0, s0] = from[id], [x1, y1, s1] = to[id];
            const used = id === a.run && t < RUN ? a.used[id] + Math.floor(SL * t / RUN) : b.used[id];
            tchip(ctx, id, lerp(x0, x1, fk), lerp(y0, y1, fk), fk < 0.5 ? s0 : s1, `${used}ms`, CW);
          });
          note(ctx, w, h, '숫자는 지금까지 쓴 CPU 시간. 가장 덜 쓴 작업이 다음 차례다.', 'info');
          say(`${pill}. 소켓 안 코어 0의 vCPU 0에 실행 중인 작업이 있고, 나머지는 메모리의 커널 대기 줄에서 쓴 시간이 적은 순서로 기다린다.`);
        },
      });
    });

    // Data: utilization is busy time over an interval. brendangregg.com/HeatMaps/utilization.html
    document.querySelectorAll('[data-figure="cpu-usage"]').forEach((root) => {
      const SEC = 7, HOLD = 1.8, CW = 40;
      const MODE = { u: ['USER', U.blue], s: ['SYSTEM', U.purple], '.': ['IDLE', '#cbd5e1'] };
      const P = [
        { pill: '한가한 CPU', tone: 'ok', seq: 'u..s...u....u...s...' },
        { pill: '바쁜 CPU', tone: 'bad', seq: 'uuus.uuuuus.uuuuuu.u' },
      ];
      hwa.scene(root, {
        scenes: hwa.loopScenes(SEC, HOLD, P.length),
        height: 290,
        still: SEC,
        frame: (ctx, w, h, time, say) => {
          const { i, k } = hwa.loop(time, SEC, HOLD, P.length), p = P[i], x20 = k * 20, done = Math.min(20, Math.floor(x20)), cur = done < 20 ? done : -1;
          const busy = [...p.seq.slice(0, done)].filter((c) => c !== '.').length, use = done ? Math.round(busy / done * 100) : 0;
          const at = Math.min(19, done), m = p.seq[at], prev = at ? p.seq[at - 1] : m, f = cur < 0 ? 1 : hwa.smooth((x20 - done) / 0.35);
          const [mode, col] = MODE[m];
          C.pill(ctx, 0, 0, p.pill, p.tone);
          // Base map: the vCPU inside its core, and the kernel's sleep area in memory.
          const cw = Math.min(w, 480), x0 = (w - cw) / 2, colW = (cw - 10) / 2;
          region(ctx, x0, 30, colW, 92, '코어 0', { fill: U.plot });
          region(ctx, x0 + 8, 50, colW - 16, 64, 'vCPU 0');
          C.text(ctx, cur < 0 ? '1초 끝' : mode, x0 + 16, 84, { size: 12, weight: 700, color: mode === 'IDLE' || cur < 0 ? U.muted : col });
          const slot = [x0 + colW - 16 - CW / 2, 98];
          C.box(ctx, slot[0] - CW / 2 - 3, slot[1] - 13, CW + 6, 26, { dash: [3, 3] });
          region(ctx, x0 + colW + 10, 30, colW, 92, '메모리, 커널 영역', { fill: U.plot });
          region(ctx, x0 + colW + 18, 50, colW - 16, 64, '요청 대기');
          const nest = [x0 + colW + 10 + colW / 2, 90], busyAt = (c) => c !== '.';
          const [cx, cy] = mv(busyAt(prev) ? slot : nest, busyAt(m) ? slot : nest, f);
          tchip(ctx, '작업', cx, cy, busyAt(m) ? 'run' : 'sleep', null, CW);

          C.text(ctx, '1초 기록, 칸 하나 50ms', x0, 146, { size: 10, weight: 600, color: U.muted });
          C.text(ctx, `사용률 ${use}%`, x0 + cw, 146, { size: 14, weight: 700, color: U.tones[p.tone][1], align: 'right' });
          const cs = (cw - 36) / 10;
          for (let j = 0; j < 20; j++) {
            const x = x0 + (j % 10) * (cs + 4), y = 156 + Math.floor(j / 10) * 34, c = MODE[p.seq[j]];
            ctx.beginPath();
            ctx.roundRect(x + 0.5, y + 0.5, cs - 1, 27, 4);
            ctx.globalAlpha = j === cur ? 0.35 : 1;
            ctx.fillStyle = j < done || j === cur ? c[1] : '#fff';
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = j === cur ? U.accent : j < done ? '#fff' : U.grid;
            ctx.lineWidth = j === cur ? 2 : 1;
            ctx.stroke();
            ctx.lineWidth = 1;
          }
          C.text(ctx, `IDLE 아닌 칸 ${busy} / 지난 칸 ${done}`, x0, 238, { size: 10 });
          C.legend(ctx, x0 + cw - 150, 234, Object.values(MODE).map(([s0, c]) => [s0, c]));
          note(ctx, w, h, '20칸이 1초. IDLE이 아닌 칸의 비율이 사용률이다.', p.tone);
          say(`${p.pill}. 작업이 실행될 때는 vCPU 0에 올라가고, IDLE일 때는 메모리에서 대기한다. 지난 ${done}칸 중 ${busy}칸이 IDLE이 아니라 사용률 ${use}%.`);
        },
      });
    });

  }

  // Group: cgroup quota base map with a multi-vCPU CFS simulator (own helpers in this block).
  {
    const TAU = Math.PI * 2, clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
    const CW = 28, ROW = 26, LW = 70, DT = 0.5, MAPW = 560;
    const lerp2 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

    // Chip colours by region: only moving parts get strong colour.
    const STY = {
      home: [U.cell, U.muted, '#cbd5e1'], run: ['#fef3c7', '#b45309', '#fbbf24'], cpu: ['#dbeafe', '#1d4ed8', '#3b82f6'],
      thr: ['#fee2e2', '#dc2626', '#f87171'], req: ['#ede9fe', '#6d28d9', '#a78bfa'], ok: ['#dcfce7', '#15803d', '#4ade80'], bad: ['#fee2e2', '#dc2626', '#f87171'],
    };
    const chip = (ctx, id, [x, y], st, dot) => {
      const [bg, fg, line] = STY[st] || STY.home;
      ctx.font = U.font(10, 700);
      const cw = Math.max(CW, ctx.measureText(id).width + 12);
      ctx.beginPath();
      ctx.roundRect(x - cw / 2 + 0.5, y - 9.5, cw - 1, 19, 6);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.lineWidth = 1;
      C.text(ctx, id, x, y + 0.5, { size: 10, weight: 700, color: fg, align: 'center', base: 'middle' });
      if (dot) { ctx.beginPath(); ctx.arc(x + cw / 2 - 2, y - 8, 4, 0, TAU); ctx.fillStyle = '#7c3aed'; ctx.fill(); }
    };
    const sector = (ctx, cx, cy, R, r, a, b, fill) => {
      if (b <= a) return;
      const s = -Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, s + a * TAU, s + b * TAU);
      ctx.arc(cx, cy, r, s + b * TAU, s + a * TAU, true);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    // Small 100ms period clock: one lap per period, a hand at the current point.
    const clock = (ctx, cx, cy, R, f) => {
      sector(ctx, cx, cy, R, 0, 0, 1, '#fff');
      sector(ctx, cx, cy, R, 0, 0, f, '#e2e8f0');
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.strokeStyle = '#cbd5e1';
      ctx.stroke();
      const an = -Math.PI / 2 + f * TAU;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R);
      ctx.strokeStyle = U.text;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.lineWidth = 1;
    };
    // A 10ms quota token; left (0..1) is what remains, shrinking like a clock.
    const token = (ctx, x, y, r, left) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.strokeStyle = U.accent;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.lineWidth = 1;
      if (left <= 0) return;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + left * TAU);
      ctx.closePath();
      ctx.fillStyle = U.accent;
      ctx.fill();
    };

    // Base map positions. Rows: request queue, threads, quota (cgroup); run queue, throttle wait (kernel); vCPU.
    const layout = (w, other, cpus = 1, slots = 8) => {
      const y0 = 30, nodeY = y0 + 52, oy = nodeY + 24, cy = oy + (other ? 42 : 0), ky = cy + 22 + 3 * ROW + 14, vy = ky + 22 + 2 * ROW + 14, end = vy + 48;
      const rowY = { req: cy + 22 + ROW / 2, home: cy + 22 + ROW * 1.5, quota: cy + 22 + ROW * 2.5, run: ky + 22 + ROW / 2, thr: ky + 22 + ROW * 1.5, bhome: oy + 17 };
      const left = 8 + LW + 6, pitch = Math.min(48, (w - 18 - left) / slots), rp = Math.min(34, (w - 84) / 8);
      const sx = (i) => left + 4 + CW / 2 + i * pitch;
      const P = (r, i) => (r === 'cpu' ? [cpus > 1 ? w * (i ? 0.8 : 0.58) : w / 2, vy + 20] : r === 'none' ? [36, y0 + 13] : r === 'resp' ? [84 + CW / 2 + i * rp, y0 + 13] : [sx(i), rowY[r]]);
      return { w, y0, nodeY, oy, cy, ky, vy, end, rowY, left, P, cpus };
    };
    const region = (ctx, L, r, stroke = '#cbd5e1', dash = [3, 3]) => C.box(ctx, L.left, L.rowY[r] - 12, L.w - 14 - L.left, 24, { fill: '#fff', stroke, dash, r: 6 });
    const rowLabel = (ctx, L, r, s, color = U.muted) => C.text(ctx, s, 18, L.rowY[r] + 0.5, { size: 10, color, base: 'middle' });
    // o: { qText, quota, budget, m, cpu: [text, colour], homeLabel, other }
    const drawMap = (ctx, L, o) => {
      const w = L.w;
      C.box(ctx, 0, L.y0, 72, 26, { fill: '#fff' });
      C.text(ctx, '클라이언트', 36, L.y0 + 13.5, { size: 10, weight: 600, color: U.text, align: 'center', base: 'middle' });
      C.arrow(ctx, [[36, L.y0 + 27], [36, L.nodeY - 2]], 1, '#cbd5e1');
      C.text(ctx, '요청', 30, (L.y0 + 27 + L.nodeY) / 2 + 3, { size: 9, align: 'right' });
      C.box(ctx, 0, L.nodeY, w, L.end - L.nodeY, { fill: U.plot, r: 10 });
      C.text(ctx, '노드', 10, L.nodeY + 15, { size: 10, weight: 600 });
      if (o.other) {
        C.box(ctx, 8, L.oy, w - 16, 34, { fill: '#fff' });
        C.text(ctx, '다른 파드 B', 18, L.rowY.bhome + 0.5, { size: 10, base: 'middle' });
      }
      C.box(ctx, 8, L.cy, w - 16, 22 + 3 * ROW + 6, { fill: '#fff' });
      C.text(ctx, '컨테이너 (cgroup)', 18, L.cy + 15, { size: 10, weight: 600 });
      C.text(ctx, o.qText, w - 18, L.cy + 15, { size: 10, align: 'right' });
      rowLabel(ctx, L, 'req', '요청 큐');
      region(ctx, L, 'req');
      rowLabel(ctx, L, 'home', o.homeLabel || '쉬는 작업');
      region(ctx, L, 'home', U.grid, []);
      rowLabel(ctx, L, 'quota', '쿼터');
      if (o.quota < Infinity) {
        const used = o.quota - o.budget;
        for (let j = 0; j < o.quota / 10; j++) token(ctx, L.left + 12 + j * 15, L.rowY.quota, 6, clamp(j + 1 - used / 10));
      } else C.text(ctx, '제한 없음', L.left + 6, L.rowY.quota + 0.5, { size: 10, base: 'middle' });
      const mm = o.m % 100;
      clock(ctx, w - 32, L.rowY.quota, 10, mm / 100);
      C.text(ctx, `주기 ${Math.round(mm)}ms`, w - 48, L.rowY.quota + 0.5, { size: 10, align: 'right', base: 'middle' });

      C.box(ctx, 8, L.ky, w - 16, 22 + 2 * ROW + 6, { fill: '#fff' });
      C.text(ctx, 'CFS 스케줄러 (커널)', 18, L.ky + 15, { size: 10, weight: 600 });
      rowLabel(ctx, L, 'run', '실행 대기 줄');
      region(ctx, L, 'run');
      rowLabel(ctx, L, 'thr', '쓰로틀 대기', '#ef4444');
      region(ctx, L, 'thr', '#fca5a5');
      C.box(ctx, 8, L.vy, w - 16, 40, { fill: '#fff', stroke: '#cbd5e1' });
      for (let c = 0; c < L.cpus; c++) { const [px] = L.P('cpu', c); C.box(ctx, px - 28, L.vy + 8, 56, 24, { fill: U.plot, dash: [3, 3], r: 6 }); }
      if (L.cpus > 1) {
        C.text(ctx, `vCPU ${L.cpus}개`, 18, L.vy + 14, { size: 11, weight: 700, color: U.text, base: 'middle' });
        C.text(ctx, o.cpu[0], 18, L.vy + 30, { size: 10, weight: 700, color: o.cpu[1], base: 'middle' });
      } else {
        C.text(ctx, 'vCPU', 18, L.vy + 20.5, { size: 11, weight: 700, color: U.text, base: 'middle' });
        C.text(ctx, o.cpu[0], w - 18, L.vy + 20.5, { size: 10, weight: 700, color: o.cpu[1], align: 'right', base: 'middle' });
      }
    };

    // vCPUs, a CFS run queue and one cgroup quota, stepped every DT ms from 0. tick adds work, done hears finishes.
    const simulate = ({ n, quota, span, slice, cpus = 1, limited = () => true, tick = () => {}, done = () => {}, reqs = [] }) => {
      const PER = Math.round(100 / DT), th = Array.from({ length: n }, (_, j) => ({ j, rem: 0, where: 'home', lim: limited(j) }));
      const cur = Array(cpus).fill(null), left = Array(cpus).fill(0);
      let runq = [], thrq = [], budget = quota, periods = 0, nthr = 0, busy = 0, thrMs = 0, flagged = false;
      const api = {
        th, reqs,
        wake(t) {
          if (t.where !== 'home' || t.rem <= 0) return;
          if (t.lim && budget <= 1e-6) { t.where = 'thr'; thrq.push(t); } else { t.where = 'run'; runq.push(t); }
        },
      };
      const snaps = [];
      for (let s = 0; s * DT <= span + 1e-9; s++) {
        const m = s * DT, edge = (s + 1) % PER === 0;
        if (s % PER === 0) { budget = quota; periods++; flagged = false; thrq.forEach((t) => { t.where = 'run'; runq.push(t); }); thrq = []; }
        tick(m, api);
        cur.forEach((c, k) => { if (!c && runq.length) { const t = runq.shift(); t.where = 'cpu'; t.slot = k; cur[k] = t; left[k] = slice; } });
        snaps.push({
          budget, cur: cur.map((t) => (t ? t.j : -1)), periods, nthr, busy, thrMs, thr: thrq.length > 0,
          th: th.map((t) => [t.where, t.where === 'run' ? runq.indexOf(t) : t.where === 'thr' ? thrq.indexOf(t) : t.where === 'cpu' ? t.slot : t.j]),
          req: reqs.map((r) => [r.where, r.where === 'req' ? reqs.filter((q) => q.where === 'req' && q.i < r.i).length : r.where === 'with' ? r.j : r.i]),
        });
        if (thrq.length) thrMs += DT;
        cur.forEach((t, k) => { if (t) { t.rem -= DT; left[k] -= DT; busy += DT; if (t.lim) budget -= DT; } });
        cur.forEach((t, k) => {
          if (!t) return;
          if (t.rem <= 1e-6) { t.where = 'home'; cur[k] = null; done(m + DT, t, api); } else if (t.lim && budget <= 1e-6 && !edge) { t.where = 'thr'; thrq.push(t); cur[k] = null; } else if (left[k] <= 1e-6 && runq.length) { t.where = 'run'; runq.push(t); cur[k] = null; }
        });
        if (budget <= 1e-6 && !edge) runq = runq.filter((q) => { if (!q.lim) return true; q.where = 'thr'; thrq.push(q); return false; });
        if (thrq.length && !flagged) { flagged = true; nthr++; }
      }
      return snaps;
    };
    const snapAt = (snaps, m) => snaps[Math.min(snaps.length - 1, Math.max(0, Math.floor(m / DT + 1e-6)))];
    // Per-chip list of [time, region, index] changes, read off the snapshots.
    const tracks = (snaps, key) => {
      const ev = snaps[0][key].map(() => []);
      snaps.forEach((s, k) => s[key].forEach(([r, i], c) => { const e = ev[c], last = e[e.length - 1]; if (!last || last[1] !== r || last[2] !== i) e.push([k * DT, r, i]); }));
      return ev;
    };
    // Where a chip is at time m: it slides for mv ms after each change.
    const glide = (ev, m, P, mv) => {
      let j = 0;
      while (j + 1 < ev.length && ev[j + 1][0] <= m) j++;
      const e = ev[j], to = P(e[1], e[2]);
      if (!j) return [to, e[1]];
      const f = hwa.smooth((m - e[0]) / mv);
      return [f >= 1 ? to : lerp2(P(ev[j - 1][1], ev[j - 1][2]), to, f), e[1]];
    };
    // One move at a time: moves at the same instant start MV apart; a queue shifting up counts as one move.
    const serial = (lists, mv) => {
      const QS = ['run', 'thr', 'req'], all = lists.flatMap((ev, c) => ev.slice(1).map((e, j) => ({ e, from: ev[j][1], c }))).filter((x) => x.e[1] !== 'gone');
      const rank = (x) => (x.e[1] === x.from ? 1 : QS.includes(x.from) ? 0 : 2);
      all.sort((a, b) => a.e[0] - b.e[0] || rank(a) - rank(b) || a.c - b.c);
      let cur = -Infinity, shift = null;
      all.forEach((x) => {
        const t = x.e[0];
        if (rank(x) === 1 && shift && shift[0] === t) { x.e[0] = shift[1]; return; }
        const st = Math.max(t, cur);
        if (rank(x) === 1) shift = [t, st];
        x.e[0] = st; cur = st + mv;
      });
      return lists;
    };
    const cpuState = (snap, ids, pos) => { const on = ids.filter((_, c) => pos[c][1] === 'cpu'); return on.length ? [`USER: ${on.join(', ')}`, U.blue] : snap.thr ? ['IDLE (쓰로틀)', U.red] : ['IDLE', U.muted]; };
    const mapFrame = (w) => { const mw = Math.min(w, MAPW); return { mw, ox: Math.round((w - mw) / 2) }; };

    // limit on the base map: T1, T2 spend one shared quota; when it runs out they sit in the throttle wait until the refill.
    document.querySelectorAll('[data-figure="cpu-quota"]').forEach((root) => {
      const SPAN = 150, SEC = 7.5, HOLD = 1.6, MV = 0.3 * SPAN / SEC, IDS = ['작업1', '작업2'], Q = 100;
      const jobsTick = (jobs) => (m, api) => jobs.forEach(([at, j, ms]) => { if (Math.abs(m - at) < 1e-6) { api.th[j].rem += ms; api.wake(api.th[j]); } });
      const S = [
        { jobs: [[0, 0, 999]], pill: '작업 하나, 바쁨', tone: 'ok', note: '작업 하나는 vCPU 하나만 써서 100ms 동안 많아야 100ms를 쓴다. 쿼터를 넘지 않아 쓰로틀 대기로 가지 않는다.' },
        { jobs: [[0, 0, 20], [0, 1, 15], [105, 0, 10]], pill: '작업 둘, 일 적음', tone: 'ok', note: '둘이 합쳐 35ms라 쿼터 100ms 안에서 끝난다.' },
        { jobs: [[0, 0, 999], [0, 1, 999]], pill: '작업 둘, 바쁨', tone: 'bad', note: '둘이 vCPU 두 개에서 같이 돌아 50ms 만에 쿼터를 다 쓰고 쓰로틀 대기로 빠진다. 100ms에 쿼터가 다시 차면 실행 대기 줄로 돌아간다.' },
      ].map((s) => { const snaps = simulate({ n: 2, quota: Q, cpus: 2, span: SPAN, slice: 10, tick: jobsTick(s.jobs) }); return { ...s, snaps, ev: serial(tracks(snaps, 'th'), MV) }; });
      hwa.scene(root, {
        scenes: hwa.loopScenes(SEC, HOLD, S.length),
        height: 430,
        still: 2 * (SEC + HOLD) + SEC * 0.5,
        frame: (ctx, w, h, time, say) => {
          const { i, k } = hwa.loop(time, SEC, HOLD, S.length), s = S[i], m = k * SPAN, snap = snapAt(s.snaps, m);
          C.pill(ctx, 0, 0, snap.thr ? '쿼터 소진, 쓰로틀' : s.pill, snap.thr ? 'bad' : s.tone);
          C.text(ctx, `${Math.round(m)}ms`, w, 11, { size: 11, weight: 600, color: U.text, align: 'right', base: 'middle' });
          const { mw, ox } = mapFrame(w), L = layout(mw, false, 2, 4);
          ctx.save();
          ctx.translate(ox, 0);
          const pos = s.ev.map((ev) => glide(ev, m, L.P, MV));
          drawMap(ctx, L, { qText: 'limit 1000m: 100ms마다 100ms', quota: Q, budget: snap.budget, m, cpu: cpuState(snap, IDS, pos) });
          pos.forEach(([p, r], c) => chip(ctx, IDS[c], p, r));
          ctx.restore();
          C.wrap(ctx, s.note, w / 2, L.end + 26, w - 16, { color: U.tones[s.tone][1] });
          say(`${s.pill}, ${Math.round(m)}ms. ${s.note}`);
        },
      });
    });

    // Dashboard signals read off the map: throttle ratio from the quota, node CPU from how busy the vCPU is.
    document.querySelectorAll('[data-figure="cpu-throttle-dash"]').forEach((root) => {
      const SPAN = 300, SEC = 12, HOLD = 2, MV = 0.2 * SPAN / SEC, IDS = ['작업1', '작업2', 'B1', 'B2'], Q = 100;
      const S = [
        { busyB: false, pill: '쓰로틀 오름, vCPU 남음', tone: 'warn', verdict: 'limit 문제', note: '작업은 쓰로틀 대기에 있는데 vCPU는 IDLE이다. CPU가 남는데 limit에 막힌 경우라 limit을 다시 정한다.' },
        { busyB: true, pill: '대기 줄 김, vCPU 꽉 참', tone: 'bad', verdict: 'CPU 부족', note: 'vCPU 두 개를 파드 B와 나눠 쓰느라 IDLE이 없고, 작업들은 실행 대기 줄에서 기다린다. CPU 자체가 모자란 경우라 노드를 늘린다.' },
      ].map((s) => {
        const tick = (m, api) => { if (m === 0) api.th.forEach((t) => { if (t.j < 2 || s.busyB) { t.rem = 9999; api.wake(t); } }); };
        const snaps = simulate({ n: 4, quota: Q, cpus: 2, span: SPAN, slice: 40, limited: (j) => j < 2, tick });
        return { ...s, snaps, ev: serial(tracks(snaps, 'th'), MV) };
      });
      hwa.scene(root, {
        scenes: hwa.loopScenes(SEC, HOLD, S.length),
        height: 494,
        still: SEC * 0.6,
        frame: (ctx, w, h, time, say) => {
          const { i, k } = hwa.loop(time, SEC, HOLD, S.length), s = S[i], m = Math.min(k * SPAN, SPAN - DT), snap = snapAt(s.snaps, m);
          C.pill(ctx, 0, 0, s.pill, s.tone);
          C.text(ctx, `${Math.round(m)}ms`, w, 11, { size: 11, weight: 600, color: U.text, align: 'right', base: 'middle' });
          const { mw, ox } = mapFrame(w), L = layout(mw, true, 2, 4);
          const P = (c) => (r, j) => (c >= 2 && r === 'home' ? L.P('bhome', c - 2) : L.P(r, j));
          ctx.save();
          ctx.translate(ox, 0);
          const pos = s.ev.map((ev, c) => glide(ev, m, P(c), MV));
          drawMap(ctx, L, { qText: 'limit 1000m: 100ms마다 100ms', quota: Q, budget: snap.budget, m, cpu: cpuState(snap, IDS, pos), other: true });
          pos.forEach(([p, r], c) => chip(ctx, IDS[c], p, r));
          const ratio = Math.round(snap.nthr / snap.periods * 100), util = m > 1 ? Math.round(snap.busy / (m * 2) * 100) : 0, sy = L.end + 18;
          C.text(ctx, `쓰로틀 비율 ${ratio}%`, 0, sy, { size: 12, weight: 700, color: U.red, base: 'middle' });
          C.text(ctx, `vCPU 사용률 ${util}%`, mw, sy, { size: 12, weight: 700, color: util > 90 ? U.red : U.slate, align: 'right', base: 'middle' });
          ctx.restore();
          C.wrap(ctx, s.note, w / 2, L.end + 46, w - 16, { color: U.tones[s.tone][1] });
          say(`${s.verdict}. ${s.note}`);
        },
      });
    });

    // Short requests vs streams on one vCPU: who sleeps in memory, who queues in the run queue.
    document.querySelectorAll('[data-figure="cpu-threads"]').forEach((root) => {
      const SPAN = 160, SEC = 8, HOLD = 1.6, MV = 0.28 * SPAN / SEC, N = 8, IDS = Array.from({ length: N }, (_, j) => String(j + 1));
      const ARR = [4, 44, 84, 124];
      const shortSim = () => {
        const reqs = ARR.map((a, i) => ({ i, a, j: i % N, where: 'none', phase: 0 }));
        const tick = (m, api) => {
          reqs.forEach((r) => {
            if (m === r.a - 5) r.where = 'req';
            if (m === r.a) { const t = api.th[r.j]; r.where = 'with'; r.phase = 1; t.job = r; t.rem += 7; api.wake(t); }
          });
          api.th.forEach((t) => { if (t.wakeAt === m) { t.wakeAt = null; t.rem += 6; api.wake(t); } });
        };
        const done = (m, t) => { const r = t.job; if (r.phase === 1) { r.phase = 2; t.wakeAt = m + 30; } else { r.where = 'gone'; t.job = null; } };
        return simulate({ n: N, quota: Infinity, span: SPAN, slice: 10, tick, done, reqs });
      };
      const streamSim = () => simulate({ n: N, quota: Infinity, span: SPAN, slice: 20, tick: (m, api) => { if (m === 0) api.th.forEach((t) => { t.rem = 9999; api.wake(t); }); } });
      const S = [
        { snaps: shortSim(), pill: '짧은 요청', tone: 'ok', home: '대기 중인 작업', note: '요청이 오면 작업이 깨어 잠깐 계산하고, DB 응답을 기다리며 다시 대기한다. 대기하는 동안 CPU를 내려놓아 실행 대기 줄이 거의 비어 있다.' },
        { snaps: streamSim(), pill: '스트림', tone: 'bad', home: '대기 중인 작업', note: '스트림은 CPU를 놓지 않는다. 8개가 실행 대기 줄을 돌며 차례를 기다리고, 하나당 CPU의 12.5%만 받는다.' },
      ].map((s) => { const ev = tracks(s.snaps, 'th'), rev = s.snaps[0].req.length ? tracks(s.snaps, 'req') : []; serial([...ev, ...rev], MV); return { ...s, ev, rev }; });
      hwa.scene(root, {
        scenes: hwa.loopScenes(SEC, HOLD, S.length),
        height: 444,
        still: SEC * 0.55,
        frame: (ctx, w, h, time, say) => {
          const { i, k } = hwa.loop(time, SEC, HOLD, S.length), s = S[i], m = Math.min(k * SPAN, SPAN - DT), snap = snapAt(s.snaps, m);
          C.pill(ctx, 0, 0, s.pill, s.tone);
          C.text(ctx, 'vCPU 1개, 작업 8개', w, 11, { size: 10, align: 'right', base: 'middle' });
          const { mw, ox } = mapFrame(w), L = layout(mw, false);
          ctx.save();
          ctx.translate(ox, 0);
          const pos = s.ev.map((ev) => glide(ev, m, L.P, MV));
          drawMap(ctx, L, { qText: 'limit 없음', quota: Infinity, budget: 0, m, cpu: cpuState(snap, IDS, pos), homeLabel: s.home });
          const holds = new Set(snap.req.filter(([r]) => r === 'with').map(([, j]) => j));
          pos.forEach(([p, r], c) => chip(ctx, IDS[c], p, r, holds.has(c)));
          s.rev.forEach((ev, c) => {
            const [p, r] = glide(ev, m, (rg, j) => (rg === 'with' ? pos[j][0] : L.P(rg, j)), MV);
            if (r === 'req' || (r === 'with' && m - ev.find((e) => e[1] === 'with')[0] < MV)) chip(ctx, `R${c + 1}`, p, 'req');
          });
          const waiting = pos.filter(([, r]) => r === 'run').length, sy = L.end + 18;
          C.text(ctx, `실행 대기 줄 ${waiting}개`, 0, sy, { size: 12, weight: 700, color: waiting > 2 ? U.red : U.tones.ok[1], base: 'middle' });
          C.text(ctx, s.tone === 'ok' ? '요청은 보라 점을 든 작업' : '하나당 CPU 12.5%', mw, sy, { size: 11, weight: 600, color: s.tone === 'ok' ? '#6d28d9' : U.red, align: 'right', base: 'middle' });
          ctx.restore();
          C.wrap(ctx, s.note, w / 2, L.end + 46, w - 16, { color: U.tones[s.tone][1] });
          say(s.note);
        },
      });
    });

  }

})();
