// Container post figures, in post order: VM and container, root switch, namespaces, cgroup, image layers, OverlayFS, copy-up.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const mv = (k, a, b) => hwa.smooth((k - a) / (b - a));
  const lerp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const each = (id, fn) => document.querySelectorAll(`[data-figure="${id}"]`).forEach(fn);
  // Colour triples: [fill, text, line].
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'], RED = ['#fee2e2', '#dc2626', '#fca5a5'];
  const GREEN = ['#dcfce7', '#15803d', '#86efac'], MUTE = [U.cell, U.muted, '#e2e8f0'], WHITE = ['#fff', U.text, U.grid];
  const tag = (ctx, s, x, y, col, { right = false, a = 1, size = 11, pad = 16 } = {}) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, size, 600) + pad, x0 = right ? x - cw : x - cw / 2;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x0 + 0.5, y - 9.5, cw - 1, 19, 6);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x0 + cw / 2, y + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  // Box with a left-aligned or centred label; col = [fill, text, line].
  const cell = (ctx, x, y, w, h, s, col = WHITE, { center = false, size = 10, dash, a = 1, lit = false } = {}) => {
    if (a <= 0) return;
    ctx.globalAlpha = Math.min(1, a);
    C.box(ctx, x, y, w, h, { fill: col[0], stroke: lit ? U.accent : col[2], dash, r: 6 });
    if (lit) { ctx.beginPath(); ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 6); ctx.strokeStyle = U.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    let sz = size;
    while (sz > 8 && tw(ctx, s, sz, 600) > w - 12) sz--;
    C.text(ctx, s, center ? x + w / 2 : x + 8, y + h / 2 + 0.5, { size: sz, weight: 600, color: col[1], align: center ? 'center' : 'left', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  const ball = (ctx, [x, y], color = U.blue, r = 5) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = color; ctx.fill(); };
  // Moves through stops in equal hops as f goes 0..1; at is the last stop reached.
  const hop = (stops, f) => {
    const m = stops.length - 1, g = clamp(f) * m, s = Math.min(m - 1, Math.floor(g)), l = g - s;
    return { p: lerp(stops[s], stops[s + 1], hwa.smooth(l)), at: l > 0.9 ? s + 1 : s };
  };
  // Time since the current scene started, so stamps can fade in during the hold.
  const since = (time, sec, hold, n, i) => (time % ((sec + hold) * n)) - i * (sec + hold);

  // Timeline: lanes on a time axis, blocks for work, double arrows for waits. demo turns scenes into modes.
  const FILL = { a: U.blue, b: U.purple, c: '#14b8a6', copy: '#f59e0b', write: U.blue };
  const ARC = { wait: '#94a3b8', late: U.red };
  const dbl = (ctx, x0, x1, y, color) => {
    if (x1 - x0 < 6) return;
    C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
    [[x0, 1], [x1, -1]].forEach(([x, d]) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    });
  };
  const tl = (id, scenes, { SEC = 7, HOLD = 1.8, LH = 46, demo } = {}) => each(id, (root) => {
    const maxL = Math.max(...scenes.map((s) => s.lanes.length)), n = scenes.length;
    hwa.scene(root, {
      height: 44 + maxL * LH + 30, still: (n - 1) * (SEC + HOLD) + SEC,
      scenes: n > 1 && !demo ? hwa.loopScenes(SEC, HOLD, n) : undefined,
      notes: scenes.map((x) => x.say), demo,
      frame: (ctx, w, h, time, say, ui) => {
        const auto = hwa.loop(time, SEC, HOLD, n), i = demo ? ui.mode : auto.i, s = scenes[i];
        const run = demo ? (ui.runAt === null ? -1 : time - ui.runAt) : since(time, SEC, HOLD, n, auto.i), k = clamp(run / SEC), t = k * s.span;
        C.pill(ctx, 0, 0, s.pill, s.tone);
        if (s.legend && w >= 340) {
          let lx = w;
          s.legend.slice().reverse().forEach(([kind, label]) => {
            lx -= tw(ctx, label, 10) + 4;
            C.text(ctx, label, lx, 11.5, { size: 10, base: 'middle' });
            lx -= 14;
            ctx.fillStyle = FILL[kind];
            ctx.beginPath(); ctx.roundRect(lx, 6, 10, 10, 2); ctx.fill();
            lx -= 10;
          });
        }
        const lw = Math.min(72, w * 0.2), x0 = lw, x1 = w - 8, top = 40, base = top + s.lanes.length * LH + 4;
        const X = (v) => x0 + (clamp(v, 0, s.span) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
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
          const y = ly(j) + LH / 2;
          dbl(ctx, X(a) + 2, X(Math.min(t, b)) - 2, y, ARC[kind]);
          if (t >= b && label && tw(ctx, label, 9, 600) < X(b) - X(a)) C.text(ctx, label, (X(a) + X(b)) / 2, y + 13, { size: 9, weight: 600, color: ARC[kind], align: 'center' });
        });
        (s.segs || []).forEach(([j, a, b, kind, label]) => {
          if (t <= a) return;
          const y = ly(j) + 7, bx = X(a) + 1, bw = Math.max(3, X(Math.min(t, b)) - bx - 1);
          ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 14, Math.min(7, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
          if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 14) / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
        });
        if (s.event && run >= 0) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
        if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
        if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, top + (base - top) / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
        if (demo && run < 0) C.text(ctx, `${demo.run} 버튼을 눌러 보자`, (x0 + x1) / 2, top + (base - top) / 2, { size: 12, align: 'center', base: 'middle' });
        say(`${s.pill}. ${s.say || ''}`);
      },
    });
  });

  // A file read travels app -> (guest kernel -> hypervisor | host kernel) -> disk.
  each('container-stack', (root) => {
    const SEC = 5.5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = [
      'VM은 게스트 커널과 하이퍼바이저를 거쳐 디스크에 닿는다. 커널이 VM마다 따로 있다.',
      '컨테이너는 호스트 커널을 바로 부른다. 커널은 하나이고 보이는 것과 쓰는 양만 나눈다.',
    ];
    hwa.scene(root, {
      height: 254, still: S.at(1) + SEC + 0.6, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2), vm = i === 0, n = vm ? 2 : 3, run = since(time, SEC, HOLD, 2, i);
        C.pill(ctx, 0, 0, vm ? '하이퍼바이저와 VM' : '컨테이너', vm ? 'warn' : 'info');
        C.text(ctx, '파일 읽기 한 번', w, 11, { size: 10, align: 'right', base: 'middle' });
        C.group(ctx, 0, 30, w, h - 30, '서버 한 대', 46);
        const uw = (w - 16 - (n - 1) * 8) / n, ux = (j) => 8 + j * (uw + 8), cx0 = ux(0) + uw / 2;
        const BY = 154, HY = 194;
        const cw = Math.min(84, (w - 100) / 3 - 6), cX = (j) => w - 14 - (3 - j) * (cw + 6) + 6;
        const disk = [cX(2) + cw / 2, HY + 24];
        const stops = [[cx0, 86], ...(vm ? [[cx0, 126]] : []), [cx0, BY + 23], [disk[0], BY + 23], disk], bi = vm ? 2 : 1;
        const f = mv(k, 0.08, 0.72), { p, at } = hop(stops, f), lit = (j) => f > 0 && f < 1 && (j === bi ? at === bi || at === bi + 1 : at === j);
        for (let j = 0; j < n; j++) {
          const x = ux(j);
          C.box(ctx, x, 54, uw, 90, { fill: '#fff', r: 8 });
          C.text(ctx, vm ? `VM ${'AB'[j]}` : `컨테이너 ${j + 1}`, x + 8, 67, { size: 10, weight: 600 });
          cell(ctx, x + 6, 74, uw - 12, 24, '앱', ['#eff6ff', BLUE[1], '#bfdbfe'], { center: true, lit: j === 0 && lit(0) });
          if (vm) cell(ctx, x + 6, 112, uw - 12, 26, '게스트 커널', WHITE, { center: true, lit: j === 0 && lit(1) });
          else {
            const s = tw(ctx, 'namespace, cgroup', 9) < uw - 12 ? 'namespace, cgroup' : 'ns, cgroup';
            C.text(ctx, s, x + uw / 2, 125, { size: 9, align: 'center', base: 'middle' });
          }
        }
        C.box(ctx, 8, BY, w - 16, 28, { fill: U.plot, on: lit(bi), r: 6 });
        C.text(ctx, vm ? '하이퍼바이저' : '호스트 커널 (하나)', w / 2, BY + 14.5, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
        C.box(ctx, 8, HY, w - 16, 48, { fill: U.plot, r: 6 });
        C.text(ctx, '하드웨어', 16, HY + 24, { size: 10, weight: 600, base: 'middle' });
        ['CPU', '메모리', '디스크'].forEach((s, j) => cell(ctx, cX(j), HY + 10, cw, 28, s, WHITE, { center: true, lit: j === 2 && lit(stops.length - 1) }));
        if (f > 0) C.line(ctx, stops, '#c7d2fe', 1.2);
        if (f > 0 && f < 1) {
          ball(ctx, p);
          C.text(ctx, 'read()', p[0] + 9, p[1], { size: 10, weight: 700, color: U.blue, base: 'middle' });
        }
        C.stamp(ctx, w / 2, 106, vm ? '게스트 커널, 하이퍼바이저 거침' : '호스트 커널만 거침', vm ? 'warn' : 'ok', (run - SEC + 0.6) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Directory tree: chroot leaves a path up to the real root; pivot_root plus umount removes it.
  each('container-root', (root) => {
    const SEC = 4.8, HOLD = 2, STEP = 1.6, S = hwa.loopScenes(SEC, HOLD, 2);
    const NODE = { root: ['/', 0.3, 0], bin: ['bin', 0.08, 1], etc: ['etc', 0.3, 1], srv: ['srv', 0.62, 1], app: ['app', 0.62, 2], abin: ['bin', 0.4, 3], alib: ['lib', 0.62, 3], out: ['.out', 0.84, 3] };
    const EDGE = [['root', 'bin'], ['root', 'etc'], ['root', 'srv'], ['srv', 'app'], ['app', 'abin'], ['app', 'alib'], ['app', 'out']];
    const UPPER = new Set(['root', 'bin', 'etc', 'srv']);
    const STEPS = [
      ['chroot: app 아래만 보인다', '.out으로 한 번 더 chroot', 'cd ..로 진짜 /에 닿는다'],
      ['pivot_root: app이 새 /', 'umount: 옛 루트를 떼어 냄', 'cd ..: 더 올라갈 곳이 없다'],
    ];
    const notes = ['chroot는 출발점만 옮겨서, 안쪽으로 한 번 더 chroot하면 위로 가는 길이 남는다.', 'pivot_root 뒤 옛 루트를 떼어 내면 / 위로 가는 길 자체가 없다.'];
    hwa.scene(root, {
      height: 268, still: S.at(1) + SEC + 0.6, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), st = Math.min(2, Math.floor(t / STEP)), f = hwa.smooth((t - st * STEP) / (STEP * 0.7));
        const run = since(time, SEC, HOLD, 2, i), X = (fx) => 8 + fx * (w - 16), Y = (lv) => 58 + lv * 50, at = (id) => [X(NODE[id][1]), Y(NODE[id][2])];
        C.pill(ctx, 0, 0, i ? 'pivot_root' : 'chroot', i ? 'ok' : 'bad');
        const upA = i && st >= 1 ? (st === 1 ? 1 - 0.8 * f : 0.2) : 1;
        // Jail: the subtree the process sees as /. In chroot step 1 it shrinks to .out and leaves bash outside.
        const R0 = { x: X(0.4) - 30, y: Y(2) - 22, w: X(0.84) - X(0.4) + 60, h: Y(3) - Y(2) + 44 }, R1 = { x: X(0.84) - 30, y: Y(3) - 18, w: 60, h: 36 };
        const g = !i && st >= 1 ? (st === 1 ? f : 1) : 0, R = { x: R0.x + (R1.x - R0.x) * g, y: R0.y + (R1.y - R0.y) * g, w: R0.w + (R1.w - R0.w) * g, h: R0.h + (R1.h - R0.h) * g };
        C.box(ctx, R.x, R.y, R.w, R.h, { fill: i ? '#f0fdf4' : '#eff6ff', stroke: i ? GREEN[2] : BLUE[2], r: 10 });
        if (g < 0.5) C.text(ctx, i ? '새 /' : '프로세스의 /', R.x - 6, Y(2), { size: 10, weight: 700, color: i ? GREEN[1] : BLUE[1], align: 'right', base: 'middle' });
        else C.text(ctx, '새 /', R.x + R.w / 2, R.y - 6, { size: 10, weight: 700, color: BLUE[1], align: 'center' });
        EDGE.forEach(([a, b]) => {
          const p = at(a), q = at(b);
          ctx.globalAlpha = UPPER.has(a) ? upA : 1;
          C.line(ctx, [[p[0], p[1] + 12], [q[0], q[1] - 12]], '#cbd5e1', 1.2);
          ctx.globalAlpha = 1;
        });
        Object.entries(NODE).forEach(([id, [s]]) => {
          const [x, y] = at(id);
          ctx.globalAlpha = UPPER.has(id) ? upA : 1;
          C.box(ctx, x - 22, y - 12, 44, 24, { fill: '#fff', stroke: '#cbd5e1', dash: UPPER.has(id) && upA < 1 ? [3, 3] : null, r: 6 });
          C.text(ctx, s, x, y + 0.5, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
          ctx.globalAlpha = 1;
        });
        if (i && st >= 1) {
          const m = lerp([at('srv')[0], at('srv')[1] + 12], [at('app')[0], at('app')[1] - 12], 0.4);
          C.line(ctx, [[m[0] - 5, m[1] - 5], [m[0] + 5, m[1] + 5]], U.red, 2);
          C.line(ctx, [[m[0] - 5, m[1] + 5], [m[0] + 5, m[1] - 5]], U.red, 2);
          C.text(ctx, '떼어 냄', m[0] + 10, m[1], { size: 10, weight: 700, color: U.red, base: 'middle' });
        }
        const side = (id) => [at(id)[0] + 44, at(id)[1]];
        let pos = side('app'), col = BLUE;
        if (!i && st === 1) col = ORANGE;
        if (!i && st === 2) { pos = hop([side('app'), side('srv'), side('root')], f).p; col = RED; }
        if (i && st === 2) pos = [pos[0], pos[1] - 22 * Math.sin(Math.PI * f)];
        tag(ctx, 'bash', pos[0], pos[1], col);
        C.text(ctx, `${st + 1}. ${STEPS[i][st]}`, 0, h - 12, { size: 12, weight: 600, color: U.text, base: 'middle' });
        C.stamp(ctx, w / 2, i ? Y(0) : Y(1) + 26, i ? '/ 위로 갈 곳이 없음' : '진짜 /에 닿음', i ? 'ok' : 'bad', (run - SEC) / 0.4);
        say(`${i ? 'pivot_root' : 'chroot'}. ${STEPS[i][st]}. ${notes[i]}`);
      },
    });
  });

  // One process, one packet, one user: the host column against the container's own view.
  each('container-ns', (root) => {
    const SEC = 5.5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3);
    const SC = [
      { pill: 'PID namespace', left: ['1  systemd', '812  containerd', '4321  node', '4350  node'], right: ['1  node', '30  node'], mine: [2, 3], links: [[2, 0], [3, 1]], stamp: ['같은 프로세스, 번호만 다름', 'info'], note: '호스트의 PID 4321이 컨테이너 안에서는 PID 1이다. 같은 프로세스에 번호만 따로 붙는다.' },
      { pill: 'network namespace', left: ['eth0  192.168.0.10', 'cni0  브리지', 'veth3a2f'], right: ['eth0  10.244.1.5', 'node  :8080'], mine: [2], path: true, stamp: ['IP와 포트를 따로 가짐', 'info'], note: '패킷은 호스트 eth0, 브리지, veth를 지나 컨테이너만의 eth0에 닿는다.' },
      { pill: 'user namespace', left: ['UID 0  root', 'UID 1000  deploy', 'UID 100000'], right: ['UID 0  root'], mine: [2], links: [[2, 0]], back: true, stamp: ['밖에서는 권한 없는 사용자', 'ok'], note: '컨테이너 안의 root가 호스트에서는 UID 100000이라, 빠져나와도 호스트 파일을 고치지 못한다.' },
    ];
    hwa.scene(root, {
      height: 236, still: S.at(2) + SEC + 0.6, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), s = SC[i], run = since(time, SEC, HOLD, 3, i);
        C.pill(ctx, 0, 0, s.pill, 'info');
        C.group(ctx, 0, 30, w, h - 30, '호스트', 46);
        const mid = Math.round(w * 0.5), lx = 8, lw = mid - 18, rx = mid + 10, rw = w - 16 - rx, rowY = (r) => 86 + r * 32;
        C.box(ctx, mid + 2, 54, w - 10 - mid, h - 64, { fill: '#fff', r: 8 });
        C.text(ctx, '호스트에서 본 것', lx + 2, 70, { size: 10, weight: 600, color: U.text });
        C.text(ctx, '컨테이너 안', rx, 70, { size: 10, weight: 600, color: BLUE[1] });
        const lit = new Set(), done = [];
        (s.links || []).forEach(([l, r], j) => {
          const a = 0.12 + j * 0.3, g = mv(k, a, a + 0.22);
          if (g <= 0) return;
          if (g < 1) { lit.add(`l${l}`); lit.add(`r${r}`); }
          const L = [mid - 10, rowY(l) + 12], Rr = [rx, rowY(r) + 12];
          done.push([s.back ? [Rr, L] : [L, Rr], g]);
        });
        let pk = null;
        if (s.path) {
          const f = mv(k, 0.08, 0.75), stops = [[2, rowY(0) + 12], [lx + lw / 2, rowY(0) + 12], [lx + lw / 2, rowY(1) + 12], [lx + lw / 2, rowY(2) + 12], [rx + rw / 2, rowY(0) + 12], [rx + rw / 2, rowY(1) + 12]];
          const hp = hop(stops, f), ids = [null, 'l0', 'l1', 'l2', 'r0', 'r1'];
          if (f > 0 && f < 1) { pk = hp.p; if (ids[hp.at]) lit.add(ids[hp.at]); }
          if (f > 0) C.line(ctx, stops, '#c7d2fe', 1.2);
        }
        s.left.forEach((t, r) => cell(ctx, lx, rowY(r), lw, 24, t, s.mine.includes(r) ? ['#eff6ff', U.text, '#bfdbfe'] : WHITE, { lit: lit.has(`l${r}`) }));
        s.right.forEach((t, r) => cell(ctx, rx, rowY(r), rw, 24, t, ['#eff6ff', U.text, '#bfdbfe'], { lit: lit.has(`r${r}`) }));
        done.forEach(([pts, g]) => C.arrow(ctx, pts, g, g < 1 ? U.accent : '#94a3b8', { width: 1.6 }));
        if (pk) ball(ctx, pk);
        C.stamp(ctx, w / 2, h - 36, s.stamp[0], s.stamp[1], (run - SEC + 0.4) / 0.4);
        say(`${s.pill}. ${s.note}`);
      },
    });
  });

  // kubelet and containerd make the cgroup directory, write limits, add the PID, then the kernel counts usage.
  // Data: Guaranteed pod path with the systemd cgroup driver; memory.max 1Gi = 1073741824.
  each('container-cgroup', (root) => {
    const STEP = 1.4, HOLD = 2.4, N = 4;
    const DIRS = [['kubepods.slice', 22], ['kubepods-pod1a2b.slice', 36], ['cri-containerd-9f3c.scope', 50]];
    const FILES = [['memory.max', 'max', '1073741824', 1], ['cpu.max', 'max 100000', '100000 100000', 1], ['cgroup.procs', '', '4321', 2]];
    const TXT = ['디렉터리 하나가 cgroup 하나', '파일에 상한을 쓴다', 'PID를 넣으면 제한이 걸린다', '커널이 사용량을 잰다'];
    hwa.scene(root, {
      height: 306, still: N * STEP + 0.8,
      notes: ['kubelet과 containerd가 디렉터리를 만들고 상한을 쓴 뒤 PID를 넣으면, 커널이 그 프로세스의 사용량을 잰다.'],
      frame: (ctx, w, h, time, say) => {
        const tt = time % (N * STEP + HOLD), cur = Math.min(N - 1, Math.floor(tt / STEP)), loc = (j) => clamp((tt - j * STEP) / (STEP * 0.75));
        const card = { x: 0, y: 34, w: Math.min(180, w * 0.56), h: 34, t: 'kubelet, containerd' };
        C.pill(ctx, 0, 0, `${cur + 1}. ${TXT[cur]}`, 'info');
        C.card(ctx, card, { lit: (cur === 1 || cur === 2) && tt < N * STEP });
        if (w >= 420) C.text(ctx, 'limits: memory 1Gi, cpu 1', w, 51, { size: 10, align: 'right', base: 'middle' });
        C.box(ctx, 0, 82, w, h - 104, { fill: U.plot, r: 10 });
        C.text(ctx, '/sys/fs/cgroup', 10, 99, { size: 11, weight: 600, color: U.text });
        const a0 = hwa.smooth(loc(0) / 0.6);
        ctx.globalAlpha = a0;
        DIRS.forEach(([s, ind], j) => {
          const y = 122 + j * 22, px = ind - 8;
          C.line(ctx, [[px, y - 14], [px, y - 4], [ind - 2, y - 4]], '#cbd5e1', 1);
          C.text(ctx, s, ind, y, { size: 10, weight: j === 2 ? 700 : 400, color: j === 2 ? U.text : U.muted, base: 'middle' });
        });
        const fy = (r) => 194 + r * 24;
        [...FILES.map((x) => x[0]), 'memory.current'].forEach((s, r) => {
          C.line(ctx, [[56, fy(r) - 14], [56, fy(r)], [62, fy(r)]], '#cbd5e1', 1);
          C.text(ctx, s, 64, fy(r), { size: 10, weight: 600, color: U.text, base: 'middle' });
        });
        ctx.globalAlpha = 1;
        FILES.forEach(([, before, after, j], r) => {
          const g = loc(j), from = [card.x + card.w / 2 + 40, card.y + card.h / 2], to = [w - 10, fy(r)];
          if (g >= 1) tag(ctx, after, w - 10, fy(r), BLUE, { right: true, size: 10 });
          else {
            if (before && a0 > 0) tag(ctx, before, w - 10, fy(r), MUTE, { right: true, size: 10, a: a0 });
            if (g > 0) tag(ctx, after, ...lerp(from, to, hwa.smooth(g)), BLUE, { right: true, size: 10 });
          }
        });
        // memory.current fills toward 640M of the 1G cap.
        const bx = 64 + tw(ctx, 'memory.current', 10, 600) + 12, bw = w - 10 - bx, by = fy(3), fill = 0.625 * hwa.smooth(loc(3));
        if (a0 > 0) {
          C.box(ctx, bx, by - 8, bw, 16, { fill: '#fff', r: 4 });
          if (fill > 0) { ctx.fillStyle = '#93c5fd'; ctx.beginPath(); ctx.roundRect(bx + 1, by - 7, (bw - 2) * fill, 14, 3); ctx.fill(); }
          C.dashed(ctx, bx + bw - 1, by - 12, bx + bw - 1, by + 12, U.red);
          if (fill > 0.1) C.text(ctx, `${Math.round(fill * 1024)}M`, bx + 6, by + 0.5, { size: 10, weight: 700, color: BLUE[1], base: 'middle' });
        }
        C.text(ctx, '빨간 점선 = memory.max', w, h - 8, { size: 10, align: 'right' });
        say(`${cur + 1}. ${TXT[cur]}. 컨테이너 cgroup의 memory.max는 1073741824, cpu.max는 100000 100000, cgroup.procs는 4321.`);
      },
    });
  });

  // Image layers: one per filesystem-changing instruction, then two images sharing the base layer on disk.
  each('container-layers', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const DF = [['FROM node:22-slim', 'node:22-slim 레이어', MUTE], ['COPY package*.json /app/', 'package.json 4KB', BLUE], ['RUN cd /app && npm ci', 'node_modules 60MB', BLUE], ['COPY . /app/', '소스 2MB', BLUE], ['CMD node /app/server.js', null]];
    const notes = ['파일 시스템을 바꾸는 명령이 레이어를 하나씩 쌓고, CMD는 설정만 바꾼다.', '베이스가 같은 이미지 둘은 베이스 레이어를 디스크에 한 벌만 둔다.'];
    hwa.scene(root, {
      height: 252, still: S.at(1) + SEC + 0.6, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2), run = since(time, SEC, HOLD, 2, i), base = h - 10;
        C.pill(ctx, 0, 0, i ? '레이어 공유' : '이미지 빌드', i ? 'ok' : 'info');
        if (!i) {
          const dw = Math.min(250, Math.round(w * 0.56)), sx = dw + 12, sw = w - sx, cur = Math.min(4, Math.floor(clamp((k - 0.04) / 0.85) * 5));
          C.box(ctx, 0, 34, dw, h - 36, { fill: U.plot, r: 10 });
          C.text(ctx, 'Dockerfile', 10, 52, { size: 10, weight: 600 });
          C.text(ctx, 'api:1.0 이미지', sx, 52, { size: 10, weight: 600 });
          DF.forEach(([line, layer, col], r) => {
            const y = 78 + r * 34, a = mv(k, 0.04 + r * 0.17, 0.12 + r * 0.17);
            if (a > 0 && cur === r && k < 0.95) C.box(ctx, 4, y - 13, dw - 8, 26, { on: true, r: 6 });
            C.text(ctx, line, 10, y, { size: 10, weight: 600, color: U.text, base: 'middle' });
            if (layer) cell(ctx, sx, base - (r + 1) * 34, sw, 30, layer, col, { center: true, a });
            else tag(ctx, '설정만, 레이어 없음', sx + sw / 2, base - 4 * 34 - 18, ORANGE, { a, size: 10, pad: 12 });
          });
        } else {
          const cw = (w - 12) / 2, cols = [['api 이미지', ['node_modules 60MB', '소스 2MB']], ['worker 이미지', ['node_modules 45MB', '소스 1MB']]];
          const by = base - 30, g = mv(k, 0.42, 0.62);
          cell(ctx, 0, by, w, 30, w >= 420 ? 'node:22-slim 레이어 (디스크에 한 벌)' : 'node:22-slim (한 벌)', MUTE, { center: true, a: mv(k, 0.04, 0.14), lit: g > 0 && g < 1 });
          cols.forEach(([name, ls], c) => {
            const x = c * (cw + 12);
            C.text(ctx, name, x, 52, { size: 10, weight: 600 });
            ls.forEach((s, r) => cell(ctx, x, by - (r + 1) * 34, cw, 30, s, BLUE, { center: true, a: mv(k, c ? 0.66 + r * 0.1 : 0.18 + r * 0.1, (c ? 0.74 : 0.26) + r * 0.1) }));
          });
          // worker's own copy of the base appears, then drops into the shared one: same sha256, stored once.
          const ga = mv(k, 0.3, 0.38) * (1 - mv(k, 0.56, 0.64));
          if (ga > 0) cell(ctx, cw + 12, by - 70 + 70 * g, cw, 30, 'node:22-slim', MUTE, { center: true, dash: [4, 3], a: ga });
          if (g > 0.3 && k < 0.66) C.text(ctx, '같은 sha256', w - 4, by - 8, { size: 10, weight: 700, color: GREEN[1], align: 'right' });
        }
        C.stamp(ctx, w / 2, i ? 96 : 160, i ? '베이스 레이어는 한 벌만 저장' : '파일을 바꾼 명령만 레이어', i ? 'ok' : 'info', (run - SEC + 0.4) / 0.4);
        say(notes[i]);
      },
    });
  });

  // OverlayFS planes: merged view on top, upperdir in the middle, lowerdir image layers at the bottom.
  each('container-overlay', (root) => {
    const SEC = 5.5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3);
    const FILES = ['app.js', 'nginx.conf', 'old.log'];
    const PL = [['merged', '컨테이너가 보는 /', 34], ['upperdir', '컨테이너 쓰기 층', 116], ['lowerdir', '이미지 레이어, 읽기 전용', 198]];
    const SC = [
      { pill: '읽기 nginx.conf', tone: 'info', stamp: ['아래층 파일을 그대로 읽음', 'info'], note: '읽을 때는 위층부터 찾고, 없으면 아래층 파일을 그대로 읽는다.' },
      { pill: '고치기 nginx.conf', tone: 'warn', stamp: ['위층 사본이 보임', 'warn'], note: '고치면 파일을 위층으로 복사(copy-up)한 뒤 바꾼다. merged에는 위층 사본이 보인다.' },
      { pill: '지우기 old.log', tone: 'warn', stamp: ['아래층 old.log는 그대로', 'warn'], note: '지우면 위층에 화이트아웃이 생겨 아래 파일을 가린다. 이미지 레이어는 바뀌지 않는다.' },
    ];
    hwa.scene(root, {
      height: 264, still: S.at(2) + SEC + 0.6, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), s = SC[i], run = since(time, SEC, HOLD, 3, i);
        const TW = Math.min(100, (w - 64) / 3), cx = (j) => w * (0.2 + 0.3 * j), ty = (p) => PL[p][2] + 38;
        C.pill(ctx, 0, 0, s.pill, s.tone);
        const labels = () => PL.forEach(([name, sub, y]) => {
          const nx = 18 + tw(ctx, name, 10, 700), sw = tw(ctx, sub, 10), fits = nx + sw < w - 8;
          ctx.fillStyle = U.plot;
          ctx.fillRect(6, y + 4, (fits ? nx + sw : nx - 6) - 2, 14);
          C.text(ctx, name, 10, y + 14, { size: 10, weight: 700, color: U.text });
          if (fits) C.text(ctx, sub, nx, y + 14, { size: 10 });
        });
        PL.forEach(([, , y]) => C.box(ctx, 0, y, w, 60, { fill: U.plot, r: 8 }));
        // Upper state: nginx.conf copied up from scene 2; old.log whiteout in scene 3.
        const upN = i === 2 || (i === 1 && k >= 0.45), wh = i === 2 ? mv(k, 0.15, 0.3) : 0, gone = i === 2 ? mv(k, 0.3, 0.5) : 0;
        FILES.forEach((f, j) => {
          const fromUp = j === 1 && upN;
          if (!(j === 2 && gone >= 1)) C.dashed(ctx, cx(j), ty(0) + 12, cx(j), (fromUp ? ty(1) : ty(2)) - 12, fromUp ? ORANGE[2] : '#cbd5e1');
          cell(ctx, cx(j) - TW / 2, ty(2) - 12, TW, 24, f, MUTE, { center: true, lit: i === 0 && j === 1 && k > 0.35 && k < 0.55 });
          if (j === 2 && gone > 0) cell(ctx, cx(j) - TW / 2, ty(0) - 12, TW, 24, '', WHITE, { dash: [3, 3], a: gone });
          cell(ctx, cx(j) - TW / 2, ty(0) - 12, TW, 24, f, fromUp ? ORANGE : WHITE, { center: true, a: j === 2 ? 1 - gone : 1, lit: i === 0 && j === 1 && k > 0.62 && k < 0.8 });
        });
        if (upN) cell(ctx, cx(1) - TW / 2, ty(1) - 12, TW, 24, i === 1 && k < 0.6 ? 'nginx.conf' : 'nginx.conf 고침', ORANGE, { center: true });
        if (wh > 0) cell(ctx, cx(2) - TW / 2, ty(1) - 12, TW, 24, 'whiteout', ['#475569', '#fff', '#475569'], { center: true, a: wh });
        labels();
        if (i === 0) {
          const f = mv(k, 0.1, 0.8), { p, at } = hop([[cx(1), ty(0) + 16], [cx(1), ty(1)], [cx(1), ty(2) - 16], [cx(1), ty(0) + 16]], f);
          if (f > 0.2 && f < 0.5) cell(ctx, cx(1) - TW / 2, ty(1) - 12, TW, 24, '없음', WHITE, { center: true, dash: [3, 3] });
          if (f > 0 && f < 1) ball(ctx, p, at >= 2 ? U.blue : '#94a3b8');
        }
        if (i === 1 && k > 0.08 && k < 0.45) {
          const g = mv(k, 0.1, 0.42);
          cell(ctx, cx(1) - TW / 2, ty(2) - 12 + (ty(1) - ty(2)) * g, TW, 24, 'copy-up', ORANGE, { center: true, dash: [3, 3] });
        }
        C.stamp(ctx, w / 2, 105, s.stamp[0], s.stamp[1], (run - SEC + 0.4) / 0.4);
        say(`${s.pill}. ${s.note}`);
      },
    });
  });

  // Demo: the first write to a file from the image copies it up whole before the write runs. Data: 1 GB/s disk, rough.
  tl('container-cow', [
    { pill: '설정 파일 4KB', tone: 'ok', span: 2400, lanes: ['복사', '앱의 쓰기'], ticks: [[1000, '1초'], [2000, '2초']], segs: [[0, 0, 1, 'copy', ''], [1, 1, 6, 'write', '']], event: [0, 'write()'], stamp: ['1ms 안에 끝남', 'ok'], say: '4KB 파일은 복사가 1ms도 안 걸려 바로 쓴다.' },
    { pill: 'DB 파일 2GB', tone: 'bad', span: 2400, lanes: ['복사', '앱의 쓰기'], ticks: [[1000, '1초'], [2000, '2초']], segs: [[0, 0, 2000, 'copy', '2GB copy-up'], [1, 2000, 2010, 'write', '']], arcs: [[1, 0, 2000, 'late', '쓰기 대기']], event: [0, 'write()'], stamp: ['첫 쓰기 2초 대기', 'bad'], say: '2GB 파일은 한 바이트를 고쳐도 2GB를 위층에 복사하는 약 2초 동안 쓰기가 기다린다.' },
  ], { SEC: 5, demo: { modes: ['설정 파일 4KB', 'DB 파일 2GB'], run: '한 줄 고치기' } });

})();
