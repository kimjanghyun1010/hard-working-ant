(() => {
  const U = hwa.ui, C = hwa.cv;
  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const fmt = (n) => n.toLocaleString('en-US');
  const WAIT = ['#fef3c7', '#b45309', '#fcd34d'], DATA = ['#eff6ff', '#1d4ed8', '#93c5fd'];

  // Waiting for N requests: one thread per request (A) against one thread in epoll_wait (B), under the same load.
  document.querySelectorAll('[data-figure="cpu-wait-model"]').forEach((root) => {
    const SEC = 6, HOLD = 2, PER = 100, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = [
      '요청 100건이면 A는 스레드 100개, B는 1개로 둘 다 여유가 있다.',
      '요청이 1만 건이면 A는 스레드와 스택이 1만 개, B는 그대로 1개다.',
    ];
    const grid = (ctx, x, y, size, count, fill) => {
      for (let i = 0; i < 100; i++) {
        const cx = x + (i % 10) * (size + 2), cy = y + Math.floor(i / 10) * (size + 2), a = Math.min(1, count - i);
        ctx.fillStyle = U.cell;
        ctx.fillRect(cx, cy, size, size);
        if (a <= 0) continue;
        ctx.globalAlpha = Math.max(0.25, a);
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.roundRect(cx, cy, size, size, 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    };
    // Data: stack size is the JVM default on 64-bit Linux (-Xss 1MB); glibc reserves 8MB of address space.
    const stack = (n) => (n < 1000 ? `${n}MB` : `${(n / 1024).toFixed(1)}GB`);
    hwa.scene(root, {
      height: 374, still: S.at(1) + SEC + 1.5, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), run = (time % (2 * (SEC + HOLD))) - S.at(i);
        const k = hwa.smooth(t / SEC), load = Math.round(i ? PER + (100 * PER - PER) * k : PER * k), cnt = load / PER;
        C.pill(ctx, 0, 0, `동시 요청 ${fmt(load)}건`, i ? 'warn' : 'info');
        C.text(ctx, '칸 하나 = 100개', w, 11, { size: 10, align: 'right', base: 'middle' });
        const pw = (w - 12) / 2, size = Math.min(8, Math.floor((pw - 42) / 10)), g = size * 10 + 18, y0 = 32, wide = pw > 240;
        [0, 1].forEach((side) => {
          const x = side * (pw + 12), gx = x + (pw - g) / 2, cx = x + pw / 2, ty = y0 + 46, sy = y0 + 184;
          C.group(ctx, x, y0, pw, 296, side ? 'B. epoll과 스레드 1개' : 'A. 요청마다 스레드', y0 + 18);
          C.text(ctx, '사용자 공간', x + 10, y0 + 38, { size: 10 });
          C.dashed(ctx, x + 8, y0 + 158, x + pw - 8, y0 + 158, '#cbd5e1');
          C.text(ctx, '커널', x + 10, y0 + 174, { size: 10 });
          C.text(ctx, side ? 'epoll 감시 목록' : '소켓', x + pw - 10, y0 + 174, { size: 10, align: 'right' });
          if (side) {
            const cw = Math.min(140, pw - 20);
            C.box(ctx, gx - 6, sy - 6, g + 12, g + 12, { fill: '#fff' });
            C.arrow(ctx, [[cx, ty + 92], [cx, sy - 8]], 1, '#94a3b8', { width: 1.2 });
            C.card(ctx, { x: cx - cw / 2, y: ty + 46, w: cw, h: 46, t: '메인 스레드', s: 'epoll_wait 대기' }, { fill: WAIT[0], stroke: WAIT[2] });
          } else {
            C.text(ctx, wide ? '스레드마다 read 대기' : 'read 대기', x + pw - 10, y0 + 38, { size: 10, weight: 600, color: WAIT[1], align: 'right' });
            grid(ctx, gx, ty, size, cnt, '#f59e0b');
          }
          grid(ctx, gx, sy, size, cnt, U.blue);
          const threads = side ? 1 : load, big = threads >= 1000;
          C.text(ctx, `스레드 ${fmt(threads)}개`, cx, 348, { size: 13, weight: 700, color: side ? U.tones.ok[1] : big ? U.tones.bad[1] : U.text, align: 'center' });
          C.text(ctx, `스택 ${stack(threads)}${wide ? ' (1MB씩)' : ''}`, cx, 366, { size: 10, align: 'center' });
          if (i === 1) C.stamp(ctx, cx, ty + 22, side ? '스레드 1개' : '스레드 1만 개', side ? 'ok' : 'bad', (run - SEC - side * 0.5) / 0.4);
        });
        say(`동시 요청 ${fmt(load)}건. A는 스레드 ${fmt(load)}개, B는 스레드 1개. ${notes[i]}`);
      },
    });
  });

  // The three epoll calls on a map of user space over the kernel: create the lists, register sockets, wait and wake.
  document.querySelectorAll('[data-figure="cpu-epoll"]').forEach((root) => {
    const S = seq([5, 6, 7.6], 1.8);
    const CALL = [['epoll_create1()', 'epoll_create1()', '시작 때 한 번'], ['epoll_ctl(ADD)', 'epoll_ctl(ADD, fd, EPOLLIN)', '연결마다 한 번'], ['epoll_wait()', 'epoll_wait()', '루프 한 바퀴마다']];
    const FD = [[20, 'listen'], [21, 'MySQL'], [22, '클라이언트']];
    const ROWS = ['감시 목록', '준비됨 목록', '대기 목록'];
    const notes = [
      'epoll_create1은 프로세스 시작 때 한 번 불러 커널에 목록 세 개를 만든다.',
      'epoll_ctl은 소켓이나 DB 연결이 생길 때 한 번씩 감시 목록에 올린다. 쿼리마다 부르지 않는다.',
      'epoll_wait는 준비됨 목록이 비면 대기하고, fd 21에 패킷이 오면 깨어나 21을 받아 간다.',
    ];
    const chip = (ctx, s, cx, cy, [bg, fg, line], cw = 40, a = 1) => {
      if (a <= 0) return;
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
    };
    const lay = (w) => {
      const wide = w >= 480, nw = wide ? 56 : 36, sx = nw + 18, sw = wide ? 92 : 56, ex = sx + sw + 10, ew = w - ex, lw = wide ? 74 : 56;
      const rx = ex + 8 + lw, ry = [174, 206, 238], cx = ex + ew / 2, cw = Math.min(132, ew - 20);
      return { wide, nw, sx, sw, ex, ew, rx, ry, cx, cw, slot: (j) => rx + 26 + j * 44, sock: (j) => 140 + j * 36, waitX: rx + 39 };
    };
    hwa.scene(root, {
      height: 280, still: S.at(2) + 7.6 + 0.8, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), L = lay(w), wt = i === 2;
        C.pill(ctx, 0, 0, CALL[i][L.wide ? 1 : 0], 'info');
        C.text(ctx, CALL[i][2], w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        C.group(ctx, 0, 32, w, 70, '사용자 공간', 50);
        if (L.wide) C.text(ctx, 'Node 프로세스', 10, 66, { size: 10 });
        C.group(ctx, 0, 112, w, 160, '커널', 130);

        // Network card and sockets on the left: packets enter here first.
        C.box(ctx, 8, L.sock(1) - 4, L.nw, 38, { fill: '#fff' });
        C.text(ctx, '랜카드', 8 + L.nw / 2, L.sock(1) + 15, { size: L.wide ? 10 : 9, align: 'center', base: 'middle' });
        const sockA = (j) => (i >= 2 ? 1 : i === 1 ? ease(t, 0.4 + j * 1.7, 0.8 + j * 1.7) : 0);
        const hot = wt && t >= 3.8;
        FD.forEach(([fd, kind], j) => {
          const a = sockA(j), y = L.sock(j);
          if (a <= 0) { C.box(ctx, L.sx, y, L.sw, 30, { fill: U.plot, dash: [3, 3] }); return; }
          ctx.globalAlpha = a;
          C.box(ctx, L.sx, y, L.sw, 30, { fill: hot && j === 1 ? DATA[0] : '#fff', stroke: hot && j === 1 ? U.blue : U.grid });
          C.text(ctx, `fd ${fd}`, L.sx + L.sw / 2, y + 11, { size: 10, weight: 700, color: U.text, align: 'center', base: 'middle' });
          C.text(ctx, kind, L.sx + L.sw / 2, y + 23, { size: 9, align: 'center', base: 'middle' });
          ctx.globalAlpha = 1;
        });
        if (wt && t > 2.8 && t < 3.8) {
          const [px, py] = mix([8 + L.nw / 2, L.sock(1) + 15], [L.sx + 4, L.sock(1) + 15], ease(t, 2.8, 3.7));
          ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fillStyle = U.blue; ctx.fill();
        }

        // epoll instance: three lists, created in scene 1.
        C.box(ctx, L.ex, 138, L.ew - 8, 126, { fill: '#fff' });
        C.text(ctx, 'epoll 인스턴스', L.ex + 10, 154, { size: 10, weight: 600, color: U.text });
        ROWS.forEach((name, j) => {
          const a = i >= 1 ? 1 : ease(t, 1.4 + j * 0.8, 2.0 + j * 0.8);
          if (a <= 0) return;
          ctx.globalAlpha = a;
          C.text(ctx, name, L.ex + 10, L.ry[j], { size: L.wide ? 10 : 9, base: 'middle' });
          C.box(ctx, L.rx, L.ry[j] - 13, L.ex + L.ew - 16 - L.rx, 26, { fill: U.plot, r: 6 });
          ctx.globalAlpha = 1;
        });
        FD.forEach(([fd], j) => {
          const from = [L.sx + L.sw / 2, L.sock(j) + 15], to = [L.slot(j), L.ry[0]];
          const k = i >= 2 ? 1 : i === 1 ? ease(t, 0.9 + j * 1.7, 1.9 + j * 1.7) : 0;
          if (k > 0) chip(ctx, `fd ${fd}`, ...mix(from, to, k), ['#fff', DATA[1], DATA[2]]);
        });
        if (wt && t >= 4.0) chip(ctx, 'fd 21', ...mix([L.slot(1), L.ry[0]], [L.slot(0), L.ry[1]], ease(t, 4.0, 5.0)), [U.blue, '#fff', U.blue]);
        if (wt && t >= 1.0 && t < 4.0) C.text(ctx, '비어 있음', L.rx + 10, L.ry[1], { size: 10, weight: 600, color: WAIT[1], base: 'middle' });

        // Main thread: leaves its card for the wait list during epoll_wait and returns when woken.
        const card = { x: L.cx - L.cw / 2, y: 44, w: L.cw, h: 46, t: '메인 스레드' };
        const away = wt && t >= 1.6 && t < 6.2, woke = wt && t >= 6.2;
        card.s = away ? '대기' : woke ? 'fd 21 읽기' : 'JS 실행';
        C.card(ctx, card, away ? { dim: true, dash: [4, 3], fill: U.plot } : { lit: woke, fill: DATA[0], stroke: DATA[2] });
        if (away || (wt && t >= 6.2 && t < 7.2)) {
          const home = [L.cx, 67], slot = [L.waitX, L.ry[2]];
          const p = t < 6.2 ? mix(home, slot, ease(t, 1.6, 2.6)) : mix(slot, home, ease(t, 6.2, 7.2));
          chip(ctx, '메인 스레드', ...p, WAIT, 66);
        }
        const call = i === 0 ? ease(t, 0.4, 1.2) : i === 1 ? 1 : ease(t, 0.2, 1.0);
        C.arrow(ctx, [[L.cx - 26, 92], [L.cx - 26, 136]], call, i === 1 ? '#94a3b8' : U.accent);
        if (wt && t >= 6.6) C.arrow(ctx, [[L.cx + 26, 136], [L.cx + 26, 92]], ease(t, 6.6, 7.3), U.blue);
        if (wt) C.stamp(ctx, L.cx - L.cw / 2 - Math.min(80, (L.cx - L.cw / 2) / 2), 75, 'fd 21 받음', 'ok', (run - 7.4) / 0.4);
        say(`${CALL[i][1]}. ${notes[i]}`);
      },
    });
  });

  // 1, 5 and 15 minute load averages during a load test on a 4-vCPU server.
  document.querySelectorAll('[data-figure="cpu-load"]').forEach((root) => {
    const MIN = 20, DT = 5, ON = 2, OFF = 11, CPUS = 4, MAX = 8, S = seq([3.2, 6.4, 7], 2.2);
    const LINES = [['1분', U.blue, 60], ['5분', U.purple, 300], ['15분', U.slate, 900]];
    // Data: Linux updates loadavg every 5 s as an exponential average of runnable threads (kernel/sched/loadavg.c).
    const n = MIN * 60 / DT + 1;
    const runq = Array.from({ length: n }, (_, i) => {
      const busy = i * DT / 60 >= ON && i * DT / 60 < OFF;
      return Math.max(0, Math.round((busy ? 5.5 : 0.6) + (busy ? 1 : 0.6) * (0.6 * Math.sin(i * 0.37) + 0.4 * Math.sin(i * 1.9 + 1))));
    });
    const avg = LINES.map(([, , win]) => { const e = Math.exp(-DT / win); let l = 0.6; return runq.map((c) => (l = l * e + c * (1 - e))); });
    const PH = [
      [0, ON, '부하 전', 'ok', '부하 전에는 세 값 모두 1 아래에서 비슷하다.'],
      [ON, OFF - DT / 60, '부하 중', 'bad', '부하가 걸리면 1분 평균이 먼저 vCPU 4개 선을 넘고, 15분 평균은 천천히 따라온다.', '15분 평균은 아직 4 아래', 'warn'],
      [OFF, MIN, '부하 끝', 'info', '부하가 끝나면 1분 평균은 바로 떨어지고, 15분 평균은 한동안 높게 남는다.', '15분 평균이 가장 늦게 내려옴', 'info'],
    ];
    hwa.scene(root, {
      height: 276, still: S.at(2) + 7 + 1, scenes: S, notes: PH.map((p) => p[4]),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), ph = PH[i], lens = [3.2, 6.4, 7];
        const m = ph[0] + (ph[1] - ph[0]) * (t / lens[i]), last = Math.max(1, Math.min(n - 1, Math.round(m * 60 / DT)));
        C.pill(ctx, 0, 0, ph[2], ph[3]);
        ctx.font = U.font(10);
        const lgw = LINES.reduce((a, [s]) => a + 24 + ctx.measureText(s).width, 0);
        C.legend(ctx, w - lgw + 12, 11, LINES.map(([s, c]) => [s, c]));
        const x0 = 26, x1 = w - 46, y0 = 40, H = 210, X = (j) => x0 + j / (n - 1) * (x1 - x0), XM = (v) => X(v * 60 / DT);
        const Y = C.panel(ctx, x0, y0, x1 - x0, H, { max: MAX, ticks: [[0, '0'], [2, '2'], [4, '4'], [6, '6'], [8, '8']] });
        if (m > ON) { ctx.fillStyle = 'rgba(239,68,68,0.06)'; ctx.fillRect(XM(ON), y0, XM(Math.min(m, OFF)) - XM(ON), H); }
        C.dashed(ctx, x0, Y(CPUS), x1, Y(CPUS), U.red);
        C.text(ctx, `vCPU ${CPUS}개`, x1 - 4, Y(CPUS) - 5, { size: 10, weight: 600, color: U.red, align: 'right' });
        [0, 5, 10, 15, 20].forEach((v) => C.text(ctx, `${v}분`, XM(v), y0 + H + 16, { size: 10, align: v ? (v === MIN ? 'right' : 'center') : 'left' }));
        if (m >= ON) C.event(ctx, XM(ON), y0 + 16, y0 + H, '부하 시작', WAIT[1], 'left');
        if (m >= OFF) C.event(ctx, XM(OFF), y0 + 16, y0 + H, '부하 끝', U.slate, 'left');
        if (t < lens[i]) C.dashed(ctx, X(last), y0, X(last), y0 + H, U.now);
        const ends = avg.map((a, li) => {
          C.line(ctx, a.slice(0, last + 1).map((v, j) => [X(j), Y(v)]), LINES[li][1], li ? 1.6 : 2);
          return { y: Y(a[last]), v: a[last], c: LINES[li][1] };
        });
        ends.slice().sort((a, b) => a.y - b.y).forEach((e, j, arr) => { e.ly = j && e.y - arr[j - 1].ly < 13 ? arr[j - 1].ly + 13 : e.y; });
        ends.forEach((e) => C.dot(ctx, X(last), e.y, e.c, e.v.toFixed(2), e.ly));
        if (ph[5]) C.stamp(ctx, (x0 + x1) / 2, Y(6.75), ph[5], ph[6], (run - lens[i]) / 0.4);
        say(`${ph[2]}, ${Math.round(m)}분. 1분 ${ends[0].v.toFixed(2)}, 5분 ${ends[1].v.toFixed(2)}, 15분 ${ends[2].v.toFixed(2)}. ${ph[4]}`);
      },
    });
  });
})();
