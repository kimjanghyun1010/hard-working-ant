(() => {
  const U = hwa.ui, C = hwa.cv;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const all = (id, fn) => document.querySelectorAll(`[data-figure="terraform-iac-${id}"]`).forEach(fn);
  // Plan colours: fill, text, border.
  const TONE = { info: ['#eff6ff', '#1d4ed8', '#93c5fd'], chg: ['#fef3c7', '#b45309', '#fcd34d'], del: ['#fee2e2', '#dc2626', '#fca5a5'], add: ['#dcfce7', '#15803d', '#86efac'] };
  const tag = (ctx, s, cx, cy, tone = 'info', a = 1) => {
    if (a <= 0) return;
    const [bg, fg, line] = TONE[tone];
    ctx.font = U.font(10, 600);
    const cw = ctx.measureText(s).width + 14;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath(); ctx.roundRect(cx - cw / 2, cy - 9, cw, 18, 5);
    ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke();
    C.text(ctx, s, cx, cy + 0.5, { size: 10, weight: 600, color: fg, align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  // Card with a title and key/value rows; rows are { k, v, tone, a, strike } or null. Returns row centre y.
  const RH = 28;
  const table = (ctx, x, y, w, title, rows, { lit = false } = {}) => {
    const rowY = (i) => y + 28 + i * RH + (RH - 4) / 2;
    C.box(ctx, x, y, w, 32 + rows.length * RH, { fill: '#fff', stroke: lit ? U.accent : U.grid });
    if (lit) C.box(ctx, x + 1, y + 1, w - 2, 30 + rows.length * RH, { fill: 'rgba(0,0,0,0)', stroke: U.accent });
    C.text(ctx, title, x + 9, y + 17, { size: 11, weight: 600, color: U.text });
    rows.forEach((r, i) => {
      if (!r) return;
      const cy = rowY(i);
      ctx.globalAlpha = r.a === undefined ? 1 : Math.max(0, r.a);
      ctx.beginPath(); ctx.roundRect(x + 4, cy - (RH - 4) / 2, w - 8, RH - 4, 5);
      ctx.fillStyle = r.tone ? TONE[r.tone][0] : U.cell; ctx.fill();
      ctx.font = U.font(10.5, 600);
      const vw = ctx.measureText(r.v).width;
      ctx.font = U.font(10);
      if (x + 13 + ctx.measureText(r.k).width + vw <= x + w - 10) C.text(ctx, r.k, x + 10, cy + 0.5, { size: 10, base: 'middle' });
      C.text(ctx, r.v, x + w - 10, cy + 0.5, { size: 10.5, weight: 600, color: r.tone ? TONE[r.tone][1] : U.text, align: 'right', base: 'middle' });
      if (r.strike) C.line(ctx, [[x + 8, cy], [x + 8 + (w - 16) * r.strike, cy]], U.red, 1.5);
      ctx.globalAlpha = 1;
    });
    return rowY;
  };
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };

  // Layers of one VM and the tool that owns each, in build order.
  all('layers', (root) => {
    const STEP = 1.4, HOLD = 2.6;
    const T = [
      { t: 'Packer', s: '빌드 때', y: 205, say: 'Packer가 빌드 때 OS와 패키지를 이미지로 굽는다.' },
      { t: 'Terraform', s: '자원 바꿀 때', y: 72, say: 'Terraform이 네트워크, 방화벽, VM을 API로 만든다.' },
      { t: 'Ansible', s: '서버가 뜬 뒤', y: 148, say: 'Ansible이 뜬 서버에 접속해 설정을 맞춘다.' },
    ];
    hwa.scene(root, {
      height: 290, still: 3 * STEP + 1.2,
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, 3, STEP, HOLD), on = (j) => s.done || s.active === j, seen = (j) => s.done || s.active >= j;
        const tw0 = Math.min(100, Math.round(w * 0.26)), gx = tw0 + 26, gw = w - gx, nw = (gw - 32) / 3;
        C.pill(ctx, 0, 0, s.done ? '세 층, 세 도구' : T[s.active].t, 'info');
        C.group(ctx, gx, 30, gw, 222, '클라우드 프로젝트', 47);
        ['VPC', '서브넷', '방화벽'].forEach((n, j) => C.card(ctx, { x: gx + 10 + j * (nw + 6), y: 56, w: nw, h: 32, t: n, size: 11 }, { lit: on(1) && seen(1) }));
        C.box(ctx, gx + 10, 100, gw - 20, 142, { fill: '#fff', stroke: on(1) ? U.accent : U.grid });
        C.text(ctx, 'VM', gx + 20, 117, { weight: 600, color: U.text });
        C.card(ctx, { x: gx + 20, y: 126, w: gw - 40, h: 44, t: '설정 파일, 서비스', s: '앱 설정, 계정, 배포' }, { lit: on(2) && seen(2) });
        C.card(ctx, { x: gx + 20, y: 180, w: gw - 40, h: 50, t: 'OS 이미지', s: 'OS, 패키지, 에이전트' }, { lit: on(0), fill: U.cell });
        T.forEach((d, j) => {
          C.card(ctx, { x: 0, y: d.y - 20, w: tw0, h: 40, t: d.t, s: d.s }, { lit: on(j) && seen(j), dim: !seen(j) });
          const pts = [[tw0 + 2, d.y], [(j === 1 ? gx + 10 : gx + 20) - 2, d.y]];
          if (seen(j)) C.arrow(ctx, pts, s.k(j), on(j) && !s.done ? U.accent : '#cbd5e1', { width: on(j) && !s.done ? 2 : 1.5 });
        });
        const msg = s.done ? 'Packer, Terraform, Ansible 순서로 VM 한 대가 완성된다.' : `${s.active + 1}. ${T[s.active].say}`;
        C.wrap(ctx, msg, w / 2, 274, w - 8, { color: U.text, weight: 600 });
        say(msg);
      },
    });
  });

  // Timeline lanes: blocks for work, double arrows for waits. demo turns scenes into modes played once by the run button.
  {
    const FILL = { inst: '#f59e0b', run: U.blue, read: '#8b5cf6', write: '#14b8a6', v: '#e2e8f0', lost: '#fecaca', ok: '#22c55e' };
    const DARK = { v: U.text, lost: '#b91c1c' };
    const ARC = { wait: '#b45309' };
    const dbl = (ctx, x0, x1, y, color) => {
      if (x1 - x0 < 6) return;
      C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
      [[x0, 1], [x1, -1]].forEach(([x, d]) => {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
      });
    };
    const LH = 44;
    const tl = (id, scenes, { SEC = 7, HOLD = 2, demo } = {}) => all(id, (root) => {
      const n = scenes.length, maxL = Math.max(...scenes.map((s) => s.lanes.length));
      hwa.scene(root, {
        height: 40 + maxL * LH + 28 + (scenes.some((x) => x.stamp) ? 34 : 0), still: (n - 1) * (SEC + HOLD) + SEC + 1, demo,
        scenes: n > 1 && !demo ? hwa.loopScenes(SEC, HOLD, n) : undefined, notes: scenes.map((s) => s.say),
        frame: (ctx, w, h, time, say, ui) => {
          const auto = hwa.loop(time, SEC, HOLD, n), i = demo ? ui.mode : auto.i, s = scenes[i];
          const run = demo ? (ui.runAt === null ? -1 : time - ui.runAt) : (time % ((SEC + HOLD) * n)) - auto.i * (SEC + HOLD);
          const k = Math.max(0, Math.min(1, run / SEC)), t = k * s.span;
          C.pill(ctx, 0, 0, s.pill, s.tone);
          if (s.legend) {
            let lx = w;
            s.legend.slice().reverse().forEach(([kind, label]) => {
              lx -= tw(ctx, label, 10) + 4;
              C.text(ctx, label, lx, 11.5, { size: 10, base: 'middle' });
              lx -= 14;
              ctx.fillStyle = FILL[kind]; ctx.beginPath(); ctx.roundRect(lx, 6, 10, 10, 2); ctx.fill();
              lx -= 10;
            });
          }
          const x0 = Math.min(64, w * 0.2), x1 = w - 6, top = 36, base = top + s.lanes.length * LH + 2;
          const X = (v) => x0 + (Math.max(0, Math.min(v, s.span)) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
          s.lanes.forEach((name, j) => C.text(ctx, name, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
          C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
          C.text(ctx, s.unit, x1, base - 6, { size: 9, align: 'right' });
          s.ticks.forEach(([v, label]) => {
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
            const y = ly(j) + 7, bx = X(a) + 1, bw = X(Math.min(t, b)) - bx - 1;
            if (bw <= 0) return;
            ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 14, Math.min(7, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
            if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 14) / 2 + 0.5, { size: 10, weight: 700, color: DARK[kind] || '#fff', align: 'center', base: 'middle' });
          });
          if (s.event && t >= s.event[0]) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], s.event[2] || U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
          if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
          if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, base + 40, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
          if (demo && run < 0) C.text(ctx, `${demo.run} 버튼을 눌러 보자`, (x0 + x1) / 2, top + (base - top) / 2, { size: 12, align: 'center', base: 'middle' });
          say(`${s.pill}. ${s.say}`);
        },
      });
    });

    // Graph walk on apply: a node starts once everything it references is done. Seconds are rough.
    const gt = [[5, '5초'], [10, '10초'], [15, '15초']];
    tl('graph', [
      { pill: 'terraform apply', tone: 'info', span: 18, unit: '초', ticks: gt, lanes: ['VPC', '서브넷', '방화벽', 'VM', 'DNS'], legend: [['inst', '생성 중']],
        segs: [[0, 0, 4, 'inst', 'VPC'], [1, 4, 7, 'inst', ''], [2, 4, 6, 'inst', ''], [3, 7, 15, 'inst', 'VM 생성'], [4, 15, 16.5, 'inst', '']],
        arcs: [[1, 0, 4, 'wait', '대기'], [2, 0, 4, 'wait', '대기'], [3, 0, 7, 'wait', '서브넷 대기'], [4, 0, 15, 'wait', 'VM IP 대기']],
        event: [4, 'VPC 완료', U.tones.ok[1]],
        say: 'VPC가 끝나는 순간 그것만 참조하는 서브넷과 방화벽이 함께 출발하고, VM과 DNS는 참조한 자원을 기다린다.' },
    ], { SEC: 8 });

    // Replacing a VM: default destroys first and leaves a gap; create_before_destroy overlaps the two.
    const rt = [[5, '5초'], [10, '10초'], [15, '15초']], rl = ['옛 VM', '새 VM', '서비스'], rg = [['inst', '생성'], ['run', '실행'], ['lost', '삭제']];
    tl('replace', [
      { pill: '지우고 만들기', tone: 'bad', span: 20, unit: '초', ticks: rt, lanes: rl, legend: rg,
        segs: [[0, 0, 2, 'run', ''], [0, 2, 5, 'lost', '삭제'], [1, 5, 13, 'inst', ''], [1, 13, 20, 'run', '실행'], [2, 0, 2, 'ok', ''], [2, 2, 13, 'lost', '중단'], [2, 13, 20, 'ok', '']],
        event: [2, 'apply 시작'], stamp: ['11초 중단', 'bad'], say: '기본 순서는 옛 VM을 먼저 지우고 새 VM을 만들어, 그 사이 서비스가 끊긴다.' },
      { pill: '만들고 지우기', tone: 'ok', span: 20, unit: '초', ticks: rt, lanes: rl, legend: rg,
        segs: [[0, 0, 10, 'run', '실행'], [0, 10, 13, 'lost', '삭제'], [1, 2, 10, 'inst', ''], [1, 10, 20, 'run', '실행'], [2, 0, 20, 'ok', '']],
        event: [2, 'apply 시작', U.blue], stamp: ['중단 없음', 'ok'], say: 'create_before_destroy는 새 VM을 먼저 만들고 옛 VM을 지워, 두 대가 잠시 함께 있다.' },
    ]);

    // Two applies seconds apart on one state: without a lock B overwrites A's write; with one B waits.
    const st = [[20, '20초'], [40, '40초'], [60, '60초']], lanes = ['A apply', 'B apply', 'state'], lg = [['read', '읽기'], ['run', '적용'], ['write', '쓰기']];
    const A = [[0, 0, 3, 'read', ''], [0, 3, 28, 'run', 'VM a 생성'], [0, 28, 31, 'write', '']];
    tl('lock', [
      { pill: '잠금 없음', tone: 'bad', span: 66, unit: '초', ticks: st, lanes, legend: lg,
        segs: [...A, [1, 6, 9, 'read', ''], [1, 9, 36, 'run', 'VM b 생성'], [1, 36, 39, 'write', ''], [2, 0, 31, 'v', 'v5'], [2, 31, 39, 'v', 'v6'], [2, 39, 66, 'lost', 'v6 (a 없음)']],
        event: [39, 'B가 덮어씀'], stamp: ['VM a가 state에서 사라짐', 'bad'], say: 'B가 A보다 먼저 읽은 state에 자기 결과만 써서, VM a가 state에서 사라진다.' },
      { pill: '잠금 있음', tone: 'ok', span: 66, unit: '초', ticks: st, lanes, legend: lg,
        segs: [...A, [1, 31, 34, 'read', ''], [1, 34, 57, 'run', 'VM b 생성'], [1, 57, 60, 'write', ''], [2, 0, 31, 'v', 'v5'], [2, 31, 60, 'v', 'v6'], [2, 60, 66, 'v', 'v7']],
        arcs: [[1, 6, 31, 'wait', '잠금 대기']], event: [31, '잠금 해제', U.tones.ok[1]], stamp: ['B 25초 대기, 둘 다 남음', 'ok'],
        say: 'B는 A가 잠금을 풀 때까지 기다렸다가 A가 쓴 state를 읽고 시작해, 두 VM이 모두 남는다.' },
    ], { demo: { modes: ['잠금 없음', '잠금 있음'], run: '둘이 동시에 apply' } });

  }

  // apply once: code is compared with an empty state, the API creates the VM, its ID lands in state, later runs refresh by ID.
  all('state', (root) => {
    const STEP = 1.5, HOLD = 2.4;
    const SAY = ['코드에 web이 있고 state에는 없어서 새로 만든다.', 'apply가 클라우드 API로 VM을 만든다.', '클라우드가 붙인 ID를 state에 web과 짝지어 적는다.', '다음 실행은 이 ID로 실제 VM을 읽어 온다(refresh).'];
    const LIT = [[0, 1], [2], [1, 2], [1, 2]];
    hwa.scene(root, {
      height: 214, still: 4 * STEP + 1.2, notes: ['state는 코드의 이름과 클라우드의 ID를 짝지어 둔 대응표다.'],
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, 4, STEP, HOLD), cur = s.done ? 4 : s.active, gap = 16, cw = (w - 2 * gap) / 3, X = (j) => j * (cw + gap), top = 48;
        const lit = (j) => !s.done && LIT[cur].includes(j), vm = cur >= 1 ? s.k(1) : 0, id = cur >= 2 ? s.k(2) : 0;
        C.pill(ctx, 0, 0, s.done ? 'apply 끝' : ['plan', 'apply', 'state 기록', '다음 plan'][cur], 'info');
        const rowY = table(ctx, X(0), top, cw, '코드', [{ k: 'web', v: 'e2-small', tone: cur === 0 ? 'add' : null }, null], { lit: lit(0) });
        table(ctx, X(1), top, cw, 'state', id > 0.5 ? [{ k: 'web', v: 'ID 4721', tone: cur === 2 ? 'info' : null }, { k: '크기', v: 'e2-small' }] : [null, null], { lit: lit(1) });
        if (id <= 0.5) C.text(ctx, '비어 있음', X(1) + cw / 2, rowY(0.5), { size: 10, align: 'center', base: 'middle' });
        table(ctx, X(2), top, cw, '클라우드', vm > 0.5 ? [{ k: 'VM', v: 'e2-small', tone: cur === 1 ? 'info' : null }, { k: 'ID', v: '4721' }] : [null, null], { lit: lit(2) });
        const bot = top + 32 + 2 * RH, P = [
          null,
          [[X(0) + cw / 2, top], [X(0) + cw / 2, top - 10], [X(2) + cw / 2, top - 10], [X(2) + cw / 2, top]],
          null,
          [[X(1) + cw / 2, bot], [X(1) + cw / 2, bot + 12], [X(2) + cw / 2, bot + 12], [X(2) + cw / 2, bot]],
        ];
        P.forEach((pts, j) => { if (pts && cur >= j) C.arrow(ctx, pts, cur === j ? s.k(j) : 1, cur === j ? U.accent : '#cbd5e1', { width: cur === j ? 2 : 1.5, dash: j === 3 ? [4, 3] : null }); });
        if (cur === 0) tag(ctx, '+ create', X(0) + cw / 2, bot + 14, 'add', s.k(0));
        if (cur === 2 && s.k(2) < 1) tag(ctx, 'ID 4721', ...mix([X(2) + cw / 2, rowY(1)], [X(1) + cw / 2, rowY(0)], s.k(2)), 'info');
        if (cur >= 3) C.text(ctx, 'refresh', (X(1) + X(2) + cw) / 2, bot + 26, { size: 10, weight: 600, color: cur === 3 ? U.accent : U.muted, align: 'center' });
        const msg = s.done ? '코드의 web과 클라우드의 ID 4721이 state에서 짝지어졌다.' : `${cur + 1}. ${SAY[cur]}`;
        C.wrap(ctx, msg, w / 2, bot + 50, w - 8, { color: U.text, weight: 600 });
        say(msg);
      },
    });
  });

  // plan: refresh state from the cloud, then diff code against state. Three scenes: code edit, console edit, code delete.
  all('plan', (root) => {
    const LEN = 7.5, HOLD = 2.2, S = hwa.loopScenes(LEN, HOLD, 3), BASE = [['web', 'e2-small'], ['ssh', '사내망'], ['logs', '서울']];
    const SC = [
      { pill: '코드 수정', tone: 'info', side: 'code', row: 0, v: 'e2-medium', line: '~ web  e2-small → e2-medium', lt: 'chg', stamp: ['1 to change', 'warn'] },
      { pill: '콘솔에서 변경', tone: 'warn', side: 'cloud', row: 1, v: '0.0.0.0/0', line: '~ ssh  0.0.0.0/0 → 사내망', lt: 'chg', stamp: ['콘솔 변경을 되돌림', 'warn'] },
      { pill: '코드에서 삭제', tone: 'bad', side: 'code', row: 2, v: null, line: '- logs  destroy', lt: 'del', stamp: ['1 to destroy', 'bad'] },
    ];
    const notes = ['코드를 고치면 코드와 state가 달라져, 그만큼 바꾸는 plan이 나온다.', '콘솔에서 바꾸면 refresh가 state를 실제 값으로 고치고, plan은 코드 쪽으로 되돌린다.', '코드에서 지우면 state에만 남은 자원을 지우는 plan이 나온다.'];
    hwa.scene(root, {
      height: 234, still: S.at(1) + LEN + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, LEN, HOLD, 3), run = (time % (3 * (LEN + HOLD))) - S.at(i), sc = SC[i];
        const gap = 16, cw = (w - 2 * gap) / 3, X = (j) => j * (cw + gap), top = 34, bot = top + 32 + 3 * RH;
        const chg = ease(t, 0.3, 0.9), ref = ease(t, 1.4, 2.8), cmp = t >= 3.2, out = ease(t, 4.4, 5.0);
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        const row = (side, r) => {
          const [k, v] = BASE[r];
          if (r !== sc.row) return { k, v };
          if (side === 'code' && sc.side === 'code') return sc.v ? { k, v: chg > 0.5 ? sc.v : v, tone: chg > 0.5 ? 'info' : null } : { k, v, strike: chg, a: 1 - 0.55 * chg };
          if (side === 'cloud' && sc.side === 'cloud') return { k, v: chg > 0.5 ? sc.v : v, tone: chg > 0.5 ? 'chg' : null };
          if (side === 'state' && sc.side === 'cloud' && ref >= 1) return { k, v: sc.v, tone: 'chg' };
          return { k, v, tone: side === 'state' && cmp ? sc.lt : null };
        };
        const rowY = table(ctx, X(0), top, cw, '코드', [0, 1, 2].map((r) => row('code', r)), { lit: cmp });
        table(ctx, X(1), top, cw, 'state', [0, 1, 2].map((r) => row('state', r)), { lit: cmp });
        table(ctx, X(2), top, cw, '클라우드', [0, 1, 2].map((r) => row('cloud', r)), { lit: t >= 1.4 && t < 3.2 });
        if (sc.side === 'cloud' && t > 0.2 && t < 0.9) tag(ctx, '콘솔', ...mix([X(2) + cw / 2, 12], [X(2) + cw / 2, rowY(1)], ease(t, 0.2, 0.9)), 'chg');
        if (t >= 1.4) {
          C.arrow(ctx, [[X(2) + cw / 2, bot + 2], [X(2) + cw / 2, bot + 14], [X(1) + cw / 2, bot + 14], [X(1) + cw / 2, bot + 2]], ref, t < 3.2 ? U.accent : '#cbd5e1', { width: t < 3.2 ? 2 : 1.5 });
          C.text(ctx, 'refresh', (X(1) + X(2) + cw) / 2, bot + 28, { size: 10, weight: 600, color: t < 3.2 ? U.accent : U.muted, align: 'center' });
        }
        if (cmp) C.text(ctx, '≠', cw + gap / 2, rowY(sc.row) + 1, { size: 15, weight: 700, color: U.red, align: 'center', base: 'middle' });
        const py = bot + 40;
        C.box(ctx, 0, py, w, 34, { fill: U.plot });
        C.text(ctx, 'plan', 10, py + 17.5, { size: 10, weight: 600, base: 'middle' });
        if (out > 0) { ctx.globalAlpha = out; C.text(ctx, sc.line, 48, py + 17.5, { size: 11, weight: 700, color: TONE[sc.lt][1], base: 'middle' }); ctx.globalAlpha = 1; }
        // Under the code column, clear of the refresh arrow and label.
        if (run >= LEN) C.stamp(ctx, Math.max(tw(ctx, sc.stamp[0], 12, 700) / 2 + 12, cw / 2), bot + 20, sc.stamp[0], sc.stamp[1], (run - LEN) / 0.4);
        say(`${sc.pill}. ${notes[i]} plan: ${sc.line}`);
      },
    });
  });

  // Demo: drop b from a list. count addresses by position (c shifts into [1]); for_each addresses by key.
  all('foreach', (root) => {
    const ITEMS = ['a', 'b', 'c'];
    const M = [
      { pill: 'count', addr: (j) => `user[${j}]`, val: ['a', 'c', 'c'], res: [['그대로', 'ok'], ['~ c로 교체', 'warn'], ['- 삭제', 'bad']], link: [[0, 0, 0], [2, 1, 1]], stamp: ['자원 2개가 바뀜', 'bad'], say: 'count는 c가 1번으로 당겨져, 1번을 c로 바꾸고 2번을 지운다.' },
      { pill: 'for_each', addr: (j) => `user["${ITEMS[j]}"]`, val: ['a', 'b', 'c'], res: [['그대로', 'ok'], ['- 삭제', 'bad'], ['그대로', 'ok']], link: [[0, 0, 0], [2, 1, 2]], stamp: ['b 하나만 삭제', 'ok'], say: 'for_each는 키로 찾으니 b만 지우고 a와 c는 그대로 둔다.' },
    ];
    hwa.scene(root, {
      height: 200, demo: { modes: ['count (순번)', 'for_each (키)'], run: '가운데 b 빼기' }, notes: M.map((m) => m.say),
      frame: (ctx, w, h, time, say, ui) => {
        const m = M[ui.mode], run = ui.runAt === null ? -1 : time - ui.runAt;
        const gone = ease(run, 0.2, 1.0), link = ease(run, 1.3, 2.3), res = ease(run, 2.5, 3.0);
        const lw = Math.min(120, w * 0.26), gap = Math.max(40, w * 0.1), rx = lw + gap, rw = w - rx, top = 34;
        C.pill(ctx, 0, 0, m.pill, 'info');
        const rowY = table(ctx, 0, top, lw, 'var.users', [null, null, null]);
        ITEMS.forEach((s, j) => {
          const y = j === 2 ? rowY(2 - gone) : rowY(j), a = j === 1 ? 1 - gone : 1;
          if (a <= 0) return;
          ctx.globalAlpha = a;
          ctx.beginPath(); ctx.roundRect(4, y - 12, lw - 8, 24, 5); ctx.fillStyle = j === 1 && gone > 0 ? TONE.del[0] : U.cell; ctx.fill();
          C.text(ctx, s, lw / 2, y + 0.5, { size: 11, weight: 700, color: U.text, align: 'center', base: 'middle' });
          ctx.globalAlpha = 1;
        });
        table(ctx, rx, top, rw, 'state 주소', [null, null, null]);
        [0, 1, 2].forEach((j) => {
          const y = rowY(j), [txt, tone] = m.res[j], hit = res > 0 && tone !== 'ok';
          ctx.beginPath(); ctx.roundRect(rx + 4, y - 12, rw - 8, 24, 5); ctx.fillStyle = hit ? hwa.ui.tones[tone][0] : U.cell; ctx.fill();
          C.text(ctx, m.addr(j), rx + 10, y + 0.5, { size: 10.5, weight: 600, color: U.text, base: 'middle' });
          C.text(ctx, res > 0.5 ? m.val[j] : ITEMS[j], rx + 10 + tw(ctx, 'user["a"]', 10.5, 600) + 10, y + 0.5, { size: 10, base: 'middle' });
          C.chip(ctx, txt, rx + rw - 8, y, tone, res);
        });
        if (link > 0) m.link.forEach(([, from, to]) => C.arrow(ctx, [[lw + 3, rowY(from)], [rx - 3, rowY(to)]], link, U.blue, { width: 1.6 }));
        const by = top + 32 + 3 * RH + 22;
        if (run < 0) C.text(ctx, '가운데 b 빼기 버튼을 눌러 보자', w / 2, by, { size: 12, align: 'center', base: 'middle' });
        else C.stamp(ctx, w / 2, by, m.stamp[0], m.stamp[1], (run - 3.2) / 0.4);
        say(`${m.pill}. ${m.say}`);
      },
    });
  });

  // One playbook, three hosts in parallel, three tasks. First run changes everything; the second finds nothing to change.
  all('ansible', (root) => {
    const LEN = 7, HOLD = 2.2, S = hwa.loopScenes(LEN, HOLD, 2), HOSTS = ['web-1', 'web-2', 'web-3'], TASK = ['설치', '설정', '시작'];
    const notes = ['첫 실행은 세 대 모두 세 작업을 바꿔 changed가 나온다.', '같은 플레이북을 다시 돌리면 이미 그 상태라 전부 ok이고 바뀌는 것이 없다.'];
    hwa.scene(root, {
      height: 226, still: S.at(1) + LEN + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, LEN, HOLD, 2), run = (time % (2 * (LEN + HOLD))) - S.at(i), tone = i ? 'add' : 'chg';
        const cn = Math.min(96, w * 0.25), hx = cn + 30, hw = w - hx, recap = 62, cellW = Math.min(46, (hw - 58 - recap) / 3 - 4), hy = (j) => 52 + j * 46;
        C.pill(ctx, 0, 0, i ? '두 번째 실행' : '첫 실행', i ? 'ok' : 'warn');
        C.legend(ctx, w - 108, 11, [['changed', TONE.chg[2]], ['ok', TONE.add[2]]]);
        C.card(ctx, { x: 0, y: 92, w: cn, h: 56, t: '제어 노드', s: 'playbook' }, { lit: t < 5.8 });
        TASK.forEach((s, k) => C.text(ctx, s, hx + 58 + k * (cellW + 4) + cellW / 2, 44, { size: 10, align: 'center' }));
        HOSTS.forEach((name, j) => {
          const y = hy(j);
          C.box(ctx, hx, y, hw, 38, { fill: '#fff' });
          C.text(ctx, name, hx + 10, y + 19.5, { size: 11, weight: 600, color: U.text, base: 'middle' });
          TASK.forEach((_, k) => {
            const x = hx + 58 + k * (cellW + 4), on = t >= 1.3 + k * 1.6;
            ctx.beginPath(); ctx.roundRect(x, y + 9, cellW, 20, 4); ctx.fillStyle = on ? TONE[tone][0] : U.cell; ctx.fill();
            if (on) { ctx.strokeStyle = TONE[tone][2]; ctx.lineWidth = 1; ctx.stroke(); }
          });
          if (t >= 5.6) C.text(ctx, i ? 'changed=0' : 'changed=3', w - 8, y + 19.5, { size: 10, weight: 700, color: TONE[tone][1], align: 'right', base: 'middle' });
          [0, 1, 2].forEach((k) => {
            const a = 0.6 + k * 1.6;
            if (t > a && t < a + 0.7) {
              const [px, py] = mix([cn + 2, 120], [hx + 4, y + 19], ease(t, a, a + 0.7));
              ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = U.blue; ctx.fill();
            }
          });
        });
        if (run >= LEN) C.stamp(ctx, w / 2, 210, i ? '바뀐 것 없음' : '세 대 모두 changed', i ? 'ok' : 'warn', (run - LEN) / 0.4);
        say(notes[i]);
      },
    });
  });

})();
