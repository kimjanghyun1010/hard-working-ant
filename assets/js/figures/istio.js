(() => {
  const U = hwa.ui, C = hwa.cv;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const fig = (id, fn) => document.querySelectorAll(`[data-figure="${id}"]`).forEach(fn);
  // Scenes of unequal length, each followed by the same hold (as in cpu-flow.js).
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, still: at(lens.length - 1) + lens[lens.length - 1] + 0.8, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  // Moves along pts; times[j] = [start, end] of segment j. seg is -1 before the first segment starts.
  const walk = (pts, times, t) => {
    for (let j = times.length - 1; j >= 0; j--) if (t >= times[j][0]) return { p: mix(pts[j], pts[j + 1], ease(t, times[j][0], times[j][1])), seg: j };
    return { p: pts[0], seg: -1 };
  };
  const BLUE = ['#eff6ff', '#1d4ed8', '#93c5fd'], WAIT = ['#fef3c7', '#b45309', '#fcd34d'], BAD = ['#fee2e2', '#dc2626', '#fca5a5'];
  const OK = ['#dcfce7', '#15803d', '#86efac'], PROXY = ['#f5f3ff', '#6d28d9', '#c4b5fd'], L4 = ['#f0fdfa', '#0f766e', '#5eead4'], PLAIN = ['#fff', '#475569', '#cbd5e1'];
  // Bordered chip centred on (cx, cy); returns its width.
  const tag = (ctx, s, cx, cy, [bg, fg, line], a = 1) => {
    const cw = tw(ctx, s, 10, 600) + 14;
    if (a <= 0) return cw;
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
    return cw;
  };
  const ball = (ctx, [x, y], color, r = 5) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  const tone = (t) => ({ fill: t[0], stroke: t[2] });
  const legendRight = (ctx, w, items) => {
    ctx.font = U.font(10);
    const lw = items.reduce((a, [s]) => a + 24 + ctx.measureText(s).width, 0);
    C.legend(ctx, w - lw + 12, 11, items);
  };
  const hint = (ctx, s, x, y) => C.text(ctx, s, x, y, { size: 12, align: 'center', base: 'middle' });

  // A slow C fills B's threads with waits, then A's: the failure travels upstream.
  fig('istio-cascade', (root) => {
    const S = seq([5, 6, 6], 1.8);
    const SV = [['주문 A', 0], ['결제 B', 1], ['재고 C', 2]];
    const PILL = [['평소', 'ok'], ['C 응답 없음', 'warn'], ['A까지 멈춤', 'bad']];
    const notes = [
      '평소에는 요청이 A, B, C를 지나 금방 돌아와서 스레드 칸이 잠깐씩만 찬다.',
      'C가 응답하지 않자, C를 부른 B의 스레드가 하나씩 응답 대기로 묶인다.',
      'B의 스레드가 다 묶이면 B를 부른 A의 스레드가 묶여, A까지 응답하지 못한다.',
    ];
    hwa.scene(root, {
      height: 196, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, PILL[i][0], PILL[i][1]);
        const ux = 40, bw = Math.min(150, (w - ux - 3 * 22) / 3), gap = (w - ux - 3 * bw) / 3, y0 = 44, bh = 112;
        const bx = (j) => ux + gap + j * (bw + gap), ly = y0 + 64;
        const wait = [i === 2 ? Math.min(6, Math.floor(t * 1.2)) : 0, i === 0 ? 0 : i === 1 ? Math.min(6, Math.floor(t * 1.2)) : 6, 0];
        C.text(ctx, '사용자', 0, ly - 12, { size: 10, weight: 600, color: U.text });
        [0, 1, 2].forEach((j) => {
          const x0 = j ? bx(j - 1) + bw : 0, x1 = bx(j);
          C.arrow(ctx, [[x0 + 2, ly], [x1 - 2, ly]], 1, '#cbd5e1', { width: 1.2 });
          const col = j === 0 && wait[0] >= 6 ? U.red : (j === 2 && i >= 1) || (j === 1 && i === 2) ? '#f59e0b' : U.blue;
          [0, 0.5].forEach((o) => ball(ctx, mix([x0 + 4, ly], [x1 - 8, ly], (t * 0.6 + o + j * 0.17) % 1), col, 3.5));
        });
        SV.forEach(([name, j]) => {
          const x = bx(j), dead = j === 2 && i >= 1, full = wait[j] >= 6;
          C.box(ctx, x, y0, bw, bh, { fill: '#fff', stroke: dead || full ? BAD[2] : U.grid });
          C.text(ctx, name, x + bw / 2, y0 + 18, { size: 12, weight: 600, color: U.text, align: 'center' });
          C.text(ctx, '스레드 6개', x + bw / 2, y0 + 34, { size: 10, align: 'center' });
          const s = 14, gx = x + (bw - 3 * s - 8) / 2;
          for (let k = 0; k < 6; k++) {
            const cx = gx + (k % 3) * (s + 4), cy = y0 + 44 + Math.floor(k / 3) * (s + 4);
            const busy = !dead && ((t * 0.9 + k * 0.31 + j * 0.13) % 1) < 0.22;
            ctx.fillStyle = k < wait[j] ? '#f59e0b' : busy ? U.blue : U.cell;
            ctx.beginPath(); ctx.roundRect(cx, cy, s, s, 3); ctx.fill();
          }
          const st = dead ? ['응답 없음', BAD[1]] : wait[j] ? [`대기 ${wait[j]}/6`, full ? BAD[1] : WAIT[1]] : ['정상', OK[1]];
          C.text(ctx, st[0], x + bw / 2, y0 + 98, { size: 11, weight: 700, color: st[1], align: 'center' });
        });
        if (i === 1) C.stamp(ctx, (bx(1) + bx(2) + bw) / 2, y0 + bh + 22, 'B 스레드 6/6 대기', 'warn', (run - 6) / 0.4);
        if (i === 2) C.stamp(ctx, (bx(0) + bx(1) + bw) / 2, y0 + bh + 22, 'A, B 스레드 전부 대기', 'bad', (run - 6) / 0.4);
        say(`${PILL[i][0]}. ${notes[i]}`);
      },
    });
  });

  // Resilience code in each service (three libraries, three sets of values) against one proxy config from istiod.
  fig('istio-where', (root) => {
    const S = seq([5, 6], 2);
    const SV = [['주문', 'Java', 'Resilience4j', '재시도 3, 2s'], ['결제', 'Node.js', 'opossum', '재시도 0, 10s'], ['재고', 'Go', 'gobreaker', '재시도 5, 무제한']];
    const notes = [
      '코드에 넣으면 언어마다 라이브러리가 다르고, 재시도와 타임아웃 값도 서비스마다 제각각이다.',
      '프록시로 빼면 앱은 그대로 두고, istiod가 같은 설정을 모든 프록시에 내려보낸다.',
    ];
    hwa.scene(root, {
      height: 240, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, i ? '프록시로 빼기' : '코드에 넣기', i ? 'ok' : 'warn');
        const iw = Math.min(110, Math.max(64, w * 0.18)), pw = Math.min(w - iw - 24, 400), cw = Math.min(150, (pw - 18) / 2);
        const ix = w - iw, top = 36, rh = 60;
        const out = i ? ease(t, 0.2, 1.0) : 0, inn = i ? ease(t, 1.0, 1.8) : 0;
        if (i) {
          ctx.globalAlpha = ease(t, 0.2, 0.8);
          C.card(ctx, { x: ix, y: top, w: iw, h: 3 * rh - 12, t: 'istiod', s: 'xDS' }, { fill: U.plot });
          ctx.globalAlpha = 1;
        }
        SV.forEach(([name, lang, lib, val], r) => {
          const y = top + r * rh, bh = rh - 12;
          C.box(ctx, 0, y, pw, bh, { fill: U.plot });
          C.card(ctx, { x: 6, y: y + 5, w: cw, h: bh - 10, t: name, s: lang });
          const lx = 12 + cw, lw = pw - lx - 6, card = { x: lx, y: y + 5, w: lw, h: bh - 10 };
          if (out < 1) { ctx.globalAlpha = 1 - out; C.card(ctx, { ...card, t: lib, s: val }, tone(WAIT)); ctx.globalAlpha = 1; }
          if (inn > 0) {
            const got = t > 2.6 + r * 0.4;
            ctx.globalAlpha = inn;
            C.card(ctx, { ...card, t: 'Envoy', s: got ? '재시도 2, 2s' : '설정 대기' }, { ...tone(PROXY), lit: got && t < 3.6 + r * 0.4 });
            ctx.globalAlpha = 1;
            C.arrow(ctx, [[ix - 2, y + bh / 2], [lx + lw + 2, y + bh / 2]], ease(t, 2.0 + r * 0.4, 2.6 + r * 0.4), PROXY[1], { width: 1.4 });
          }
        });
        const sy = top + 3 * rh + 8;
        if (i === 0) C.stamp(ctx, w / 2, sy, '라이브러리 3개, 값 3벌', 'warn', (run - 5) / 0.4);
        else C.stamp(ctx, w / 2, sy, '설정 한 벌', 'ok', (run - 6) / 0.4);
        say(notes[i]);
      },
    });
  });

  // The pod spec passes the API server, istiod's webhook adds istio-init and istio-proxy, and the pod starts with three containers.
  fig('istio-inject', (root) => {
    const LEN = 9, HOLD = 2.2;
    const ADD = [['istio-init', 'iptables 쓰고 끝남'], ['istio-proxy', 'Envoy']];
    hwa.scene(root, {
      height: 262, still: LEN + 0.5,
      frame: (ctx, w, h, time, say) => {
        const t = Math.min(time % (LEN + HOLD), LEN), cw = Math.min(140, (w - 48) / 3), gap = (w - 3 * cw) / 2;
        const sx = 0, ax = cw + gap, px = 2 * (cw + gap), top = 104, ch = 130;
        const step = t < 1.7 ? 0 : t < 4.4 ? 1 : t < 6 ? 2 : 3;
        C.pill(ctx, 0, 0, ['파드 스펙 제출', '웹훅이 고침', '노드에 배치', '컨테이너 기동'][step], 'info');
        const api = { x: ax, y: top + 40, w: cw, h: 46, t: 'API 서버' }, ist = { x: ax, y: 32, w: cw, h: 46, t: 'istiod', s: '주입 웹훅' };
        C.card(ctx, api, { lit: step === 0 && t > 1.2 });
        C.card(ctx, ist, { lit: step === 1, fill: U.plot });
        // Spec card: app from the start, the two injected containers after the webhook answers.
        C.box(ctx, sx, top, cw, ch, { fill: '#fff' });
        C.text(ctx, 'Pod 스펙', sx + 10, top + 18, { size: 11, weight: 600, color: U.text });
        tag(ctx, 'app', sx + cw / 2, top + 42, BLUE);
        ADD.forEach(([s], j) => tag(ctx, `+ ${s}`, sx + cw / 2, top + 68 + j * 26, OK, ease(t, 4.0 + j * 0.2, 4.4 + j * 0.2)));
        // Pod on the node: init runs then finishes, proxy starts before app (native sidecar).
        C.group(ctx, px, top, cw, ch, '노드의 파드', top + 18);
        const rows = [['istio-init', 6.3, 7.3], ['istio-proxy', 6.9, 99], ['app', 7.6, 99]];
        rows.forEach(([s, on, off], j) => {
          const a = ease(t, on, on + 0.4);
          if (a <= 0) return;
          const done = t >= off;
          tag(ctx, done ? `${s} 완료` : s, px + cw / 2, top + 42 + j * 26, done ? PLAIN : s === 'istio-proxy' ? PROXY : BLUE, a);
        });
        const a1 = [[sx + cw + 2, top + 62], [ax - 2, top + 62]], a2 = [[ax + cw / 2 - 14, top + 38], [ax + cw / 2 - 14, 80]];
        const a3 = [[ax + cw / 2 + 14, 80], [ax + cw / 2 + 14, top + 38]], a4 = [[ax + cw + 2, top + 62], [px - 2, top + 62]];
        [[a1, 0.3, 1.2, 1, U.accent], [a2, 1.8, 2.6, 2, U.accent], [a3, 3.2, 4.0, 3, OK[1]], [a4, 4.8, 5.8, 4, U.accent]].forEach(([pts, a, b, n, col]) => {
          C.arrow(ctx, pts, ease(t, a, b), col, { width: 1.4 });
          if (t > a) C.badge(ctx, pts, n, t < b + 0.4, pts[0][0] === pts[1][0] ? (n === 2 ? 'left' : 'right') : 'up');
        });
        C.stamp(ctx, w / 2, top + ch + 22, '컨테이너 1개가 3개로', 'info', (t - 8.2) / 0.4);
        say('파드 스펙이 API 서버를 지나 istiod 웹훅에서 istio-init과 istio-proxy가 붙은 뒤 노드에서 뜬다.');
      },
    });
  });

  // One request from pod A's app to pod B's app: iptables sends it to Envoy on each side, the hop between nodes is mTLS.
  fig('istio-path', (root) => {
    const S = seq([5.5, 5.5], 1.6);
    const notes = [
      '앱이 payments로 보낸 요청을 iptables가 Envoy 15001로 돌리고, Envoy가 mTLS로 감싸 내보낸다.',
      '파드 B의 iptables가 들어온 연결을 Envoy 15006으로 돌리고, Envoy가 TLS를 풀어 앱 8080에 넘긴다.',
    ];
    hwa.scene(root, {
      height: 266, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, i ? '들어오는 길' : '나가는 길', 'info');
        const pw = Math.min(230, (w - 56) / 2), y0 = 32, ph = 196, aw = pw - 46;
        const P = [0, w - pw].map((x, side) => {
          const sx = side ? x + 6 : x + pw - 18, cx = side ? x + 36 + aw / 2 : x + 10 + aw / 2;
          return { x, sx, cx, app: { x: cx - aw / 2, y: y0 + 34, w: aw, h: 46 }, env: { x: cx - aw / 2, y: y0 + 120, w: aw, h: 46 } };
        });
        const ey = y0 + 143, ay = y0 + 57, mid = w / 2;
        let hit = -1, lit = -1, chip = null;
        if (i === 0) {
          const pts = [[P[0].cx, ay], [P[0].sx, ay], [P[0].cx, ey], [P[0].sx + 12, ey], [mid, ey]];
          const m = walk(pts, [[0.3, 1.1], [1.4, 2.2], [2.6, 3.2], [3.2, 4.4]], t);
          hit = m.seg === 0 && t > 1.0 && t < 1.8 ? 0 : -1;
          lit = m.seg >= 1 && t < 3.0 ? 0 : -1;
          chip = { p: m.p, s: m.seg >= 2 ? 'mTLS' : 'HTTP', c: m.seg >= 2 ? OK : BLUE };
        } else {
          const pts = [[mid, ey], [P[1].sx, ey], [P[1].cx, ey], [P[1].cx, ay]];
          const m = walk(pts, [[0.3, 1.2], [1.5, 2.3], [2.8, 3.8]], t);
          hit = m.seg === 0 && t > 1.1 && t < 1.9 ? 1 : -1;
          lit = m.seg === 1 || (m.seg === 2 && t < 3.0) ? 1 : -1;
          chip = { p: m.p, s: m.seg >= 2 ? 'HTTP' : 'mTLS', c: m.seg >= 2 ? BLUE : OK };
        }
        P.forEach((p, side) => {
          const on = side === i;
          C.box(ctx, p.x, y0, pw, ph, { fill: U.plot, stroke: on ? U.accentLine : U.grid });
          C.text(ctx, side ? '파드 B (결제)' : '파드 A (주문)', side ? p.x + 36 : p.x + 10, y0 + 18, { size: 11, weight: 600, color: U.text });
          C.card(ctx, { ...p.app, t: '앱', s: side ? ':8080 받음' : 'payments 호출' });
          C.card(ctx, { ...p.env, t: 'Envoy', s: side ? '15006 들어옴' : '15001 나감' }, { ...tone(PROXY), lit: lit === side });
          ctx.fillStyle = hit === side ? U.accentSoft : '#fff';
          ctx.strokeStyle = hit === side ? U.accent : '#cbd5e1';
          ctx.beginPath(); ctx.roundRect(p.sx, y0 + 28, 12, ph - 38, 4); ctx.fill(); ctx.stroke();
          ctx.save();
          ctx.translate(p.sx + 6, y0 + ph / 2 + 4);
          ctx.rotate(-Math.PI / 2);
          C.text(ctx, 'iptables', 0, 0, { size: 9, weight: 600, color: hit === side ? U.accent : U.muted, align: 'center', base: 'middle' });
          ctx.restore();
        });
        C.dashed(ctx, P[0].x + pw, ey, P[1].x, ey, '#94a3b8');
        C.text(ctx, '노드 사이', mid, ey + 26, { size: 10, align: 'center' });
        if (chip && !(i === 1 && t > 4.0)) tag(ctx, chip.s, chip.p[0], chip.p[1], chip.c);
        C.stamp(ctx, mid, y0 + ph + 22, i ? '프록시 두 번 지남' : '앱 모르게 Envoy로', 'info', (run - 5.5) / 0.4);
        say(notes[i]);
      },
    });
  });

  // istiod pushes config and signs certificates; when it stops, requests between Envoys keep flowing.
  fig('istio-xds', (root) => {
    const S = seq([6, 6, 6.5], 1.8);
    const PILL = [['설정 배포', 'info'], ['인증서 발급', 'info'], ['istiod 멈춤', 'bad']];
    const notes = [
      'VirtualService가 바뀌면 istiod가 API 서버에서 보고 xDS로 모든 Envoy에 밀어 넣는다.',
      '파드의 istio-agent가 서명 요청(CSR)을 보내면 istiod가 서명한 인증서를 돌려준다.',
      'istiod가 멈춰도 Envoy는 받은 설정으로 요청을 계속 나른다. 새 설정과 인증서 갱신만 멈춘다.',
    ];
    hwa.scene(root, {
      height: 290, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, PILL[i][0], PILL[i][1]);
        const iw = Math.min(130, w * 0.32), aw = Math.min(110, w * 0.28), ix = Math.min(w * 0.5 - iw / 2, w - aw - iw - 22), ax = w - aw - 8;
        C.group(ctx, 0, 30, w, 84, '컨트롤 플레인', 48);
        const ist = { x: ix, y: 56, w: iw, h: 46, t: 'istiod', s: i === 2 ? '멈춤' : 'xDS, CA' };
        C.card(ctx, ist, i === 2 ? { dash: [4, 3], stroke: U.red, dim: true } : { lit: (i === 0 && t > 1.6 && t < 2.6) || (i === 1 && t > 1.6 && t < 2.4) });
        C.card(ctx, { x: ax, y: 56, w: aw, h: 46, t: 'API 서버' });
        C.group(ctx, 0, 132, w, 122, '데이터 플레인', 150);
        const g = 18, pw = (w - 16 - 2 * g) / 3, py = 162, phh = 82, pc = (j) => 8 + j * (pw + g) + pw / 2;
        if (i === 0 && t < 2) {
          const m = walk([[ax + 14, 79], [ix + iw - 6, 79]], [[0.5, 1.6]], t);
          if (m.seg >= 0) tag(ctx, 'VS', m.p[0], m.p[1], WAIT);
        }
        [0, 1, 2].forEach((j) => {
          const x = pc(j) - pw / 2;
          C.box(ctx, x, py, pw, phh, { fill: '#fff' });
          C.text(ctx, `파드 ${j + 1}`, x + 8, py + 16, { size: 10, weight: 600, color: U.text });
          let s = 'Envoy', c = PROXY;
          if (i === 0 && t > 3.4 + j * 0.15) { s = '새 라우팅'; c = OK; }
          if (i === 1 && t > 3.6 + j * 0.15) { s = '인증서'; c = OK; }
          tag(ctx, s, pc(j), py + 52, c);
          const top = [ix + iw / 2 + (j - 1) * 24, 104], up = [[pc(j), py - 2], top], down = [top, [pc(j), py + 40]];
          if (i === 0) { const m = walk(down, [[2.2 + j * 0.15, 3.4 + j * 0.15]], t); if (m.seg >= 0 && t < 3.4 + j * 0.15) ball(ctx, m.p, PROXY[1]); }
          if (i === 1) {
            const a = walk(up, [[0.4 + j * 0.2, 1.6 + j * 0.15]], t);
            if (a.seg >= 0 && t < 1.7 + j * 0.15) tag(ctx, 'CSR', a.p[0], a.p[1], PLAIN);
            const b = walk(down, [[2.4 + j * 0.15, 3.6 + j * 0.15]], t);
            if (b.seg >= 0 && t < 3.6 + j * 0.15) ball(ctx, b.p, OK[1]);
          }
        });
        if (i === 2) {
          [0, 1].forEach((j) => {
            const y = py + 72, a = [pc(j) + 16, y], b = [pc(j + 1) - 16, y];
            C.arrow(ctx, [a, b], 1, '#cbd5e1', { width: 1.2 });
            [0, 0.5].forEach((o) => ball(ctx, mix(a, b, (t * 0.5 + o + j * 0.25) % 1), U.blue, 3.5));
          });
          C.text(ctx, '새 설정 반영 안 됨', ix + iw / 2, 118, { size: 10, weight: 600, color: U.red, align: 'center' });
          C.stamp(ctx, w / 2, 272, '요청은 계속 흐름', 'ok', (run - 6.5) / 0.4);
        }
        if (i === 0) C.stamp(ctx, w / 2, 272, '파드 3개에 같이 반영', 'info', (run - 6) / 0.4);
        if (i === 1) C.stamp(ctx, w / 2, 272, '서명은 istiod가', 'info', (run - 6) / 0.4);
        say(`${PILL[i][0]}. ${notes[i]}`);
      },
    });
  });

  // productpage's Envoy checks the VirtualService rules top-down; jason goes to subset v2, everyone else to v1.
  fig('istio-routing', (root) => {
    const GAP = 0.9, N = 12, T = GAP * N;
    hwa.scene(root, {
      height: 222, still: 5.6,
      notes: ['보내는 쪽 Envoy가 VirtualService 규칙을 위에서부터 맞춰 보고, jason만 v2로 보낸다.'],
      frame: (ctx, w, h, time, say) => {
        const lt = time % T;
        C.pill(ctx, 0, 0, 'end-user 헤더로 나눔', 'info');
        legendRight(ctx, w, [['jason', U.purple], ['다른 사용자', U.blue]]);
        const ex = 44, ew = Math.min(180, w * 0.4), ey = 40, eh = 164, rw = Math.min(200, w - ex - ew - 26), rx = w - rw;
        const R = [ey + 82, ey + 128];
        C.text(ctx, '사용자', 0, ey + 60, { size: 10, weight: 600, color: U.text });
        C.box(ctx, ex, ey, ew, eh, { fill: PROXY[0], stroke: PROXY[2] });
        C.text(ctx, 'productpage의 Envoy', ex + 10, ey + 18, { size: 10, weight: 600, color: PROXY[1] });
        C.text(ctx, 'VirtualService 규칙', ex + 10, ey + 36, { size: 9 });
        const pods = [[ey + 4, 'v1'], [ey + 50, 'v1'], [ey + 112, 'v2']];
        C.group(ctx, rx, ey - 4, rw, eh + 12, '', 0);
        C.text(ctx, 'DestinationRule', rx + 8, ey + 10, { size: 9 });
        const hot = [false, false], fill = [0, 0, 0];
        for (let n = -3; n < N; n++) {
          const r = lt - n * GAP;
          if (r < 0 || r > 2.6) continue;
          const jason = ((n % 3) + 3) % 3 === 1, row = jason ? 0 : 1, dst = jason ? 2 : ((n % 2) + 2) % 2;
          const py = pods[dst][0] + 32;
          const pts = [[2, ey + 72], [ex, ey + 72], [ex + 50, R[row]], [ex + ew, R[row]], [rx + 8, py]];
          const m = walk(pts, [[0, 0.6], [0.6, 1.0], [1.3, 1.7], [1.7, 2.3]], r);
          if (r > 0.8 && r < 1.5) hot[row] = true;
          if (r > 2.2) fill[dst] = 1;
          ball(ctx, m.p, jason ? U.purple : U.blue);
        }
        ['jason → v2', '그 외 → v1'].forEach((s, j) => {
          C.box(ctx, ex + 8, R[j] - 15, ew - 16, 30, { fill: '#fff', on: hot[j] });
          C.text(ctx, `${j + 1}. ${s}`, ex + 16, R[j] + 0.5, { size: 10, weight: 600, color: hot[j] ? U.accent : U.text, base: 'middle' });
        });
        pods.forEach(([y, v], j) => C.card(ctx, { x: rx + 8, y: y + 16, w: rw - 16, h: 38, t: `${v} 파드`, s: `version: ${v}`, size: 11 }, { lit: fill[j] > 0, fill: v === 'v2' ? '#faf5ff' : '#fff' }));
        say('productpage의 Envoy가 end-user 헤더가 jason인 요청은 v2로, 나머지는 v1으로 보낸다.');
      },
    });
  });

  // Demo: the same buggy v2 behind weight 100 or weight 10; failures land in a 40-cell grid.
  fig('istio-canary', (root) => {
    const N = 40, GAP = 0.22, END = 0.3 + N * GAP + 1.2;
    const MODES = [{ pill: '전부 v2로 교체', v2: () => true, w: 100 }, { pill: '카나리 v2 10%', v2: (n) => n % 10 === 4, w: 10 }];
    hwa.scene(root, {
      height: 250, still: 0,
      notes: ['v2로 한 번에 바꾸면 요청 40건이 모두 v2의 버그를 만난다.', '10%만 v2로 보내면 같은 버그라도 4건만 실패한다.'],
      demo: { modes: MODES.map((m) => m.pill), run: 'v2 배포하기' },
      frame: (ctx, w, h, time, say, ui) => {
        const M = MODES[ui.mode], run = ui.runAt === null ? -1 : time - ui.runAt;
        const ex = 40, ew = Math.min(170, w * 0.38), rw = Math.min(200, w - ex - ew - 28), rx = w - rw, cy = 92;
        const v1 = { x: rx, y: 42, w: rw, h: 40, t: 'v1 파드', s: `${100 - M.w}%` }, v2 = { x: rx, y: 104, w: rw, h: 40, t: 'v2 파드', s: `${M.w}%, 버그 있음` };
        let fail = 0;
        const cells = [];
        for (let n = 0; n < N; n++) {
          const r = run - 0.3 - n * GAP, to2 = M.v2(n);
          if (r < 0) break;
          const dst = to2 ? v2 : v1, pts = [[2, cy], [ex + ew / 2, cy], [dst.x + 6, dst.y + dst.h / 2]];
          if (r < 0.9) ball(ctx, walk(pts, [[0, 0.45], [0.45, 0.9]], r).p, U.blue, 4);
          else { cells.push(to2 ? 2 : 1); if (to2) fail++; }
        }
        C.pill(ctx, 0, 0, M.pill, ui.mode ? 'ok' : 'warn');
        C.text(ctx, `실패 ${fail}건`, w, 11, { size: 11, weight: 700, color: fail ? U.red : U.muted, align: 'right', base: 'middle' });
        C.text(ctx, '요청', 0, cy - 12, { size: 10, weight: 600, color: U.text });
        C.card(ctx, { x: ex, y: 54, w: ew, h: 76, t: 'Envoy', s: 'weight' }, tone(PROXY));
        const bx = ex + 12, bw = ew - 24, by = 112;
        ctx.fillStyle = U.blue; ctx.fillRect(bx, by, bw * (100 - M.w) / 100, 8);
        ctx.fillStyle = U.red; ctx.fillRect(bx + bw * (100 - M.w) / 100, by, bw * M.w / 100, 8);
        C.card(ctx, v1, { dim: M.w === 100, fill: M.w === 100 ? U.plot : '#fff' });
        C.card(ctx, v2, { stroke: BAD[2] });
        const cols = 20, s = Math.min(14, Math.floor((w - (cols - 1) * 3) / cols)), gy = 178;
        C.text(ctx, '요청 40건의 결과', 0, gy - 10, { size: 10 });
        for (let n = 0; n < N; n++) {
          const x = (n % cols) * (s + 3), y = gy + Math.floor(n / cols) * (s + 3);
          ctx.fillStyle = cells[n] === 2 ? U.red : cells[n] === 1 ? '#22c55e' : U.cell;
          ctx.beginPath(); ctx.roundRect(x, y, s, s, 3); ctx.fill();
        }
        if (run < 0) hint(ctx, 'v2 배포하기 버튼을 눌러 보자', w / 2, gy + 2 * s + 24);
        if (run >= END) C.stamp(ctx, w / 2, gy + s + 2, ui.mode ? '4건만 실패' : '40건 모두 실패', ui.mode ? 'ok' : 'bad', (run - END) / 0.4);
        say(`${M.pill}. 실패 ${fail}건.`);
      },
    });
  });

  // Lanes on a time axis: blocks for work, arrows for waits (a slim version of the timeline in cpu.js).
  const FILL = { slow: '#f59e0b', ok: U.blue, l7: '#8b5cf6', l4: '#14b8a6', net: '#cbd5e1' };
  const ARC = { wait: '#94a3b8', late: U.red };
  const dbl = (ctx, x0, x1, y, color) => {
    if (x1 - x0 < 6) return;
    C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
    [[x0, 1], [x1, -1]].forEach(([x, d]) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    });
  };
  const timeline = (id, scenes, { SEC = 6, HOLD = 1.8, LH = 46, lw = 84 } = {}) => fig(id, (root) => {
    const n = scenes.length, maxL = Math.max(...scenes.map((s) => s.lanes.length));
    hwa.scene(root, {
      height: 44 + maxL * LH + 30, still: (n - 1) * (SEC + HOLD) + SEC + 0.8,
      scenes: n > 1 ? hwa.loopScenes(SEC, HOLD, n) : undefined, notes: scenes.map((s) => s.say),
      frame: (ctx, w, h, time, say) => {
        const { i } = hwa.loop(time, SEC, HOLD, n), s = scenes[i], run = (time % ((SEC + HOLD) * n)) - i * (SEC + HOLD);
        const k = Math.max(0, Math.min(1, run / SEC)), t = k * s.span;
        C.pill(ctx, 0, 0, s.pill, s.tone);
        if (s.legend) legendRight(ctx, w, s.legend.map(([kind, label]) => [label, FILL[kind]]));
        const x0 = Math.min(lw, w * 0.26), x1 = w - 8, top = 40, base = top + s.lanes.length * LH + 4;
        const X = (v) => x0 + (Math.max(0, Math.min(v, s.span)) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
        s.lanes.forEach((name, j) => C.text(ctx, name, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
        C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
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
          const y = ly(j) + 8, bx = X(a) + 1, bw = X(Math.min(t, b)) - bx - 1;
          if (bw <= 0) return;
          ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 16, Math.min(6, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
          if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 16) / 2 + 0.5, { size: 10, weight: 700, color: kind === 'net' ? U.text : '#fff', align: 'center', base: 'middle' });
        });
        if (s.event && t >= s.event[0]) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
        if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
        if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, top + (base - top) / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
        say(`${s.pill}. ${s.say}`);
      },
    });
  });

  // Default (no timeout) waits out a slow pod; perTryTimeout cuts it at 500ms and the retry lands on a healthy pod.
  const rt = [[1000, '1s'], [2000, '2s'], [3000, '3s']], rl = ['주문', '결제 파드 1', '결제 파드 2'];
  timeline('istio-retry', [
    { pill: '타임아웃 없음', tone: 'bad', span: 3000, lanes: rl, ticks: rt, segs: [[1, 0, 3000, 'slow', '느린 응답']], arcs: [[0, 0, 3000, 'late', '응답 대기']], stamp: ['3초 대기', 'bad'], say: '타임아웃이 없으면 느린 파드에 걸린 요청을 끝까지 기다린다.' },
    { pill: 'perTryTimeout 500ms, 재시도', tone: 'ok', span: 3000, lanes: rl, ticks: rt, segs: [[1, 0, 500, 'slow', ''], [2, 530, 650, 'ok', '']], arcs: [[0, 0, 650, 'wait', '']], event: [500, '시도 끊음'], stamp: ['650ms에 성공', 'ok'], say: '500ms에 첫 시도를 끊고 다시 보내, 다른 파드가 받아 650ms에 끝난다.' },
  ]);

  // Proxies a request passes in each data plane mode. Lengths are shape only, not measurements.
  timeline('istio-latency', [
    {
      pill: '요청 하나가 지나는 프록시', tone: 'info', span: 36, lanes: ['메시 없음', '사이드카', 'ambient L4', 'ambient L7'],
      legend: [['l7', 'L7'], ['l4', 'L4'], ['net', '네트워크']],
      segs: [[0, 0, 10, 'net', ''], [1, 0, 12, 'l7', 'Envoy'], [1, 12, 22, 'net', ''], [1, 22, 34, 'l7', 'Envoy'], [2, 0, 3, 'l4', ''], [2, 3, 13, 'net', ''], [2, 13, 16, 'l4', ''], [3, 0, 3, 'l4', ''], [3, 3, 8, 'net', ''], [3, 8, 20, 'l7', 'waypoint'], [3, 20, 25, 'net', ''], [3, 25, 28, 'l4', '']],
      say: '사이드카는 L7 프록시를 두 번, ambient L4는 가벼운 L4 처리만 두 번, waypoint를 붙이면 L7을 한 번 지난다.',
    },
  ], { SEC: 6, LH: 40, lw: 76 });

  // Demo: pod 2 answers 503 after 3s. Without outlier detection its requests hold the order service's threads; with it, pod 2 is ejected after 3 errors in a row.
  fig('istio-breaker', (root) => {
    const SLOTS = 6, GAP = 0.2, N = 50, FAST = 0.3, SLOW = 3, TRIP = 3, END = 11, DT = 0.01;
    const sim = (breaker) => {
      const reqs = Array.from({ length: N }, (_, n) => ({ arrive: 0.3 + n * GAP, start: -1, end: -1, pod: -1 }));
      let rr = 0, streak = 0, eject = Infinity;
      for (let s = 0; s * DT < END; s++) {
        const m = s * DT + 1e-9;
        reqs.forEach((r) => {
          if (r.start < 0 || r.end >= 0 || m < r.start + (r.pod ? SLOW : FAST)) return;
          r.end = r.start + (r.pod ? SLOW : FAST);
          if (r.pod && breaker && ++streak >= TRIP && eject === Infinity) eject = r.end;
        });
        let busy = reqs.filter((r) => r.start >= 0 && r.end < 0).length;
        for (const r of reqs) {
          if (busy >= SLOTS) break;
          if (r.start >= 0 || r.arrive > m) continue;
          r.start = m;
          r.pod = m >= eject ? 0 : rr++ % 2;
          busy++;
        }
      }
      return { reqs, eject };
    };
    const R = [sim(false), sim(true)];
    const PILL = ['서킷 브레이커 없음', 'outlierDetection'];
    hwa.scene(root, {
      height: 214, still: 0,
      notes: ['파드 2에 간 요청이 3초씩 스레드를 붙잡아, 스레드 6개가 차고 대기 줄이 늘어난다.', '파드 2가 503을 세 번 연달아 내자 부하 분산에서 빠지고, 대기 줄이 금방 빠진다.'],
      demo: { modes: ['서킷 브레이커 없음', '서킷 브레이커 있음'], run: '파드 2 고장 내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const run = ui.runAt === null ? -1 : time - ui.runAt, t = Math.min(run, END), { reqs, eject } = R[ui.mode];
        const on = run >= 0, cut = on && t >= eject;
        const busy = on ? reqs.filter((r) => r.start >= 0 && r.start <= t && (r.end < 0 || r.end > t)).sort((a, b) => a.start - b.start) : [];
        const queue = on ? reqs.filter((r) => r.arrive <= t && (r.start < 0 || r.start > t)).length : 0;
        const failed = on ? reqs.filter((r) => r.pod === 1 && r.end >= 0 && r.end <= t).length : 0;
        C.pill(ctx, 0, 0, PILL[ui.mode], ui.mode ? 'ok' : 'warn');
        C.text(ctx, `대기 ${queue}건`, w, 11, { size: 11, weight: 700, color: queue > 3 ? U.red : U.muted, align: 'right', base: 'middle' });
        const gw = Math.min(240, w * 0.56), y0 = 32, gh = 150;
        C.group(ctx, 0, y0, gw, gh, '주문 파드', y0 + 18);
        C.text(ctx, '스레드 6개', 10, y0 + 40, { size: 10 });
        const s = Math.min(24, (gw - 20 - 5 * 5) / 6);
        for (let k = 0; k < SLOTS; k++) {
          const r = busy[k];
          ctx.fillStyle = !r ? '#fff' : r.pod ? '#f59e0b' : U.blue;
          ctx.strokeStyle = U.grid;
          ctx.beginPath(); ctx.roundRect(10 + k * (s + 5), y0 + 50, s, s, 4); ctx.fill(); ctx.stroke();
        }
        C.text(ctx, '대기 줄', 10, y0 + 98, { size: 10 });
        const fit = Math.floor((gw - 50) / 11);
        for (let k = 0; k < Math.min(queue, fit); k++) ball(ctx, [16 + k * 11, y0 + 118], '#f59e0b', 4);
        if (queue > fit) C.text(ctx, `+${queue - fit}`, gw - 10, y0 + 118, { size: 10, weight: 700, color: WAIT[1], align: 'right', base: 'middle' });
        const pw = Math.min(200, w - gw - 26), px = w - pw, p1 = { x: px, y: y0 + 6, w: pw, h: 48 }, p2 = { x: px, y: y0 + 92, w: pw, h: 48 };
        const n1 = busy.filter((r) => r.pod === 0).length, n2 = busy.filter((r) => r.pod === 1).length;
        C.arrow(ctx, [[gw + 2, y0 + 62], [px - 2, p1.y + 24]], 1, '#cbd5e1', { width: 1.2 });
        C.arrow(ctx, [[gw + 2, y0 + 62], [px - 2, p2.y + 24]], 1, cut ? '#e5e7eb' : '#cbd5e1', { width: 1.2, dash: cut ? [3, 3] : undefined });
        C.card(ctx, { ...p1, t: '결제 파드 1', s: `처리 중 ${n1}` });
        C.card(ctx, { ...p2, t: '결제 파드 2', s: cut ? (n2 ? `제외, 남은 ${n2}` : '제외 30초') : on ? `503 ${failed}번, 대기 ${n2}` : '정상' }, { stroke: on ? BAD[2] : U.grid, dash: cut ? [4, 3] : undefined, dim: cut });
        const es = '503 3번 연속, 제외', ex = Math.min(px + pw / 2, w - tw(ctx, es, 13, 700) / 2 - 16);
        if (cut && t < eject + 1.2) C.stamp(ctx, ex, p2.y - 16, es, 'info', (t - eject) / 0.3);
        if (!on) hint(ctx, '파드 2 고장 내기 버튼을 눌러 보자', w / 2, y0 + gh + 18);
        if (run >= END) C.stamp(ctx, w / 2, y0 + gh + 16, ui.mode ? '파드 2 제외, 대기 0건' : `대기 ${queue}건, 계속 늘어남`, ui.mode ? 'ok' : 'bad', (run - END) / 0.4);
        say(`${PILL[ui.mode]}. 대기 ${queue}건, 파드 2의 503 ${failed}번.`);
      },
    });
  });

  // PeerAuthentication: a meshed pod always gets in over mTLS; a pod without a sidecar sends plain text, accepted in PERMISSIVE and refused in STRICT.
  fig('istio-mtls', (root) => {
    const S = seq([5, 5, 5], 1.8);
    const PILL = [['mTLS', 'info'], ['PERMISSIVE', 'warn'], ['STRICT', 'ok']];
    const notes = [
      '사이드카가 있는 파드끼리는 인증서를 주고받는 mTLS로 연결하고, 받는 쪽이 sa/orders 신원을 확인한다.',
      'PERMISSIVE(기본값)는 사이드카 없는 파드의 평문 요청도 받아 앱까지 넘긴다.',
      'STRICT는 mTLS만 받아, 사이드카 없는 파드의 평문 요청을 Envoy에서 끊는다.',
    ];
    hwa.scene(root, {
      height: 252, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, PILL[i][0], PILL[i][1]);
        if (i) C.text(ctx, 'PeerAuthentication', w, 11, { size: 10, align: 'right', base: 'middle' });
        const cw = Math.min(150, w * 0.34), gw = Math.min(190, w * 0.4), gx = w - gw, y0 = 34;
        const a = { x: 0, y: 46, w: cw, h: 46, t: '주문 파드', s: '사이드카 있음' }, b = { x: 0, y: 140, w: cw, h: 46, t: '레거시 파드', s: '사이드카 없음' };
        C.card(ctx, a, tone(BLUE));
        C.card(ctx, b, { dash: i ? undefined : [4, 3], dim: !i });
        C.group(ctx, gx, y0, gw, 172, '결제 파드', y0 + 18);
        const env = { x: gx + 10, y: y0 + 32, w: gw - 20, h: 46 }, app = { x: gx + 10, y: y0 + 116, w: gw - 20, h: 46 };
        const ok1 = t > 2.0, rej = i === 2 && t > 2.4;
        C.dashed(ctx, cw + 4, a.y + 23, env.x - 2, env.y + 16, '#cbd5e1');
        if (i) C.dashed(ctx, cw + 4, b.y + 23, env.x - 2, env.y + 34, rej ? BAD[2] : '#cbd5e1');
        C.card(ctx, { ...env, t: 'Envoy', s: ok1 ? 'sa/orders 확인' : i === 2 ? 'mTLS만 받음' : 'mTLS, 평문 받음' }, { ...tone(PROXY), lit: t > 1.8 && t < 3.0 });
        C.card(ctx, { ...app, t: '앱', s: ':8080' });
        const m1 = walk([[cw + 4, a.y + 23], [env.x - 2, env.y + 16], [env.x + env.w / 2 - 20, env.y + 30], [app.x + app.w / 2 - 20, app.y + 10]], [[0.4, 1.8], [2.0, 2.3], [2.5, 3.4]], t);
        if (m1.seg >= 0 && t < 3.6) tag(ctx, m1.seg < 1 ? 'mTLS' : 'HTTP', m1.p[0], m1.p[1], m1.seg < 1 ? OK : BLUE);
        if (i) {
          const pts = [[cw + 4, b.y + 23], [env.x - 2, env.y + 34], [env.x + env.w / 2 + 20, env.y + 30], [app.x + app.w / 2 + 20, app.y + 10]];
          if (i === 1) {
            const m2 = walk(pts, [[0.8, 2.2], [2.4, 2.7], [2.9, 3.8]], t);
            if (m2.seg >= 0 && t < 4.0) tag(ctx, '평문', m2.p[0], m2.p[1], PLAIN);
          } else {
            const m2 = walk(pts.slice(0, 2), [[0.8, 2.2]], t);
            if (m2.seg >= 0 && !rej) tag(ctx, '평문', m2.p[0], m2.p[1], PLAIN);
            if (rej) tag(ctx, '거절', pts[1][0] - 22, pts[1][1] + 6, BAD);
          }
        }
        if (i === 1) C.stamp(ctx, w / 2, 234, '평문도 통과', 'warn', (run - 5) / 0.4);
        if (i === 2) C.stamp(ctx, w / 2, 234, '평문은 Envoy에서 끊김', 'ok', (run - 5) / 0.4);
        say(`${PILL[i][0]}. ${notes[i]}`);
      },
    });
  });

  // Metrics come from every Envoy on their own; a trace stays one line only if each app forwards the trace headers.
  fig('istio-observe', (root) => {
    const S = seq([6, 6], 1.8);
    const notes = [
      '앱이 받은 traceparent를 다음 요청에 실으면 A, B, C 구간이 한 추적으로 이어진다.',
      'B가 헤더를 빠뜨리면 C는 새 추적으로 잡혀 둘로 끊긴다. 지표는 그래도 세 Envoy에서 쌓인다.',
    ];
    hwa.scene(root, {
      height: 262, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, i ? 'B가 헤더 누락' : '헤더 전달', i ? 'bad' : 'ok');
        const got = (t > 0.6) + (t > 1.6) + (t > 2.9);
        C.text(ctx, `istio_requests_total +${got}`, w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        const g = 26, cw = (w - 2 * g) / 3, cy = 36, cx = (j) => j * (cw + g);
        ['주문 A', '결제 B', '재고 C'].forEach((s, j) => C.card(ctx, { x: cx(j), y: cy, w: cw, h: 46, t: s, s: 'Envoy' }, { lit: Math.abs(t - [0.6, 1.6, 2.9][j]) < 0.4 }));
        [0, 1].forEach((j) => {
          const a = [cx(j) + cw + 2, cy + 23], b = [cx(j + 1) - 2, cy + 23], [s0, s1] = j ? [1.9, 2.9] : [0.6, 1.6];
          C.arrow(ctx, [a, b], ease(t, s0, s1), '#94a3b8', { width: 1.2 });
          const miss = i && j;
          if (t > s0) tag(ctx, miss ? '헤더 없음' : 'traceparent', (a[0] + b[0]) / 2, cy + 64, miss ? BAD : BLUE, ease(t, s0, s0 + 0.4));
        });
        const ty = 120;
        C.box(ctx, 0, ty, w, h - ty - 2, { fill: U.plot });
        C.text(ctx, '추적 화면', 10, ty + 18, { size: 11, weight: 600, color: U.text });
        const lx = 70, X = (v) => lx + (w - lx - 12) * v;
        const spans = [[0, 0, 1, 'A', 0.6], [1, 0.12, 0.85, 'B', 1.6], [2, 0.3, 0.7, 'C', 2.9]];
        spans.forEach(([j, a, b, s, at]) => {
          const k = ease(t, at, at + 0.8);
          if (k <= 0) return;
          const split = i && j === 2, y = ty + 32 + j * 24 + (split ? 22 : 0), x0 = split ? X(0) : X(a), x1 = split ? X(b - a) : X(b);
          ctx.fillStyle = split ? U.red : [U.blue, '#6366f1', '#8b5cf6'][j];
          ctx.beginPath(); ctx.roundRect(x0, y, Math.max(2, (x1 - x0) * k), 16, 4); ctx.fill();
          C.text(ctx, s, x0 + 8, y + 8.5, { size: 10, weight: 700, color: '#fff', base: 'middle' });
        });
        C.text(ctx, 'trace 1', 10, ty + 40, { size: 10, weight: 600 });
        if (i && t > 2.9) C.text(ctx, 'trace 2', 10, ty + 110, { size: 10, weight: 600, color: U.red });
        const ss = i ? '추적 끊김' : '한 줄로 이어짐';
        C.stamp(ctx, w - tw(ctx, ss, 13, 700) / 2 - 22, ty + 16, ss, i ? 'bad' : 'ok', (run - 6) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Demo: 30 pods on 3 nodes. Sidecar adds a proxy per pod; ambient keeps a ztunnel per node and one waypoint.
  // Data: Istio 1.24 performance summary at 1000 rps (sidecar 60MB, ztunnel 12MB, waypoint 60MB).
  fig('istio-cost', (root) => {
    const N = 30, GAP = 0.2, END = 0.3 + N * GAP + 0.6, PM = 60, ZM = 12, WM = 60;
    hwa.scene(root, {
      height: 232, still: 0,
      notes: ['사이드카는 파드마다 프록시가 하나씩 붙어, 파드 수만큼 메모리가 쌓인다.', 'ambient는 노드마다 ztunnel 하나와 waypoint 하나라, 파드가 늘어도 프록시 수가 그대로다.'],
      demo: { modes: ['사이드카', 'ambient'], run: '파드 30개 띄우기' },
      frame: (ctx, w, h, time, say, ui) => {
        const run = ui.runAt === null ? -1 : time - ui.runAt, amb = ui.mode === 1;
        const pods = run < 0 ? 0 : Math.max(0, Math.min(N, Math.floor((run - 0.3) / GAP) + 1));
        const proxies = amb ? 4 : pods, mem = amb ? 3 * ZM + WM : pods * PM;
        C.pill(ctx, 0, 0, amb ? 'ambient' : '사이드카', amb ? 'ok' : 'warn');
        C.text(ctx, `프록시 ${proxies}개, ${mem >= 1000 ? `${(mem / 1000).toFixed(1)}GB` : `${mem}MB`}`, w, 11, { size: 11, weight: 700, color: !amb && pods > 10 ? U.red : U.text, align: 'right', base: 'middle' });
        const g = 8, nw = (w - 2 * g) / 3, y0 = 32, cw = (nw - 22) / 2, chh = 16;
        [0, 1, 2].forEach((nd) => {
          const x = nd * (nw + g);
          C.group(ctx, x, y0, nw, 190, `노드 ${nd + 1}`, y0 + 16);
          for (let r = 0; r < 10; r++) {
            const n = r * 3 + nd, cx = x + 8 + (r % 2) * (cw + 6), cy = y0 + 26 + Math.floor(r / 2) * (chh + 5);
            if (n >= pods) { ctx.strokeStyle = U.grid; ctx.setLineDash([3, 3]); ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, chh - 1); ctx.setLineDash([]); continue; }
            ctx.fillStyle = '#bfdbfe';
            ctx.beginPath(); ctx.roundRect(cx, cy, cw, chh, 3); ctx.fill();
            if (!amb) { ctx.fillStyle = '#8b5cf6'; ctx.beginPath(); ctx.roundRect(cx + cw - 12, cy, 12, chh, 3); ctx.fill(); }
          }
          if (amb) {
            if (nd === 0) { C.box(ctx, x + 8, y0 + 132, nw - 16, 20, { fill: '#ede9fe', stroke: '#c4b5fd', r: 4 }); C.text(ctx, 'waypoint', x + nw / 2, y0 + 142.5, { size: 10, weight: 600, color: PROXY[1], align: 'center', base: 'middle' }); }
            C.box(ctx, x + 8, y0 + 160, nw - 16, 22, { fill: L4[0], stroke: L4[2], r: 4 });
            C.text(ctx, 'ztunnel', x + nw / 2, y0 + 171.5, { size: 10, weight: 600, color: L4[1], align: 'center', base: 'middle' });
          }
        });
        if (run < 0) hint(ctx, '파드 30개 띄우기 버튼을 눌러 보자', w / 2, y0 + 110);
        if (run >= END) C.stamp(ctx, w / 2, y0 + 100, amb ? '프록시 4개, 96MB' : '프록시 30개, 1.8GB', amb ? 'ok' : 'bad', (run - END) / 0.4);
        say(`${amb ? 'ambient' : '사이드카'}. 파드 ${pods}개, 프록시 ${proxies}개, 메모리 ${mem}MB.`);
      },
    });
  });

  // Ambient: pods without sidecars, a ztunnel per node carrying HBONE between nodes; a waypoint joins only for L7.
  fig('istio-ambient', (root) => {
    const S = seq([6, 6.5], 1.8);
    const notes = [
      '파드에는 사이드카가 없다. 노드의 ztunnel이 요청을 받아 HBONE 터널로 다른 노드의 ztunnel에 넘긴다.',
      'L7 기능이 필요하면 waypoint를 붙인다. ztunnel이 waypoint를 거쳐 보내고, HTTP 규칙은 waypoint가 처리한다.',
    ];
    hwa.scene(root, {
      height: 258, still: S.still, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time);
        C.pill(ctx, 0, 0, i ? 'ztunnel과 waypoint' : 'ztunnel만', 'info');
        const nw = Math.min(220, (w - 84) / 2), y0 = 32, nh = 192, mid = w / 2;
        const N = [0, w - nw].map((x, side) => ({ x, cx: x + nw / 2, pod: { x: x + 10, y: y0 + 32, w: nw - 20, h: 46, t: side ? '파드 B' : '파드 A', s: '사이드카 없음' }, zt: { x: x + 10, y: y0 + 130, w: nw - 20, h: 46, t: 'ztunnel', s: side ? '15008 받음' : '15001 나감' } }));
        const ww = Math.min(140, w - 2 * nw - 12), wp = { x: mid - ww / 2, y: y0 + 72, w: ww, h: 46, t: 'waypoint', s: 'L7' };
        const zy = N[0].zt.y + 23, py = N[0].pod.y + 23;
        let pts, times;
        if (i === 0) { pts = [[N[0].cx, py], [N[0].cx, zy], [N[1].cx, zy], [N[1].cx, py]]; times = [[0.3, 1.3], [1.7, 3.4], [3.8, 4.8]]; }
        else { pts = [[N[0].cx, py], [N[0].cx, zy], [mid, wp.y + 23], [N[1].cx, zy], [N[1].cx, py]]; times = [[0.3, 1.3], [1.7, 2.7], [3.3, 4.3], [4.7, 5.7]]; }
        const m = walk(pts, times, t), seg = m.seg, last = times.length - 1;
        if (i === 1) [[pts[1], pts[2]], [pts[2], pts[3]]].forEach(([a, b]) => C.dashed(ctx, a[0], a[1], b[0], b[1], '#94a3b8'));
        N.forEach((n, side) => {
          C.group(ctx, n.x, y0, nw, nh, `노드 ${side + 1}`, y0 + 18);
          C.card(ctx, n.pod, { lit: (side === 0 && seg === 0 && t < 1.4) || (side === 1 && seg === last && t > times[last][1] - 0.2) });
          const near = side ? seg === last - 1 && t > times[last - 1][1] - 0.3 : seg === 0 && t > times[0][1] - 0.2 && t < times[1][0] + 0.4;
          C.card(ctx, n.zt, { ...tone(L4), lit: near });
        });
        if (i === 1) C.card(ctx, wp, { ...tone(PROXY), lit: seg === 1 && t > times[1][1] - 0.2 && t < times[2][0] + 0.3 });
        else C.dashed(ctx, N[0].x + nw, zy, N[1].x, zy, '#94a3b8');
        if (seg >= 0 && t < times[last][1] + 0.3) {
          const tunnel = seg >= 1 && seg < last;
          tag(ctx, tunnel ? 'HBONE' : 'HTTP', m.p[0], m.p[1], tunnel ? OK : BLUE);
        }
        C.stamp(ctx, mid, y0 + nh + 18, i ? 'L7은 waypoint에서' : '파드 재시작 없이 mTLS', i ? 'info' : 'ok', (run - (i ? 6.5 : 6)) / 0.4);
        say(notes[i]);
      },
    });
  });
})();
