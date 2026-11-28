// GPU on Kubernetes post: container toolkit, device plugin, GPU sharing, DRA, Operator, Kubeflow Pipelines.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], GREEN = ['#dcfce7', '#15803d', '#86efac'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'];
  const RED = ['#fee2e2', '#dc2626', '#fca5a5'], PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], TEAL = ['#ccfbf1', '#0f766e', '#5eead4'];
  // Chip centred at (cx, cy). col = [bg, fg, line].
  const tag = (ctx, s, cx, cy, col, a = 1, size = 10) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, size, 600) + 14;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(cx - cw / 2, cy - 9, cw, 18, 5);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, cx, cy + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  const slot = (ctx, x, y, w, h, s, color = U.muted) => {
    C.box(ctx, x, y, w, h, { fill: U.plot, dash: [4, 3], r: 6 });
    if (s) C.text(ctx, s, x + w / 2, y + h / 2 + 0.5, { size: 10, weight: 600, color, align: 'center', base: 'middle' });
  };
  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  const fig = (id, o) => document.querySelectorAll(`[data-figure="gpu-kubeflow-${id}"]`).forEach((root) => hwa.scene(root, o));

  // Demo: the same CUDA image started by runc gets no GPU; the nvidia runtime adds device files and host libraries.
  {
    const notes = ['runc는 이미지만으로 컨테이너를 시작한다. 장치 파일이 없어 GPU를 찾지 못한다.', 'nvidia 런타임은 같은 이미지에 장치 파일과 호스트 드라이버 라이브러리를 더한다.'];
    fig('toolkit', {
      height: 292, notes, demo: { modes: ['runc', 'nvidia 런타임'], run: '컨테이너 시작' },
      frame: (ctx, w, h, time, say, ui) => {
        const nv = ui.mode === 1, run = ui.runAt === null ? -1 : time - ui.runAt;
        const hw = Math.round(w * 0.3), mw = Math.max(80, Math.round(w * 0.22)), mx = hw + 10, cx0 = mx + mw + 10, cw = w - cx0;
        C.pill(ctx, 0, 0, run < 0 ? '시작 전' : nv ? 'nvidia 런타임' : 'runc', run < 0 ? 'info' : nv ? 'ok' : 'bad');
        C.group(ctx, 0, 34, hw, 220, '호스트', 50);
        const host = [{ x: 8, y: 70, w: hw - 16, h: 44, t: '/dev/nvidia0', s: '장치 파일', size: 11 }, { x: 8, y: 132, w: hw - 16, h: 44, t: 'libcuda.so', s: '드라이버', size: 11 }];
        host.forEach((b) => C.card(ctx, b));
        const rt = { x: mx, y: 101, w: mw, h: 44, t: 'containerd', s: nv ? 'nvidia 런타임' : 'runc', size: 11 };
        C.card(ctx, rt, { lit: run >= 0 && run < 2.8 });
        C.arrow(ctx, [[hw + 1, 123], [mx - 1, 123]], 1, '#cbd5e1');
        C.arrow(ctx, [[mx + mw + 1, 123], [cx0 - 1, 123]], 1, '#cbd5e1');
        const a = run < 0 ? 0 : ease(run, 0, 0.8);
        C.box(ctx, cx0, 34, cw, 220, { fill: a > 0 ? U.plot : '#fff', dash: a > 0 ? null : [4, 3], r: 10 });
        C.text(ctx, '컨테이너', cx0 + 10, 50, { weight: 600 });
        if (run < 0) { C.text(ctx, '시작 버튼을 눌러 보자', cx0 + cw / 2, 123, { size: 11, align: 'center', base: 'middle' }); say('컨테이너 시작 전. 모드를 고르고 시작 버튼을 누른다.'); return; }
        const sx = cx0 + 8, sw = cw - 16, slots = [[70, '/dev/nvidia0'], [132, 'libcuda.so']];
        ctx.globalAlpha = a;
        C.card(ctx, { x: sx, y: 194, w: sw, h: 44, t: 'CUDA 이미지', s: '런타임 라이브러리', size: 11 });
        ctx.globalAlpha = 1;
        slots.forEach(([y, s], j) => {
          const land = 1.6 + j * 0.5, full = nv && run >= land + 0.4;
          if (full) C.card(ctx, { x: sx, y, w: sw, h: 44, t: s, s: j ? '호스트에서 마운트' : '호스트에서 넣음', size: 11 }, { fill: BLUE[0], stroke: BLUE[2] });
          else if (a > 0.5) slot(ctx, sx, y, sw, 44, !nv && run >= 1.4 ? `${s} 없음` : '', !nv ? RED[1] : U.muted);
          if (nv && run >= 0.8 && run < land + 0.4) {
            const from = [host[j].x + host[j].w / 2, host[j].y + 22], via = [mx + mw / 2, 123], to = [sx + sw / 2, y + 22];
            const k = ease(run, 0.8 + j * 0.5, land + 0.4), p = k < 0.5 ? mix(from, via, k * 2) : mix(via, to, k * 2 - 1);
            tag(ctx, j ? 'libcuda.so' : '/dev/nvidia0', ...p, BLUE, 1, 9);
          }
        });
        C.stamp(ctx, w / 2, 274, nv ? 'nvidia-smi 정상' : 'GPU 없음', nv ? 'ok' : 'bad', (run - (nv ? 3.2 : 2.2)) / 0.4);
        say(notes[ui.mode]);
      },
    });
  }

  // Device plugin: register and report the GPU count; when a pod lands, kubelet picks GPU 2 and calls Allocate.
  {
    const S = seq([5.6, 6], 1.8);
    const notes = ['device plugin이 kubelet에 등록하고 GPU 4개를 보고한다. kubelet은 그 수를 노드 정보에 올린다.', '파드가 배치되면 kubelet이 GPU 2를 골라 Allocate로 넘기고, plugin은 그 GPU를 넣을 환경 변수와 장치 정보를 돌려준다.'];
    fig('plugin', {
      height: 300, still: S.at(1) + 6 + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = S.pos(time), wide = w >= 480, cpW = Math.max(100, Math.round(w * 0.3)), nx = cpW + 12, nw = w - nx;
        C.pill(ctx, 0, 0, i ? '할당' : '등록과 보고', 'info');
        C.group(ctx, 0, 34, cpW, h - 40, '컨트롤 플레인', 50);
        C.group(ctx, nx, 34, nw, h - 40, 'GPU 노드', 50);
        const left = i ? (t >= 4.2 ? 3 : 4) : t >= 4.4 ? 4 : null;
        const api = { x: 8, y: 62, w: cpW - 16, h: 48, t: 'API 서버', s: left === null ? 'GPU 정보 없음' : `${wide ? 'nvidia.com/' : ''}gpu: ${left}`, size: 11 };
        const sch = { x: 8, y: 150, w: cpW - 16, h: 48, t: '스케줄러', size: 11 };
        const kub = { x: nx + 8, y: 62, w: nw - 16, h: 48, t: 'kubelet', size: 11 };
        const plg = { x: nx + 8, y: 150, w: nw - 16, h: 48, t: 'device plugin', s: 'DaemonSet', size: 11 };
        C.card(ctx, api, { lit: (i === 0 && t >= 4.4) || (i === 1 && t >= 4.2) });
        C.card(ctx, sch, { lit: i === 1 && t < 1.8 });
        C.card(ctx, kub, { lit: (i === 0 && t >= 2.4 && t < 4.4) || (i === 1 && t >= 1.4 && t < 2.6) });
        C.card(ctx, plg, { lit: (i === 0 && t < 2.4) || (i === 1 && t >= 2.6 && t < 4.2) });
        const gw = (nw - 16 - 18) / 4, pick = i === 1 && t >= 3.4;
        for (let g = 0; g < 4; g++) {
          const b = { x: nx + 8 + g * (gw + 6), y: 228, w: gw, h: 34, t: wide ? `GPU ${g}` : `${g}`, size: 11 };
          C.card(ctx, b, g === 2 && pick ? { lit: true, fill: GREEN[0] } : { fill: i === 0 && t >= 0.6 && t < 1.8 ? BLUE[0] : '#fff' });
        }
        if (!wide) C.text(ctx, 'GPU', nx + 10, 278, { size: 10 });
        const kx = kub.x + kub.w / 2, px = plg.x + plg.w / 2;
        if (i === 0) {
          C.arrow(ctx, [[px, 228], [px, 200]], ease(t, 0.4, 1.0), U.blue);
          if (t >= 1.2 && t < 2.4) tag(ctx, '등록', ...mix([px, 150], [kx, 110], ease(t, 1.2, 2.2)), BLUE);
          if (t >= 2.4 && t < 3.6) tag(ctx, 'GPU 4개', ...mix([px, 150], [kx, 110], ease(t, 2.4, 3.4)), BLUE);
          if (t >= 3.4 && t < 4.6) tag(ctx, 'gpu: 4', ...mix([kub.x, 86], [api.x + api.w, 86], ease(t, 3.4, 4.4)), BLUE);
          C.stamp(ctx, w / 2, 213, '스케줄러가 GPU 4개를 앎', 'ok', (t - 4.8) / 0.4);
        } else {
          if (t < 1.8) tag(ctx, 'gpu: 1 파드', sch.x + sch.w / 2, 140, ORANGE, ease(t, 0, 0.4));
          if (t >= 0.8 && t < 1.8) C.arrow(ctx, [[sch.x + sch.w, 174], [nx - 2, 174], [nx - 2, 86], [kub.x, 86]], ease(t, 0.8, 1.6), U.accent);
          if (t >= 1.6 && t < 2.6) tag(ctx, 'gpu: 1 파드', ...mix([kub.x + 40, 86], [kx, 86], ease(t, 1.6, 2.4)), ORANGE);
          if (t >= 2.6 && t < 3.6) tag(ctx, 'Allocate: GPU 2', ...mix([kx, 110], [px, 150], ease(t, 2.6, 3.4)), BLUE);
          if (t >= 3.8 && t < 5.0) tag(ctx, '환경 변수, 장치', ...mix([px, 150], [kx, 110], ease(t, 3.8, 4.8)), GREEN);
          C.stamp(ctx, w / 2, 213, 'GPU 2 할당', 'ok', (t - 5.0) / 0.4);
        }
        say(notes[i]);
      },
    });
  }

  // GPU Operator on a new node: NFD labels it, then each layer starts after the one below is ready.
  {
    const ROWS = [['NFD', 'GPU 노드 라벨'], ['드라이버', '커널 모듈 적재'], ['container toolkit', 'containerd 설정'], ['device plugin', 'GPU 개수 보고'], ['GFD, DCGM', '모델 라벨, 지표']];
    const STEP = 1.3, N = ROWS.length + 1;
    fig('operator', {
      height: 330, still: N * STEP + 1.5,
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, N, STEP, 2.6), cur = s.done ? N : s.active, opW = Math.max(92, Math.min(150, Math.round(w * 0.26))), nx = opW + 12, nw = w - nx;
        C.pill(ctx, 0, 0, cur >= N ? 'GPU 노드 준비 끝' : cur === N - 1 ? 'allocatable 등록' : `${ROWS[cur][0]} 기동`, cur >= N - 1 ? 'ok' : 'info');
        const op = { x: 0, y: 150, w: opW, h: 52, t: 'GPU Operator', s: 'ClusterPolicy', size: 11 };
        C.card(ctx, op, { lit: cur < N - 1 });
        C.group(ctx, nx, 34, nw, h - 40, '새 GPU 노드', 50);
        tag(ctx, 'pci-10de.present', nx + nw - 8 - (tw(ctx, 'pci-10de.present', 10, 600) + 14) / 2, 47, GREEN, s.k(0), 10);
        ROWS.forEach(([name, note], j) => {
          const y = 66 + j * 44, a = s.k(j), ready = cur > j;
          if (a <= 0) { slot(ctx, nx + 8, y, nw - 16, 36); return; }
          ctx.globalAlpha = a;
          C.box(ctx, nx + 8, y, nw - 16, 36, { fill: '#fff', on: cur === j, r: 6 });
          C.text(ctx, name, nx + 18, y + 12, { size: 11, weight: 600, color: U.text, base: 'middle' });
          C.text(ctx, note, nx + 18, y + 26, { size: 10, base: 'middle' });
          ctx.beginPath();
          ctx.arc(nx + nw - 20, y + 18, 4, 0, Math.PI * 2);
          ctx.fillStyle = ready ? '#22c55e' : '#f59e0b';
          ctx.fill();
          ctx.globalAlpha = 1;
          if (cur === j) C.arrow(ctx, [[opW + 1, 176], [nx - 2, 176], [nx - 2, y + 18], [nx + 7, y + 18]], hwa.smooth((time % (s.run + 2.6) - j * STEP) / (STEP * 0.6)), U.accent);
        });
        tag(ctx, 'nvidia.com/gpu: 4', nx + nw / 2, 300, GREEN, s.k(N - 1), 11);
        say(cur >= N - 1 ? '라벨, 드라이버, toolkit, device plugin, GFD와 DCGM이 차례로 올라와 노드에 nvidia.com/gpu 4개가 생겼다.' : `GPU Operator가 ${ROWS[cur][0]}을 띄운다. 앞 층이 준비되어야 다음 층이 뜬다.`);
      },
    });
  }

  // Lanes on a time axis: blocks for work, double arrows for waits. demo turns scenes into modes.
  const FILL = { a: U.blue, b: U.purple, c: '#14b8a6', d: '#f59e0b', cpu: '#94a3b8', ok: '#22c55e', bad: U.red };
  const ARC = { wait: '#94a3b8', idle: '#cbd5e1', pend: '#f59e0b' };
  const dbl = (ctx, x0, x1, y, color) => {
    if (x1 - x0 < 6) return;
    C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
    [[x0, 1], [x1, -1]].forEach(([x, d]) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    });
  };
  const LH = 50;
  const tl = (id, scenes, { SEC = 7, HOLD = 1.8, demo } = {}) => {
    const maxL = Math.max(...scenes.map((s) => s.lanes.length)), n = scenes.length;
    fig(id, {
      height: 44 + maxL * LH + 56, still: (n - 1) * (SEC + HOLD) + SEC + 0.6,
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
            ctx.fillStyle = FILL[kind];
            ctx.beginPath(); ctx.roundRect(lx, 6, 10, 10, 2); ctx.fill();
            lx -= 10;
          });
        }
        const x0 = Math.min(72, w * 0.2), x1 = w - 8, top = 40, base = top + s.lanes.length * LH + 4;
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
          const y = ly(j) + LH / 2;
          dbl(ctx, X(a) + 2, X(Math.min(t, b)) - 2, y, ARC[kind]);
          if (t >= b && label && tw(ctx, label, 9, 600) < X(b) - X(a)) C.text(ctx, label, (X(a) + X(b)) / 2, y + 13, { size: 9, weight: 600, color: kind === 'pend' ? ORANGE[1] : U.muted, align: 'center' });
        });
        (s.segs || []).forEach(([j, a, b, kind, label]) => {
          if (t <= a) return;
          const y = ly(j) + 8, bx = X(a) + 0.5, bw = X(Math.min(t, b)) - bx - 0.5;
          if (bw <= 0) return;
          ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 16, Math.min(6, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
          if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 16) / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
        });
        if (s.event && run > 0 && t >= s.event[0]) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
        if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
        if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, base + 36, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
        if (demo && run < 0) C.text(ctx, `${demo.run} 버튼을 눌러 보자`, (x0 + x1) / 2, top + (base - top) / 2, { size: 12, align: 'center', base: 'middle' });
        say(`${s.pill}. ${s.say}`);
      },
    });
  };

  // Demo: four experiments on one GPU, whole (queued) against time-sliced (interleaved). Times are rough.
  {
    const ticks = [[10, '10분'], [20, '20분'], [30, '30분'], [40, '40분']], lanes = ['실험 1', '실험 2', '실험 3', '실험 4'], K = ['a', 'b', 'c', 'd'];
    const slices = Array.from({ length: 40 }, (_, j) => [j % 4, j * 1.05, j * 1.05 + 1, K[j % 4], '']);
    tl('timeslice', [
      { pill: '통째로 할당', tone: 'warn', span: 44, lanes, ticks, segs: K.map((c, j) => [j, j * 10, j * 10 + 10, c, '10분']), arcs: [[1, 0, 10, 'pend', 'Pending'], [2, 0, 20, 'pend', 'Pending'], [3, 0, 30, 'pend', 'Pending']], event: [0, '제출'], stamp: ['첫 결과 10분, 마지막 40분', 'warn'], say: '한 번에 하나씩 돌아 실험 1은 10분에 끝나고 실험 4는 30분을 기다려 40분에 끝난다.' },
      { pill: 'time-slicing 4', tone: 'info', span: 44, lanes, ticks, segs: slices, event: [0, '제출'], stamp: ['넷 다 42분쯤 끝남', 'info'], say: '넷 다 바로 시작하지만 GPU 시간을 번갈아 받아 각자 4분의 1 속도로 돌고, 전환 비용까지 더해 42분쯤 함께 끝난다.' },
    ], { SEC: 7, demo: { modes: ['통째로 할당', 'time-slicing 4'], run: '실험 4개 제출' } });
  }

  // One pod grows its GPU memory: time-slicing shares memory so B fails too; MIG walls keep the failure inside A.
  {
    const SEC = 6.5, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const POD = { A: BLUE, B: PURPLE, C: TEAL, D: ORANGE };
    const notes = ['time-slicing은 메모리를 다 같이 쓴다. A가 늘어 메모리가 차면 B의 다음 할당이 실패한다.', 'MIG는 연산과 메모리를 하드웨어에서 나눈다. A는 자기 칸에서만 넘치고 B, C, D는 그대로 돈다.'];
    // Data: A100 40GB has 7 compute slices and 8 memory slices of 5GB; all-balanced = 3g.20gb + 2g.10gb + 1g.5gb x2.
    const MIG = [['A', 0, 3, 0, 4, '3g.20gb'], ['B', 3, 5, 4, 6, '2g.10gb'], ['C', 5, 6, 6, 7, '1g.5gb'], ['D', 6, 7, 7, 8, '1g.5gb']];
    fig('mig', {
      height: 300, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), mig = i === 1, pods = mig ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C'];
        const pw = 56, gx = pw + 14, gw = w - gx, cy = 82, my = 176, rowH = 50, inner = gw - 20, colW = inner / 7, memW = inner / 8;
        C.pill(ctx, 0, 0, mig ? 'MIG' : 'time-slicing', mig ? 'ok' : 'warn');
        C.text(ctx, 'A100 40GB', w, 11, { size: 10, align: 'right', base: 'middle' });
        C.group(ctx, gx, 34, gw, h - 40, 'GPU', 50);
        C.text(ctx, '연산 (SM 7칸)', gx + 10, cy - 8, { size: 10 });
        C.text(ctx, w < 480 ? '메모리 (8칸)' : '메모리 (8칸, 5GB씩)', gx + 10, my - 8, { size: 10 });
        // Memory owners over time: A grows into free cells, then the next allocation fails.
        const grow = ease(t, 1.6, 3.0), failAt = 3.6, failed = t >= failAt;
        const owner = (c) => {
          if (mig) { const p = MIG.find((m) => c >= m[3] && c < m[4]); const used = p[0] === 'A' ? 2 + Math.round(grow * 2) : p[4] - p[3]; return c - p[3] < used ? p[0] : null; }
          const base = ['A', 'A', 'B', 'B', 'C', 'C'][c];
          return base || (grow * 2 > c - 6 + 0.5 ? 'A' : null);
        };
        for (let c = 0; c < 7; c++) {
          const turn = pods[Math.floor(time * 2) % 3], p = mig ? MIG.find((m) => c >= m[1] && c < m[2])[0] : turn;
          C.box(ctx, gx + 10 + c * colW + 1, cy, colW - 2, rowH, { fill: POD[p][0], stroke: POD[p][2], r: 4 });
          if (colW > 22 && (mig || c === 3)) C.text(ctx, p, gx + 10 + c * colW + colW / 2, cy + rowH / 2 + 0.5, { size: 10, weight: 700, color: POD[p][1], align: 'center', base: 'middle' });
        }
        if (!mig) C.text(ctx, '번갈아 씀', gx + gw - 10, cy - 8, { size: 10, weight: 600, color: ORANGE[1], align: 'right' });
        for (let c = 0; c < 8; c++) {
          const p = owner(c), x = gx + 10 + c * memW + 1;
          if (p) C.box(ctx, x, my, memW - 2, rowH, { fill: POD[p][0], stroke: POD[p][2], r: 4 });
          else C.box(ctx, x, my, memW - 2, rowH, { fill: '#fff', dash: [3, 3], r: 4 });
          if (p && memW > 22) C.text(ctx, p, x + memW / 2 - 1, my + rowH / 2 + 0.5, { size: 10, weight: 700, color: POD[p][1], align: 'center', base: 'middle' });
        }
        if (mig) {
          MIG.forEach(([p, , , m0, m1, prof], j) => {
            const xa = gx + 10 + MIG[j][1] * colW;
            if (j) C.line(ctx, [[xa, cy - 4], [xa, cy + rowH + 4]], U.accent, 2);
            if (j) C.line(ctx, [[gx + 10 + m0 * memW, my - 4], [gx + 10 + m0 * memW, my + rowH + 4]], U.accent, 2);
            const lw = (m1 - m0) * memW;
            if (tw(ctx, prof, 9, 600) + 4 < lw) C.text(ctx, prof, gx + 10 + (m0 + m1) / 2 * memW, my + rowH + 14, { size: 9, weight: 600, color: POD[p][1], align: 'center' });
          });
        }
        const victim = mig ? 'A' : 'B';
        pods.forEach((p, j) => {
          const y = 70 + j * 46, bad = failed && p === victim;
          C.box(ctx, 0, y, pw, 34, { fill: bad ? RED[0] : POD[p][0], stroke: bad ? RED[2] : POD[p][2], r: 6 });
          C.text(ctx, `파드 ${p}`, pw / 2, y + 12, { size: 10, weight: 700, color: bad ? RED[1] : POD[p][1], align: 'center', base: 'middle' });
          C.text(ctx, bad ? 'OOM' : '실행', pw / 2, y + 25, { size: 9, weight: 600, color: bad ? RED[1] : U.muted, align: 'center', base: 'middle' });
        });
        if (t >= failAt - 0.6) {
          const vx = mig ? gx + 10 + 4 * memW : gx + 10 + 8 * memW, k = ease(t, failAt - 0.6, failAt);
          tag(ctx, `${victim} +5GB`, Math.min(w - 34, vx - 4), my - 22 + (1 - k) * 8, failed ? RED : POD[victim], k, 10);
        }
        C.stamp(ctx, gx + gw / 2, my + rowH + 34, mig ? 'A만 실패' : 'B도 같이 실패', mig ? 'warn' : 'bad', (t - failAt - 0.5) / 0.4);
        say(notes[i]);
      },
    });
  }

  // DRA: a pod needing 40GB of GPU memory. Counting GPUs can pick the T4 node; a claim on memory picks the A100.
  {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = ['개수로만 요청하면 T4와 A100이 똑같이 GPU 1개로 보여, 학습 파드가 T4에 배치되고 메모리가 모자란다.', '속성으로 요청하면 스케줄러가 GPU 메모리를 보고 40GB를 넘는 A100 노드만 고른다.'];
    fig('dra', {
      height: 276, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), dra = i === 1, wide = w >= 480;
        const pw = Math.max(88, Math.round(w * 0.25)), sx = pw + 16, sw = Math.max(70, Math.round(w * 0.18)), nx = sx + sw + 16, nw = w - nx;
        C.pill(ctx, 0, 0, dra ? 'DRA ResourceClaim' : 'nvidia.com/gpu: 1', dra ? 'ok' : 'warn');
        const pod = { x: 0, y: 112, w: pw, h: 52, t: '학습 파드', s: '40GB 필요', size: 11 };
        const sch = { x: sx, y: 112, w: sw, h: 52, t: '스케줄러', size: 11 };
        C.card(ctx, pod, { fill: BLUE[0], stroke: BLUE[2] });
        C.text(ctx, dra ? 'memory > 40Gi' : 'gpu: 1', pw / 2, 182, { size: 10, weight: 600, color: U.text, align: 'center' });
        C.card(ctx, sch, { lit: t >= 1.2 && t < 2.8 });
        C.arrow(ctx, [[pw + 1, 138], [sx - 1, 138]], ease(t, 0.4, 1.2), '#94a3b8');
        const N = [{ y: 52, name: '노드 1', gpu: 'T4 16GB', mem: '16GB' }, { y: 172, name: '노드 2', gpu: 'A100 80GB', mem: '80GB' }];
        const pick = dra ? 1 : 0, land = t >= 4.0;
        N.forEach((n, j) => {
          const fail = land && !dra && j === pick, chosen = land && j === pick;
          C.box(ctx, nx, n.y, nw, 52, { fill: fail ? RED[0] : '#fff', stroke: chosen ? (fail ? RED[2] : U.accent) : U.grid, r: 8 });
          C.text(ctx, n.name, nx + 10, n.y + 18, { size: 11, weight: 600, color: U.text, base: 'middle' });
          C.text(ctx, n.gpu, nx + 10, n.y + 36, { size: 10, base: 'middle' });
          const seen = dra ? n.mem : 'gpu: 1', col = dra ? (j ? GREEN : RED) : BLUE;
          const cw = tw(ctx, seen, 10, 600) + 14;
          tag(ctx, seen, nx + nw - 8 - cw / 2, n.y + 26, col, ease(t, 1.6 + j * 0.4, 2.1 + j * 0.4));
          C.arrow(ctx, [[sx + sw + 1, 138], [nx - 8, 138], [nx - 8, n.y + 26], [nx - 1, n.y + 26]], j === pick ? ease(t, 2.8, 3.8) : 0, U.accent);
        });
        if (t >= 2.8) tag(ctx, '학습 파드', ...mix([sx + sw / 2, 100], [nx + nw / 2, N[pick].y - 10], ease(t, 2.8, 4.0)), dra ? GREEN : ORANGE, 1);
        C.stamp(ctx, nx + nw / 2, N[pick].y + 76, dra ? 'A100에 배치' : '메모리 부족', dra ? 'ok' : 'bad', (t - 4.4) / 0.4);
        if (wide) C.text(ctx, dra ? '조건에 맞는 장치만 후보' : '개수만 보고 아무 노드나', sx + sw / 2, 182, { size: 10, align: 'center' });
        say(notes[i]);
      },
    });
  }

  // A day on one GPU: a notebook holds it all day; a pipeline holds it only for the training step. Hours are rough.
  {
    const ticks = [[2, '11시'], [4, '13시'], [6, '15시'], [8, '17시'], [10, '19시']];
    tl('pipeline', [
      { pill: '노트북', tone: 'warn', span: 10, lanes: ['노트북 파드', 'GPU 0'], ticks, segs: [[1, 0.5, 0.7, 'a', ''], [1, 2, 4, 'a', '학습'], [1, 5, 5.3, 'a', ''], [1, 7, 7.2, 'a', '']], arcs: [[0, 0, 10, 'pend', 'GPU를 쥐고 있음'], [1, 0.7, 2, 'idle', ''], [1, 4, 5, 'idle', ''], [1, 5.3, 7, 'idle', '놀고 있음'], [1, 7.2, 10, 'idle', '놀고 있음']], stamp: ['10시간 쥐고 2.7시간 씀', 'warn'], say: '노트북은 열려 있는 10시간 동안 GPU를 쥐고, 실제로 쓰는 건 학습 2시간과 짧은 실행 몇 번이다.' },
      { pill: '파이프라인', tone: 'ok', span: 10, lanes: ['파이프라인', 'GPU 0'], ticks, legend: [['a', '학습'], ['b', '다른 작업']], segs: [[0, 0, 1.5, 'cpu', '준비'], [0, 1.5, 3.5, 'a', '학습'], [0, 3.5, 4, 'cpu', ''], [1, 1.5, 3.5, 'a', '학습'], [1, 4.5, 7, 'b', '다른 작업'], [1, 7.5, 9.5, 'b', '다른 작업']], stamp: ['학습 2시간만 GPU를 씀', 'ok'], say: '파이프라인은 준비와 평가를 CPU 파드로 돌리고 학습 단계에서만 GPU를 쥐어, 남는 시간에 다른 작업이 GPU를 받는다.' },
    ]);
  }
})();
