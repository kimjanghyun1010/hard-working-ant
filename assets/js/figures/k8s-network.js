// Kubernetes network post: pod network, Service and kube-proxy, cluster DNS, external entry, Cilium.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const along = (pts, k) => C.pathAt(pts, k).slice(-1)[0];
  const tw = (ctx, s, size = 10, weight = 600) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const mid = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], GREEN = ['#dcfce7', '#15803d', '#86efac'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'];
  const RED = ['#fee2e2', '#dc2626', '#fca5a5'], PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], MUTE = [U.cell, U.muted, '#e2e8f0'];
  const LINK = '#cbd5e1';
  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  // Fraction of the path length reached at each point, to light a box when a moving dot gets there.
  const reach = (pts) => {
    const d = [0];
    for (let j = 1; j < pts.length; j++) d.push(d[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
    return d.map((v) => v / (d[d.length - 1] || 1));
  };
  // Chip centred at (x, y), kept inside 0..maxX when given. col = [bg, fg, line].
  const tag = (ctx, s, x, y, col, { a = 1, size = 10, maxX } = {}) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, size) + 14;
    if (maxX) x = Math.max(cw / 2, Math.min(maxX - cw / 2, x));
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x - cw / 2, y - 9, cw, 18, 5);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x, y + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  const dot = (ctx, p, color = U.blue, r = 5, a = 1) => {
    if (a <= 0) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const link = (ctx, pts, color = LINK, width = 1) => C.line(ctx, pts, color, width);
  const on = (id, fn) => document.querySelectorAll(`[data-figure="k8s-network-${id}"]`).forEach(fn);

  // Pod to pod: same node through the node kernel, other node across the node network; addresses never change.
  on('pod-to-pod', (root) => {
    const LENS = [4.6, 6], S = seq(LENS, 1.8);
    const IPS = [['10.244.1.5', '10.244.1.6'], ['10.244.2.7', '10.244.2.8']];
    const notes = [
      '같은 노드면 파드 A의 패킷이 veth를 지나 노드 커널에서 바로 파드 B로 간다.',
      '다른 노드면 노드 네트워크를 건너 노드 2의 파드 C에 닿는다. 출발과 도착 주소는 그대로다.',
    ];
    hwa.scene(root, {
      height: 272, still: S.at(1) + LENS[1] + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), narrow = w < 480, gap = 16, gw = (w - gap) / 2;
        const gx = [0, gw + gap], pw = (gw - 24) / 2, PY = 58, KY = 130, EY = 186;
        const P = (j, m) => ({ x: gx[j] + 8 + m * (pw + 8), y: PY, w: pw, h: 44, t: `파드 ${'ABCD'[j * 2 + m]}`, s: IPS[j][m] });
        const nc = (j) => gx[j] + gw / 2;
        C.pill(ctx, 0, 0, i ? '다른 노드' : '같은 노드', 'info');
        [0, 1].forEach((j) => {
          C.group(ctx, gx[j], 32, gw, 204, narrow ? `노드 ${j + 1}` : `노드 ${j + 1}  192.168.0.1${j + 1}`);
          [0, 1].forEach((m) => link(ctx, [[mid(P(j, m))[0], PY + 44], [mid(P(j, m))[0], KY]]));
          link(ctx, [[nc(j), KY + 36], [nc(j), EY]]);
        });
        link(ctx, [[nc(0) + 28, EY + 15], [nc(1) - 28, EY + 15]]);
        if (!narrow) C.text(ctx, 'veth', mid(P(0, 0))[0] + 5, KY - 8, { size: 9 });
        const k = ease(t, 0.5, LENS[i] - 0.7), A = mid(P(0, 0))[0], B = mid(P(0, 1))[0], Cx = mid(P(1, 0))[0], ky = KY + 18;
        const pts = i === 0
          ? [[A, PY + 44], [A, ky], [B, ky], [B, PY + 44]]
          : [[A, PY + 44], [A, ky], [nc(0), ky], [nc(0), EY + 15], [nc(1), EY + 15], [nc(1), ky], [Cx, ky], [Cx, PY + 44]];
        [0, 1].forEach((j) => {
          C.card(ctx, { x: gx[j] + 8, y: KY, w: gw - 16, h: 36, t: '커널 라우팅', size: 11 });
          C.card(ctx, { x: nc(j) - 28, y: EY, w: 56, h: 30, t: 'eth0', size: 11 });
          [0, 1].forEach((m) => C.card(ctx, P(j, m), { lit: k >= 1 && j === i && m === 1 - i }));
        });
        if (k > 0 && k < 1) dot(ctx, along(pts, k));
        tag(ctx, `${IPS[0][0]} → ${i ? IPS[1][0] : IPS[0][1]}`, w / 2, 254, k >= 1 ? GREEN : BLUE);
        C.stamp(ctx, w / 2, 116, 'NAT 없이 도착', 'ok', i === 1 ? (run - LENS[1]) / 0.4 : 0);
        say(notes[i]);
      },
    });
  });

  // kube-proxy writes nat rules; a new connection walks KUBE-SERVICES, a random KUBE-SVC branch, then DNAT in KUBE-SEP.
  on('iptables', (root) => {
    const LENS = [5.4, 6, 6], S = seq(LENS, 1.8);
    const COLS = [['KUBE-SERVICES', 'SERVICES', ['10.96.0.10:53', '10.96.0.20:80', '…']], ['KUBE-SVC-API', 'SVC-API', ['1/3 확률', '1/2 확률', '나머지']], ['KUBE-SEP', 'SEP', ['10.244.1.5', '10.244.2.7', '10.244.2.8']]];
    const notes = [
      'kube-proxy가 EndpointSlice를 보고 nat 테이블에 Service마다, 엔드포인트마다 규칙을 깐다.',
      '새 연결의 첫 패킷이 KUBE-SERVICES에서 자기 Service 줄을 찾고, 확률 갈래를 지나 DNAT된다.',
      '다음 연결은 다른 갈래로 갈 수 있다. 같은 연결의 뒤 패킷은 conntrack이 기억한 파드로 간다.',
    ];
    hwa.scene(root, {
      height: 296, still: S.at(1) + LENS[1] + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), narrow = w < 480;
        C.pill(ctx, 0, 0, ['규칙 설치', '첫 연결', '새 연결'][i], 'info');
        C.group(ctx, 0, 32, w, 58, '');
        C.text(ctx, '사용자 공간', 10, 65, { size: 10, weight: 600 });
        const cx0 = narrow ? 74 : 110, cwid = (w - cx0 - 18) / 2;
        const kp = { x: cx0 + cwid + 8, y: 44, w: cwid, h: 34, t: 'kube-proxy', size: 11 };
        C.card(ctx, { x: cx0, y: 44, w: cwid, h: 34, t: 'API 서버', size: 11 });
        C.card(ctx, kp, { lit: i === 0 && t > 0.4 && t < 4 });
        C.group(ctx, 0, 100, w, 156, narrow ? 'nat 테이블' : '커널 netfilter nat 테이블', 118);
        C.arrow(ctx, [[kp.x + kp.w / 2, 80], [kp.x + kp.w / 2, 112]], i === 0 ? ease(t, 0.4, 1.0) : 1, i === 0 ? U.accent : LINK);
        const colW = (w - 36) / 3, colX = (c) => 8 + c * (colW + 10), cm = (c) => colX(c) + colW / 2, ry = (rr) => 159 + rr * 34;
        const pick = i === 2 ? 0 : 1, k = i === 0 ? 0 : ease(t, 0.6, 4.2);
        const pts = [[2, ry(0)], [cm(0), ry(0)], [cm(0), ry(1)], [cm(1), ry(0)], [cm(1), ry(pick)], [cm(2), ry(pick)]], f = reach(pts);
        COLS.forEach(([long, short, rows], c) => {
          C.text(ctx, narrow ? short : long, cm(c), 138, { size: 10, weight: 700, color: U.text, align: 'center' });
          rows.forEach((s, rr) => {
            const a = i === 0 ? ease(t, 1.0 + (c * 3 + rr) * 0.3, 1.4 + (c * 3 + rr) * 0.3) : 1;
            if (a <= 0) return;
            const lit = i > 0 && ((c === 0 && rr === 1 && k >= f[2]) || (c === 1 && rr === pick && k >= f[4]) || (c === 2 && rr === pick && k >= 1));
            ctx.globalAlpha = a;
            C.box(ctx, colX(c), ry(rr) - 13, colW, 26, { fill: lit ? (c === 2 ? GREEN[0] : U.accentSoft) : '#fff', stroke: lit ? (c === 2 ? GREEN[2] : U.accentLine) : U.grid, r: 6 });
            C.text(ctx, (c === 2 && !narrow ? 'DNAT ' : '') + s, cm(c), ry(rr) + 0.5, { size: narrow ? 9 : 10, weight: 600, color: lit ? U.text : U.muted, align: 'center', base: 'middle' });
            ctx.globalAlpha = 1;
          });
        });
        if (k > 0 && k < 1) dot(ctx, along(pts, k));
        const dst = COLS[2][2][pick];
        if (i === 0) tag(ctx, 'EndpointSlice: 파드 3개', w / 2, 276, PURPLE);
        else tag(ctx, k >= 1 ? `목적지 ${dst}:8080` : '목적지 10.96.0.20:80', w / 2, 276, k >= 1 ? GREEN : BLUE);
        if (i) C.stamp(ctx, w / 2, 276, i === 1 ? `DNAT → ${dst}` : `새 연결은 ${dst}로`, i === 1 ? 'ok' : 'info', (run - LENS[i]) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Service types stack: NodePort adds a node port on top of ClusterIP, LoadBalancer adds an external IP on top of both.
  on('svc-types', (root) => {
    const LENS = [4.8, 5.4, 6], S = seq(LENS, 1.8), TYPES = ['ClusterIP', 'NodePort', 'LoadBalancer'];
    const notes = [
      'ClusterIP는 클러스터 안의 파드만 부를 수 있는 가상 IP다.',
      'NodePort는 모든 노드의 같은 포트를 열고, 받은 요청을 그 밑의 ClusterIP로 넘긴다.',
      'LoadBalancer는 외부 IP를 하나 붙이고, 그 밑에 NodePort와 ClusterIP가 그대로 깔린다.',
    ];
    const BAR = [[3, 'ClusterIP', BLUE], [2, 'NodePort', PURPLE], [1, 'LoadBalancer', ORANGE]];
    hwa.scene(root, {
      height: 214, still: S.at(2) + LENS[2] + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = S.pos(time), narrow = w < 480, g = narrow ? 8 : 16, ow = narrow ? 46 : 72, cw = (w - ow - 4 * g) / 4;
        const X = [0, 1, 2, 3, 4].map((c) => (c ? ow + g + (c - 1) * (cw + g) : 0)), W = [ow, cw, cw, cw, cw], CY = 64, CH = 48, LY = CY + CH / 2;
        C.pill(ctx, 0, 0, TYPES[i], 'info');
        C.text(ctx, ['ClusterIP', 'NodePort + ClusterIP', 'LB + NodePort + ClusterIP'][i], w, 11, { size: 10, align: 'right', base: 'middle' });
        C.box(ctx, X[2] - g / 2, 34, w - X[2] + g / 2, h - 36, { fill: U.plot, r: 10 });
        C.text(ctx, '클러스터', X[2] - g / 2 + 8, 50, { size: 10, weight: 600 });
        const cards = [
          { t: '사용자', s: '밖', size: 11 },
          { t: 'LB', s: narrow ? '외부 IP' : '203.0.113.10' },
          i ? { t: '노드', s: ':31080' } : { t: '파드', s: '클러스터 안', size: 11 },
          { t: 'ClusterIP', s: '10.96.0.20', size: 11 },
        ];
        const act = [i > 0, i > 1, true, true], first = act.indexOf(true), litC = [3, 2, 1][i];
        const pods = [{ x: X[4], y: 56, w: cw, h: 30, t: '파드', size: 11 }, { x: X[4], y: 94, w: cw, h: 30, t: '파드', size: 11 }];
        for (let c = first; c < 3; c++) link(ctx, [[X[c] + W[c], LY], [X[c + 1], LY]]);
        pods.forEach((p) => link(ctx, [[X[3] + cw, LY], [p.x, p.y + 15]]));
        cards.forEach((b, c) => {
          const box = { x: X[c], y: CY, w: W[c], h: CH, ...b };
          if (act[c]) C.card(ctx, box, { lit: c === litC && t > 0.3 });
          else C.box(ctx, box.x, box.y, box.w, box.h, { fill: '#fff', dash: [3, 3] });
        });
        pods.forEach((p) => C.card(ctx, p));
        BAR.slice(0, i + 1).forEach(([a, s, col], j) => {
          const y = 136 + j * 22, x0 = X[a], x1 = X[3] + cw;
          ctx.globalAlpha = j === i ? ease(t, 0.1, 0.7) : 1;
          C.box(ctx, x0, y, x1 - x0, 16, { fill: col[0], stroke: col[2], r: 5 });
          C.text(ctx, s, (x0 + x1) / 2, y + 8.5, { size: 9, weight: 700, color: col[1], align: 'center', base: 'middle' });
          ctx.globalAlpha = 1;
        });
        const path = [first ? [X[first] + W[first], LY] : [ow, LY]];
        for (let c = first + 1; c < 4; c++) path.push([X[c], LY], [X[c] + W[c], LY]);
        [0, 1, 2].forEach((d) => {
          const k = (t - 0.4 - d * 1.3) / 1.8;
          if (k > 0 && k < 1) dot(ctx, along([...path, [pods[d % 2].x, pods[d % 2].y + 15]], k), U.blue, 4.5);
        });
        say(`${TYPES[i]}. ${notes[i]}`);
      },
    });
  });

  // Demo: one external name under ndots:5 and ndots:2. Each name sends A and AAAA queries; the log shows what came back.
  on('ndots', (root) => {
    const NAME = 'api.example.com', ROWS = [[...['shop.svc.cluster.local', 'svc.cluster.local', 'cluster.local'].map((s) => `${NAME}.${s}`), NAME], [NAME]];
    const GAP = 1.0, LY = 124, RH = 28;
    const notes = [
      'ndots:5에서는 점이 2개뿐인 api.example.com에 search 세 개를 먼저 붙여 본다. A와 AAAA를 같이 물어 질의 8번 중 6번이 헛걸음이다.',
      'ndots:2면 점이 2개인 이름을 그대로 먼저 묻는다. 질의 2번에 끝난다.',
    ];
    hwa.scene(root, {
      height: 276, still: 6, notes, demo: { modes: ['ndots:5 (기본)', 'ndots:2'], run: 'api.example.com 조회' },
      frame: (ctx, w, h, time, say, ui) => {
        const narrow = w < 480, rows = ROWS[ui.mode], r = ui.runAt === null ? -1 : time - ui.runAt;
        const sent = r < 0 ? 0 : Math.min(rows.length, Math.floor(r / GAP) + 1), n = sent * 2, end = rows.length * GAP + 0.2;
        const pw = narrow ? 96 : 160, cw = narrow ? 92 : 130;
        C.pill(ctx, 0, 0, r < 0 ? '조회 전' : `질의 ${n}번`, n > 2 ? 'bad' : 'info');
        ctx.font = U.font(10);
        C.legend(ctx, w - 24 - ctx.measureText('응답 없음').width - 24, 11, [['응답', '#22c55e'], ['없음', U.red]]);
        link(ctx, [[pw, 56], [w - cw, 56]]);
        C.card(ctx, { x: 0, y: 34, w: pw, h: 44, t: '파드', s: `ndots:${ui.mode ? 2 : 5}` });
        C.card(ctx, { x: w - cw, y: 34, w: cw, h: 44, t: 'CoreDNS' });
        const cur = Math.floor(r / GAP);
        if (r >= 0 && cur < rows.length) {
          const u = r - cur * GAP, last = cur === rows.length - 1, out = [[pw, 56], [w - cw, 56]];
          if (u < 0.5) [-4, 4].forEach((dy) => dot(ctx, along(out.map(([x, y]) => [x, y + dy]), ease(u, 0, 0.45)), U.blue, 4));
          else if (u < 0.95) [-4, 4].forEach((dy) => dot(ctx, along(out.slice().reverse().map(([x, y]) => [x, y + dy]), ease(u, 0.5, 0.9)), last ? '#16a34a' : U.red, 4));
        }
        C.text(ctx, '질의 로그', 0, 102, { size: 10, weight: 700, color: U.text });
        rows.forEach((name, j) => {
          if (j >= sent) return;
          const u = r - j * GAP, y = LY + j * RH, ok = j === rows.length - 1, col = u < 0.9 ? MUTE : ok ? GREEN : RED;
          ctx.globalAlpha = ease(u, 0, 0.2);
          C.box(ctx, 0, y - 12, w, 24, { fill: U.plot, r: 6 });
          C.text(ctx, name, 8, y + 0.5, { size: narrow ? 9 : 10, weight: 600, color: U.text, base: 'middle' });
          ctx.globalAlpha = 1;
          tag(ctx, 'A', w - 58, y, col, { size: 9, a: ease(u, 0, 0.2) });
          tag(ctx, 'AAAA', w - 24, y, col, { size: 9, a: ease(u, 0, 0.2) });
        });
        if (r < 0) C.text(ctx, '조회 버튼을 눌러 보자', w / 2, 170, { size: 12, align: 'center', base: 'middle' });
        C.stamp(ctx, w / 2, 256, ui.mode ? '질의 2번에 끝' : '8번 중 6번 헛걸음', ui.mode ? 'ok' : 'bad', (r - end) / 0.4);
        say(`ndots:${ui.mode ? 2 : 5}. 질의 ${n}번. ${notes[ui.mode]}`);
      },
    });
  });

  // Rules compared per new connection as Services grow: iptables scans KUBE-SERVICES, eBPF does one map lookup.
  on('ebpf', (root) => {
    const SEC = 6, HOLD = 2.4, MAX = 10000;
    hwa.scene(root, {
      height: 250, still: SEC + 1,
      frame: (ctx, w, h, time, say) => {
        const { k } = hwa.loop(time, SEC, HOLD, 1), run = time % (SEC + HOLD), N = MAX * k;
        C.pill(ctx, 0, 0, `Service ${fmt(N)}개`, N > 5000 ? 'warn' : 'info');
        ctx.font = U.font(10);
        C.legend(ctx, w - ctx.measureText('iptables eBPF').width - 48, 11, [['iptables', U.red], ['eBPF', U.blue]]);
        const x0 = 42, x1 = w - 64, y0 = 54, H = 158, X = (v) => x0 + (v / MAX) * (x1 - x0);
        const Y = C.panel(ctx, x0, y0, x1 - x0, H, { title: '새 연결 하나가 비교하는 규칙 수', max: 5000, ticks: [[0, '0'], [2500, '2,500'], [5000, '5,000']] });
        [[0, '0'], [5000, '5천'], [10000, '1만']].forEach(([v, s]) => C.text(ctx, s, X(v), y0 + H + 15, { size: 10, align: v ? (v === MAX ? 'right' : 'center') : 'left' }));
        C.text(ctx, 'Service 수', x1, y0 + H + 30, { size: 10, align: 'right' });
        const xs = Array.from({ length: 41 }, (_, j) => (N * j) / 40);
        C.line(ctx, xs.map((v) => [X(v), Y(v / 2)]), U.red);
        C.line(ctx, xs.map((v) => [X(v), Y(1)]), U.blue);
        const yr = Y(N / 2), yb = Y(1);
        C.dot(ctx, X(N), yr, U.red, `${fmt(N / 2)}번`, Math.min(yr, yb - 14));
        C.dot(ctx, X(N), yb, U.blue, '1번');
        C.stamp(ctx, (x0 + x1) / 2, Y(3600), '5,000번 대 1번', 'info', (run - SEC) / 0.4);
        say(`Service ${fmt(N)}개. iptables는 평균 ${fmt(N / 2)}줄을 훑고, eBPF는 맵을 한 번 찾는다.`);
      },
    });
  });

  // Demo: an external request lands on node 1 and the pod runs on node 2. SNAT hides the client; DSR keeps it and replies directly.
  on('dsr', (root) => {
    const REQ = 2.0, BACK = 1.8, DONE = REQ + 0.3 + BACK;
    const notes = [
      'SNAT에서는 노드 1이 출발 주소를 자기 IP로 바꿔 넘긴다. 파드는 노드 1의 IP만 보고, 응답도 노드 1을 거쳐 돌아간다.',
      'DSR에서는 출발 주소를 그대로 두고 Service IP를 IP 옵션에 실어 넘긴다. 파드는 클라이언트 IP를 보고, 응답은 노드 2에서 바로 나간다.',
    ];
    hwa.scene(root, {
      height: 272, still: 6, notes, demo: { modes: ['SNAT (Cluster)', 'DSR'], run: '요청 보내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const narrow = w < 480, dsr = ui.mode === 1, r = ui.runAt === null ? -1 : time - ui.runAt;
        const cw = narrow ? 70 : 100, g = narrow ? 12 : 30, rest = w - cw - 2 * g, n1w = Math.round(rest * 0.42), n2w = rest - n1w;
        const n1x = cw + g, n2x = n1x + n1w + g, LY = 126, pcx = n2x + n2w / 2;
        C.pill(ctx, 0, 0, dsr ? 'DSR' : 'SNAT', 'info');
        C.text(ctx, dsr ? '응답: 노드 2 → 클라이언트' : '응답: 노드 2 → 노드 1 → 클라이언트', w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        C.group(ctx, n1x, 40, n1w, 160, '노드 1');
        C.group(ctx, n2x, 40, n2w, 160, '노드 2');
        const req = [[cw, LY], [n1x + 8, LY], [n1x + n1w - 8, LY], [n2x + 8, LY], [pcx, LY], [pcx, 152]], fq = reach(req);
        const back = dsr ? [[pcx, 192], [pcx, 222], [cw / 2, 222], [cw / 2, LY + 26]] : [[pcx, 152], [pcx, LY + 12], [n2x + 8, LY + 12], [n1x + n1w - 8, LY + 12], [n1x + 8, LY + 12], [cw, LY + 12]];
        link(ctx, [[cw, LY], [n1x + 8, LY]]);
        link(ctx, [[n1x + n1w - 8, LY], [n2x + 8, LY]]);
        if (dsr) C.line(ctx, back, LINK, 1);
        const kq = r < 0 ? 0 : Math.min(1, r / REQ), kb = r < 0 ? 0 : Math.min(1, (r - REQ - 0.3) / BACK);
        C.card(ctx, { x: 0, y: LY - 26, w: cw, h: 52, t: narrow ? '사용자' : '클라이언트', s: '203.0.113.7' }, { lit: kb >= 1 });
        C.card(ctx, { x: n1x + 8, y: LY - 22, w: n1w - 16, h: 44, t: 'Cilium', s: 'LB IP 받음' }, { lit: kq > fq[1] && kq < fq[3] });
        C.card(ctx, { x: n2x + 8, y: LY - 22, w: n2w - 16, h: 44, t: 'Cilium' });
        C.card(ctx, { x: n2x + 8, y: 152, w: n2w - 16, h: 40, t: '파드', s: '10.244.2.7' }, { lit: kq >= 1 && kb <= 0 });
        if (kq > 0 && kq < 1) {
          const p = along(req, kq), moved = kq >= fq[2], src = moved && !dsr ? 'src 192.168.0.11' : 'src 203.0.113.7';
          dot(ctx, p, U.blue);
          tag(ctx, src, p[0], p[1] - 22, moved && !dsr ? ORANGE : BLUE, { size: 9, maxX: w });
          if (moved && dsr) tag(ctx, 'IP 옵션: LB IP', p[0], p[1] + 20, PURPLE, { size: 9, maxX: w });
        }
        if (kq >= 1) tag(ctx, dsr ? '본 IP 203.0.113.7' : '본 IP 192.168.0.11', pcx, 82, dsr ? GREEN : RED, { maxX: w });
        if (kb > 0 && kb < 1) dot(ctx, along(back, kb), '#16a34a');
        if (r < 0) C.text(ctx, '요청 보내기 버튼을 눌러 보자', w / 2, 250, { size: 12, align: 'center', base: 'middle' });
        C.stamp(ctx, w / 2, 250, dsr ? '클라이언트 IP 그대로' : '파드는 노드 1 IP만 봄', dsr ? 'ok' : 'bad', (r - DONE - 0.2) / 0.4);
        say(`${dsr ? 'DSR' : 'SNAT'}. ${notes[ui.mode]}`);
      },
    });
  });

  // BGP: nodes peer with two routers, advertise the LB pool, then receive the traffic the routers send them.
  on('bgp', (root) => {
    const LENS = [5, 5.6, 6], S = seq(LENS, 1.8);
    const notes = [
      'Cilium이 BGP를 켠 노드마다 라우터와 TCP 179로 세션(피어)을 맺는다.',
      '노드가 LB IP 풀 203.0.113.0/27을 광고하면, 라우터가 그 대역으로 가는 길을 노드 둘로 배운다.',
      '사용자가 LB IP로 보낸 요청을 라우터가 배운 두 경로로 나눠 보낸다(ECMP를 켠 경우).',
    ];
    hwa.scene(root, {
      height: 250, still: S.at(2) + LENS[2] + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), narrow = w < 480;
        const cw = narrow ? 54 : 84, rw = narrow ? 90 : 130, ww = narrow ? 100 : 150, rx = cw + (narrow ? 14 : 44), wx = w - ww, RY = [50, 148], H = 52;
        C.pill(ctx, 0, 0, ['BGP 피어', '대역 광고', '트래픽'][i], 'info');
        C.text(ctx, narrow ? 'LB 풀 /27' : 'LB 풀 203.0.113.0/27', w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        const peer = (a, b) => [[wx, RY[b] + H / 2], [rx + rw, RY[a] + H / 2]];
        RY.forEach((y) => link(ctx, [[cw, 124], [rx, y + H / 2]]));
        [0, 1].forEach((a) => [0, 1].forEach((b) => {
          const idx = a * 2 + b, up = i ? 1 : ease(t, 0.6 + idx * 0.8, 1.1 + idx * 0.8);
          C.dashed(ctx, ...peer(a, b)[0], ...peer(a, b)[1], LINK);
          if (up > 0) { ctx.globalAlpha = up; C.line(ctx, peer(a, b), PURPLE[2], 1.5); ctx.globalAlpha = 1; }
        }));
        C.text(ctx, 'TCP 179', (rx + rw + wx) / 2, RY[0] + H / 2 - 8,{ size: 9, weight: 600, color: PURPLE[1], align: 'center' });
        const learned = i === 2 || (i === 1 && t > 3.6);
        RY.forEach((y, a) => C.card(ctx, { x: rx, y, w: rw, h: H, t: `라우터 ${a + 1}`, s: learned ? '/27 경로 2개' : 'AS 64513' }, { lit: i === 1 && learned }));
        RY.forEach((y, b) => C.card(ctx, { x: wx, y, w: ww, h: H, t: `worker ${b + 1}`, s: 'Cilium AS 64512' }, { lit: i === 2 && t > 1.2 }));
        C.card(ctx, { x: 0, y: 98, w: cw, h: 52, t: '사용자', size: 11 });
        if (i === 1) [0, 1].forEach((a) => [0, 1].forEach((b) => {
          const idx = a * 2 + b, k = ease(t, 0.5 + idx * 0.4, 2.3 + idx * 0.4);
          if (k > 0 && k < 1) tag(ctx, narrow ? '/27' : '203.0.113.0/27', ...along(peer(a, b), k), PURPLE, { size: 9 });
        }));
        if (i === 2) for (let q = 0; q < 10; q++) {
          const k = (t - 0.3 - q * 0.5) / 1.6, a = q % 2, b = (q >> 1) % 2;
          if (k > 0 && k < 1) dot(ctx, along([[cw, 124], [rx, RY[a] + H / 2], [rx + rw, RY[a] + H / 2], [wx, RY[b] + H / 2]], k), U.blue, 4.5);
        }
        if (i) C.stamp(ctx, w / 2, 228, i === 1 ? '라우터가 LB 대역을 배움' : '두 노드로 나눠 들어옴', i === 1 ? 'info' : 'ok', (run - LENS[i]) / 0.4);
        say(notes[i]);
      },
    });
  });
})();
