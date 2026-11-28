// Secret management post: where a secret lives and when it turns into plaintext on its way to a pod.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const fitSize = (ctx, s, maxW, size, weight) => { while (size > 8 && tw(ctx, s, size, weight) > maxW) size -= 0.5; return size; };
  // [bg, fg, line] per chip meaning: plaintext secret, ciphertext, reference to a store, ordinary data, refused.
  const KIND = { plain: ['#fef3c7', '#b45309', '#f59e0b'], enc: ['#dcfce7', '#15803d', '#86efac'], ref: ['#ede9fe', '#6d28d9', '#a78bfa'], info: ['#dbeafe', '#1d4ed8', '#93c5fd'], bad: ['#fee2e2', '#dc2626', '#fca5a5'] };
  const NAME = { plain: '평문', enc: '암호문', ref: '참조' };

  const chip = (ctx, s, cx, cy, kind, w, a = 1) => {
    if (a <= 0) return;
    const [bg, fg, line] = KIND[kind], cw = tw(ctx, s, 10, 600) + 14, x = clamp(cx - cw / 2, 1, w - cw - 1);
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x, cy - 9, cw, 18, 5);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x + cw / 2, cy + 0.5, { size: 10, weight: 600, color: fg, align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  // Left-aligned text broken at spaces, 16px per line.
  const para = (ctx, s, x, y, maxW, opts = {}) => {
    const o = { size: 11, weight: 600, color: U.text, ...opts }, out = [''];
    ctx.font = U.font(o.size, o.weight);
    s.split(' ').forEach((word) => {
      const line = out[out.length - 1], next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) out.push(word); else out[out.length - 1] = next;
    });
    out.forEach((l, i) => C.text(ctx, l, x, y + i * 16, o));
  };
  // Stamp moved inward so its pill stays on the canvas.
  const stamp = (ctx, x, y, s, tone, k, w) => { const half = tw(ctx, s, 13, 700) / 2 + 16; C.stamp(ctx, clamp(x, half, w - half), y, s, tone, k); };
  const topBar = (ctx, w, pill, tone, items) => {
    C.pill(ctx, 0, 0, pill, tone);
    const pw = tw(ctx, pill, 11, 600) + 30, lw = items.reduce((a, [s]) => a + 24 + tw(ctx, s, 10), 0) - 12;
    if (items.length && pw + lw + 14 <= w) C.legend(ctx, w - lw, 11, items);
  };
  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time); return { i, run: (time % T) - at(i) }; } };
  };

  // Group: node maps. Nodes sit on a column grid; each step moves one chip from node to node.
  // nodes: id -> [col, row, title, sub, span]. step: [from, to, chip, kind, text, set = [id, sub, kind], 'v' for vertical first].
  const STEP = 1.6, HOLD = 2.4, TOP = 34, ROW = 70, NH = 44;
  const route = (a, b, v) => {
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2, down = by > ay;
    if (Math.abs(ay - by) < 1) { const d = bx > ax ? 1 : -1, y = ay - 6 * d; return [[d > 0 ? a.x + a.w : a.x, y], [d > 0 ? b.x : b.x + b.w, y]]; }
    const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w);
    if (hi - lo > 20) { const x = (lo + hi) / 2 + (down ? -6 : 6); return [[x, down ? a.y + a.h : a.y], [x, down ? b.y : b.y + b.h]]; }
    if (v) { const x = ax + (bx > ax ? 8 : -8); return [[x, down ? a.y + a.h : a.y], [x, by], [bx > ax ? b.x : b.x + b.w, by]]; }
    return [[bx > ax ? a.x + a.w : a.x, ay], [bx, ay], [bx, down ? b.y : b.y + b.h]];
  };
  const node = (ctx, b, st, lit) => {
    const tone = st ? KIND[st[1]] : null, sub = st ? st[0] : b.s, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    C.box(ctx, b.x, b.y, b.w, b.h, { fill: tone ? tone[0] : '#fff', stroke: tone ? tone[2] : U.grid });
    if (lit) {
      ctx.beginPath();
      ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 8);
      ctx.strokeStyle = U.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    C.text(ctx, b.t, cx, sub ? cy - 7 : cy, { size: fitSize(ctx, b.t, b.w - 8, 11.5, 600), weight: 600, color: U.text, align: 'center', base: 'middle' });
    if (sub) C.text(ctx, sub, cx, cy + 9, { size: fitSize(ctx, sub, b.w - 6, 10, st ? 600 : 400), weight: st ? 600 : 400, color: tone ? tone[1] : U.muted, align: 'center', base: 'middle' });
  };
  const flow = (name, { cols, rows, nodes, groups = [], scenes, demo }) => document.querySelectorAll(`[data-figure="${name}"]`).forEach((root) => {
    const lens = scenes.map((s) => s.steps.length * STEP), S = seq(lens, HOLD), last = scenes.length - 1;
    const kinds = [...new Set(scenes.flatMap((s) => s.steps.map((st) => st[3])))].filter((k) => NAME[k]);
    hwa.scene(root, {
      height: TOP + rows * ROW + 46,
      still: demo ? lens[0] + 1 : S.at(last) + lens[last] + 1,
      scenes: demo || scenes.length < 2 ? undefined : S,
      notes: scenes.map((s) => s.note),
      demo,
      frame: (ctx, w, h, time, say, ui) => {
        const p = demo ? { i: ui.mode, run: ui.runAt === null ? -1 : time - ui.runAt } : S.pos(time);
        const sc = scenes[p.i], n = sc.steps.length, run = p.run, done = run >= n * STEP;
        const gap = w < 480 ? 10 : 20, cw = (w - 8 - gap * (cols - 1)) / cols, X = (c) => 4 + c * (cw + gap), B = {};
        Object.entries({ ...nodes, ...(sc.nodes || {}) }).forEach(([id, d]) => {
          if (d) B[id] = { x: X(d[0]), y: TOP + 20 + d[1] * ROW, w: cw * (d[4] || 1) + gap * ((d[4] || 1) - 1), h: NH, t: d[2], s: d[3] };
        });
        topBar(ctx, w, sc.pill, sc.tone, kinds.map((k) => [NAME[k], KIND[k][2]]));
        [...groups, ...(sc.groups || [])].forEach(([label, c0, r0, c1, r1]) => {
          const x = X(c0) - 4, y = TOP + r0 * ROW + 2;
          C.box(ctx, x, y, X(c1) + cw + 4 - x, TOP + 20 + r1 * ROW + NH + 6 - y, { fill: U.plot, r: 10 });
          C.text(ctx, label, x + 8, y + 12, { size: 10, weight: 600 });
        });
        const k = (j) => (run < 0 ? 0 : clamp((run - j * STEP) / (STEP * 0.7)));
        const cur = run < 0 ? -1 : Math.min(n - 1, Math.floor(run / STEP)), cs = cur >= 0 ? sc.steps[cur] : null, kc = cur >= 0 ? k(cur) : 0;
        const st = { ...(sc.init || {}) };
        sc.steps.forEach((s, j) => { if (j <= cur && k(j) >= 1 && s[5]) st[s[5][0]] = s[5].slice(1); });
        Object.entries(B).forEach(([id, b]) => node(ctx, b, st[id], cs && !done && (kc < 1 ? id === cs[0] : id === cs[1])));
        sc.steps.forEach((s, j) => {
          if (j > cur) return;
          C.arrow(ctx, route(B[s[0]], B[s[1]], s[6]), j < cur ? 1 : hwa.smooth(kc), j < cur ? '#cbd5e1' : KIND[s[3]][2], { width: j < cur ? 1.2 : 1.8 });
        });
        if (cs && !done) { const [x, y] = C.pathAt(route(B[cs[0]], B[cs[1]], cs[6]), hwa.smooth(kc)).pop(); chip(ctx, cs[2], x, y, cs[3], w); }
        const ty = TOP + rows * ROW + 12;
        if (done && sc.stamp) stamp(ctx, w / 2, ty + 6, sc.stamp[0], sc.stamp[1], (run - n * STEP) / 0.4, w);
        else if (cs) para(ctx, `${cur + 1}. ${cs[4]}`, 0, ty, w);
        else para(ctx, `모드를 고르고 ${demo.run} 버튼을 눌러 보자`, 0, ty, w, { weight: 400, color: U.muted });
        say(`${sc.pill}. ${sc.note}${cs ? ` 지금 단계: ${cs[4]}` : ''}`);
      },
    });
  });

  // Secret data is base64: written to etcd and read back without any key.
  flow('secret-management-base64', {
    cols: 3, rows: 2,
    nodes: { raw: [0, 0, '원래 값', 's3cr3t'], yaml: [1, 0, 'Secret', 'data 필드'], etcd: [2, 0, 'etcd', '저장소'], get: [2, 1, 'kubectl get', '읽기 권한'], dec: [1, 1, 'base64 -d', '디코딩'], out: [0, 1, '읽은 값', ''] },
    scenes: [{ pill: 'Secret의 data 필드', tone: 'warn', note: '값은 base64로 바뀌어 저장될 뿐이고, 읽는 쪽은 키 없이 원래 값으로 되돌린다.', steps: [
      ['raw', 'yaml', 's3cr3t', 'plain', 'base64로 바꿔 data에 적는다', ['yaml', 'czNjcjN0', 'plain']],
      ['yaml', 'etcd', 'czNjcjN0', 'plain', 'API 서버가 그대로 etcd에 쓴다', ['etcd', 'czNjcjN0', 'plain']],
      ['etcd', 'get', 'czNjcjN0', 'plain', '읽기 권한만 있으면 꺼낸다'],
      ['get', 'dec', 'czNjcjN0', 'plain', '키 없이 디코딩한다'],
      ['dec', 'out', 's3cr3t', 'plain', '원래 값이 나온다', ['out', 's3cr3t', 'plain']],
    ], stamp: ['키 없이 되돌림', 'bad'] }],
  });

  // Demo: the same Secret in an etcd backup, without encryption and with a KMS v2 provider.
  flow('secret-management-etcd', {
    cols: 4, rows: 2,
    nodes: { user: [0, 0, 'kubectl', 'apply'], api: [1, 0, 'API 서버', ''], etcd: [2, 0, 'etcd', ''], bak: [3, 0, '백업 파일', ''], kms: [1, 1, 'KMS', '키 보관'], who: [3, 1, '외부인', '백업을 엶'] },
    scenes: [
      { pill: '암호화 없음', tone: 'bad', nodes: { kms: null }, note: '암호화가 없으면 etcd와 백업에 값이 그대로 있어, 백업 파일만으로 읽힌다.', steps: [
        ['user', 'api', 's3cr3t', 'plain', 'Secret을 만든다'],
        ['api', 'etcd', 's3cr3t', 'plain', '그대로 etcd에 쓴다', ['etcd', 's3cr3t', 'plain']],
        ['etcd', 'bak', 's3cr3t', 'plain', '백업 파일로 복사된다', ['bak', 's3cr3t', 'plain']],
        ['bak', 'who', 's3cr3t', 'plain', '백업만 있으면 읽힌다', ['who', '읽힘', 'plain']],
      ], stamp: ['백업만으로 읽힘', 'bad'] },
      { pill: 'KMS v2', tone: 'ok', note: 'KMS v2를 켜면 etcd와 백업에는 암호문만 있고, 푸는 키는 클러스터 밖 KMS에 있다.', steps: [
        ['user', 'api', 's3cr3t', 'plain', 'Secret을 만든다'],
        ['api', 'kms', 'DEK', 'info', '데이터 키(DEK)를 KMS로 감싼다'],
        ['kms', 'api', '감싼 DEK', 'enc', '감싼 키만 돌려받는다'],
        ['api', 'etcd', 'k8s:enc:kms:v2', 'enc', 'DEK로 암호화해 etcd에 쓴다', ['etcd', '암호문', 'enc']],
        ['etcd', 'bak', '암호문', 'enc', '백업 파일로 복사된다', ['bak', '암호문', 'enc']],
        ['bak', 'who', '암호문', 'enc', '키가 클러스터 밖이라 풀지 못한다', ['who', '못 읽음', 'enc']],
      ], stamp: ['백업만으로는 못 읽음', 'ok'] },
    ],
    demo: { modes: ['암호화 없음', 'KMS v2'], run: '백업 열어 보기' },
  });

  // When the secret turns into plaintext on the road git -> render -> cluster -> pod, one approach per scene.
  document.querySelectorAll('[data-figure="secret-management-timing"]').forEach((root) => {
    const SEC = 5, HOLD = 2.2, S = hwa.loopScenes(SEC, HOLD, 3), STAGES = ['git', '렌더링', '클러스터', '파드 시작'];
    const R = [
      { name: 'Sealed Secrets', short: 'Sealed', git: ['암호문', 'enc'], at: 2, stamp: ['클러스터에서 풀림', 'ok'], note: 'Sealed Secrets는 git에 암호문을 두고, 클러스터 안 컨트롤러가 받은 뒤에야 평문이 된다.' },
      { name: 'argocd-vault-plugin', short: 'AVP', git: ['참조', 'ref'], at: 1, stamp: ['렌더링부터 평문', 'bad'], note: 'AVP는 Argo CD가 매니페스트를 렌더링할 때 값을 채워, 그 뒤 모든 단계가 평문을 쥔다.' },
      { name: 'CSI 드라이버', git: ['참조', 'ref'], at: 3, stamp: ['파드 시작 때만 평문', 'ok'], note: 'CSI 드라이버는 파드가 시작할 때 값을 가져와 파드 안 파일로만 둔다.' },
    ];
    hwa.scene(root, {
      height: 248, still: S.at(2) + SEC + 1, scenes: S, notes: R.map((r) => r.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), run = (time % ((SEC + HOLD) * 3)) - S.at(i);
        const narrow = w < 480, lw = narrow ? 64 : 140, cw = (w - lw) / 4, cx = (c) => lw + cw * c + cw / 2, ry = (r) => 86 + r * 54;
        topBar(ctx, w, R[i].name, R[i].stamp[1], [['평문 구간', KIND.plain[2]]]);
        STAGES.forEach((s, c) => {
          C.text(ctx, s, cx(c), 52, { size: fitSize(ctx, s, cw - 4, 10.5, 600), weight: 600, color: U.text, align: 'center' });
          C.dashed(ctx, cx(c), 60, cx(c), ry(2) + 22, '#e5e7eb');
        });
        R.forEach((r, j) => {
          const y = ry(j), label = narrow && r.short ? r.short : r.name;
          ctx.globalAlpha = j > i ? 0.35 : 1;
          C.text(ctx, label, 0, y, { size: fitSize(ctx, label, lw - 6, 11, 600), weight: 600, color: j === i ? U.text : U.muted, base: 'middle' });
          C.line(ctx, [[cx(0), y], [cx(3), y]], '#e2e8f0', 6);
          // Travel 0..0.8 of the scene across four stages; past rows stay finished.
          const pos = j < i ? 3 : j > i ? 0 : clamp(t / (SEC * 0.8)) * 3, x = lw + cw / 2 + pos * cw;
          if (pos >= r.at) {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';
            ctx.beginPath(); ctx.roundRect(cx(r.at) - 4, y - 8, x - cx(r.at) + 8, 16, 8); ctx.fill();
          }
          STAGES.forEach((s, c) => {
            ctx.beginPath(); ctx.arc(cx(c), y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = c <= pos ? (c >= r.at ? KIND.plain[2] : KIND[r.git[1]][2]) : '#cbd5e1'; ctx.fill();
          });
          chip(ctx, pos >= r.at ? '평문' : r.git[0], x, y - 18, pos >= r.at ? 'plain' : r.git[1], w);
          ctx.globalAlpha = 1;
        });
        stamp(ctx, (cx(R[i].at) + cx(3)) / 2, ry(i) + 26, R[i].stamp[0], R[i].stamp[1], (run - SEC) / 0.4, w);
        say(`${R[i].name}. ${R[i].note}`);
      },
    });
  });

  // argocd-vault-plugin: the placeholder becomes the value inside repo-server, and the manifest is cached.
  flow('secret-management-avp', {
    cols: 4, rows: 2,
    nodes: { git: [0, 0, 'git', 'values.yaml'], helm: [1, 0, 'helm', 'template'], avp: [2, 0, 'AVP', 'generate'], asm: [3, 0, 'ASM', '시크릿 저장소'], redis: [2, 1, 'Redis', '캐시'], k8s: [3, 1, '클러스터', 'Secret'] },
    groups: [['Argo CD', 1, 0, 2, 1]],
    scenes: [{ pill: 'argocd-vault-plugin', tone: 'warn', note: '자리표시자는 repo-server 안에서 평문이 되고, 완성된 매니페스트는 Redis에 평문으로 캐시된다.', steps: [
      ['git', 'helm', '<path:...#key>', 'ref', '자리표시자가 든 values를 읽는다'],
      ['helm', 'avp', '<path:...#key>', 'ref', 'helm template 결과를 AVP에 넘긴다'],
      ['avp', 'asm', 'company/dev', 'ref', '경로로 ASM에 값을 묻는다'],
      ['asm', 'avp', 's3cr3t', 'plain', '평문 값을 받아 자리표시자를 바꾼다', ['avp', '평문', 'plain']],
      ['avp', 'redis', '매니페스트', 'plain', '완성된 매니페스트를 캐시한다', ['redis', '평문', 'plain']],
      ['redis', 'k8s', 's3cr3t', 'plain', '동기화로 Secret을 적용한다', ['k8s', '평문', 'plain']],
    ], stamp: ['Argo CD가 평문을 쥠', 'bad'] }],
  });

  // ESO: Argo CD syncs only the reference; values move between the operator and the store.
  flow('secret-management-eso', {
    cols: 4, rows: 2,
    nodes: { git: [0, 0, 'git', 'ExternalSecret'], argo: [1, 0, 'Argo CD', ''], eso: [2, 0, 'ESO', '컨트롤러'], store: [3, 0, 'ASM', '시크릿 저장소'], sec: [2, 1, 'Secret', ''], pod: [3, 1, '파드', ''] },
    scenes: [{ pill: 'External Secrets Operator', tone: 'ok', note: 'Argo CD는 참조만 동기화하고, 값은 ESO와 저장소 사이에서만 오간다.', steps: [
      ['git', 'argo', 'ExternalSecret', 'ref', 'git에는 참조만 둔다'],
      ['argo', 'eso', 'ExternalSecret', 'ref', 'Argo CD는 참조를 클러스터에 적용한다'],
      ['eso', 'store', 'company/dev', 'ref', 'ESO가 저장소에 값을 묻는다'],
      ['store', 'eso', 's3cr3t', 'plain', '평문 값을 받는다'],
      ['eso', 'sec', 's3cr3t', 'plain', '쿠버네티스 Secret을 만든다', ['sec', '평문', 'plain']],
      ['sec', 'pod', 's3cr3t', 'plain', '파드가 Secret을 읽는다'],
      ['eso', 'store', 'company/dev', 'ref', 'refreshInterval마다 다시 읽는다'],
    ], stamp: ['Argo CD는 참조만 봄', 'ok'] }],
  });

  // Group: timelines. One lane per place the value lives; block colour is the value it holds.
  // stale: the old value still held after the source has changed.
  {
    const FILL = { old: '#64748b', stale: '#f59e0b', new: U.blue, work: '#8b5cf6', gone: U.red }, LH = 46;
    const LEGEND = [['옛 값', FILL.old], ['밀린 값', FILL.stale], ['새 값', FILL.new]];
    const tl = (name, scenes, { SEC = 7, HOLD = 2, demo, legend = LEGEND } = {}) => document.querySelectorAll(`[data-figure="${name}"]`).forEach((root) => {
      const n = scenes.length, lanes = Math.max(...scenes.map((s) => s.lanes.length));
      hwa.scene(root, {
        height: 52 + lanes * LH + 30, still: (n - 1) * (SEC + HOLD) + SEC + 0.6,
        scenes: n > 1 && !demo ? hwa.loopScenes(SEC, HOLD, n) : undefined,
        notes: scenes.map((s) => s.say), demo,
        frame: (ctx, w, h, time, say, ui) => {
          const auto = hwa.loop(time, SEC, HOLD, n), i = demo ? ui.mode : auto.i, s = scenes[i];
          const run = demo ? (ui.runAt === null ? -1 : time - ui.runAt) : (time % ((SEC + HOLD) * n)) - auto.i * (SEC + HOLD), k = clamp(run / SEC), t = k * s.span;
          topBar(ctx, w, s.pill, s.tone, legend);
          const lw = Math.min(84, w * 0.22), x0 = lw, x1 = w - 8, top = 52, base = top + s.lanes.length * LH + 4;
          const X = (v) => x0 + (clamp(v, 0, s.span) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
          s.lanes.forEach((nm, j) => C.text(ctx, nm, 0, ly(j) + LH / 2, { size: fitSize(ctx, nm, lw - 6, 10, 600), weight: 600, color: U.text, base: 'middle' }));
          C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
          (s.ticks || []).forEach(([v, label]) => {
            if (t < v) return;
            C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
            C.text(ctx, label, X(v), base + 14, { size: 9, align: v >= s.span ? 'right' : 'center' });
          });
          s.segs.forEach(([j, a, b, kind, label]) => {
            if (t <= a) return;
            const y = ly(j) + 8, bx = X(a) + 1, bw = X(Math.min(t, b)) - bx - 1;
            if (bw <= 0) return;
            ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 16, Math.min(8, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
            if (label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 16) / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
          });
          s.events.forEach(([v, label, hot]) => {
            if (t < v) return;
            const x = X(v), lwid = tw(ctx, label, 10, 700), align = x - x0 < lwid / 2 + 2 ? 'left' : x1 - x < lwid / 2 ? 'right' : 'center';
            C.event(ctx, x, top + 2, base, label, hot ? U.red : U.slate, align);
          });
          if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
          if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, top + (base - top) / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
          if (demo && run < 0) C.text(ctx, `${demo.run} 버튼을 눌러 보자`, (x0 + x1) / 2, top + (base - top) / 2, { size: 12, align: 'center', base: 'middle' });
          say(`${s.pill}. ${s.say}`);
        },
      });
    });

    // Vault dynamic DB credentials: the account dies with its lease unless an agent renews it (TTL 1h example).
    const leaseTk = [[20, '20분'], [40, '40분'], [60, '60분'], [80, '80분']];
    tl('secret-management-lease', [
      { pill: '한 번 읽고 끝', tone: 'bad', span: 80, lanes: ['Vault 리스', 'DB 계정', '앱 접속'], ticks: leaseTk, events: [[60, 'TTL 만료', true]],
        segs: [[0, 0, 60, 'old', 'TTL 1h'], [1, 0, 60, 'old', 'v-app-x7k2'], [1, 60, 80, 'gone', '삭제'], [2, 0, 60, 'old', '접속'], [2, 60, 80, 'gone', '실패']],
        stamp: ['만료와 함께 접속 끊김', 'bad'], say: '리스가 끝나면 Vault가 DB 계정을 지워서, 한 번 읽은 값을 계속 쓰는 앱은 접속이 끊긴다.' },
      { pill: 'Vault Agent', tone: 'ok', span: 80, lanes: ['Vault 리스', 'DB 계정', '앱 접속'], ticks: leaseTk, events: [[40, 'TTL 2/3에서 갱신']],
        segs: [[0, 0, 40, 'old', 'TTL 1h'], [0, 40, 80, 'new', '연장'], [1, 0, 80, 'old', 'v-app-x7k2'], [2, 0, 80, 'old', '접속']],
        stamp: ['리스 연장, 계정 유지', 'ok'], say: 'Vault Agent는 TTL의 2/3가 지나면 리스를 연장해서, 계정과 접속이 끊기지 않는다.' },
    ], { legend: [['발급된 계정', FILL.old], ['연장된 리스', FILL.new], ['폐기', FILL.gone]] });

    // Demo: rotation polls Key Vault every 2 minutes; a file reader sees it, an env var waits for a restart.
    const kv = [[0, 0, 40, 'old', 'v1'], [0, 40, 240, 'new', 'v2']], polled = (j) => [[j, 0, 40, 'old', 'v1'], [j, 40, 120, 'stale', 'v1'], [j, 120, 240, 'new', 'v2']];
    const tk = [[60, '1분'], [120, '2분'], [180, '3분'], [240, '4분']], lanes = ['Key Vault', '파일, Secret', '앱이 읽는 값'];
    tl('secret-management-rotation', [
      { pill: '파일로 읽기', tone: 'ok', span: 240, lanes, ticks: tk, events: [[40, '값 변경'], [120, '폴링']],
        segs: [...kv, ...polled(1), ...polled(2)],
        stamp: ['2분 안에 반영', 'ok'], say: '2분마다 폴링해 파일이 바뀌고, 파일을 다시 읽는 앱은 바로 새 값을 쓴다.' },
      { pill: '환경 변수로 읽기', tone: 'warn', span: 240, lanes, ticks: tk, events: [[40, '값 변경'], [120, '폴링'], [200, '재시작', true]],
        segs: [...kv, ...polled(1), [2, 0, 40, 'old', 'v1'], [2, 40, 200, 'stale', 'v1'], [2, 200, 240, 'new', 'v2']],
        stamp: ['재시작 전까지 v1', 'warn'], say: 'Secret은 2분 뒤 바뀌지만 환경 변수는 파드가 시작할 때 정해져서, 재시작 전까지 옛 값이다.' },
    ], { demo: { modes: ['파일로 읽기', '환경 변수로 읽기'], run: 'Key Vault 값 바꾸기' } });
  }
})();
