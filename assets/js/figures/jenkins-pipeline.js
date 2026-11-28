// Jenkins pipeline post: controller and agents, Groovy on the controller, quoting, pod agents, kaniko, shared library, roles.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'], GREEN = ['#dcfce7', '#15803d', '#86efac'];
  const RED = ['#fee2e2', '#dc2626', '#fca5a5'], PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], MUTE = [U.cell, U.muted, '#e2e8f0'];
  const each = (id, fn) => document.querySelectorAll(`[data-figure="jenkins-pipeline-${id}"]`).forEach(fn);
  const fade = (ctx, a, fn) => { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= Math.min(1, a); fn(); ctx.restore(); };
  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  // Chip centred at (x, y); col = [bg, fg, line].
  const tag = (ctx, s, x, y, col, a = 1, size = 10) => fade(ctx, a, () => {
    const cw = tw(ctx, s, size, 600) + 14;
    ctx.beginPath();
    ctx.roundRect(x - cw / 2 + 0.5, y - 9.5, cw - 1, 19, 6);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x, y + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
  });
  const tint = (col) => ({ fill: col[0], stroke: col[2] });

  // Lane timeline. segs are blocks, gaps are thin waiting bars; demo turns scenes into modes played once per run.
  const KIND = { run: U.blue, pod: '#94a3b8', ctl: '#8b5cf6', heavy: '#f97316' };
  const GAP = { wait: ['#fde68a', ORANGE[1]], idle: ['#e2e8f0', U.muted] };
  const lanes = (id, scenes, { SEC = 7, HOLD = 2, demo, LH = 36, legend } = {}) => each(id, (root) => {
    const n = scenes.length, maxL = Math.max(...scenes.map((s) => s.lanes.length));
    hwa.scene(root, {
      height: 44 + maxL * LH + 26, still: (n - 1) * (SEC + HOLD) + SEC + 0.5,
      scenes: n > 1 && !demo ? hwa.loopScenes(SEC, HOLD, n) : undefined,
      notes: scenes.map((s) => s.say), demo,
      frame: (ctx, w, h, time, say, ui) => {
        const auto = hwa.loop(time, SEC, HOLD, n), i = demo ? ui.mode : auto.i, s = scenes[i];
        const run = demo ? (ui.runAt === null ? -1 : time - ui.runAt) : (time % ((SEC + HOLD) * n)) - auto.i * (SEC + HOLD);
        const k = Math.max(0, Math.min(1, run / SEC)), t = k * s.span;
        C.pill(ctx, 0, 0, s.pill, s.tone);
        if (legend && w >= 460) {
          let lx = w;
          legend.slice().reverse().forEach(([kind, label]) => {
            lx -= tw(ctx, label, 10) + 4;
            C.text(ctx, label, lx, 11.5, { size: 10, base: 'middle' });
            lx -= 14;
            ctx.fillStyle = KIND[kind] || GAP[kind][0];
            ctx.beginPath(); ctx.roundRect(lx, 6, 10, 10, 2); ctx.fill();
            lx -= 10;
          });
        }
        const lw = Math.min(84, Math.round(w * 0.24)), x0 = lw, x1 = w - 6, top = 40, base = top + s.lanes.length * LH;
        const X = (v) => x0 + (Math.max(0, Math.min(v, s.span)) / s.span) * (x1 - x0), mid = (j) => top + j * LH + LH / 2;
        s.lanes.forEach((name, j) => {
          C.text(ctx, name, 0, mid(j), { size: 10, weight: 600, color: U.text, base: 'middle' });
          if (j) C.line(ctx, [[x0, top + j * LH], [x1, top + j * LH]], U.grid, 1);
        });
        C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
        (s.ticks || []).forEach(([v, label]) => {
          C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
          C.text(ctx, label, X(v), base + 15, { size: 9, align: v >= s.span ? 'right' : 'center' });
        });
        (s.gaps || []).forEach(([j, a, b, kind, label]) => {
          const xa = X(a) + 2, xb = X(Math.min(t, b)) - 2, [fill, fg] = GAP[kind];
          if (t <= a || xb <= xa) return;
          ctx.fillStyle = fill;
          ctx.beginPath(); ctx.roundRect(xa, mid(j) - 3, xb - xa, 6, 3); ctx.fill();
          if (t >= b && label && tw(ctx, label, 9, 600) + 4 < X(b) - X(a)) C.text(ctx, label, (X(a) + X(b)) / 2, mid(j) - 7, { size: 9, weight: 600, color: fg, align: 'center' });
        });
        (s.segs || []).forEach(([j, a, b, kind, label]) => {
          const bx = X(a) + 1, bw = X(Math.min(t, b)) - bx - 1, bh = LH - 12;
          if (t <= a || bw <= 0) return;
          ctx.beginPath(); ctx.roundRect(bx, mid(j) - bh / 2, bw, bh, Math.min(6, bw / 2)); ctx.fillStyle = KIND[kind]; ctx.fill();
          if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, mid(j) + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
        });
        if (s.event && t >= s.event[0]) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
        if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
        if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, (top + base) / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
        if (demo && run < 0) C.text(ctx, `${demo.run} 버튼을 눌러 보자`, (x0 + x1) / 2, (top + base) / 2, { size: 12, align: 'center', base: 'middle' });
        say(`${s.pill}. ${s.say}`);
      },
    });
  });

  // One commit from push to deploy: the controller queues it and starts a pod; the pod builds, pushes and deploys.
  each('flow', (root) => {
    const RUN = 10.4, HOLD = 2.6;
    const PH = [[0, 'push'], [1.0, 'webhook'], [2.2, '에이전트 생성'], [3.6, '빌드'], [5.0, '이미지 push'], [6.6, '배포'], [8.4, '파드 삭제']];
    const ST = [['빌드', "sh 'make test'"], ['이미지', 'kaniko'], ['배포', 'helm upgrade']];
    hwa.scene(root, {
      height: 262, still: RUN + 1,
      frame: (ctx, w, h, time, say) => {
        const t = Math.min(time % (RUN + HOLD), RUN), ph = PH.filter((p) => t >= p[0]).length - 1, wide = w >= 480;
        C.pill(ctx, 0, 0, `${ph + 1}. ${PH[ph][1]}`, t >= 9.4 ? 'ok' : 'info');
        const gw = Math.max(64, Math.round(w * 0.2)), gap = 10, cx0 = gw + gap, cw = Math.max(92, Math.round(w * 0.3)), ax0 = cx0 + cw + gap, aw = w - ax0;
        const top = 34, gh = 148, by = 198;

        C.group(ctx, 0, top, gw, gh, wide ? 'Git 저장소' : 'Git');
        C.line(ctx, [[gw / 2, top + 40], [gw / 2, top + 118]], '#cbd5e1', 1.5);
        [0, 1, 2].forEach((j) => { ctx.beginPath(); ctx.arc(gw / 2, top + 48 + j * 30, 4, 0, Math.PI * 2); ctx.fillStyle = '#cbd5e1'; ctx.fill(); });
        C.text(ctx, 'main', gw / 2 + 9, top + 52, { size: 9 });

        C.group(ctx, cx0, top, cw, gh, '컨트롤러');
        C.text(ctx, '빌드 큐', cx0 + 10, top + 38, { size: 10 });
        const qx = cx0 + 10, qw = cw - 20;
        C.box(ctx, qx, top + 44, qw, 24, { fill: '#fff', r: 6 });
        [1, 2].forEach((j) => C.line(ctx, [[qx + (qw * j) / 3, top + 46], [qx + (qw * j) / 3, top + 66]], U.grid, 1));
        const busy = t >= 2.2 && t < 8.4;
        C.card(ctx, { x: qx, y: top + 80, w: qw, h: 40, t: 'Jenkinsfile', s: busy ? '해석, 기록' : '대기' }, { lit: busy, fill: busy ? PURPLE[0] : '#fff', stroke: busy ? PURPLE[2] : U.grid });
        C.text(ctx, '실행기 0개', cx0 + cw / 2, top + gh - 10, { size: 9, align: 'center' });

        // Agent pod: only exists while the build runs.
        const agA = ease(t, 2.4, 3.2) * (1 - ease(t, 8.6, 9.6));
        C.box(ctx, ax0, top, aw, gh, { fill: '#fff', dash: [4, 3], r: 10 });
        if (agA < 1) C.text(ctx, '파드 없음', ax0 + aw / 2, top + gh / 2, { size: 10, align: 'center', base: 'middle' });
        const sy = (j) => top + 30 + j * 38;
        fade(ctx, agA, () => {
          C.group(ctx, ax0, top, aw, gh, '에이전트 파드');
          ST.forEach(([name, sub], j) => {
            const on = ph === 3 + j, done = ph > 3 + j;
            C.card(ctx, { x: ax0 + 8, y: sy(j), w: aw - 16, h: 32, t: name, s: aw >= 150 ? sub : undefined }, done ? tint(GREEN) : on ? { lit: true, ...tint(BLUE) } : {});
          });
        });

        C.card(ctx, { x: cx0, y: by, w: cw, h: 48, t: '레지스트리', s: t >= 6.3 ? 'app:a1b2c3' : 'app:9f8e7d' }, t >= 6.3 ? tint(BLUE) : {});
        const live = t >= 7.9;
        C.card(ctx, { x: ax0, y: by, w: aw, h: 48, t: '클러스터', s: live ? 'a1b2c3 실행' : '9f8e7d 실행' }, live ? tint(GREEN) : {});

        C.arrow(ctx, [[gw - 4, top + 108], [cx0 + 6, top + 56]], ease(t, 1.0, 1.6), '#94a3b8', { width: 1.2 });
        C.arrow(ctx, [[cx0 + cw - 4, top + 100], [ax0 + 6, top + 100]], ease(t, 2.2, 2.8) * (t < 8.4 ? 1 : 0), '#94a3b8', { width: 1.2 });
        C.arrow(ctx, [[ax0 + 8, sy(1) + 16], [ax0 - gap / 2, sy(1) + 16], [ax0 - gap / 2, by - 8], [cx0 + cw / 2, by - 8], [cx0 + cw / 2, by]], ease(t, 5.4, 6.3) * (t < 8.6 ? 1 : 0), U.blue);
        C.arrow(ctx, [[ax0 + aw / 2, sy(2) + 32], [ax0 + aw / 2, by]], ease(t, 7.0, 7.8) * (t < 8.6 ? 1 : 0), GREEN[1]);

        // The commit chip: Git, then the queue, then into the pod where the stages take over.
        const git = [gw / 2, top + 108], q = [cx0 + cw / 2, top + 56], pod = [ax0 + aw / 2, sy(0) + 16];
        if (t < 4.0) {
          const p = t < 1.0 ? git : t < 2.2 ? mix(git, q, ease(t, 1.0, 2.0)) : t < 3.6 ? q : mix(q, pod, ease(t, 3.6, 4.0));
          tag(ctx, 'a1b2c3', p[0], p[1], [U.blue, '#fff', U.blue], Math.min(ease(t, 0, 0.5), 1 - ease(t, 3.8, 4.0)));
        }
        if (t >= 9.4) C.stamp(ctx, ax0 + aw / 2, top + gh / 2, '배포 완료', 'ok', (t - 9.4) / 0.4);
        say(`${PH[ph][1]}. 커밋이 webhook으로 컨트롤러 큐에 들어가고, 에이전트 파드가 빌드, 이미지 push, 배포를 한 뒤 지워진다.`);
      },
    });
  });

  // Five builds at once: two fixed agents queue them; pod agents pay a start-up cost but run all five. Times are assumed.
  const five = [0, 1, 2, 3, 4];
  lanes('agents', [
    {
      pill: '고정 에이전트 2대', tone: 'bad', span: 130, lanes: five.map((j) => `빌드 ${j + 1}`), ticks: [[60, '60초'], [120, '120초']],
      segs: [[0, 0, 40, 'run', '에이전트 1'], [1, 0, 40, 'run', '에이전트 2'], [2, 40, 80, 'run', '에이전트 1'], [3, 40, 80, 'run', '에이전트 2'], [4, 80, 120, 'run', '에이전트 1']],
      gaps: [[2, 0, 40, 'wait', '큐 대기'], [3, 0, 40, 'wait', '큐 대기'], [4, 0, 80, 'wait', '큐 대기']],
      event: [0, '빌드 5개 몰림'], stamp: ['마지막 빌드 120초', 'bad'], say: '실행기가 2개라 셋째 빌드부터 큐에서 기다리고, 마지막 빌드는 120초에 끝난다.',
    },
    {
      pill: '파드 에이전트', tone: 'ok', span: 130, lanes: five.map((j) => `빌드 ${j + 1}`), ticks: [[60, '60초'], [120, '120초']],
      segs: five.flatMap((j) => [[j, 0, 15, 'pod', ''], [j, 15, 55, 'run', '빌드']]),
      event: [0, '빌드 5개 몰림'], stamp: ['마지막 빌드 55초', 'ok'], say: '빌드마다 파드를 15초 들여 띄우지만 다섯이 같이 돌아 55초에 끝난다.',
    },
  ], { LH: 30, legend: [['run', '빌드'], ['pod', '파드 생성'], ['wait', '큐 대기']], demo: { modes: ['고정 에이전트 2대', '파드 에이전트'], run: '빌드 5개 넣기' } });

  // Pod agent: created per build, steps hop between containers that share one workspace, deleted at the end.
  each('pod', (root) => {
    const S = seq([5, 7.5, 4.5], 1.8);
    const CT = [['jnlp', '에이전트', "sh 'make test'", 'make test'], ['kaniko', '이미지 빌드', "container('kaniko')", 'kaniko'], ['kubectl', '배포', "container('kubectl')", 'kubectl']];
    const notes = [
      '빌드가 큐에 들어오면 컨트롤러가 파드를 만들고, jnlp 컨테이너의 에이전트가 컨트롤러에 붙는다.',
      '단계마다 container()로 컨테이너를 고른다. 세 컨테이너가 같은 workspace를 마운트해 소스를 같이 본다.',
      '빌드가 끝나면 파드와 workspace가 함께 지워진다.',
    ];
    hwa.scene(root, {
      height: 262, still: S.at(1) + 6.8, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), wide = w >= 480;
        const cw = wide ? 176 : Math.max(104, Math.round(w * 0.36)), nx = cw + 12, nw = w - nx, px = nx + 8, pw = nw - 16;
        const row = (j) => 70 + j * 36, cy = (j) => 84 + j * 40;
        const step = i === 1 ? Math.min(2, Math.floor(t / 2.5)) : -1, u = t - step * 2.5;
        C.pill(ctx, 0, 0, i === 0 ? '파드 생성' : i === 2 ? '빌드 끝' : CT[step][wide ? 2 : 3], i === 2 ? 'ok' : 'info');

        C.group(ctx, 0, 32, cw, 222, '컨트롤러');
        C.text(ctx, 'Jenkinsfile 단계', 10, 62, { size: 10 });
        CT.forEach((c, j) => {
          C.box(ctx, 8, row(j), cw - 16, 28, { fill: '#fff', on: step === j, r: 6 });
          C.text(ctx, c[wide ? 2 : 3], cw / 2, row(j) + 14.5, { size: 10, weight: 600, color: U.text, align: 'center', base: 'middle' });
        });

        C.group(ctx, nx, 32, nw, 222, '쿠버네티스 노드');
        const podA = i === 0 ? ease(t, 0.8, 1.8) : i === 2 ? 1 - ease(t, 0.8, 2.2) : 1;
        C.box(ctx, px, 54, pw, 192, { fill: '#fff', dash: [4, 3] });
        fade(ctx, podA, () => {
          C.box(ctx, px, 54, pw, 192, { fill: '#fff', stroke: '#cbd5e1' });
          C.text(ctx, '에이전트 파드', px + 8, 69, { size: 10, weight: 600 });
          CT.forEach((c, j) => {
            const on = (i === 0 && j === 0 && t >= 3.4) || (step === j && u >= 1.0);
            C.card(ctx, { x: px + 8, y: cy(j), w: pw - 16, h: 32, t: c[0], s: pw >= 150 ? c[1] : undefined }, on ? { lit: true, ...tint(BLUE) } : {});
          });
          const ws = step >= 0 && u >= 1.0;
          C.box(ctx, px + 8, 208, pw - 16, 28, { fill: ws ? BLUE[0] : U.plot, stroke: ws ? BLUE[2] : U.grid, r: 6 });
          C.text(ctx, pw >= 150 ? 'workspace (emptyDir)' : 'workspace', px + pw / 2, 222.5, { size: 10, weight: 600, color: ws ? BLUE[1] : U.muted, align: 'center', base: 'middle' });
        });
        if (i === 0) {
          C.arrow(ctx, [[cw - 4, 200], [px, 200]], ease(t, 0.2, 0.8), '#94a3b8', { width: 1.2 });
          C.arrow(ctx, [[px + 8, cy(0) + 16], [cw - 4, row(0) + 14]], ease(t, 2.4, 3.4), U.blue);
        }
        if (step >= 0 && u < 1.2) {
          const p = mix([cw - 10, row(step) + 14], [px + pw / 2, cy(step) + 16], ease(u, 0.2, 1.0));
          tag(ctx, 'step', p[0], p[1], [U.blue, '#fff', U.blue], 1 - ease(u, 1.0, 1.2));
        }
        if (i === 2) C.stamp(ctx, px + pw / 2, 140, '파드 삭제', 'info', (run - 2.4) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Same parsing work done by Groovy on the controller or by a shell step on the agent. Times are rough, for shape.
  lanes('cps', [
    {
      pill: 'Groovy로 파싱', tone: 'bad', span: 40, lanes: ['컨트롤러', '에이전트'], ticks: [[20, '20초'], [40, '40초']],
      segs: [[0, 0, 1, 'ctl', ''], [0, 4, 34, 'heavy', 'JSON 파싱'], [0, 34, 35, 'ctl', ''], [1, 1, 4, 'run', ''], [1, 35, 38, 'run', '']],
      gaps: [[1, 4, 34, 'idle', '대기']], stamp: ['컨트롤러 32초 사용', 'bad'], say: 'readFile과 JsonSlurper로 파싱하면 30초 동안 컨트롤러가 일하고 에이전트는 기다린다.',
    },
    {
      pill: 'sh로 파싱', tone: 'ok', span: 40, lanes: ['컨트롤러', '에이전트'], ticks: [[20, '20초'], [40, '40초']],
      segs: [[0, 0, 1, 'ctl', ''], [0, 34, 35, 'ctl', ''], [1, 1, 4, 'run', ''], [1, 4, 34, 'heavy', 'sh jq 파싱'], [1, 35, 38, 'run', '']],
      gaps: [[0, 1, 34, 'idle', '다른 빌드에 씀']], stamp: ['컨트롤러 2초 사용', 'ok'], say: 'sh로 넘기면 같은 30초를 에이전트가 쓰고, 컨트롤러는 결과 한 줄만 받는다.',
    },
  ], { LH: 44, SEC: 6, legend: [['ctl', 'Groovy'], ['run', 'sh 스텝'], ['heavy', '파싱']], demo: { modes: ['Groovy로 파싱', 'sh로 파싱'], run: '빌드 실행' } });

  // Double quotes: Groovy puts the secret into the command before it leaves the controller. Single quotes: the shell reads it.
  each('quote', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = [
      '큰따옴표면 컨트롤러의 Groovy가 ${TOKEN}을 실제 값으로 바꾼 뒤 명령을 보낸다.',
      '작은따옴표면 $TOKEN 글자 그대로 보내고, 에이전트의 셸이 환경 변수에서 값을 읽는다.',
    ];
    hwa.scene(root, {
      height: 242, still: S.at(1) + SEC + 0.5, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), run = (time % (2 * (SEC + HOLD))) - S.at(i), dq = i === 0;
        const lw = Math.round(w * 0.47), rx = lw + 12, rw = w - rx, cx = lw / 2, rcx = rx + rw / 2;
        C.pill(ctx, 0, 0, dq ? '큰따옴표 "..."' : "작은따옴표 '...'", dq ? 'bad' : 'ok');
        C.group(ctx, 0, 32, lw, 172, '컨트롤러');
        C.group(ctx, rx, 32, rw, 172, '에이전트');
        C.text(ctx, 'Jenkinsfile', 10, 64, { size: 10 });
        C.card(ctx, { x: 8, y: 70, w: lw - 16, h: 36, t: dq ? '"Bearer ${TOKEN}"' : "'Bearer $TOKEN'" }, {});
        C.text(ctx, '보내는 명령', 10, 132, { size: 10 });
        const sub = dq && t >= 1.4, sent = dq ? (sub ? 'Bearer s3cr3t' : 'Bearer ${TOKEN}') : 'Bearer $TOKEN';
        C.arrow(ctx, [[cx, 108], [cx, 138]], ease(t, 0.6, 1.2), dq ? U.red : '#94a3b8', { width: 1.2 });
        if (t >= 0.6 && lw >= 150) C.text(ctx, dq ? 'Groovy가 치환' : '그대로', cx + 8, 127, { size: 9, weight: 600, color: dq ? U.red : U.muted });
        const box = { x: 8, y: 140, w: lw - 16, h: 36 };
        C.box(ctx, box.x, box.y, box.w, box.h, { fill: sub ? RED[0] : '#fff', stroke: sub ? RED[2] : U.grid });
        if (t >= 1.2) C.text(ctx, sent, cx, 158.5, { size: 11, weight: 700, color: sub ? RED[1] : U.text, align: 'center', base: 'middle' });

        C.text(ctx, '환경 변수', rx + 10, 64, { size: 10 });
        C.card(ctx, { x: rx + 8, y: 70, w: rw - 16, h: 36, t: 'TOKEN = ****' }, !dq && t >= 3.4 ? tint(GREEN) : {});
        C.text(ctx, 'sh 프로세스', rx + 10, 132, { size: 10 });
        const got = t >= 3.0;
        C.box(ctx, rx + 8, 140, rw - 16, 36, { fill: got && dq ? RED[0] : '#fff', stroke: got && dq ? RED[2] : U.grid });
        if (got) C.text(ctx, sent, rcx, 158.5, { size: 11, weight: 700, color: dq ? RED[1] : U.text, align: 'center', base: 'middle' });
        if (t >= 1.8 && t < 3.0) {
          const p = mix([cx, 158], [rcx, 158], ease(t, 1.8, 2.9));
          tag(ctx, sent, p[0], p[1], dq ? [U.red, '#fff', U.red] : [U.blue, '#fff', U.blue]);
        }
        if (!dq) C.arrow(ctx, [[rcx, 108], [rcx, 138]], ease(t, 3.4, 4.0), GREEN[1]);
        if (!dq && t >= 4.0 && rw >= 150) C.text(ctx, '셸이 읽음', rcx + 8, 127, { size: 9, weight: 600, color: GREEN[1] });
        if (run < SEC) C.text(ctx, dq ? '값이 프로세스 인자에 남는다' : '명령 문자열에는 변수 이름만 있다', w / 2, 224, { size: 10, weight: 600, color: dq ? U.red : GREEN[1], align: 'center' });
        if (run >= SEC) C.stamp(ctx, w / 2, 222, dq ? '명령에 비밀값이 박힘' : '셸이 값을 읽음', dq ? 'bad' : 'ok', (run - SEC) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Shared library: three service Jenkinsfiles call one vars function; a library release reaches all but the pinned one.
  each('library', (root) => {
    const S = seq([6, 6], 2);
    const APP = ['주문', '결제', '회원'];
    const notes = ['서비스 Jenkinsfile은 buildApp() 한 줄만 부르고, 빌드 방법과 Dockerfile은 라이브러리에 한 벌만 있다.', '라이브러리를 v1.3으로 고치면 다음 빌드부터 반영되고, @v1.2로 고정한 서비스만 그대로 남는다.'];
    hwa.scene(root, {
      height: 250, still: S.at(1) + 6.5, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), wide = w >= 480, up = i === 1;
        const aw = Math.max(100, Math.round(w * 0.32)), lx = aw + 30, lw = w - lx;
        C.pill(ctx, 0, 0, up ? '라이브러리 v1.3' : 'buildApp() 호출', up ? 'ok' : 'info');
        C.text(ctx, '서비스 저장소', 0, 44, { size: 10 });
        const ay = (j) => 54 + j * 62;
        APP.forEach((s, j) => {
          const got = up && j < 2 && t >= 2.4 + j * 0.6, pin = up && j === 2;
          C.card(ctx, { x: 0, y: ay(j), w: aw, h: 46, t: s, s: pin ? '@v1.2 고정' : got ? 'v1.3 적용' : 'buildApp()' }, got ? tint(GREEN) : pin ? { dim: true, fill: U.cell } : {});
        });
        const ver = up && t >= 1.2 ? 'v1.3' : 'v1.2';
        C.group(ctx, lx, 32, lw, 210, wide ? 'Shared Library 저장소' : 'Shared Library');
        tag(ctx, ver, lx + lw - 10 - (tw(ctx, ver, 10, 600) + 14) / 2, 48, up && t >= 1.2 ? GREEN : MUTE);
        const ROW = [['vars/', 'buildApp.groovy'], ['src/', 'common/Jobs.groovy'], ['resources/', wide ? 'Dockerfile, pod.yaml' : 'Dockerfile']];
        const ry = (j) => 66 + j * 58;
        ROW.forEach(([d, f], j) => {
          const on = (!up && ((j === 0 && t >= 0.8) || (j === 2 && t >= 3.6))) || (up && j === 0 && t >= 1.2);
          C.card(ctx, { x: lx + 10, y: ry(j), w: lw - 20, h: 46, t: d, s: f }, on ? { lit: true, ...tint(BLUE) } : {});
        });
        if (!up) {
          APP.forEach((s, j) => C.arrow(ctx, [[aw + 2, ay(j) + 23], [lx + 8, ry(0) + 23]], ease(t, j * 0.8, j * 0.8 + 0.8), U.blue, { width: 1.2 }));
          C.arrow(ctx, [[lx + lw - 22, ry(0) + 46], [lx + lw - 22, ry(2)]], ease(t, 3.0, 3.6), U.purple, { dash: [3, 3] });
          if (t >= 3.6 && lw >= 190) C.text(ctx, 'libraryResource', lx + lw - 28, ry(1) - 2, { size: 9, weight: 600, color: U.purple, align: 'right' });
        } else {
          tag(ctx, 'v1.3 커밋', lx + lw / 2, mix([0, 12], [0, 48], ease(t, 0.2, 1.0))[1], GREEN, ease(t, 0.2, 0.6) * (1 - ease(t, 1.0, 1.3)));
          [0, 1].forEach((j) => C.arrow(ctx, [[lx + 8, ry(0) + 23], [aw + 2, ay(j) + 23]], ease(t, 1.8 + j * 0.6, 2.4 + j * 0.6), GREEN[1], { width: 1.2 }));
        }
        if (run > 6) C.stamp(ctx, lx + lw / 2, ry(1) + 23, up ? '한 번 고쳐 두 곳 반영' : 'Jenkinsfile은 한 줄', up ? 'ok' : 'info', (run - 6) / 0.4);
        say(notes[i]);
      },
    });
  });

  // docker build needs a daemon the node no longer has; kaniko builds layers itself; in one shared container it wipes the workspace.
  each('kaniko', (root) => {
    const S = seq([5, 7, 6.5], 1.8);
    const notes = [
      'docker build는 노드의 dockerd에 일을 맡기는데, 쿠버네티스 1.24 이후 노드에는 보통 containerd만 있다.',
      'kaniko는 Dockerfile 명령을 자기 컨테이너 안에서 실행하고, 명령마다 레이어를 떠서 레지스트리로 바로 보낸다.',
      '에이전트와 kaniko가 한 컨테이너면, 멀티스테이지의 다음 FROM에서 kaniko가 workspace까지 지운다.',
    ];
    hwa.scene(root, {
      height: 262, still: S.at(1) + 6.6, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), wide = w >= 480;
        const lw = Math.round(w * 0.46), rx = lw + 14, rw = w - rx, one = i === 2;
        C.pill(ctx, 0, 0, ['docker build', 'kaniko', 'kaniko 멀티스테이지'][i], ['bad', 'ok', 'bad'][i]);
        C.group(ctx, 0, 32, lw, 222, one ? '에이전트 컨테이너' : '에이전트 파드');
        const gone = one && t >= 2.6;
        C.card(ctx, { x: 10, y: 58, w: lw - 20, h: 50, t: 'workspace', s: gone ? '삭제됨' : wide ? 'Dockerfile, src/' : 'Dockerfile' }, gone ? { ...tint(RED), dash: [4, 3] } : {});
        const bt = ['docker CLI', 'kaniko executor', one ? (t >= 2.0 ? 'stage 1 (FROM)' : 'stage 0') : ''][i];
        C.box(ctx, 10, 130, lw - 20, 112, { fill: '#fff', stroke: i ? BLUE[2] : U.grid });
        C.text(ctx, bt, lw / 2, 148, { weight: 600, color: U.text, align: 'center', base: 'middle' });
        if (i === 1) {
          ['FROM', 'RUN', 'COPY'].forEach((s, j) => tag(ctx, s, lw / 2, 176 + j * 22, BLUE, ease(t, 0.8 + j, 1.2 + j)));
          C.arrow(ctx, [[lw / 2, 108], [lw / 2, 130]], ease(t, 0.2, 0.7), '#94a3b8', { width: 1.2 });
        }
        if (i === 0) C.text(ctx, '데몬에 요청만 보냄', lw / 2, 180, { size: 10, align: 'center' });
        if (one) C.text(ctx, '루트 파일 시스템 정리', lw / 2, 180, { size: 10, align: 'center' });
        if (one && t >= 2.0) C.arrow(ctx, [[lw / 2, 170], [lw / 2, 108]], ease(t, 2.0, 2.6), U.red);

        fade(ctx, i === 0 ? 1 : 0.4, () => {
          C.group(ctx, rx, 32, rw, 108, '노드');
          C.card(ctx, { x: rx + 10, y: 54, w: rw - 20, h: 34, t: 'containerd' }, {});
          const miss = i === 0 && t >= 2.2;
          C.card(ctx, { x: rx + 10, y: 96, w: rw - 20, h: 34, t: miss ? 'dockerd 없음' : 'dockerd' }, miss ? { ...tint(RED), dash: [4, 3] } : { dim: true, dash: [4, 3], fill: U.plot });
        });
        const pushed = i === 1 && t >= 5.0;
        fade(ctx, i === 1 ? 1 : 0.4, () => C.card(ctx, { x: rx, y: 160, w: rw, h: 52, t: '레지스트리', s: pushed ? 'app:a1b2c3' : undefined }, pushed ? tint(GREEN) : {}));
        if (i === 0) {
          const p = mix([lw / 2, 160], [rx + rw / 2, 113], ease(t, 0.6, 2.0));
          tag(ctx, 'docker build', p[0], p[1], [U.blue, '#fff', U.blue], 1 - ease(t, 2.2, 2.6));
        }
        if (i === 1 && t >= 3.6) {
          const p = mix([lw / 2, 220], [rx + rw / 2, 186], ease(t, 3.6, 4.8));
          tag(ctx, 'push', p[0], p[1], [U.blue, '#fff', U.blue], 1 - ease(t, 4.8, 5.1));
        }
        const end = [5, 7, 6.5][i];
        if (run > end) C.stamp(ctx, rx + rw / 2, 234, ['데몬 없음', '데몬 없이 push', 'workspace 사라짐'][i], ['bad', 'ok', 'bad'][i], (run - end) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Role table: patterns pick folders per role; a push to the global library sits outside the table with full access.
  each('rbac', (root) => {
    const S = seq([6, 5], 2);
    const COLS = ['DEV/api', 'DEV/web', 'PROD/api'];
    const ROWS = [['admin', ['전체', '전체', '전체'], PURPLE], ['developer', ['빌드', '빌드', '없음'], BLUE], ['authenticated', ['읽기', '읽기', '읽기'], GREEN]];
    const notes = ['항목 역할은 정규식으로 폴더를 고른다. developer는 DEV 폴더만 빌드하고 PROD는 보지 못한다.', '글로벌 Shared Library에 push할 수 있으면 역할 표와 상관없이 Jenkins 전체를 다룬다.'];
    hwa.scene(root, {
      height: 252, still: S.at(1) + 5.5, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), lib = i === 1;
        C.pill(ctx, 0, 0, lib ? '역할 표 밖' : '역할 표', lib ? 'bad' : 'info');
        const lw = Math.min(110, Math.round(w * 0.3)), cw = (w - lw) / 3, ry = (r) => 70 + r * 36, cx = (c) => lw + c * cw + cw / 2;
        COLS.forEach((s, c) => C.text(ctx, s, cx(c), 56, { size: 10, weight: 600, color: U.text, align: 'center' }));
        const br = lib || t >= 1.8;
        if (br) {
          C.line(ctx, [[cx(0) - cw / 2 + 6, 42], [cx(0) - cw / 2 + 6, 38], [cx(1) + cw / 2 - 6, 38], [cx(1) + cw / 2 - 6, 42]], BLUE[2], 1);
          C.text(ctx, 'DEV($|/.*)', lw + cw, 33, { size: 10, weight: 600, color: BLUE[1], align: 'center' });
        }
        const all = [...ROWS, ['lib push', ['전체', '전체', '전체'], RED]];
        all.forEach(([name, cells, col], r) => {
          const a = r < 3 ? (lib ? 0.45 : ease(t, 0.5 + r * 1.3, 0.9 + r * 1.3)) : lib ? ease(t, 0.6, 1.0) : 0;
          C.line(ctx, [[0, ry(r) + 32], [w, ry(r) + 32]], U.grid, 1);
          fade(ctx, Math.max(a, r < 3 ? 0.25 : 0), () => C.text(ctx, name, 0, ry(r) + 14, { size: 10, weight: 600, color: r === 3 ? U.red : U.text, base: 'middle' }));
          cells.forEach((s, c) => {
            const k = r < 3 ? a : lib ? ease(t, 1.2 + c * 0.6, 1.6 + c * 0.6) : 0;
            tag(ctx, s, cx(c), ry(r) + 14, s === '없음' ? MUTE : col, k);
          });
        });
        if (run > [6, 5][i]) C.stamp(ctx, (lw + w) / 2, 232, lib ? '표 밖의 전체 권한' : 'developer는 DEV만', lib ? 'bad' : 'ok', (run - [6, 5][i]) / 0.4);
        say(notes[i]);
      },
    });
  });
})();
