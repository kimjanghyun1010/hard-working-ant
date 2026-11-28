// Kubernetes architecture post: request flow, API server, etcd quorum, scheduler, pod, reconcile loop, operator.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], GREEN = ['#dcfce7', '#15803d', '#86efac'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'];
  const RED = ['#fee2e2', '#dc2626', '#fca5a5'], PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], GRAY = [U.cell, U.muted, '#e2e8f0'];
  const LINE = '#cbd5e1';
  const each = (id, fn) => document.querySelectorAll(`[data-figure="k8s-architecture-${id}"]`).forEach(fn);
  // Chip centred at (x, y). col = [bg, fg, line].
  const tag = (ctx, s, x, y, col, { w, a = 1, size = 10, dash, h = 18 } = {}) => {
    if (a <= 0) return 0;
    const cw = w || tw(ctx, s, size, 600) + 14;
    ctx.save();
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x - cw / 2 + 0.5, y - h / 2 + 0.5, cw - 1, h - 1, 5);
    ctx.fillStyle = col[0];
    ctx.fill();
    if (dash) ctx.setLineDash(dash);
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    C.text(ctx, s, x, y + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.restore();
    return cw;
  };
  const dot = (ctx, [x, y], color = U.blue, r = 4.5) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = color; ctx.fill(); };
  const at = (pts, k) => C.pathAt(pts, k).pop();
  const legs = (p) => p.slice(1).map((q, k) => Math.hypot(q[0] - p[k][0], q[1] - p[k][1]));
  const legMid = (p, s) => { const L = legs(p); return (L.slice(0, s).reduce((a, b) => a + b, 0) + L[s] / 2) / L.reduce((a, b) => a + b, 0); };
  const fade = (ctx, a, draw) => { if (a <= 0) return; ctx.save(); ctx.globalAlpha = Math.min(1, a); draw(); ctx.restore(); };
  // Box with a name and a second line, both colourable; col = [bg, fg, line].
  const unit = (ctx, b, name, sub, { col = ['#fff', U.text, U.grid], dash, lit, size = 11, subSize = 10, subColor = U.muted } = {}) => {
    C.box(ctx, b.x, b.y, b.w, b.h, { fill: col[0], stroke: lit ? U.accent : col[2], dash, r: 7 });
    if (lit) { ctx.beginPath(); ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 7); ctx.strokeStyle = U.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    const cy = b.y + b.h / 2;
    C.text(ctx, name, b.x + b.w / 2, sub ? cy - 7 : cy, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    if (sub) C.text(ctx, sub, b.x + b.w / 2, cy + 9, { size: subSize, color: subColor, align: 'center', base: 'middle' });
  };
  const hint = (ctx, w, y, s) => C.text(ctx, `${s} 버튼을 눌러 보자`, w / 2, y, { size: 12, align: 'center', base: 'middle' });

  // Cluster map shared by the first two figures: kubectl, control plane, two worker nodes.
  const clusterMap = (ctx, w, y0, { show = () => 1, lit = new Set(), pods = [] } = {}) => {
    const kw = w < 480 ? 52 : 72, gx = kw + 12, gw = w - gx, aw = Math.min(130, gw * 0.36), B = {};
    B.kubectl = { x: 0, y: y0 + 46, w: kw, h: 40, t: 'kubectl', size: 11 };
    B.api = { x: gx + 10, y: y0 + 24, w: aw, h: 92, t: 'API 서버' };
    const rx = B.api.x + aw + 30, rw = gx + gw - 10 - rx;
    [['etcd', 'etcd'], ['sched', '스케줄러'], ['cm', '컨트롤러 매니저']].forEach(([k, t], j) => { B[k] = { x: rx, y: y0 + 24 + j * 32, w: rw, h: 28, t, size: 11 }; });
    const ny = y0 + 166, nw = (w - 10) / 2, ns = w < 420 ? 10 : 11;
    [0, 1].forEach((j) => {
      const x = j * (nw + 10), half = (nw - 22) / 2;
      B[`node${j}`] = { x, y: ny, w: nw, h: 124 };
      B[`kubelet${j}`] = { x: x + 8, y: ny + 26, w: half, h: 30, t: 'kubelet', size: ns };
      B[`proxy${j}`] = { x: x + 14 + half, y: ny + 26, w: half, h: 30, t: 'kube-proxy', size: ns };
      B[`rt${j}`] = { x: x + 8, y: ny + 62, w: nw - 16, h: 26, t: '컨테이너 런타임', size: ns };
    });
    fade(ctx, show('kubectl'), () => C.card(ctx, B.kubectl, { lit: lit.has('kubectl') }));
    fade(ctx, show('cp'), () => C.group(ctx, gx, y0, gw, 126, '컨트롤 플레인'));
    ['api', 'etcd', 'sched', 'cm'].forEach((k) => fade(ctx, show(k), () => C.card(ctx, B[k], { lit: lit.has(k), fill: k === 'api' ? U.accentSoft : '#fff', stroke: k === 'api' ? U.accentLine : U.grid })));
    [0, 1].forEach((j) => fade(ctx, show(`node${j}`), () => {
      const N = B[`node${j}`];
      C.group(ctx, N.x, N.y, N.w, N.h, `워커 노드 ${j + 1}`);
      ['kubelet', 'proxy', 'rt'].forEach((k) => C.card(ctx, B[`${k}${j}`], { lit: lit.has(`${k}${j}`) }));
    }));
    pods.forEach(([j, slot, s, col, opt]) => {
      const N = B[`node${j}`], pw = Math.min(54, (N.w - 28) / 3);
      fade(ctx, show(`node${j}`), () => tag(ctx, s, N.x + 8 + pw / 2 + slot * (pw + 6), N.y + 106, col, { w: pw, ...opt }));
    });
    return B;
  };
  // Every component reaches the API server; kubelet paths come up through the gap between the two layers.
  const routes = (B, y0) => {
    const A = B.api, my = y0 + 146, ar = A.x + A.w, cy = (b) => b.y + b.h / 2;
    const up = (j, off) => { const L = B[`kubelet${j}`], ax = A.x + A.w / 2 + (j ? 16 : -16) + off; return [[L.x + L.w - 14 + off, L.y], [L.x + L.w - 14 + off, my - off], [ax, my - off], [ax, A.y + A.h]]; };
    return {
      kubectl: [[B.kubectl.x + B.kubectl.w, cy(B.kubectl)], [A.x, cy(B.kubectl)]],
      etcd: [[B.etcd.x, cy(B.etcd)], [ar, cy(B.etcd)]], sched: [[B.sched.x, cy(B.sched)], [ar, cy(B.sched)]], cm: [[B.cm.x, cy(B.cm)], [ar, cy(B.cm)]],
      kubelet0: up(0, 0), kubelet1: up(1, 0), up0: up(0, 8),
    };
  };
  const EXIST = [[0, 0, 'pod', BLUE], [0, 1, 'pod', BLUE], [1, 0, 'pod', BLUE], [1, 1, 'pod', BLUE]];

  each('flow', (root) => {
    const STEP = 1.5, HOLD = 2.6;
    // [from, to, text, [status, tone, node]]
    const ST = [
      ['kubectl', 'api', 'kubectl이 Deployment를 API 서버에 보낸다', ['파드 없음', 'info', '-']],
      ['api', 'etcd', 'API 서버가 검사한 뒤 etcd에 저장한다', ['파드 없음', 'info', '-']],
      ['cm', 'api', '컨트롤러가 ReplicaSet과 파드를 만든다', ['Pending', 'warn', '<none>']],
      ['sched', 'api', '스케줄러가 노드 1을 골라 적는다', ['Pending', 'warn', 'node-1']],
      ['api', 'kubelet0', '노드 1의 kubelet이 자기 파드를 받는다', ['Pending', 'warn', 'node-1']],
      ['kubelet0', 'rt0', '런타임이 이미지를 받고 컨테이너를 띄운다', ['ContainerCreating', 'info', 'node-1']],
      ['kubelet0', 'api', 'kubelet이 파드 상태를 보고한다', ['Running', 'ok', 'node-1']],
    ];
    const n = ST.length;
    hwa.scene(root, {
      height: 356, still: n * STEP + 0.5,
      frame: (ctx, w, h, time, say) => {
        const t = time % (n * STEP + HOLD), cur = Math.min(n - 1, Math.floor(t / STEP)), f = t >= n * STEP ? 1 : hwa.smooth((t - cur * STEP) / (STEP * 0.6)), y0 = 32;
        const step = ST[cur], state = f > 0.9 ? step[3] : (ST[cur - 1] || ST[0])[3];
        const lit = new Set([step[0]]);
        if (f > 0.9) lit.add(step[1]);
        const pods = [...EXIST];
        if (cur >= 5) pods.push([0, 2, 'pod', cur === 6 && f > 0.9 ? GREEN : ORANGE, { dash: cur === 6 && f > 0.9 ? null : [3, 2] }]);
        const B = clusterMap(ctx, w, y0, { lit, pods }), P = routes(B, y0), rev = (p) => p.slice().reverse();
        const L = B.kubelet0, R = B.rt0;
        const path = {
          'kubectl>api': P.kubectl, 'api>etcd': rev(P.etcd), 'cm>api': P.cm, 'sched>api': P.sched, 'api>kubelet0': rev(P.kubelet0),
          'kubelet0>rt0': [[L.x + L.w / 2, L.y + L.h], [L.x + L.w / 2, R.y]], 'kubelet0>api': P.up0,
        };
        C.pill(ctx, 0, 0, `STATUS ${state[0]}`, state[1]);
        C.text(ctx, `NODE ${state[2]}`, w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        ST.forEach((s, j) => {
          if (j > cur) return;
          const p = path[`${s[0]}>${s[1]}`], on = j === cur;
          C.arrow(ctx, p, on ? f : 1, on ? U.accent : LINE, { width: on ? 2 : 1.4 });
          const len = p.slice(1).reduce((a, q, k) => a + Math.hypot(q[0] - p[k][0], q[1] - p[k][1]), 0);
          // Kubelet paths: badge on the horizontal leg between the two layers.
          if (j === 4 || j === 6) C.badge(ctx, p, j + 1, on, j === 4 ? 'down' : 'up', legMid(p, 1));
          else if (len > 40) C.badge(ctx, p, j + 1, on);
        });
        if (cur >= 2) {
          const A = B.api, done = cur > 2 || f > 0.9;
          tag(ctx, cur >= 3 && (cur > 3 || f > 0.9) ? 'nodeName: node-1' : 'nodeName 없음', A.x + A.w / 2, A.y + A.h - 15, cur >= 3 ? BLUE : ORANGE, { a: done ? 1 : f, size: 9 });
        }
        C.text(ctx, `${cur + 1}. ${step[2]}`, 0, h - 12, { size: 12, weight: 600, color: U.text, base: 'middle' });
        say(`${cur + 1}단계: ${step[2]}. 파드 상태 ${state[0]}, 노드 ${state[2]}.`);
      },
    });
  });

  each('api', (root) => {
    const SEC = 5, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 3);
    const STAGE = [['인증', '실패 401'], ['인가', '실패 403'], ['어드미션', '쓰기만'], ['검증', '형식 검사']];
    const SC = [
      { pill: 'kubectl get pods', req: 'GET /api/v1/namespaces/default/pods?limit=500', verb: 'GET', stamp: ['200 OK, 캐시에서 응답', 'ok'] },
      { pill: 'kubectl apply', req: 'POST /apis/apps/v1/namespaces/default/deployments', verb: 'POST', stamp: ['201 Created, etcd 저장', 'ok'] },
      { pill: 'kubectl delete pod, 권한 없음', req: 'DELETE /api/v1/namespaces/prod/pods/api-0', verb: 'DELETE', stamp: ['403 Forbidden', 'bad'] },
    ];
    const notes = ['읽기 요청은 인증과 인가만 거치고, 목록은 API 서버의 감시 캐시에서 답한다.', '쓰기 요청은 어드미션과 검증까지 거친 뒤 etcd에 저장된다.', '권한이 없으면 인가에서 403으로 끝나고 etcd까지 가지 않는다.'];
    hwa.scene(root, {
      height: 244, still: S.at(2) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), sc = SC[i], lane = 72;
        const kw = w < 480 ? 46 : 72, K = { x: 0, y: lane - 22, w: kw, h: 44, t: 'kubectl', size: w < 480 ? 10 : 11 }, E = { x: w - kw, y: lane - 22, w: kw, h: 44, t: 'etcd' };
        const gx = kw + 8, gw = w - 2 * kw - 16, sw = (gw - 16 - 18) / 4, sx = (j) => gx + 8 + j * (sw + 6);
        const cache = { x: sx(2), y: 148, w: 2 * sw + 6, h: 28 };
        C.pill(ctx, 0, 0, sc.pill, i === 2 ? 'bad' : 'info');
        C.group(ctx, gx, 34, gw, 152, 'API 서버', 50);
        C.dashed(ctx, K.x + kw, lane, E.x, lane, LINE);
        const path = i === 0 ? [[kw, lane], [sx(2) - 3, lane], [sx(2) - 3, cache.y + 14], [cache.x, cache.y + 14]]
          : i === 1 ? [[kw, lane], [E.x - 20, lane]] : [[kw, lane], [sx(1) + sw / 2, lane]];
        const k = ease(t, 0.3, 3.3), p = at(path, k), down = i === 0 && p[1] > lane + 1;
        STAGE.forEach(([name, sub], j) => {
          const b = { x: sx(j), y: 92, w: sw, h: 46 }, passed = p[0] > b.x + b.w / 2 && !down, here = !down && p[0] >= b.x && p[0] <= b.x + b.w + 6;
          const skip = i === 0 && j >= 2 && (down || k >= 1), deny = i === 2 && j === 1 && k >= 1;
          const col = deny ? RED : passed || (here && k >= 1) ? GREEN : skip ? GRAY : ['#fff', U.text, U.grid];
          unit(ctx, b, name, skip ? '건너뜀' : sub, { col, dash: skip ? [3, 3] : null, lit: here && !deny && k < 1, size: w < 420 ? 10 : 12, subSize: w < 420 ? 9 : 10 });
          C.line(ctx, [[b.x + b.w / 2, lane + 3], [b.x + b.w / 2, b.y]], LINE, 1);
        });
        unit(ctx, cache, '감시 캐시', null, { col: i === 0 && down ? BLUE : GRAY });
        C.card(ctx, K, { lit: k < 0.1 });
        C.card(ctx, E, { lit: i === 1 && k >= 1, fill: i === 1 && k >= 1 ? GREEN[0] : '#fff' });
        tag(ctx, sc.verb, p[0], p[1], i === 2 && k >= 1 ? RED : BLUE, { a: ease(t, 0.1, 0.4) });
        C.stamp(ctx, w / 2, 204, sc.stamp[0], sc.stamp[1], (t - 3.6) / 0.4);
        let size = 10;
        while (size > 8 && tw(ctx, sc.req, size, 600) > w) size--;
        C.text(ctx, sc.req, 0, 238, { size, weight: 600, color: U.text });
        say(`${sc.pill}: ${notes[i]}`);
      },
    });
  });

  each('etcd', (root) => {
    const NS = [3, 4], K1 = 1.2, K2 = 3.2, P = 1.4;
    const notes = ['3대는 1대가 죽어도 2대로 과반을 지키고, 두 번째 고장에서 쓰기를 멈춘다.', '4대는 과반이 3이라, 3대와 똑같이 두 번째 고장에서 쓰기를 멈춘다.'];
    hwa.scene(root, {
      height: 236, still: 0, notes, demo: { modes: ['etcd 3대', 'etcd 4대'], run: '한 대씩 끄기' },
      frame: (ctx, w, h, time, say, ui) => {
        const N = NS[ui.mode], q = Math.floor(N / 2) + 1, run = ui.runAt === null ? -1 : time - ui.runAt;
        const dead = run < K1 ? 0 : run < K2 ? 1 : 2, alive = N - dead, ok = alive >= q;
        C.pill(ctx, 0, 0, run < 0 ? '쓰기 정상' : ok ? `쓰기 정상, ${dead}대 고장` : '쓰기 멈춤', ok ? 'ok' : 'bad');
        C.text(ctx, `살아 있음 ${alive}/${N}, 과반 ${q}`, w, 11, { size: 10, weight: 600, color: ok ? U.text : U.red, align: 'right', base: 'middle' });
        const aw = w < 480 ? 60 : 84, A = { x: 0, y: 86, w: aw, h: 46, t: 'API 서버', size: 11 };
        const gx = aw + 22, gw = w - gx, mw = Math.min(84, (gw - 20 - (N - 1) * 8) / N);
        const M = Array.from({ length: N }, (_, j) => ({ x: gx + 10 + j * (mw + 8), y: 76, w: mw, h: 66 }));
        C.group(ctx, gx, 36, gw, 162, 'etcd 클러스터', 52);
        C.card(ctx, A);
        const gone = (j) => (j === N - 1 ? ease(run, K1, K1 + 0.4) : j === N - 2 ? ease(run, K2, K2 + 0.4) : 0);
        M.forEach((b, j) => {
          const g = run < 0 ? 0 : gone(j);
          if (g >= 0.5) unit(ctx, b, `etcd-${j + 1}`, '꺼짐', { col: [U.plot, U.muted, RED[2]], dash: [3, 3] });
          else unit(ctx, b, `etcd-${j + 1}`, !ok ? '쓰기 불가' : j ? '팔로워' : '리더', { col: !ok ? ORANGE : j ? ['#fff', U.text, U.grid] : BLUE });
          const cx = b.x + b.w / 2, alive1 = g < 0.5;
          ctx.fillStyle = alive1 ? GREEN[2] : RED[0];
          ctx.beginPath(); ctx.roundRect(b.x, 156, b.w, 14, 4); ctx.fill();
          if (!alive1) { ctx.strokeStyle = RED[2]; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]); }
          if (j === 0) C.text(ctx, '살아 있는 멤버', b.x, 186, { size: 10 });
          if (g > 0 && g < 1) C.stamp(ctx, cx, b.y + b.h / 2, '꺼짐', 'bad', 1 - Math.abs(g - 0.5) * 2);
        });
        const qx = M[q - 1].x + mw + 4;
        C.dashed(ctx, qx, 150, qx, 176, U.red);
        C.text(ctx, `과반 ${q}`, qx + 4, 186, { size: 10, weight: 700, color: U.red });
        // Writes: API to the leader, then the leader copies to the followers that are still up.
        const ph = (time % P) / P, L = M[0], ly = A.y + A.h / 2;
        if (ph < 0.45) tag(ctx, 'PUT', ...mix([aw + 22, ly], [L.x - 16, ly], hwa.smooth(ph / 0.45)), BLUE);
        else if (ok) M.slice(1).forEach((b, j) => {
          if (run >= 0 && gone(j + 1) >= 0.5) return;
          const pts = [[L.x + L.w / 2, L.y], [L.x + L.w / 2, 66], [b.x + b.w / 2, 66], [b.x + b.w / 2, b.y]];
          dot(ctx, at(pts, hwa.smooth((ph - 0.45) / 0.45)), U.blue, 4);
        });
        else tag(ctx, 'PUT 실패', L.x - 30, ly, RED, { a: 1 - (ph - 0.45) / 0.55 });
        if (run >= 0) C.stamp(ctx, w / 2, 218, N === 3 ? '두 번째 고장에서 멈춤' : '4대도 두 번째에서 멈춤', 'bad', (run - 4.2) / 0.4);
        if (run < 0) hint(ctx, w, 220, '한 대씩 끄기');
        say(`etcd ${N}대, 과반 ${q}. 살아 있는 멤버 ${alive}대, ${ok ? '쓰기 가능' : '쓰기 멈춤'}.`);
      },
    });
  });

  // Node rows with a 4-core request bar, shared by the filter and Pending figures.
  const CAP = 4;
  const rowGeo = (b) => ({ bx: b.x + 62, bw: b.w - 142, X: (v) => b.x + 62 + (v / CAP) * (b.w - 142), right: b.x + b.w - 8, cy: b.y + b.h / 2 });
  const nodeRow = (ctx, b, node, { a = 1, lit = false, try: r, use = false } = {}) => { fade(ctx, a, () => {
    C.box(ctx, b.x, b.y, b.w, b.h, { fill: '#fff', on: lit, r: 7 });
    C.text(ctx, node.n, b.x + 10, b.y + (node.sub ? 15 : b.h / 2), { size: 11, weight: 600, color: U.text, base: 'middle' });
    if (node.sub) C.text(ctx, node.sub, b.x + 10, b.y + 29, { size: 9, color: U.muted, base: 'middle' });
    const { bx, bw, X } = rowGeo(b), by = b.y + b.h / 2 - 6;
    ctx.fillStyle = U.cell;
    ctx.fillRect(bx, by, bw, 12);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(bx, by, X(node.req) - bx, 12);
    if (use) { C.dashed(ctx, X(node.use), by - 4, X(node.use), by + 16, '#f59e0b'); }
    if (r) {
      const fits = node.req + r.v <= CAP, x0 = X(node.req), x1 = Math.min(X(node.req + r.v), bx + bw + 6);
      ctx.save();
      ctx.globalAlpha *= r.k;
      ctx.fillStyle = r.solid ? GREEN[2] : fits ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
      ctx.fillRect(x0, by - 2, x1 - x0, 16);
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = fits ? '#16a34a' : U.red;
      ctx.strokeRect(x0 + 0.5, by - 1.5, x1 - x0 - 1, 15);
      ctx.restore();
    }
  }); return rowGeo(b); };

  each('filter', (root) => {
    const SEC = 5, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 3), R = 0.5;
    const NODES = [
      { n: 'node-1', req: 2.5, score: 25 }, { n: 'node-2', req: 3.8, why: 'CPU 부족' },
      { n: 'node-3', req: 1.0, score: 63 }, { n: 'node-4', req: 1.0, why: 'taint', sub: 'gpu 전용' },
    ];
    const notes = ['거르기: CPU가 모자란 node-2와 견딜 수 없는 taint가 있는 node-4가 빠진다.', '점수: 남은 두 노드 중 request 여유가 큰 node-3이 높은 점수를 받는다. 점수는 CPU만 넣어 계산했다.', '바인딩: 파드의 nodeName에 node-3을 적는다. 컨테이너는 그 노드의 kubelet이 띄운다.'];
    hwa.scene(root, {
      height: 252, still: S.at(2) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), pw = w < 480 ? 80 : 110, rx = pw + 14;
        C.pill(ctx, 0, 0, ['거르기', '점수', '바인딩'][i], ['warn', 'info', 'ok'][i]);
        C.text(ctx, '막대 = 노드 CPU 4개 중 request 합', w, 11, { size: 10, align: 'right', base: 'middle' });
        const pod = { x: 0, y: 70, w: pw, h: 56 };
        unit(ctx, pod, '새 파드', 'cpu 500m', { col: BLUE, lit: i === 0 && t < 0.6 });
        C.text(ctx, 'toleration 없음', pw / 2, 142, { size: 9, align: 'center' });
        NODES.forEach((nd, j) => {
          const b = { x: rx, y: 36 + j * 46, w: w - rx, h: 40 }, tj = 0.5 + j * 0.9, judged = i > 0 || t >= tj + 0.5;
          const a = nd.why && (i > 0 || t >= tj + 0.8) ? 0.45 : 1, chosen = i === 2 && nd.n === 'node-3';
          const tryK = i === 0 ? ease(t, tj, tj + 0.4) : nd.why ? 0 : 1;
          const g = nodeRow(ctx, b, nd, { a, lit: chosen && t > 2.4, try: tryK > 0 && !(chosen && t > 2.4) ? { v: R, k: tryK } : chosen && t > 2.4 ? { v: R, k: 1, solid: true } : null });
          if (!judged) return;
          if (nd.why) fade(ctx, a, () => C.chip(ctx, nd.why, g.right, g.cy, 'bad', i ? 1 : ease(t, tj + 0.5, tj + 0.8)));
          else if (i === 0) C.chip(ctx, '통과', g.right, g.cy, 'ok', ease(t, tj + 0.5, tj + 0.8));
          else {
            const k = i === 1 ? ease(t, 0.4 + j * 0.5, 1.6 + j * 0.5) : 1;
            ctx.fillStyle = U.purple;
            ctx.fillRect(g.bx, b.y + b.h - 7, g.bw * (nd.score / 100) * k, 3);
            C.chip(ctx, chosen && t > 2.4 ? '선택' : `${Math.round(nd.score * k)}점`, g.right, g.cy, chosen && t > 2.4 ? 'ok' : 'info');
          }
        });
        if (i === 2) {
          const g = rowGeo({ x: rx, y: 36 + 2 * 46, w: w - rx, h: 40 }), k = ease(t, 0.6, 2.4);
          if (k < 1) tag(ctx, '500m', ...mix([pw / 2, pod.y + pod.h / 2], [(g.X(1) + g.X(1.5)) / 2, g.cy], k), BLUE);
          tag(ctx, 'nodeName: node-3', Math.max(pw / 2, 52), 170, GREEN, { a: ease(t, 2.6, 3.0), size: 9 });
          C.stamp(ctx, rx + (w - rx) / 2, 230, 'node-3에 바인딩', 'ok', (t - 3.4) / 0.4);
        }
        say(notes[i]);
      },
    });
  });

  each('pending', (root) => {
    const NODES = [{ n: 'node-1', req: 3.2, use: 1.1 }, { n: 'node-2', req: 2.5, use: 0.9 }, { n: 'node-3', req: 3.6, use: 1.4 }].map((nd) => ({ ...nd, sub: `여유 ${(CAP - nd.req).toFixed(1)}` })), RS = [0.5, 2];
    const notes = ['request 500m은 여유가 가장 큰 node-2(1.5코어)에 들어간다.', 'request 2000m은 실사용으로 보면 자리가 남는데, request 합으로는 들어갈 노드가 없어 Pending에 머문다.'];
    hwa.scene(root, {
      height: 262, still: 0, notes, demo: { modes: ['request 500m', 'request 2000m'], run: '파드 만들기' },
      frame: (ctx, w, h, time, say, ui) => {
        const R = RS[ui.mode], run = ui.runAt === null ? -1 : time - ui.runAt, pw = w < 480 ? 80 : 110, rx = pw + 14;
        const fit = NODES.filter((nd) => nd.req + R <= CAP), target = fit.sort((a, b) => a.req - b.req)[0], done = run >= 3.6;
        C.pill(ctx, 0, 0, run < 0 ? '파드 없음' : !done ? '거르는 중' : target ? `${target.n}에 배치` : 'Pending', run < 0 ? 'info' : !done ? 'warn' : target ? 'ok' : 'bad');
        ctx.font = U.font(10);
        const lw = 24 + ctx.measureText('request 합').width + 24 + ctx.measureText('실사용').width;
        C.legend(ctx, w - lw + 12, 11, [['request 합', '#94a3b8'], ['실사용', '#f59e0b']]);
        const pod = { x: 0, y: 70, w: pw, h: 56 };
        unit(ctx, pod, '새 파드', `cpu ${R * 1000}m`, { col: run >= 0 && done && !target ? ORANGE : BLUE, dash: run < 0 ? [3, 3] : null });
        if (run >= 0 && done && !target) C.text(ctx, 'Pending', pw / 2, 142, { size: 11, weight: 700, color: ORANGE[1], align: 'center' });
        NODES.forEach((nd, j) => {
          const b = { x: rx, y: 40 + j * 54, w: w - rx, h: 46 }, tj = 0.5 + j * 0.9, k = run < 0 ? 0 : ease(run, tj, tj + 0.4), fits = nd.req + R <= CAP;
          const placed = target === nd && run >= 4.4;
          const g = nodeRow(ctx, b, nd, { use: true, lit: placed, try: placed ? { v: R, k: 1, solid: true } : k > 0 ? { v: R, k } : null });
          if (run >= tj + 0.5) C.chip(ctx, fits ? '들어감' : '자리 없음', g.right, g.cy, fits ? 'ok' : 'bad', ease(run, tj + 0.5, tj + 0.8));
        });
        if (target && run >= 3.6 && run < 4.4) {
          const j = NODES.indexOf(target), g = rowGeo({ x: rx, y: 40 + j * 54, w: w - rx, h: 46 });
          tag(ctx, `${R * 1000}m`, ...mix([pw / 2, 98], [(g.X(target.req) + g.X(target.req + R)) / 2, g.cy], ease(run, 3.6, 4.4)), BLUE);
        }
        const use = NODES.reduce((a, nd) => a + nd.use, 0) / (CAP * 3), req = NODES.reduce((a, nd) => a + nd.req, 0) / (CAP * 3);
        C.text(ctx, `클러스터 실사용 ${Math.round(use * 100)}%, request ${Math.round(req * 100)}%`, w, 214, { size: 10, weight: 600, color: U.text, align: 'right' });
        if (run >= 0) C.stamp(ctx, w / 2, 242, target ? `${target.n}에 배치` : 'Pending, 맞는 노드 없음', target ? 'ok' : 'bad', (run - 4.6) / 0.4);
        if (run < 0) hint(ctx, w, 244, '파드 만들기');
        say(`request ${R * 1000}m 파드. ${notes[ui.mode]}`);
      },
    });
  });

  each('pod', (root) => {
    const SEC = 5.5, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = ['밖에서 온 요청은 파드 IP의 8080으로 들어가고, 사이드카는 같은 서버를 localhost:8080으로 부른다.', '앱이 볼륨에 쓴 로그를 사이드카가 읽어 로그 저장소로 보낸다.'];
    hwa.scene(root, {
      height: 248, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), cw = w < 480 ? 58 : 84, gx = cw + 14, gw = w - gx;
        const client = { x: 0, y: 84, w: cw, h: 44 }, store = { x: 0, y: 182, w: cw, h: 44 };
        const px = gx + 10, pw = gw - 20, py = 58, ph = 176, ex = { x: px + 8, y: 88, w: 50, h: 36 };
        const cx0 = px + 68, cwid = (pw - 68 - 18) / 2, app = { x: cx0, y: 84, w: cwid, h: 46 }, side = { x: cx0 + cwid + 10, y: 84, w: cwid, h: 46 };
        const vol = { x: cx0, y: 154, w: 2 * cwid + 10, h: 38 };
        C.pill(ctx, 0, 0, i ? '볼륨 공유' : '네트워크 공유', 'info');
        unit(ctx, client, '클라이언트', null, { size: 10 });
        unit(ctx, store, '로그', '저장소', { size: 10 });
        C.group(ctx, gx, 34, gw, h - 36, '워커 노드');
        C.box(ctx, px, py, pw, ph, { fill: '#fff', stroke: U.accentLine, r: 9 });
        C.text(ctx, 'Pod', px + 10, py + 15, { size: 11, weight: 700, color: U.accent });
        C.text(ctx, 'IP 10.244.1.7', px + 38, py + 15, { size: 10, weight: 600, color: U.text });
        unit(ctx, ex, 'eth0', null, { col: GRAY, size: 10 });
        C.line(ctx, [[ex.x + ex.w, ex.y + ex.h / 2], [app.x, ex.y + ex.h / 2]], LINE, 1);
        unit(ctx, app, 'app', ':8080', { col: BLUE, lit: (i === 0 && t > 1.8 && t < 2.6) || (i === 1 && t < 1.2) });
        unit(ctx, side, 'log-agent', '사이드카', { col: PURPLE, lit: (i === 0 && t > 2.6 && t < 4) || (i === 1 && t > 2.4 && t < 3.4) });
        unit(ctx, vol, 'emptyDir 볼륨', '/var/log/app', { col: GRAY });
        [app, side].forEach((b) => C.line(ctx, [[b.x + b.w / 2, b.y + b.h], [b.x + b.w / 2, vol.y]], LINE, 1));
        const cyA = ex.y + ex.h / 2;
        if (i === 0) {
          const p1 = [[cw, cyA + 2], [ex.x + ex.w / 2, cyA + 2], [app.x + 14, cyA + 2]];
          tag(ctx, ':8080', ...at(p1, ease(t, 0.3, 1.8)), BLUE, { a: 1 - ease(t, 2.0, 2.4) });
          const p2 = [[side.x + side.w / 2, side.y], [side.x + side.w / 2, side.y - 10], [app.x + app.w / 2, side.y - 10], [app.x + app.w / 2, app.y]];
          if (t > 2.6) { C.line(ctx, p2, '#c4b5fd', 1); tag(ctx, 'localhost', ...at(p2, ease(t, 2.6, 3.8)), PURPLE, { size: 9 }); }
          C.stamp(ctx, px + pw / 2, py + ph - 12, 'IP 하나, 포트로 구별', 'info', (t - 4.2) / 0.4);
        } else {
          const ax = app.x + app.w / 2, sx2 = side.x + side.w / 2, vy = vol.y + 10;
          tag(ctx, 'log', ...mix([ax, app.y + app.h], [ax, vy], ease(t, 0.3, 1.1)), BLUE, { a: 1 - ease(t, 1.1, 1.4), size: 9 });
          tag(ctx, 'log', ...mix([sx2, vy], [sx2, side.y + side.h], ease(t, 1.6, 2.4)), PURPLE, { a: ease(t, 1.5, 1.7) * (1 - ease(t, 2.4, 2.7)), size: 9 });
          const out = [[side.x + side.w, side.y + side.h - 10], [px + pw - 5, side.y + side.h - 10], [px + pw - 5, 212], [cw, 212]];
          if (t > 2.8) { C.line(ctx, out, '#c4b5fd', 1); tag(ctx, 'log', ...at(out, ease(t, 2.8, 4.2)), PURPLE, { size: 9 }); }
          C.stamp(ctx, px + pw / 2, vol.y - 12, '같은 볼륨을 둘이 마운트', 'info', (t - 4.4) / 0.4);
        }
        say(notes[i]);
      },
    });
  });

  each('reconcile', (root) => {
    const NAMES = [['test-a', 'test-b', 'test-c'], ['api-7d4b-x2k9', 'api-7d4b-p8mz', 'api-7d4b-q1ns']], NEW = 'api-7d4b-z7tf';
    const notes = ['직접 만든 파드는 지키는 컨트롤러가 없어 지운 만큼 그대로 줄어든다.', 'ReplicaSet 컨트롤러가 원하는 3과 실제 2의 차이를 보고 새 파드를 만들어 3개로 되돌린다.'];
    const SEC = 5.2, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    hwa.scene(root, {
      height: 256, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t: run } = hwa.loop(time, SEC, HOLD, 2), dep = i === 1, names = NAMES[i];
        const del = ease(run, 0.6, 1.4), born = dep && run >= 2.6, ready = dep && run >= 3.6;
        const count = 3 - (del >= 1 ? 1 : 0) + (ready ? 1 : 0), diff = dep && run >= 1.6 && !ready;
        C.pill(ctx, 0, 0, dep ? `파드 ${count}/3` : `파드 ${count}개`, count === 3 ? 'ok' : dep ? 'warn' : 'bad');
        const cb = { x: 0, y: 34, w, h: 56 };
        if (dep) {
          unit(ctx, cb, 'ReplicaSet 컨트롤러', diff ? `원하는 3, 실제 ${ready ? 3 : 2}` : `원하는 3, 실제 ${count}`, { col: diff ? ORANGE : ['#fff', U.text, U.grid], lit: diff, subColor: diff ? ORANGE[1] : U.muted });
          const lx = w - 28, ly = cb.y + cb.h / 2, a0 = time * 2.4;
          ctx.beginPath(); ctx.arc(lx, ly, 10, a0, a0 + TAU * 0.75); ctx.strokeStyle = diff ? ORANGE[1] : U.accent; ctx.lineWidth = 1.6; ctx.stroke(); ctx.lineWidth = 1;
          dot(ctx, [lx + 10 * Math.cos(a0 + TAU * 0.75), ly + 10 * Math.sin(a0 + TAU * 0.75)], diff ? ORANGE[1] : U.accent, 2.8);
          C.text(ctx, '조정 루프', lx - 18, ly, { size: 10, align: 'right', base: 'middle' });
        } else unit(ctx, cb, '컨트롤러 없음', '지켜보는 쪽이 없다', { col: [U.plot, U.muted, U.grid], dash: [4, 3] });
        C.group(ctx, 0, 116, w, 118, '클러스터');
        const pw = (w - 16 - 16) / 3;
        names.forEach((s, j) => {
          const b = { x: 8 + j * (pw + 8), y: 148, w: pw, h: 54 };
          if (dep) C.dashed(ctx, b.x + pw / 2, cb.y + cb.h, b.x + pw / 2, b.y, LINE);
          if (j === 1 && del > 0) {
            if (born) unit(ctx, b, NEW, ready ? 'Running' : '생성 중', { col: ready ? GREEN : ORANGE, dash: ready ? null : [3, 2], size: 10 });
            else if (del < 1) fade(ctx, 1 - del * 0.7, () => unit(ctx, b, s, '삭제 중', { col: RED, size: 10 }));
            else C.box(ctx, b.x, b.y, b.w, b.h, { fill: U.plot, dash: [3, 3], r: 7 });
            return;
          }
          unit(ctx, b, s, 'Running', { col: BLUE, size: 10 });
        });
        if (dep && run >= 2.0) C.arrow(ctx, [[w / 2 + 12, cb.y + cb.h], [w / 2 + 12, 146]], ease(run, 2.0, 2.6), U.accent, { width: 2 });
        C.stamp(ctx, w / 2, 222, dep ? '3개로 복구' : '2개로 남음, 아무도 안 살림', dep ? 'ok' : 'bad', (run - (dep ? 4.2 : 2.4)) / 0.4);
        say(`${dep ? 'Deployment' : '직접 만든 파드'}: 파드 ${count}개. ${notes[i]}`);
      },
    });
  });

  each('operator', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 3), KINDS = ['Pod', 'Deployment', 'StatefulSet', 'Prometheus'];
    const notes = ['CRD를 등록하면 API 서버가 Prometheus라는 새 종류를 받는다.', 'CR을 만들면 오퍼레이터가 보고 replicas 2인 StatefulSet을 만든다.', '누가 StatefulSet을 1로 줄이면 오퍼레이터가 CR대로 2로 되돌린다.'];
    hwa.scene(root, {
      height: 262, still: S.at(2) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), uw = w < 480 ? 50 : 72, ax = uw + 12, aw = Math.min(180, (w - ax - 12) * 0.52), rx = ax + aw + 12, rw = w - rx;
        const user = { x: 0, y: 76, w: uw, h: 44, t: 'kubectl', size: 11 }, row = (r) => ({ x: ax + 10, y: 62 + r * 34, w: aw - 20, h: 26 });
        const op = { x: rx, y: 50, w: rw, h: 46 }, sts = { x: rx, y: 134, w: rw, h: 92 };
        const crd = i ? 1 : ease(t, 1.6, 2.4), cr = i === 2 || (i === 1 && t >= 1.6);
        const created = i === 2 ? 1 : i === 1 ? ease(t, 3.4, 4.2) : 0;
        const cut = i === 2 ? ease(t, 1.6, 2.2) * (1 - ease(t, 3.8, 4.4)) : 0;
        const opLit = (i === 1 && t > 1.8 && t < 3.6) || (i === 2 && t > 2.4 && t < 4);
        C.pill(ctx, 0, 0, ['CRD 등록', 'CR 생성', '직접 수정'][i], ['info', 'info', 'warn'][i]);
        C.card(ctx, user);
        C.group(ctx, ax, 34, aw, h - 36, 'API 서버', 50);
        KINDS.forEach((k, r) => {
          const b = row(r), isNew = r === 3;
          if (isNew && crd <= 0) { C.box(ctx, b.x, b.y, b.w, b.h, { fill: U.plot, dash: [3, 3], r: 6 }); return; }
          fade(ctx, isNew ? crd : 1, () => {
            C.box(ctx, b.x, b.y, b.w, b.h, { fill: isNew ? PURPLE[0] : '#fff', stroke: isNew ? PURPLE[2] : U.grid, r: 6 });
            C.text(ctx, k, b.x + 8, b.y + b.h / 2 + 0.5, { size: 10, weight: 600, color: isNew ? PURPLE[1] : U.text, base: 'middle' });
          });
        });
        C.text(ctx, '종류(kind)', ax + 10, 220, { size: 9 });
        const r3 = row(3), r2 = row(2);
        ctx.font = U.font(10, 600);
        const roomy = r3.w - 8 - ctx.measureText('Prometheus').width > 48;
        if (cr) tag(ctx, 'main', roomy ? r3.x + r3.w - 20 : r3.x + 22, roomy ? r3.y + r3.h / 2 : r3.y + r3.h + 11, PURPLE, { size: 9, h: 16, a: i === 2 ? 1 : ease(t, 1.6, 2.0) });
        unit(ctx, op, '오퍼레이터', opLit ? (i === 2 ? '원하는 2, 실제 1' : 'CR 감지') : 'Prometheus', { col: opLit ? ORANGE : ['#fff', U.text, U.grid], lit: opLit, size: 11 });
        // User request into the API server: the CRD and the CR go to the new kind's row, the edit to StatefulSet.
        const into = (b) => [[uw, user.y + user.h / 2], [ax + 4, user.y + user.h / 2], [ax + 4, b.y + b.h / 2], [b.x + 8, b.y + b.h / 2]];
        const send = [['CRD', r3], ['CR main', r3], ['replicas: 1', r2]][i];
        const sk = ease(t, 0.3, 1.5);
        if (sk < 1) tag(ctx, send[0], ...at(into(send[1]), sk), i === 2 ? ORANGE : PURPLE, { size: 9 });
        const watch = [[r3.x + r3.w, r3.y + r3.h / 2], [rx - 6, r3.y + r3.h / 2], [rx - 6, op.y + op.h / 2], [rx, op.y + op.h / 2]];
        C.line(ctx, watch, LINE, 1);
        const wt = i === 1 ? ease(t, 1.8, 2.6) : i === 2 ? ease(t, 2.4, 3.0) : 0;
        if (wt > 0 && wt < 1) dot(ctx, at(watch, wt), U.accent, 4);
        if (i >= 1) C.arrow(ctx, [[rx + rw / 2, op.y + op.h], [rx + rw / 2, sts.y]], i === 1 ? ease(t, 2.8, 3.4) : ease(t, 3.2, 3.8), opLit ? U.accent : LINE, { width: opLit ? 2 : 1.4 });
        if (i === 2) { const e = [[r2.x + r2.w, r2.y + r2.h / 2], [rx, r2.y + r2.h / 2 + 30]]; if (t > 1.4 && t < 2.4) C.arrow(ctx, e, ease(t, 1.4, 1.8), ORANGE[1], { dash: [3, 2] }); }
        C.box(ctx, sts.x, sts.y, sts.w, sts.h, { fill: created > 0 ? U.plot : '#fff', dash: created > 0 ? null : [4, 3], r: 9 });
        C.text(ctx, 'StatefulSet', sts.x + 10, sts.y + 16, { weight: 600, color: created > 0 ? U.text : U.muted });
        fade(ctx, created, () => {
          C.text(ctx, 'prometheus-main', sts.x + 10, sts.y + 32, { size: 10 });
          const pw = Math.min(64, (rw - 26) / 2);
          tag(ctx, 'main-0', sts.x + 10 + pw / 2, sts.y + 62, BLUE, { w: pw, h: 24 });
          tag(ctx, 'main-1', sts.x + 16 + pw * 1.5, sts.y + 62, cut > 0.5 ? RED : BLUE, { w: pw, h: 24, a: 1 - 0.8 * cut, dash: cut > 0.5 ? [3, 2] : null });
        });
        const st = [['새 종류 등록', 'info'], ['StatefulSet 생성', 'ok'], ['2로 되돌림', 'ok']][i];
        C.stamp(ctx, w < 480 ? Math.min(rx + rw / 2, w - tw(ctx, st[0], 13, 700) / 2 - 16) : w / 2, 244, st[0], st[1], (t - 4.6) / 0.4);
        say(notes[i]);
      },
    });
  });
})();
