// Memory post figures: pages, page cache, cgroup metrics, reclaim and OOM, Kubernetes request and limit, Node.js heap.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const mv = (k, a, b) => hwa.smooth((k - a) / (b - a));
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const fig = (id, fn) => document.querySelectorAll(`[data-figure="${id}"]`).forEach(fn);
  const APP = U.blue, PUR = U.purple, CACHE = '#c4b5fd', BUF = '#14b8a6', NAT = '#64748b', STK = '#cbd5e1', OTHER = '#e2e8f0', DEAD = '#cbd5e1';
  const BLUE = ['#dbeafe', '#1d4ed8', '#3b82f6'], ORANGE = ['#fef3c7', '#b45309', '#f59e0b'], MUTE = [U.cell, U.muted, '#e2e8f0'];
  const rect = (ctx, x, y, w, h, fill, r = 3) => {
    if (w <= 0.5) return;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2));
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // Chip centred at (x, y), or right-aligned at x when right is set. col = [bg, fg, line].
  const tag = (ctx, s, x, y, col, { right = false, a = 1 } = {}) => {
    const cw = tw(ctx, s, 11, 600) + 18, x0 = right ? x - cw : x - cw / 2;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.roundRect(x0 + 0.5, y - 9.5, cw - 1, 19, 6);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x0 + cw / 2, y + 0.5, { weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
    return cw;
  };
  // Bracket over x0..x1 that grows with k; the label sits above it, kept inside the canvas width w.
  const brace = (ctx, x0, x1, y, color, label, w, k = 1, down = false) => {
    if (k <= 0) return;
    const d = down ? -5 : 5, xe = x0 + (x1 - x0) * clamp(k);
    C.line(ctx, [[x0, y + d], [x0, y], [xe, y], ...(k >= 1 ? [[x1, y + d]] : [])], color, 1.4);
    if (k < 1 || !label) return;
    const half = tw(ctx, label, 11, 600) / 2, cx = clamp((x0 + x1) / 2, half, w - half);
    C.text(ctx, label, cx, down ? y + 14 : y - 6, { weight: 600, color, align: 'center' });
  };
  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  const prompt = (ctx, s, x, y) => C.text(ctx, `${s} 버튼을 눌러 보자`, x, y, { size: 12, align: 'center', base: 'middle' });

  // CPU shares time (both finish, later); memory shares space (the last request has nowhere to go).
  fig('memory-time-space', (root) => {
    const SEC = 6, HOLD = 1.8;
    const notes = ['CPU는 시간을 나눈다. 둘이 같이 쓰면 번갈아 도느라 늦게 끝나지만 둘 다 끝난다.', '메모리는 공간을 나눈다. 칸이 다 차면 기다려도 자리가 생기지 않는다.'];
    hwa.scene(root, {
      height: 214, still: SEC + HOLD + SEC, scenes: hwa.loopScenes(SEC, HOLD, 2), notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2);
        ctx.font = U.font(10);
        C.legend(ctx, w - 48, 11, [['A', APP], ['B', PUR]]);
        if (i === 0) {
          C.pill(ctx, 0, 0, 'CPU: 시간을 나눔', 'info');
          const x0 = 58, x1 = w - 6, top = 44, LH = 44, X = (v) => x0 + v / 80 * (x1 - x0), t = clamp(k / 0.8) * 80;
          const lanes = [[[0, 40, 'A']], Array.from({ length: 8 }, (_, j) => [j * 10, j * 10 + 10, j % 2 ? 'B' : 'A'])];
          ['A 혼자', 'A와 B'].forEach((s, j) => {
            C.text(ctx, s, 0, top + j * LH + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' });
            lanes[j].forEach(([a, b, n]) => { if (t > a) rect(ctx, X(a) + 1, top + j * LH + 9, X(Math.min(t, b)) - X(a) - 2, LH - 18, n === 'A' ? APP : PUR, 6); });
          });
          const base = top + 2 * LH + 2;
          C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
          [[40, '40ms'], [80, '80ms']].forEach(([v, s]) => {
            if (t < v) return;
            C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
            C.text(ctx, s, X(v), base + 14, { size: 9, align: v === 80 ? 'right' : 'center' });
          });
          if (t < 80) C.dashed(ctx, X(t), top - 4, X(t), base);
          C.stamp(ctx, (x0 + x1) / 2, base + 44, '늦어져도 둘 다 끝남', 'info', mv(k, 0.84, 0.92));
          say('CPU는 시간을 나눈다. A 혼자면 40ms, A와 B가 번갈아 쓰면 80ms에 둘 다 끝난다.');
          return;
        }
        C.pill(ctx, 0, 0, '메모리: 공간을 나눔', 'warn');
        const gap = 4, cs = Math.min(34, (w - 7 * gap) / 8), gy = 50, at = (q) => [(q % 8) * (cs + gap), gy + Math.floor(q / 8) * (cs + gap)];
        C.text(ctx, '메모리 16GB (한 칸 1GB)', 0, gy - 8, { size: 10, weight: 600 });
        const nA = 8 * mv(k, 0.05, 0.35), nB = 6 * mv(k, 0.38, 0.6) + 2 * mv(k, 0.63, 0.72);
        for (let q = 0; q < 16; q++) {
          const [x, y] = at(q), a = q < 8 ? clamp(nA - q) : clamp(nB - (q - 8));
          rect(ctx, x, y, cs, cs, U.cell, 5);
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          rect(ctx, x, y, cs, cs, q < 8 ? APP : PUR, 5);
          C.text(ctx, q < 8 ? 'A' : 'B', x + cs / 2, y + cs / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
          ctx.globalAlpha = 1;
        }
        const ko = mv(k, 0.75, 0.8), oy = gy + 2 * (cs + gap) + 6;
        if (ko > 0) {
          ctx.globalAlpha = ko;
          [6, 7].forEach((c) => {
            const x = c * (cs + gap);
            C.box(ctx, x, oy, cs, cs, { fill: U.tones.bad[0], stroke: U.red, dash: [3, 3], r: 5 });
            C.text(ctx, 'B', x + cs / 2, oy + cs / 2 + 0.5, { size: 10, weight: 700, color: U.red, align: 'center', base: 'middle' });
          });
          C.text(ctx, '자리 없음', 6 * (cs + gap) - 8, oy + cs / 2, { size: 10, weight: 700, color: U.red, align: 'right', base: 'middle' });
          ctx.globalAlpha = 1;
        }
        C.stamp(ctx, (8 * cs + 7 * gap) / 2, oy + cs + 26, '2GB 모자람, OOM', 'bad', mv(k, 0.86, 0.93));
        say('메모리 16칸 중 A가 8칸, B가 8칸을 쓰면 다 찬다. B가 2칸을 더 원하면 자리가 없다.');
      },
    });
  });

  // malloc reserves virtual pages only; the first write to each page faults and the kernel attaches a frame.
  fig('memory-pages', (root) => {
    const SEC = 6.5, HOLD = 1.8, N = 8, OCC = [0, 1, 4, 6, 9, 10, 13], MAP = [12, 2, 7];
    const notes = ['malloc(32KB)은 가상 주소 8페이지를 예약만 한다. 물리 메모리는 아직 하나도 쓰지 않는다.', '처음 쓰는 순간 페이지 폴트가 나고, 커널이 빈 프레임을 하나씩 붙인다. 쓴 페이지만 RSS가 된다.'];
    hwa.scene(root, {
      height: 244, still: SEC + HOLD + SEC, scenes: hwa.loopScenes(SEC, HOLD, 2), notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2), top = 58, sh = 17, sg = 3;
        const vw = Math.min(120, Math.round(w * 0.3)), tx = vw + 14, tWd = Math.min(96, Math.round(w * 0.22)), px0 = tx + tWd + 14;
        const fs = Math.min(34, (w - px0 - 12) / 4), px = px0 + (w - px0 - (4 * fs + 12)) / 2, fy = top;
        const reserved = i ? N : N * mv(k, 0.08, 0.5);
        // Each touched page: write at f=0, fault label 0.15..0.5, arrow 0.5..0.85, frame attached from 0.85.
        const f = (m) => (i ? clamp((k - 0.06 - m * 0.25) / 0.25) : 0), mapped = MAP.filter((_, m) => f(m) >= 0.85).length;
        C.pill(ctx, 0, 0, `VSZ ${Math.round(reserved) * 4}KB, RSS ${mapped * 4}KB`, i ? 'ok' : 'info');
        [['가상 주소', 0], ['페이지 테이블', tx], ['물리 메모리', px]].forEach(([s, x]) => C.text(ctx, s, x, 46, { size: 10, weight: 600 }));
        const frameAt = (q) => [px + (q % 4) * (fs + 4), fy + Math.floor(q / 4) * (fs + 4)];
        for (let q = 0; q < 16; q++) {
          const [x, y] = frameAt(q), m = MAP.indexOf(q), on = m >= 0 && f(m) >= 0.85;
          C.box(ctx, x, y, fs, fs, { fill: OCC.includes(q) ? OTHER : on ? APP : '#fff', stroke: OCC.includes(q) ? OTHER : U.grid, r: 4 });
          if (on) C.text(ctx, String(m), x + fs / 2, y + fs / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
        }
        for (let j = 0; j < N; j++) {
          const y = top + j * (sh + sg), a = clamp(reserved - j), m = j < MAP.length ? f(j) : 0;
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          C.box(ctx, 0, y, vw, sh, { fill: m >= 0.85 ? '#dbeafe' : '#fff', stroke: m > 0 ? APP : '#94a3b8', dash: m > 0 ? null : [3, 2], r: 4 });
          C.text(ctx, `페이지 ${j}`, vw / 2, y + sh / 2 + 0.5, { size: 9, weight: m > 0 ? 600 : 400, color: m > 0 ? BLUE[1] : U.muted, align: 'center', base: 'middle' });
          const fault = m >= 0.15 && m < 0.5, done = m >= 0.85;
          C.box(ctx, tx, y, tWd, sh, { fill: fault ? U.tones.bad[0] : '#fff', stroke: fault ? U.red : U.grid, r: 4 });
          C.text(ctx, fault ? '페이지 폴트' : done ? `프레임 ${MAP[j]}` : '-', tx + tWd / 2, y + sh / 2 + 0.5, { size: 9, weight: fault || done ? 700 : 400, color: fault ? U.red : done ? BLUE[1] : U.muted, align: 'center', base: 'middle' });
          ctx.globalAlpha = 1;
          if (m >= 0.5 && m < 1) {
            const [fx, fyy] = frameAt(MAP[j]);
            C.arrow(ctx, [[tx + tWd + 2, y + sh / 2], [fx - 3, fyy + fs / 2]], mv(m, 0.5, 0.85), APP);
          }
        }
        ctx.font = U.font(10);
        C.legend(ctx, 0, h - 8, [['다른 프로세스', OTHER], ['이 프로세스', APP]]);
        C.stamp(ctx, w / 2, top + 4 * (sh + sg), i ? '쓴 3페이지만 RSS 12KB' : '주소만 예약, RSS 0KB', i ? 'ok' : 'info', mv(k, 0.88, 0.95));
        say(i ? `처음 쓴 페이지마다 페이지 폴트가 나고 프레임이 붙는다. RSS ${mapped * 4}KB.` : 'malloc은 가상 주소 32KB를 예약만 하고 물리 메모리는 쓰지 않는다.');
      },
    });
  });

  // Page cache fills free RAM as files are read, then gives way when the app asks for more.
  fig('memory-page-cache', (root) => {
    const SEC = 6, HOLD = 1.8;
    const notes = ['파일을 읽을수록 빈 칸이 페이지 캐시로 찬다. free는 1GB로 줄지만 available은 12GB다.', '앱이 4GB를 더 요청하자 커널이 캐시 4GB를 비워 내준다.'];
    hwa.scene(root, {
      height: 224, still: SEC + HOLD + SEC, scenes: hwa.loopScenes(SEC, HOLD, 2), notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2);
        const app = i ? 4 + 4 * mv(k, 0.15, 0.7) : 4, cache = i ? 11 - (app - 4) : 11 * mv(k, 0.08, 0.75), free = 16 - app - cache;
        C.pill(ctx, 0, 0, i ? '앱이 4GB 더 요청' : '파일 읽기', i ? 'warn' : 'info');
        const cw = w / 4;
        [['used', app, U.text], ['buff/cache', cache, PUR], ['free', free, free < 1.5 ? ORANGE[1] : U.text], ['available', free + cache, U.tones.ok[1]]].forEach(([s, v, c], j) => {
          C.text(ctx, s, j * cw, 44, { size: 10 });
          C.text(ctx, `${Math.round(v)}GB`, j * cw, 62, { size: 14, weight: 700, color: c });
        });
        const gap = 4, cs = Math.min(36, (w - 7 * gap) / 8), gy = 80;
        for (let q = 0; q < 16; q++) {
          const x = (q % 8) * (cs + gap), y = gy + Math.floor(q / 8) * (cs + gap);
          rect(ctx, x, y, cs, cs, U.cell, 5);
          const c = clamp(app + cache - q), a = clamp(app - q);
          if (c > 0) { ctx.globalAlpha = c; rect(ctx, x, y, cs, cs, CACHE, 5); }
          if (a > 0) { ctx.globalAlpha = a; rect(ctx, x, y, cs, cs, APP, 5); }
          ctx.globalAlpha = 1;
        }
        ctx.font = U.font(10);
        C.legend(ctx, 0, gy + 2 * cs + gap + 20, [['앱', APP], ['페이지 캐시', CACHE], ['빈 칸', OTHER]]);
        C.stamp(ctx, (8 * cs + 7 * gap) / 2, gy + 2 * cs + gap + 52, i ? '캐시 4GB를 비워 앱에 줌' : 'free 1GB, available 12GB', 'ok', mv(k, 0.84, 0.92));
        say(`used ${Math.round(app)}GB, buff/cache ${Math.round(cache)}GB, free ${Math.round(free)}GB, available ${Math.round(free + cache)}GB.`);
      },
    });
  });

  // One limit 2Gi container read three ways: usage counts the cache, working set drops inactive_file, rss is anon only.
  fig('memory-working-set', (root) => {
    const SEC = 4.6, HOLD = 1.8, MAX = 2.1;
    const SEG = [['anon', 1.1, APP], ['active_file', 0.4, PUR], ['inactive_file', 0.4, CACHE]];
    const S = [
      ['container_memory_usage_bytes', 3, 'usage 1.9Gi (95%)', 'usage(memory.current)는 페이지 캐시까지 더해 limit의 95%로 보인다.'],
      ['container_memory_working_set_bytes', 2, 'working set 1.5Gi (75%)', 'working set은 usage에서 inactive_file을 뺀 값이다. kubectl top과 축출이 이 값을 본다.'],
      ['container_memory_rss', 1, 'RSS 1.1Gi (55%)', 'RSS는 anon만 센다. 스왑 없이는 비울 수 없는 몫이라 OOM에 가장 가깝다.'],
    ];
    hwa.scene(root, {
      height: 180, still: 2 * (SEC + HOLD) + SEC, scenes: hwa.loopScenes(SEC, HOLD, 3), notes: S.map((s) => s[3]),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), s = S[i], X = (v) => v / MAX * (w - 2), by = 92, bh = 30;
        C.pill(ctx, 0, 0, s[0], 'info');
        rect(ctx, 0, by, X(2), bh, U.cell, 4);
        let x = 0, v = 0;
        SEG.forEach(([, size, col], j) => {
          ctx.globalAlpha = j < s[1] ? 1 : 1 - 0.75 * mv(k, 0.45, 0.65);
          rect(ctx, x, by, X(size) - 1, bh, col, 3);
          ctx.globalAlpha = 1;
          x += X(size);
          if (j < s[1]) v += size;
        });
        C.dashed(ctx, X(2), by - 22, X(2), by + bh + 6, U.red);
        C.text(ctx, 'limit 2Gi', X(2), by - 26, { size: 10, weight: 700, color: U.red, align: 'right' });
        brace(ctx, 0, X(v), by - 10, BLUE[1], s[2], X(2) - tw(ctx, 'limit 2Gi', 10, 700) - 12, mv(k, 0.08, 0.4));
        ctx.font = U.font(10);
        C.legend(ctx, 0, by + bh + 24, SEG.map(([n, , c]) => [n, c]));
        say(`${s[0]}: ${s[2]}. ${s[3]}`);
      },
    });
  });

  // anon grows in a limit 2Gi container: the page cache is reclaimed first, response time rises once it is gone, then OOM.
  // Shape only: values are made up to show the order of events.
  fig('memory-reclaim', (root) => {
    const LENS = [3.5, 5, 4.5], S = seq(LENS, 2), T_OOM = 10.4, T_END = 11.5;
    const anon = (t) => 0.6 + 0.135 * t, cache = (t) => (t < T_OOM ? clamp(2 - anon(t), 0, 0.6) : 0);
    const lat = (t) => 40 + 400 * ((0.6 - cache(t)) / 0.6) ** 3;
    const PH = [
      [0, 5.9, '여유', 'ok', '처음에는 빈자리가 있어 anon이 늘어도 페이지 캐시가 그대로 남는다.'],
      [5.9, 9.4, '캐시 회수', 'warn', 'limit에 닿으면 커널이 페이지 캐시부터 비운다. 응답 시간은 아직 거의 그대로다.', '캐시부터 비움'],
      [9.4, T_END, '캐시 바닥', 'bad', '캐시가 바닥나면 파일을 디스크에서 다시 읽느라 응답이 먼저 느려지고, 그다음 OOM이 난다.', '응답 40ms → 440ms, 그다음 OOM'],
    ];
    hwa.scene(root, {
      height: 284, still: S.at(2) + LENS[2] + 1, scenes: S, notes: PH.map((p) => p[4]),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), ph = PH[i], m = ph[0] + (ph[1] - ph[0]) * (t / LENS[i]);
        C.pill(ctx, 0, 0, ph[2], ph[3]);
        ctx.font = U.font(10);
        const lg = [['anon', APP], ['페이지 캐시', PUR]], lgw = lg.reduce((a, [s]) => a + 24 + ctx.measureText(s).width, 0);
        C.legend(ctx, w - lgw + 12, 11, lg);
        const x0 = 40, x1 = w - 44, y0 = 46, H = 120, y1 = y0 + H + 34, H2 = 58, X = (v) => x0 + v / T_END * (x1 - x0);
        const Y = C.panel(ctx, x0, y0, x1 - x0, H, { max: 2.4, ticks: [[0, '0'], [1, '1Gi'], [2, '2Gi']] });
        const Y2 = C.panel(ctx, x0, y1, x1 - x0, H2, { title: '응답 시간', max: 500, ticks: [[0, '0'], [500, '500ms']] });
        C.dashed(ctx, x0, Y(2), x1, Y(2), U.red);
        C.text(ctx, 'limit 2Gi', x0 + 4, Y(2) - 5, { size: 10, weight: 600, color: U.red });
        const pts = [];
        for (let v = 0; v <= Math.min(m, T_OOM) + 1e-6; v += 0.05) pts.push(v);
        if (pts.length > 1) {
          const a = pts.map((v) => [X(v), Y(anon(v))]), top = pts.map((v) => [X(v), Y(anon(v) + cache(v))]);
          C.area(ctx, a, Y(0), 'rgba(59,130,246,0.14)');
          C.area(ctx, top, a, 'rgba(139,92,246,0.16)');
          C.line(ctx, top, PUR, 1.6);
          C.line(ctx, a, APP, 2);
          C.line(ctx, pts.map((v) => [X(v), Y2(lat(v))]), ORANGE[2], 2);
        }
        [0, 5, 10].forEach((v) => C.text(ctx, `${v}분`, X(v), y1 + H2 + 15, { size: 10, align: v ? 'center' : 'left' }));
        if (m >= 5.9) C.event(ctx, X(5.9), y0 + 2, y1 + H2, '회수 시작', ORANGE[1]);
        if (m >= T_OOM) C.event(ctx, X(T_OOM), y0 + 2, y1 + H2, 'OOM', U.red);
        const e = Math.min(m, T_OOM);
        if (m < T_OOM) C.dashed(ctx, X(m), y0, X(m), y1 + H2);
        C.dot(ctx, X(e), Y2(lat(e)), ORANGE[1], `${Math.round(lat(e))}ms`);
        if (ph[5]) C.stamp(ctx, (x0 + x1) / 2, y0 + H * 0.62, ph[5], ph[3], (run - LENS[i]) / 0.4);
        say(`${ph[2]}, ${m.toFixed(1)}분. anon ${anon(e).toFixed(2)}Gi, 캐시 ${cache(e).toFixed(2)}Gi, 응답 ${Math.round(lat(e))}ms. ${ph[4]}`);
      },
    });
  });

  // OOM killer scope: on node OOM every process is a candidate; on cgroup OOM only the processes in that container are.
  fig('memory-oom-killer', (root) => {
    const SEC = 6, HOLD = 1.8, P = [['sshd', 0.1, -1000], ['mysql', 5, 0], ['app', 9.5, 0]];
    const score = ([, rss, adj]) => Math.max(0, Math.round(rss / 16 * 1000) + adj);
    const notes = ['노드 OOM: 노드의 모든 프로세스가 후보다. 쓰는 메모리 비율에 oom_score_adj를 더한 점수가 가장 높은 app이 끝난다.', 'cgroup OOM: memory.max에 닿은 컨테이너 안의 프로세스만 후보다. 노드에 메모리가 남아 있어도 끝난다.'];
    hwa.scene(root, {
      height: 220, still: SEC + HOLD + SEC, scenes: hwa.loopScenes(SEC, HOLD, 2), notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2), gy = 34, gh = 142;
        C.pill(ctx, 0, 0, i ? 'cgroup OOM' : '노드 OOM', 'bad');
        if (i === 0) {
          C.group(ctx, 0, gy, w, gh, '노드 메모리 16GB');
          const bx = 10, bw = w - 20, kill = mv(k, 0.62, 0.8);
          let x = bx;
          [[0.1, NAT], [5, PUR], [9.5, APP], [1.4, OTHER]].forEach(([v, c], j) => {
            ctx.globalAlpha = j === 2 ? 1 - kill : 1;
            rect(ctx, x, gy + 26, v / 16 * bw - 1, 12, c, 2);
            ctx.globalAlpha = 1;
            x += v / 16 * bw;
          });
          const cw = (bw - 16) / 3;
          P.forEach((p, j) => {
            const cx = bx + j * (cw + 8), cy = gy + 50, hit = j === 2 && k >= 0.55, dead = j === 2 && k >= 0.62;
            C.box(ctx, cx, cy, cw, 82, { fill: dead ? U.tones.bad[0] : '#fff', stroke: hit ? U.red : U.grid });
            C.text(ctx, p[0], cx + 10, cy + 18, { size: 12, weight: 600, color: dead ? U.red : U.text });
            C.text(ctx, dead ? 'SIGKILL' : `RSS ${p[1]}GB`, cx + 10, cy + 35, { size: 10, weight: dead ? 700 : 400, color: dead ? U.red : U.muted });
            C.text(ctx, `adj ${p[2]}`, cx + 10, cy + 50, { size: 10 });
            const a = mv(k, 0.12 + j * 0.1, 0.3 + j * 0.1);
            if (a > 0) tag(ctx, `점수 ${score(p)}`, cx + cw / 2, cy + 68, j === 2 ? [U.tones.bad[0], U.red, '#fca5a5'] : MUTE, { a });
          });
          C.stamp(ctx, w / 2, gy + gh + 24, 'app 종료, 9.5GB 반환', 'bad', mv(k, 0.84, 0.92));
          say('노드 메모리가 바닥나면 점수가 가장 높은 app이 SIGKILL로 끝난다.');
          return;
        }
        C.group(ctx, 0, gy, w, gh, '노드 메모리 16GB, 남은 칸 10GB');
        const bw = (w - 30) / 2;
        [['Pod A', 'limit 2Gi', 0.5 + 0.5 * mv(k, 0.05, 0.45)], ['Pod B', 'limit 4Gi', 0.25]].forEach(([n, lim, u], j) => {
          const x = 10 + j * (bw + 10), y = gy + 26, full = j === 0 && u >= 0.999, dead = j === 0 && k >= 0.62;
          C.box(ctx, x, y, bw, 106, { fill: '#fff', stroke: full ? U.red : U.grid });
          C.text(ctx, n, x + 10, y + 18, { size: 12, weight: 600, color: U.text });
          C.text(ctx, lim, x + bw - 10, y + 18, { size: 10, align: 'right' });
          rect(ctx, x + 10, y + 32, bw - 20, 12, U.cell, 3);
          rect(ctx, x + 10, y + 32, (bw - 20) * u, 12, full ? U.red : APP, 3);
          if (full) C.text(ctx, 'memory.max 도달', x + 10, y + 60, { size: 10, weight: 700, color: U.red });
          C.box(ctx, x + 10, y + 70, bw - 20, 26, { fill: dead ? U.tones.bad[0] : U.plot, stroke: dead ? U.red : U.grid, r: 6 });
          C.text(ctx, dead ? 'node, SIGKILL' : 'node', x + bw / 2, y + 83.5, { size: 10, weight: 600, color: dead ? U.red : U.text, align: 'center', base: 'middle' });
        });
        C.stamp(ctx, w / 2, gy + gh + 24, 'A만 끝남, 노드는 여유', 'bad', mv(k, 0.84, 0.92));
        say('Pod A가 limit 2Gi에 닿으면 노드에 10GB가 남아 있어도 A 안의 프로세스만 끝난다.');
      },
    });
  });

  // requests go to the scheduler (no cgroup file by default); limits become memory.max, which the kernel enforces.
  fig('memory-layers', (root) => {
    const SEC = 5.2, HOLD = 1.6;
    const R = [
      { name: 'Pod 스펙', sub: 'API 서버에 저장', y: 32, h: 60 },
      { name: '스케줄러', sub: '노드 고르기', y: 104, h: 46 },
      { name: 'cgroup 파일', sub: '/sys/fs/cgroup', y: 162, h: 60 },
      { name: '커널', sub: '회수와 OOM killer', y: 234, h: 46 },
    ];
    // Data: limit 2Gi = 2 x 1024^3 bytes. request has no cgroup file unless memoryReservationPolicy is set.
    const REQ = { 0: ['requests: 1Gi', 18], 1: ['남은 request ≥ 1Gi', 20] };
    const LIM = { 0: ['limits: 2Gi', 42], 2: ['memory.max = 2147483648', 42], 3: ['2GiB에서 회수, 못 하면 OOM', 22] };
    const S = [
      { pill: '스케줄러가 읽음', note: 'request는 cgroup 파일로 가지 않는다. 스케줄러가 노드를 고를 때 쓴다.' },
      { pill: 'kubelet이 씀', note: 'limit은 kubelet이 cgroup의 memory.max로 적는다. request 자리(memory.min)는 기본으로 비어 있다.' },
      { pill: '커널이 지킴', note: '커널은 memory.max에 닿으면 그 컨테이너의 페이지를 회수하고, 못 비우면 OOM killer를 부른다.' },
    ];
    const MOVE = [[0, 1], [0, 2], [2, 3]];
    hwa.scene(root, {
      height: 284, still: 2 * (SEC + HOLD) + SEC, scenes: hwa.loopScenes(SEC, HOLD, 3), notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), rx = w - 10, p = mv(k, 0.12, 0.55), [from, to] = MOVE[i];
        const slot = (tab, r) => R[r].y + tab[r][1];
        C.pill(ctx, 0, 0, S[i].pill, 'info');
        ctx.font = U.font(10);
        C.legend(ctx, w - 40 - ctx.measureText('requests limits').width - 16, 11, [['requests', U.blue], ['limits', ORANGE[2]]]);
        const chips = [];
        // Chips at rest: the current scene's subject is coloured, everything already passed is muted.
        Object.keys(REQ).forEach((r) => { r = +r; if (r === 0 || i > 0 || p >= 1) chips.push([REQ[r][0], slot(REQ, r), i === 0 && r === (p >= 1 ? 1 : 0) ? BLUE : MUTE]); });
        Object.keys(LIM).forEach((r) => {
          r = +r;
          const seen = r === 0 || (r === 2 && (i === 2 || (i === 1 && p >= 1))) || (r === 3 && i === 2 && p >= 1);
          const cur = (i === 1 && r === (p >= 1 ? 2 : 0)) || (i === 2 && r === (p >= 1 ? 3 : 2)) || (i === 0 && r === 0);
          if (seen) chips.push([LIM[r][0], slot(LIM, r), cur ? ORANGE : MUTE]);
        });
        R.forEach((r, j) => {
          C.box(ctx, j ? 8 : 0, r.y, j ? w - 16 : w, r.h, { fill: '#fff', on: j === to && p > 0 && p < 1, r: 8 });
          C.text(ctx, r.name, (j ? 8 : 0) + 12, r.y + 20, { size: 12, weight: 600, color: U.text });
          const widest = Math.max(...[...chips.filter((c) => c[1] > r.y && c[1] < r.y + r.h).map((c) => tw(ctx, c[0], 11, 600) + 18), j === 2 ? tw(ctx, 'memory.min: 없음', 11, 600) + 18 : 0]);
          if (tw(ctx, r.sub, 10) + 30 < w - widest - 24) C.text(ctx, r.sub, (j ? 8 : 0) + 12, r.y + 38, { size: 10 });
        });
        tag(ctx, 'memory.min: 없음', rx, R[2].y + 18, MUTE, { right: true });
        chips.forEach(([s, y, col]) => { if (!(p > 0 && p < 1 && col !== MUTE)) tag(ctx, s, rx, y, col, { right: true }); });
        if (p > 0 && p < 1) {
          const tab = i === 0 ? REQ : LIM, y = slot(tab, from) + (slot(tab, to) - slot(tab, from)) * p;
          tag(ctx, tab[p < 0.5 ? from : to][0], rx, y, i === 0 ? BLUE : ORANGE, { right: true });
        }
        say(`${S[i].pill}. ${S[i].note}`);
      },
    });
  });

  // Demo: the same rising load against a CPU limit (flattens, slower) and a memory limit (killed, restarts from zero).
  fig('memory-limit', (root) => {
    const SEC = 7, T = 60, D = (s) => 0.3 + 0.95 * s / T, HIT = (1 - 0.3) / 0.95 * T, BACK = 4;
    const M = [
      { pill: 'CPU limit 1000m', tone: 'warn', stamp: ['느려지지만 살아 있음', 'warn'], ev: '쓰로틀 시작', note: 'CPU는 limit에서 사용량이 평평해진다. 못 쓴 몫만큼 응답이 늦어질 뿐 프로세스는 그대로다.' },
      { pill: 'memory limit 2Gi', tone: 'bad', stamp: ['OOMKilled, 재시작', 'bad'], ev: 'OOMKilled', note: '메모리는 limit에 닿는 순간 OOMKilled로 끝나고, 재시작해 처음부터 다시 쌓는다.' },
    ];
    const use = (mode, s) => (mode === 0 ? Math.min(D(s), 1) : s < HIT ? D(s) : s < HIT + BACK ? null : 0.3 + 0.95 * (s - HIT - BACK) / T);
    hwa.scene(root, {
      height: 240, still: SEC, notes: M.map((m) => m.note), demo: { modes: ['CPU limit', '메모리 limit'], run: '부하 올리기' },
      frame: (ctx, w, h, time, say, ui) => {
        const m = M[ui.mode], run = ui.runAt === null ? -1 : time - ui.runAt, t = clamp(run / SEC) * T;
        C.pill(ctx, 0, 0, m.pill, m.tone);
        const x0 = 40, x1 = w - 8, y0 = 46, H = 150, X = (s) => x0 + s / T * (x1 - x0);
        const Y = C.panel(ctx, x0, y0, x1 - x0, H, { max: 1.4, ticks: [[0, '0'], [0.5, '50%'], [1, '100%']] });
        C.dashed(ctx, x0, Y(1), x1, Y(1), U.red);
        C.text(ctx, 'limit', x0 + 4, Y(1) - 5, { size: 10, weight: 700, color: U.red });
        [0, 30, 60].forEach((v) => C.text(ctx, `${v}초`, X(v), y0 + H + 15, { size: 10, align: v ? (v === T ? 'right' : 'center') : 'left' }));
        if (run < 0) { prompt(ctx, '부하 올리기', (x0 + x1) / 2, y0 + H * 0.62); say(`${m.pill}. 부하 올리기 버튼을 누르면 시작한다.`); return; }
        const pts = [];
        for (let s = 0; s <= t + 1e-6; s += 0.25) pts.push(s);
        if (ui.mode === 0 && t > HIT) {
          const over = pts.filter((s) => s >= HIT);
          C.area(ctx, over.map((s) => [X(s), Y(D(s))]), Y(1), 'rgba(239,68,68,0.12)');
        }
        C.line(ctx, pts.map((s) => [X(s), Y(D(s))]), '#94a3b8', 1.2);
        // Line breaks while the memory container is down between the kill and the restart.
        let seg = [];
        pts.forEach((s) => { const u = use(ui.mode, s); if (u === null) { C.line(ctx, seg, APP, 2); seg = []; } else seg.push([X(s), Y(u)]); });
        C.line(ctx, seg, APP, 2);
        if (t > HIT + 6) C.text(ctx, '원하는 양', X(t) - 2, Y(D(t)) - 8, { size: 10, align: 'right' });
        if (t >= HIT) C.event(ctx, X(HIT), y0 + H * 0.6, y0 + H, m.ev, U.red);
        const late = Math.round(50 * Math.max(1, D(t))), restarts = ui.mode && t >= HIT ? 1 : 0;
        if (ui.mode === 0) C.chip(ctx, `응답 ${late}ms`, w, 11, late > 50 ? 'warn' : 'ok');
        else C.chip(ctx, `재시작 ${restarts}회`, w, 11, restarts ? 'bad' : 'ok');
        if (t < T) C.dashed(ctx, X(t), y0, X(t), y0 + H);
        C.stamp(ctx, (x0 + x1) / 2, y0 + H * 0.84, m.stamp[0], m.stamp[1], (run - SEC) / 0.4);
        say(`${m.pill}. ${m.note}`);
      },
    });
  });

  // Demo: node memory runs low; the kubelet evicts the pod whose usage exceeds its request the most.
  fig('memory-eviction', (root) => {
    const SEC = 7, NODE = 3, MAX = 1.6;
    const PODS = [
      { n: 'API', req: [0.25, 1.2], sub: ['request 256Mi', 'request = limit 1.2Gi'], u: [0.6, 1.0], col: APP },
      { n: 'batch', req: [0, 0], sub: ['request 없음', 'request 없음'], u: [0.25, 0.5], col: PUR },
      { n: 'db', req: [1.5, 1.5], sub: ['request 1.5Gi', 'request 1.5Gi'], u: [1.45, 1.45], col: NAT },
    ];
    const notes = ['API 파드는 request 256Mi를 0.75Gi 넘어, 노드가 모자라자 가장 먼저 축출된다.', 'request를 limit과 같게 두면 API 파드는 후보에서 빠지고, request 없이 돌던 batch가 축출된다.'];
    hwa.scene(root, {
      height: 262, still: SEC, notes, demo: { modes: ['request 256Mi', 'request = limit'], run: '노드 메모리 채우기' },
      frame: (ctx, w, h, time, say, ui) => {
        const md = ui.mode, run = ui.runAt === null ? -1 : time - ui.runAt, k = run < 0 ? 0 : clamp(run / SEC);
        const g = mv(k, 0.05, 0.5), over = (p) => p.u[0] + (p.u[1] - p.u[0]) * g - p.req[md];
        const cand = k >= 0.6 ? PODS.filter((p) => over(p) > 0) : [], victim = k >= 0.75 ? cand.reduce((a, b) => (over(b) > over(a) ? b : a)) : null, gone = mv(k, 0.78, 0.9);
        const use = PODS.map((p) => (p.u[0] + (p.u[1] - p.u[0]) * g) * (p === victim ? 1 - gone : 1)), used = use.reduce((a, b) => a + b, 0), avail = Math.round((NODE - used) * 1024);
        const low = k >= 0.55 && !victim;
        C.pill(ctx, 0, 0, victim ? `${victim.n} 축출` : low ? '노드 메모리 압박' : '노드 3Gi', victim ? (victim.n === 'API' ? 'bad' : 'ok') : low ? 'warn' : 'info');
        const NY = 52, NX = (v) => v / NODE * w;
        C.text(ctx, '노드 3Gi', 0, NY - 8, { size: 10, weight: 600 });
        C.text(ctx, `memory.available ${avail}Mi`, w, NY - 8, { size: 10, weight: 700, color: avail < 100 ? U.red : U.muted, align: 'right' });
        rect(ctx, 0, NY, w, 14, U.cell, 3);
        let x = 0;
        PODS.forEach((p, j) => { rect(ctx, x, NY, NX(use[j]) - 1, 14, p.col, 2); x += NX(use[j]); });
        C.dashed(ctx, NX(NODE - 100 / 1024), NY - 4, NX(NODE - 100 / 1024), NY + 18, U.red);
        const bx = Math.min(110, w * 0.32), BX = (v) => bx + v / MAX * (w - bx - 8);
        PODS.forEach((p, j) => {
          const y = 96 + j * 46, isC = cand.includes(p), isV = p === victim;
          C.text(ctx, p.n, 0, y + 10, { size: 12, weight: 600, color: isV ? U.red : U.text });
          C.text(ctx, p.sub[md], 0, y + 25, { size: 9 });
          rect(ctx, bx, y, w - bx - 8, 16, U.cell, 3);
          rect(ctx, bx, y, BX(use[j]) - bx, 16, isV ? U.red : isC ? ORANGE[2] : p.col, 3);
          if (p.req[md] > 0) {
            C.line(ctx, [[BX(p.req[md]), y - 4], [BX(p.req[md]), y + 20]], U.text, 1.5);
            C.text(ctx, 'request', BX(p.req[md]), y + 31, { size: 9, align: 'center' });
          }
          if (isC && !isV) C.text(ctx, `+${over(p).toFixed(2)}Gi`, BX(use[j]) + 4, y + 8.5, { size: 10, weight: 700, color: ORANGE[1], base: 'middle' });
          if (isV) C.text(ctx, '축출', bx + 6, y + 8.5, { size: 10, weight: 700, color: gone > 0.5 ? U.red : '#fff', base: 'middle' });
        });
        if (run < 0) prompt(ctx, '노드 메모리 채우기', w / 2, h - 14);
        else C.stamp(ctx, w / 2, h - 18, md ? 'batch 축출, API 유지' : 'API가 먼저 축출됨', md ? 'ok' : 'bad', (run - SEC) / 0.4);
        say(`${PODS[0].sub[md]}. 노드 memory.available ${avail}Mi. ${victim ? `${victim.n} 축출.` : ''}`);
      },
    });
  });

  // Node.js rss is more than the heap: uploads grow the buffers outside the heap while the heap stays put.
  fig('memory-node-rss', (root) => {
    const SEC = 5.5, HOLD = 1.8, MAX = 2.15;
    const seg = (buf) => [['힙', 0.5, APP], ['네이티브', 0.2, NAT], ['스택', 0.03, STK], ['버퍼', buf, BUF]];
    const notes = ['평소에는 힙 0.5Gi에 네이티브와 버퍼가 조금 붙어 rss가 0.9Gi다.', '업로드가 몰리면 힙은 그대로이고 버퍼만 1Gi로 늘어 rss가 limit에 다가간다.'];
    hwa.scene(root, {
      height: 196, still: SEC + HOLD + SEC, scenes: hwa.loopScenes(SEC, HOLD, 2), notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2), X = (v) => v / MAX * (w - 2), by = 80, bh = 30;
        const buf = i ? 0.15 + 0.85 * mv(k, 0.1, 0.6) : 0.15, S = seg(buf), grow = i ? 1 : mv(k, 0.05, 0.5);
        C.pill(ctx, 0, 0, i ? '파일 업로드 몰림' : '평소', i ? 'warn' : 'ok');
        rect(ctx, 0, by, X(2), bh, U.cell, 4);
        let x = 0, total = 0;
        S.forEach(([, v, c], j) => {
          const f = clamp(grow * 4 - j);
          rect(ctx, x, by, X(v) * f - (j < 3 ? 1 : 0), bh, c, 3);
          x += X(v) * f;
          total += v * f;
        });
        C.dashed(ctx, X(2), by - 30, X(2), by + bh + 6, U.red);
        C.text(ctx, 'limit 2Gi', X(2), by - 34, { size: 10, weight: 700, color: U.red, align: 'right' });
        brace(ctx, 0, X(total), by - 8, U.text, `rss ${total.toFixed(2)}Gi`, X(2) - tw(ctx, 'limit 2Gi', 10, 700) - 10, i ? 1 : mv(k, 0.55, 0.7));
        brace(ctx, 0, X(0.5), by + bh + 8, APP, 'GC가 치우는 곳', w, i ? 1 : mv(k, 0.72, 0.85), true);
        ctx.font = U.font(10);
        C.legend(ctx, 0, h - 8, S.map(([n, , c]) => [n, c]));
        if (i) C.stamp(ctx, w / 2, by + bh + 46, `힙 그대로, rss ${total.toFixed(2)}Gi`, 'warn', mv(k, 0.75, 0.85));
        say(`${i ? '업로드가 몰려 버퍼가 늘었다' : '평소'}. 힙 0.5Gi, 버퍼 ${buf.toFixed(2)}Gi, rss ${total.toFixed(2)}Gi.`);
      },
    });
  });

  // V8 generations: most new objects die in the first Scavenge; only objects that survive two are promoted to old space.
  fig('memory-node-gc', (root) => {
    const SEC = 5.5, HOLD = 1.8, LIVE1 = [1, 5], LIVE2 = 5, OLD = [0, 1, 2, 4, 5, 8];
    const notes = ['새 객체는 New space의 한쪽 칸에 차례로 놓인다.', '칸이 차면 Scavenge가 돈다. 8개 중 6개는 이미 버려져 그대로 사라지고, 살아 있는 2개만 반대쪽 칸으로 옮긴다.', '다음 Scavenge까지 살아남은 1개만 Old space로 옮겨 간다. Old space는 크고 가끔 치운다.'];
    hwa.scene(root, {
      height: 222, still: 2 * (SEC + HOLD) + SEC, scenes: hwa.loopScenes(SEC, HOLD, 3), notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), gy = 34, gh = 140, nw = Math.round(w * 0.56), hw = (nw - 30) / 2;
        const s = Math.min(22, (hw - 16 - 8) / 3), ow = w - nw - 10, os = Math.min(22, (ow - 20 - 12) / 4);
        C.pill(ctx, 0, 0, ['할당', 'Scavenge 1회', 'Scavenge 2회'][i], i ? 'ok' : 'info');
        C.group(ctx, 0, gy, nw, gh, 'New space');
        C.group(ctx, nw + 10, gy, ow, gh, 'Old space');
        const half = (j) => [10 + j * (hw + 10), gy + 30];
        [0, 1].forEach((j) => {
          const [hx, hy] = half(j);
          C.box(ctx, hx, hy, hw, 98, { fill: '#fff', r: 6 });
          C.text(ctx, j ? 'to' : 'from', hx + 8, hy + 14, { size: 9 });
        });
        const at = (j, q) => { const [hx, hy] = half(j); return [hx + 8 + (q % 3) * (s + 4), hy + 24 + Math.floor(q / 3) * (s + 4)]; };
        const oat = (q) => [nw + 20 + (q % 4) * (os + 4), gy + 30 + Math.floor(q / 4) * (os + 4)];
        for (let q = 0; q < 12; q++) { const [x, y] = oat(q); rect(ctx, x, y, os, os, U.cell, 4); if (OLD.includes(q)) rect(ctx, x, y, os, os, NAT, 4); }
        const obj = (x, y, a, col, label, size = s) => {
          if (a <= 0) return;
          ctx.globalAlpha = a;
          rect(ctx, x, y, size, size, col, 4);
          if (label) C.text(ctx, label, x + size / 2, y + size / 2 + 0.5, { size: 9, weight: 700, color: '#fff', align: 'center', base: 'middle' });
          ctx.globalAlpha = 1;
        };
        const mix = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
        if (i === 0) for (let q = 0; q < 8; q++) obj(...at(0, q), mv(k, 0.05 + q * 0.08, 0.12 + q * 0.08), APP);
        if (i === 1) {
          for (let q = 0; q < 8; q++) {
            const live = LIVE1.indexOf(q);
            if (live < 0) obj(...at(0, q), 1 - mv(k, 0.35, 0.5), k >= 0.15 ? DEAD : APP);
            else obj(...mix(at(0, q), at(1, live), mv(k, 0.5, 0.75)), 1, APP, k >= 0.75 ? '1' : '');
          }
        }
        if (i === 2) {
          obj(...at(1, 0), 1 - mv(k, 0.3, 0.45), k >= 0.12 ? DEAD : APP, '1');
          const f = mv(k, 0.45, 0.75), [ox, oy] = oat(3);
          obj(...mix(at(1, 1), [ox, oy], f), 1, f >= 1 ? PUR : APP, f >= 1 ? '' : '1', s + (os - s) * f);
        }
        if (i) C.stamp(ctx, w / 2, gy + gh + 26, i === 1 ? '8개 중 2개만 남음' : '두 번 살아남은 1개만 Old로', 'ok', mv(k, 0.82, 0.9));
        say(notes[i]);
      },
    });
  });

  // Where Node reads its memory size: cgroup memory.max (Node 20.3+ on cgroup v2) or the whole host (older Node).
  // Data: Node 20 to 26 on 64-bit Linux, old space = half of that memory, capped at 2GB (4GB from 15GB up).
  fig('memory-node-heap-limit', (root) => {
    const SEC = 6, HOLD = 1.8, MAX = 4.4;
    const S = [
      { pill: 'Node 20.3 이상', tone: 'ok', sub: '인식 2GiB, 상한 1GiB', heap: 1, stamp: ['상한 1GiB, limit 안', 'ok'], note: 'Node 20.3 이상은 cgroup v2의 memory.max를 읽어 2GiB로 인식하고, Old space 상한을 그 절반인 1GiB로 잡는다.' },
      { pill: 'Node 18 이하, cgroup v2', tone: 'bad', sub: '인식 64GB, 상한 4GB', heap: 4, stamp: ['상한 4GB > limit 2Gi', 'bad'], note: '오래된 Node는 cgroup v2의 limit을 못 읽고 호스트 64GB로 계산해, 상한이 4GB로 limit보다 커진다.' },
    ];
    hwa.scene(root, {
      height: 262, still: SEC + HOLD + SEC, scenes: hwa.loopScenes(SEC, HOLD, 2), notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2), s = S[i], gy = 34;
        C.pill(ctx, 0, 0, s.pill, s.tone);
        C.group(ctx, 0, gy, w, 132, '노드');
        const host = '호스트 메모리 64GB', hx = w - 10 - tw(ctx, host, 10, 600) / 2;
        C.text(ctx, host, w - 10, gy + 16, { size: 10, weight: i ? 700 : 600, color: i ? U.red : U.muted, align: 'right' });
        C.box(ctx, 10, gy + 30, w - 20, 92, { fill: '#fff', r: 8 });
        C.text(ctx, '컨테이너 limit 2Gi', 20, gy + 47, { size: 10, weight: 600 });
        const mtx = 20 + (tw(ctx, 'memory.max', 11, 600) + 18) / 2, mty = gy + 90;
        tag(ctx, 'memory.max', mtx, mty, i ? MUTE : BLUE);
        const nw = Math.min(170, (w - 40) * 0.56), nx = w - 20 - nw, ny = gy + 66;
        const a = mv(k, 0.1, 0.42), on = k >= 0.45;
        C.card(ctx, { x: nx, y: ny, w: nw, h: 46, t: 'Node.js', s: on ? s.sub : '시작' }, { lit: a > 0 && !on });
        const path = i ? [[hx, gy + 22], [hx, ny - 2]] : [[mtx + (tw(ctx, 'memory.max', 11, 600) + 18) / 2 + 2, mty], [nx - 3, mty]];
        if (i) path[1][0] = Math.min(hx, nx + nw - 12);
        if (i) path[0][0] = path[1][0];
        C.arrow(ctx, path, a, i ? U.red : APP);
        const by = gy + 152, bx = 64, X = (v) => bx + v / MAX * (w - bx - 8);
        C.text(ctx, 'old space', 0, by + 7, { size: 10, weight: 600, color: U.text, base: 'middle' });
        C.text(ctx, '상한', 0, by + 20, { size: 10, base: 'middle' });
        rect(ctx, bx, by, w - bx - 8, 16, U.cell, 3);
        rect(ctx, bx, by, X(s.heap * mv(k, 0.5, 0.75)) - bx, 16, i ? U.red : APP, 3);
        C.dashed(ctx, X(2), by - 6, X(2), by + 26, U.red);
        C.text(ctx, 'limit 2Gi', X(2), by + 38, { size: 10, weight: 700, color: U.red, align: 'center' });
        C.stamp(ctx, w / 2, h - 18, s.stamp[0], s.stamp[1], mv(k, 0.82, 0.9));
        say(s.note);
      },
    });
  });

  // Demo: two ceilings, heap limit 1.5G and container limit 2Gi. A leak hits the first, a buffer burst hits the second.
  fig('memory-node-oom', (root) => {
    const SEC = 7, N = 240, HL = 1.5, LIM = 2;
    const saw = (k) => (k * 7) % 1;
    const build = (mode) => {
      const heap = [], rss = [];
      for (let j = 0; j <= N; j++) {
        const k = j / N, hp = mode ? 0.5 + 0.15 * saw(k) : 0.42 + 1.25 * k + 0.16 * (1 - k) * saw(k);
        heap.push(hp);
        rss.push(hp + (mode ? 0.3 + 1.5 * k : 0.35));
        if ((mode ? rss[j] : hp) >= (mode ? LIM : HL)) return { heap, rss, hit: k };
      }
      return { heap, rss, hit: 1 };
    };
    const DATA = [build(0), build(1)];
    const M = [
      { pill: '캐시 누수', ev: 'FATAL ERROR', stamp: '힙 OOM, 종료 코드 134', log: '앱 로그: FATAL ERROR ... heap out of memory', note: '캐시가 새면 heapUsed가 힙 상한 1.5G에 먼저 닿는다. V8이 스스로 끝내며 FATAL ERROR를 남긴다.' },
      { pill: '큰 버퍼', ev: 'OOMKilled', stamp: 'OOMKilled, 종료 코드 137', log: '앱 로그: 없음', note: '버퍼가 몰리면 힙은 멀쩡한데 rss가 limit 2Gi에 먼저 닿는다. 커널이 SIGKILL로 끝내 로그가 없다.' },
    ];
    hwa.scene(root, {
      height: 258, still: SEC, notes: M.map((m) => m.note), demo: { modes: ['캐시 누수', '큰 버퍼'], run: '트래픽 보내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const m = M[ui.mode], d = DATA[ui.mode], run = ui.runAt === null ? -1 : time - ui.runAt, k = clamp(run / SEC);
        C.pill(ctx, 0, 0, m.pill, 'info');
        ctx.font = U.font(10);
        const lg = [['heapUsed', APP], ['rss', PUR]], lgw = lg.reduce((a, [s]) => a + 24 + ctx.measureText(s).width, 0);
        C.legend(ctx, w - lgw + 12, 11, lg);
        const x0 = 32, x1 = w - 8, y0 = 48, H = 160, X = (v) => x0 + v * (x1 - x0);
        const Y = C.panel(ctx, x0, y0, x1 - x0, H, { max: 2.3, ticks: [[0, '0'], [1, '1G'], [2, '2G']] });
        C.dashed(ctx, x0, Y(LIM), x1, Y(LIM), U.red);
        C.text(ctx, 'limit 2Gi', x0 + 4, Y(LIM) - 5, { size: 10, weight: 700, color: U.red });
        C.dashed(ctx, x0, Y(HL), x1, Y(HL), BLUE[2]);
        C.text(ctx, '힙 상한 1.5G', x0 + 4, Y(HL) - 5, { size: 10, weight: 700, color: BLUE[1] });
        C.text(ctx, '시간', x1, y0 + H + 14, { size: 10, align: 'right' });
        if (run < 0) { prompt(ctx, '트래픽 보내기', (x0 + x1) / 2, y0 + H * 0.7); say(`${m.pill}. 트래픽 보내기 버튼을 누르면 시작한다.`); return; }
        const last = Math.min(Math.round(k * N), d.heap.length - 1), xs = (j) => X(j / N);
        C.line(ctx, d.rss.slice(0, last + 1).map((v, j) => [xs(j), Y(v)]), PUR, 2);
        C.line(ctx, d.heap.slice(0, last + 1).map((v, j) => [xs(j), Y(v)]), APP, 2);
        const dead = k >= d.hit;
        if (dead) {
          C.event(ctx, X(d.hit), y0 + 16, y0 + H, m.ev, U.red, X(d.hit) > x1 - 40 ? 'right' : 'center');
          C.text(ctx, m.log, x0, y0 + H + 30, { size: 10, weight: 600, color: U.red });
        } else C.dashed(ctx, X(k), y0, X(k), y0 + H);
        C.stamp(ctx, (x0 + x1) / 2, y0 + H * 0.78, m.stamp, 'bad', (run - d.hit * SEC) / 0.4);
        say(`${m.pill}. ${m.note}`);
      },
    });
  });

  // In-place resize of memory 2Gi to 4Gi: NotRequired changes memory.max but Node keeps the heap limit it set at start.
  fig('memory-resize', (root) => {
    const SEC = 6.5, HOLD = 1.8, MAX = 4.3;
    const S = [
      { pill: 'resizePolicy: NotRequired', tone: 'warn', stamp: ['limit 4Gi, 힙 상한 1GiB 그대로', 'warn'], note: 'NotRequired면 memory.max만 4Gi로 바뀐다. 힙 상한은 시작할 때 정해져 1GiB 그대로다.' },
      { pill: 'resizePolicy: RestartContainer', tone: 'ok', stamp: ['재시작 후 힙 상한 2GiB', 'ok'], note: 'RestartContainer면 컨테이너가 다시 시작하며 Node가 4Gi를 읽고 힙 상한을 2GiB로 잡는다.' },
    ];
    hwa.scene(root, {
      height: 288, still: SEC + HOLD + SEC, scenes: hwa.loopScenes(SEC, HOLD, 2), notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2), s = S[i];
        C.pill(ctx, 0, 0, s.pill, s.tone);
        const aw = Math.min(180, w * 0.5), kw = Math.min(140, w * 0.38), ky = 34;
        C.card(ctx, { x: 0, y: ky, w: aw, h: 44, t: 'resize 요청', s: 'memory 2Gi → 4Gi' }, { lit: k < 0.25 });
        C.card(ctx, { x: w - kw, y: ky, w: kw, h: 44, t: 'kubelet', s: '런타임에 전달' }, { lit: k >= 0.25 && k < 0.42 });
        C.arrow(ctx, [[aw + 4, ky + 22], [w - kw - 6, ky + 22]], mv(k, 0.05, 0.25), U.text);
        const cy = 106, ch = 76;
        C.arrow(ctx, [[w - kw / 2, ky + 46], [w - kw / 2, cy - 3]], mv(k, 0.25, 0.4), U.text);
        const changed = k >= 0.42, restarting = i === 1 && k >= 0.48 && k < 0.64, restarted = i === 1 && k >= 0.64;
        C.box(ctx, 0, cy, w, ch, { fill: U.plot, stroke: changed ? U.accentLine : U.grid, r: 10 });
        C.text(ctx, '컨테이너', 10, cy + 16, { size: 10, weight: 600 });
        C.text(ctx, `재시작 ${restarted ? 1 : 0}회`, w - 10, cy + 16, { size: 10, weight: 600, color: restarted ? ORANGE[1] : U.muted, align: 'right' });
        const mt = `memory.max = ${changed ? 4 : 2}Gi`, mw = tw(ctx, mt, 11, 600) + 18;
        tag(ctx, mt, 10 + mw / 2, cy + 48, changed ? ORANGE : MUTE);
        const heap = restarted ? 2 : 1, nw = Math.min(150, w - mw - 40), nx = w - 10 - nw;
        ctx.globalAlpha = restarting ? 0.35 : 1;
        C.card(ctx, { x: nx, y: cy + 26, w: nw, h: 42, t: 'Node.js', s: restarting ? '재시작 중' : `힙 상한 ${heap}GiB` }, { lit: restarted });
        ctx.globalAlpha = 1;
        const by = cy + ch + 20, bx = 56, X = (v) => bx + v / MAX * (w - bx - 8);
        [['limit', changed ? 4 : 2, ORANGE[2]], ['힙 상한', heap, APP]].forEach(([n, v, c], j) => {
          const y = by + j * 22;
          C.text(ctx, n, 0, y + 6, { size: 10, weight: 600, color: U.text, base: 'middle' });
          rect(ctx, bx, y, w - bx - 8, 12, U.cell, 3);
          rect(ctx, bx, y, X(v) - bx, 12, c, 3);
          C.text(ctx, `${v}Gi`, X(v) + 4, y + 6.5, { size: 10, weight: 600, color: U.text, base: 'middle' });
        });
        C.stamp(ctx, w / 2, h - 18, s.stamp[0], s.stamp[1], mv(k, 0.82, 0.9));
        say(s.note);
      },
    });
  });
})();
