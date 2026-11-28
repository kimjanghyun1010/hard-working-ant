// Memory post figures: pages, page cache, cgroup metrics, reclaim and OOM, Kubernetes request and limit, Node.js heap.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const mv = (k, a, b) => hwa.smooth((k - a) / (b - a));
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const fig = (id, fn) => document.querySelectorAll(`[data-figure="${id}"]`).forEach(fn);
  const APP = U.blue, PUR = U.purple, CACHE = '#c4b5fd', NAT = '#64748b', OTHER = '#e2e8f0';
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
