// TLS post figures: roles, keys, handshake, cipher suites, certificates, revocation, private CA, Kubernetes.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const mv = (k, a, b) => hwa.smooth((k - a) / (b - a));
  const mix = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], GREEN = ['#dcfce7', '#15803d', '#86efac'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'];
  const RED = ['#fee2e2', '#dc2626', '#fca5a5'], PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], MUTE = [U.cell, U.muted, '#e2e8f0'];

  const lock = (ctx, x, y, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x - 3.5, y - 1, 7, 5.5);
    ctx.beginPath();
    ctx.arc(x, y - 1, 2.3, Math.PI, 0);
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.lineWidth = 1;
  };
  const key = (ctx, x, y, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x - 2, y, 2.6, 0, TAU);
    ctx.moveTo(x + 0.6, y); ctx.lineTo(x + 5, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 4, y + 2.6);
    ctx.stroke();
    ctx.lineWidth = 1;
  };
  const tagW = (ctx, s, icon) => tw(ctx, s, 10, 600) + 16 + (icon ? 12 : 0);
  // Chip centred at (x, y). col = [bg, fg, line]; icon draws a lock or key before the text.
  const tag = (ctx, s, x, y, col, { a = 1, icon } = {}) => {
    if (a <= 0) return;
    const cw = tagW(ctx, s, icon), x0 = x - cw / 2;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x0 + 0.5, y - 9.5, cw - 1, 19, 6);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    if (icon) icon(ctx, x0 + 12, y, col[1]);
    C.text(ctx, s, x0 + (icon ? 20 : 8), y + 0.5, { size: 10, weight: 600, color: col[1], base: 'middle' });
    ctx.globalAlpha = 1;
  };
  // Chip moving from p to q; fades at both ends so it never rests on a card.
  const fly = (ctx, s, p, q, f, col, icon) => {
    if (f <= 0 || f >= 1) return;
    tag(ctx, s, ...mix(p, q, f), col, { a: Math.min(1, f * 6, (1 - f) * 6), icon });
  };
  // Stamp kept inside the canvas width.
  const stamp = (ctx, w, cx, cy, s, tone, k) => {
    const half = (tw(ctx, s, 13, 700) + 28) / 2;
    C.stamp(ctx, clamp(cx, half + 1, w - half - 1), cy, s, tone, k);
  };
  // Demo figures: the mode picks the scene and the run button plays it once. Without demo it loops.
  const play = (time, ui, demo, SEC, HOLD, n) => {
    if (demo) return { i: ui.mode, run: ui.runAt === null ? -1 : time - ui.runAt };
    const len = SEC + HOLD, at = time % (len * n), i = Math.floor(at / len);
    return { i, run: at - i * len };
  };
  const hint = (ctx, w, y, demo) => C.text(ctx, `${demo.run} 버튼을 눌러 보자`, w / 2, y, { size: 12, align: 'center', base: 'middle' });
  const fig = (id, make) => document.querySelectorAll(`[data-figure="tls-certificate-${id}"]`).forEach((root) => hwa.scene(root, make(root)));

  // Same packet over HTTP and HTTPS past a man in the middle: read, altered, impersonated.
  fig('roles', () => {
    const SEC = 6.4, HOLD = 1.8, TOP = 30, LH = 112;
    const S = [
      { pill: '엿보기', at: 'mid', note: '엿보기: HTTP 비밀번호는 중간에서 그대로 읽히고, HTTPS는 암호문만 보인다.', lanes: [
        { send: ['pw=1234', BLUE], see: ['pw=1234 읽음', RED], next: ['pw=1234', BLUE], stamp: ['비밀번호 노출', 'bad'] },
        { send: ['x9f#2a', PURPLE, lock], see: ['암호문만 보임', MUTE], next: ['x9f#2a', PURPLE, lock], stamp: ['못 읽음', 'ok'] }] },
      { pill: '변조', at: 'srv', note: '변조: HTTP는 바뀐 금액이 그대로 처리되고, HTTPS는 서버가 변조를 알아채 연결을 끊는다.', lanes: [
        { send: ['1만원 송금', BLUE], see: ['100만원으로 바꿈', RED], next: ['100만원 송금', RED], stamp: ['바뀐 채 처리', 'bad'] },
        { send: ['c71e0b', PURPLE, lock], see: ['몇 바이트 바꿈', RED], next: ['c71e0b', RED, lock], stamp: ['변조 감지, 연결 끊음', 'ok'] }] },
      { pill: '사칭', at: 'br', back: true, note: '사칭: HTTP는 가짜 서버의 화면을 띄우고, HTTPS는 인증서가 맞지 않아 연결을 끊는다.', lanes: [
        { send: ['GET /login', BLUE], see: ['서버인 척 응답', RED], next: ['가짜 로그인 화면', RED], stamp: ['가짜 화면 표시', 'bad'] },
        { send: ['ClientHello', BLUE], see: ['서버인 척 응답', RED], next: ['가짜 인증서', RED], stamp: ['인증서 불일치, 차단', 'ok'] }] },
    ];
    return {
      height: TOP + 2 * LH - 6, still: 2 * (SEC + HOLD) + SEC + 0.5, scenes: hwa.loopScenes(SEC, HOLD, 3), notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), sc = S[i], bw = clamp(w * 0.2, 62, 110);
        const X = { br: [8, 8 + bw], mid: [(w - bw) / 2, (w + bw) / 2], srv: [w - 8 - bw, w - 8] };
        const p1 = mv(k, 0.05, 0.36), seen = mv(k, 0.36, 0.46), p2 = mv(k, 0.55, 0.85), done = (k - 0.88) / 0.08;
        C.pill(ctx, 0, 0, sc.pill, 'info');
        sc.lanes.forEach((ln, j) => {
          const y0 = TOP + j * LH, cy = y0 + 46;
          C.group(ctx, 0, y0, w, LH - 10, j ? 'HTTPS' : 'HTTP');
          C.line(ctx, [[X.br[1], cy], [X.srv[0], cy]], '#e2e8f0', 1);
          C.card(ctx, { x: X.br[0], y: cy - 18, w: bw, h: 36, t: '브라우저' }, { lit: sc.at === 'br' && done > 0 });
          C.card(ctx, { x: X.mid[0], y: cy - 18, w: bw, h: 36, t: '중간자' }, { fill: RED[0], stroke: RED[2], dash: [4, 3] });
          C.card(ctx, { x: X.srv[0], y: cy - 18, w: bw, h: 36, t: '서버' }, sc.back ? { dim: true, dash: [4, 3], fill: U.plot } : { lit: sc.at === 'srv' && done > 0 });
          fly(ctx, ln.send[0], [X.br[1], cy], [X.mid[0], cy], p1, ln.send[1], ln.send[2]);
          tag(ctx, ln.see[0], w / 2, cy - 31, ln.see[1], { a: seen });
          if (sc.back) fly(ctx, ln.next[0], [X.mid[0], cy], [X.br[1], cy], p2, ln.next[1], ln.next[2]);
          else fly(ctx, ln.next[0], [X.mid[1], cy], [X.srv[0], cy], p2, ln.next[1], ln.next[2]);
          stamp(ctx, w, (X[sc.at][0] + X[sc.at][1]) / 2, cy + 36, ln.stamp[0], ln.stamp[1], done);
        });
        say(`${sc.pill}. ${sc.note}`);
      },
    };
  });

  // Browser and server either side of the network: symmetric key, key agreement, signature.
  fig('keys', () => {
    const SEC = 6.6, HOLD = 1.8, TOP = 30, BH = 210;
    const S = [
      { pill: '대칭키', stamp: ['빠르지만 키 전달이 문제', 'warn'], note: '대칭키: 같은 세션키로 잠그고 연다. 빠르지만 그 키를 미리 나눠 가질 방법이 없다.' },
      { pill: '키 합의 (ECDHE)', stamp: ['공개값만 오가고 같은 키', 'ok'], note: '키 합의: 공개값 A와 B만 네트워크를 지나고, 양쪽은 각자 비밀값과 섞어 같은 세션키를 얻는다.' },
      { pill: '서명', stamp: ['서버가 보낸 값 맞음', 'ok'], note: '서명: 서버가 개인키로 서명한 값을 브라우저가 인증서 속 공개키로 확인한다.' },
    ];
    return {
      height: TOP + BH + 2, still: 2 * (SEC + HOLD) + SEC + 0.5, scenes: hwa.loopScenes(SEC, HOLD, 3), notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), bw = clamp(w * 0.3, 96, 180), bx = bw / 2, sx = w - bw / 2, mx = w / 2;
        const R = [TOP + 42, TOP + 82, TOP + 122, TOP + 162];
        C.pill(ctx, 0, 0, S[i].pill, 'info');
        C.group(ctx, 0, TOP, bw, BH - 30, '브라우저');
        C.group(ctx, w - bw, TOP, bw, BH - 30, '서버');
        C.box(ctx, bw + 8, TOP, w - 2 * bw - 16, BH - 30, { fill: '#fff', dash: [4, 3] });
        C.text(ctx, '네트워크', mx, TOP + 16, { size: 10, weight: 600, align: 'center' });
        const both = (s, r, col, a, icon) => { tag(ctx, s, bx, R[r], col, { a, icon }); tag(ctx, s, sx, R[r], col, { a, icon }); };
        if (i === 0) {
          both('세션키', 0, GREEN, mv(k, 0, 0.1), key);
          const enc = mv(k, 0.15, 0.25), dec = mv(k, 0.72, 0.82), go = mv(k, 0.3, 0.62);
          tag(ctx, '주문 내역', bx, R[1], BLUE, { a: 1 - enc });
          if (go <= 0) tag(ctx, 'a7#c0e', bx, R[1], PURPLE, { a: enc, icon: lock });
          fly(ctx, 'a7#c0e', [bx, R[1]], [sx, R[1]], go, PURPLE, lock);
          tag(ctx, 'a7#c0e', mx, R[2], MUTE, { a: mv(k, 0.44, 0.5), icon: lock });
          if (go >= 1) { tag(ctx, 'a7#c0e', sx, R[1], PURPLE, { a: 1 - dec, icon: lock }); tag(ctx, '주문 내역', sx, R[1], BLUE, { a: dec }); }
        } else if (i === 1) {
          tag(ctx, 'a 비밀', bx, R[0], PURPLE, { a: mv(k, 0, 0.1), icon: key });
          tag(ctx, 'b 비밀', sx, R[0], PURPLE, { a: mv(k, 0, 0.1), icon: key });
          const show = mv(k, 0.1, 0.18), go = mv(k, 0.25, 0.55), got = go >= 1 ? 1 : 0;
          tag(ctx, 'A 공개값', bx, R[1], BLUE, { a: show });
          tag(ctx, 'B 공개값', sx, R[2], BLUE, { a: show });
          fly(ctx, 'A 공개값', [bx, R[1]], [sx, R[1]], go, BLUE);
          fly(ctx, 'B 공개값', [sx, R[2]], [bx, R[2]], go, BLUE);
          tag(ctx, 'A 공개값', sx, R[1], BLUE, { a: got });
          tag(ctx, 'B 공개값', bx, R[2], BLUE, { a: got });
          tag(ctx, 'A', mx - 16, R[1], MUTE, { a: mv(k, 0.38, 0.44) });
          tag(ctx, 'B', mx + 16, R[1], MUTE, { a: mv(k, 0.38, 0.44) });
          both('세션키', 3, GREEN, mv(k, 0.62, 0.72), key);
          tag(ctx, '세션키 계산 불가', mx, R[3], MUTE, { a: mv(k, 0.7, 0.78) });
        } else {
          tag(ctx, '공개키', bx, R[0], BLUE, { a: mv(k, 0, 0.1), icon: key });
          C.text(ctx, '인증서에서', bx, R[0] + 20, { size: 9, align: 'center', base: 'middle' });
          tag(ctx, '개인키', sx, R[0], PURPLE, { a: mv(k, 0, 0.1), icon: key });
          const sign = mv(k, 0.15, 0.28), go = mv(k, 0.32, 0.6);
          tag(ctx, 'A, B', sx, R[1], MUTE, { a: 1 - sign });
          tag(ctx, 'A, B + 서명', sx, R[1], PURPLE, { a: sign });
          fly(ctx, 'A, B + 서명', [sx, R[1]], [bx, R[1]], go, PURPLE);
          tag(ctx, 'A, B + 서명', mx, R[2], MUTE, { a: mv(k, 0.44, 0.5) });
          tag(ctx, 'A, B + 서명', bx, R[1], PURPLE, { a: go >= 1 ? 1 : 0 });
          tag(ctx, '서명 맞음', bx, R[2], GREEN, { a: mv(k, 0.68, 0.78) });
        }
        stamp(ctx, w, mx, TOP + BH - 12, S[i].stamp[0], S[i].stamp[1], (k - 0.86) / 0.08);
        say(`${S[i].pill}. ${S[i].note}`);
      },
    };
  });

  // Demo: TCP plus TLS 1.2 or TLS 1.3 to a server 100ms away, until the first response arrives.
  fig('handshake', () => {
    const SEC = 6.5, HOLD = 2, SPAN = 400, demo = { modes: ['TLS 1.2', 'TLS 1.3'], run: '접속하기' };
    const COL = { tcp: '#94a3b8', tls: U.purple, http: U.blue };
    const M = [
      { pill: 'TLS 1.2', end: 400, stamp: ['첫 응답 400ms', 'bad'], note: 'TLS 1.2: TCP 1 RTT, 핸드셰이크 2 RTT, 요청 1 RTT로 첫 응답까지 400ms다.',
        msgs: [['SYN', 'tcp'], ['SYN-ACK', 'tcp'], ['ClientHello', 'tls'], ['ServerHello, 인증서', 'tls'], ['키 교환, Finished', 'tls'], ['Finished', 'tls'], ['GET /', 'http'], ['200 OK', 'http']],
        bands: [[0, 100, 'TCP', 'tcp'], [100, 300, 'TLS 2 RTT', 'tls'], [300, 400, '요청', 'http']] },
      { pill: 'TLS 1.3', end: 300, stamp: ['첫 응답 300ms', 'ok'], note: 'TLS 1.3: ClientHello에 키 공유 값을 실어 핸드셰이크가 1 RTT로 줄고, 첫 응답이 300ms에 온다.',
        msgs: [['SYN', 'tcp'], ['SYN-ACK', 'tcp'], ['ClientHello, 키 공유', 'tls'], ['ServerHello, 인증서, Finished', 'tls'], ['Finished, GET /', 'http'], ['200 OK', 'http']],
        bands: [[0, 100, 'TCP', 'tcp'], [100, 200, 'TLS 1 RTT', 'tls'], [200, 300, '요청', 'http']] },
    ];
    return {
      height: 222, still: SEC + HOLD + SEC, notes: M.map((m) => m.note), demo: demo,
      frame: (ctx, w, h, time, say, ui) => {
        const { i, run } = play(time, ui, demo, SEC, HOLD, 2), m = M[i], k = clamp(run / SEC), t = k * SPAN;
        const lw = Math.min(64, w * 0.18), x0 = lw, x1 = w - 10, yB = 62, yS = 150, X = (v) => x0 + (v / SPAN) * (x1 - x0), room = X(100) - X(0) - 8;
        C.pill(ctx, 0, 0, m.pill, 'info');
        C.text(ctx, '왕복 100ms', w, 11, { size: 10, align: 'right', base: 'middle' });
        [[yB, '브라우저'], [yS, '서버']].forEach(([y, s]) => {
          C.text(ctx, s, 0, y, { size: 10, weight: 600, color: U.text, base: 'middle' });
          C.line(ctx, [[x0, y], [x1, y]], '#cbd5e1', 1);
        });
        [100, 200, 300, 400].forEach((v) => C.dashed(ctx, X(v), yB, X(v), yS, U.grid));
        [0, 100, 200, 300, 400].forEach((v) => C.text(ctx, v ? `${v}ms` : '0', X(v), h - 4, { size: 9, align: v === 0 ? 'left' : v === SPAN ? 'right' : 'center' }));
        m.msgs.forEach(([s, kind], j) => {
          const t0 = j * 50, f = clamp((t - t0) / 50), down = j % 2 === 0;
          if (f <= 0) return;
          C.arrow(ctx, down ? [[X(t0), yB], [X(t0 + 50), yS]] : [[X(t0), yS], [X(t0 + 50), yB]], f, COL[kind], { width: 1.6 });
          if (f >= 1 && tw(ctx, s, 9, 600) < room) C.text(ctx, s, X(t0), down ? yB - 8 : yS + 14, { size: 9, weight: 600, color: COL[kind] });
        });
        m.bands.forEach(([a, b, s, kind]) => {
          if (t <= a) return;
          const y = yS + 34, xa = X(a) + 2, xb = X(Math.min(t, b)) - 2;
          C.line(ctx, [[xa, y - 4], [xa, y], [xb, y], [xb, y - 4]], COL[kind], 1.2);
          if (t >= b && tw(ctx, s, 10, 600) < xb - xa) C.text(ctx, s, (xa + xb) / 2, y + 13, { size: 10, weight: 600, color: kind === 'tcp' ? U.muted : COL[kind], align: 'center' });
        });
        if (k > 0 && k < 1) C.dashed(ctx, X(t), yB - 4, X(t), yS + 4, U.now);
        if (t >= m.end) C.dashed(ctx, X(m.end), yB, X(m.end), yS + 22, U.tones[m.stamp[1]][1]);
        stamp(ctx, w, (x0 + x1) / 2, (yB + yS) / 2, m.stamp[0], m.stamp[1], (run - SEC) / 0.4);
        if (run < 0) hint(ctx, w, (yB + yS) / 2, demo);
        say(`${m.pill}. ${m.note}`);
      },
    };
  });

  // Four roles of a cipher suite: TLS 1.2 names all four, TLS 1.3 names two and leaves two to extensions.
  fig('suite', () => {
    const SEC = 6.6, HOLD = 2;
    const ROLE = [['키 합의', BLUE], ['서명', PURPLE], ['데이터 암호화', GREEN], ['해시', ORANGE]];
    const S = [
      { pill: 'TLS 1.2', parts: [['ECDHE', 0], ['-'], ['RSA', 1], ['-'], ['AES128-GCM', 2], ['-'], ['SHA256', 3]], ext: [], stamp: ['이름 하나가 네 칸', 'info'],
        note: 'TLS 1.2: 이름의 네 조각이 키 합의, 서명, 데이터 암호화, 해시를 모두 정한다.' },
      { pill: 'TLS 1.3', parts: [['TLS_'], ['AES_128_GCM', 2], ['_'], ['SHA256', 3]], ext: [[0, 'X25519MLKEM768', 'supported_groups'], [1, 'ecdsa_secp256r1_sha256', 'signature_algorithms']], stamp: ['이름은 두 칸만', 'info'],
        note: 'TLS 1.3: 이름은 데이터 암호화와 해시만 정하고, 키 합의와 서명은 확장 칸에서 따로 고른다.' },
    ];
    const NY = 46, RY = (r) => 88 + r * 40;
    return {
      height: RY(3) + 58, still: SEC + HOLD + SEC + 0.5, scenes: hwa.loopScenes(SEC, HOLD, 2), notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2), sc = S[i], lw = 104;
        C.pill(ctx, 0, 0, sc.pill, 'info');
        C.text(ctx, 'cipher suite 이름', w, 11, { size: 10, align: 'right', base: 'middle' });
        const total = sc.parts.reduce((a, [s]) => a + tw(ctx, s, 13, 700), 0);
        let x = (w - total) / 2, order = 0;
        const flights = [];
        sc.parts.forEach(([s, r]) => {
          const pw = tw(ctx, s, 13, 700);
          C.text(ctx, s, x, NY, { size: 13, weight: 700, color: r === undefined ? U.muted : ROLE[r][1][1], base: 'middle' });
          if (r !== undefined) flights.push([s, r, [x + pw / 2, NY], mv(k, 0.12 + order * 0.13, 0.32 + order * 0.13)]), order++;
          x += pw;
        });
        ROLE.forEach(([name, col], r) => {
          const y = RY(r), ext = sc.ext.find((e) => e[0] === r);
          C.box(ctx, lw, y - 15, w - lw, 30, { fill: U.plot, r: 6 });
          C.text(ctx, name, 0, ext ? y - 6 : y, { size: 11, weight: 600, color: U.text, base: 'middle' });
          if (ext) C.text(ctx, ext[2], 0, y + 9, { size: 9, base: 'middle' });
          const fromName = flights.find((f) => f[1] === r);
          if (!fromName && !ext) return;
          if (ext) {
            const f = mv(k, 0.62 + r * 0.1, 0.78 + r * 0.1), tx = lw + 10 + tagW(ctx, ext[1]) / 2;
            if (f <= 0) C.text(ctx, '이름에 없음', lw + 10, y, { size: 10, base: 'middle' });
            tag(ctx, ext[1], tx + (1 - f) * 30, y, col, { a: f });
          }
        });
        flights.forEach(([s, r, from, f]) => {
          const to = [lw + 10 + tagW(ctx, s) / 2, RY(r)];
          if (f >= 1) tag(ctx, s, ...to, ROLE[r][1]);
          else if (f > 0) tag(ctx, s, ...mix(from, to, f), ROLE[r][1]);
        });
        stamp(ctx, w, w / 2, RY(3) + 40, sc.stamp[0], sc.stamp[1], (k - 0.9) / 0.06);
        say(`${sc.pill}. ${sc.note}`);
      },
    };
  });

  // Client offer against nginx's list, scanned in client order (ssl_prefer_server_ciphers off).
  fig('negotiate', () => {
    const SEC = 6, HOLD = 2;
    const NEW = ['최신 브라우저', 'TLS 1.3 지원', [['1.3', 'aes', 'TLS 1.3 AES-128-GCM'], ['1.3', 'chacha', 'TLS 1.3 CHACHA20'], ['1.2', 'gcm', 'TLS 1.2 ECDHE GCM']]];
    const OLD = ['오래된 클라이언트', 'TLS 1.3 모름', [['1.2', 'gcm', 'TLS 1.2 ECDHE GCM'], ['1.2', 'cbc', 'TLS 1.2 RSA CBC']]];
    const INTER = ['nginx', 'Intermediate', [['1.3', '*', 'TLS 1.3 세 개 전부'], ['1.2', 'gcm', 'TLS 1.2 ECDHE GCM'], ['1.2', 'chacha', 'TLS 1.2 ECDHE CHACHA']]];
    const MODERN = ['nginx', 'Modern', [['1.3', '*', 'TLS 1.3 세 개 전부']]];
    const S = [
      { c: NEW, s: INTER, pill: 'Intermediate 설정', stamp: '연결: TLS 1.3', note: '최신 브라우저는 첫 줄의 TLS 1.3 조합이 바로 겹친다.' },
      { c: OLD, s: INTER, pill: 'Intermediate 설정', stamp: '연결: TLS 1.2', note: 'TLS 1.3을 모르는 클라이언트도 Intermediate의 ECDHE GCM 줄과 겹쳐 붙는다.' },
      { c: OLD, s: MODERN, pill: 'Modern 설정', stamp: 'handshake failure', note: 'Modern은 TLS 1.3만 받아서, 같은 클라이언트와 겹치는 줄이 없어 연결이 끊긴다.' },
    ];
    const match = (c, s) => c[0] === s[0] && (s[1] === '*' || s[1] === c[1]);
    const TOP = 32, RY = (j) => TOP + 62 + j * 30;
    return {
      height: RY(3) + 46, still: 2 * (SEC + HOLD) + SEC + 0.5, scenes: hwa.loopScenes(SEC, HOLD, 3), notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), sc = S[i], cw = (w - 28) / 2, sx0 = w - cw;
        const cRows = sc.c[2], sRows = sc.s[2], mi = cRows.findIndex((c) => sRows.some((s) => match(c, s)));
        const last = mi < 0 ? cRows.length - 1 : mi, win = (j) => [0.12 + j * 0.2, 0.3 + j * 0.2];
        C.pill(ctx, 0, 0, sc.pill, mi < 0 ? 'warn' : 'info');
        if (tw(ctx, sc.pill, 11, 600) + tw(ctx, '클라이언트 순서대로', 10) + 50 < w) C.text(ctx, '클라이언트 순서대로', w, 11, { size: 10, align: 'right', base: 'middle' });
        [[0, sc.c], [sx0, sc.s]].forEach(([x, [title, sub]]) => {
          C.group(ctx, x, TOP, cw, RY(2) + 22 - TOP, title, TOP + 17);
          C.text(ctx, sub, x + 10, TOP + 32, { size: 10 });
        });
        const row = (x, y, s, state) => {
          const fill = state === 'ok' ? GREEN[0] : state === 'now' ? U.accentSoft : '#fff', stroke = state === 'ok' ? GREEN[2] : state === 'now' ? U.accentLine : U.grid;
          C.box(ctx, x + 8, y - 11, cw - 16, 22, { fill, stroke, r: 5 });
          C.text(ctx, s, x + 15, y + 0.5, { size: 10, weight: 600, color: state === 'no' ? '#cbd5e1' : state === 'ok' ? GREEN[1] : U.text, base: 'middle' });
          if (state === 'no') C.line(ctx, [[x + 14, y], [x + 14 + tw(ctx, s, 10, 600), y]], RED[2], 1);
        };
        const found = mi >= 0 && k >= win(mi)[1];
        sRows.forEach((s, j) => row(sx0, RY(j), s[2], found && match(cRows[mi], s) && sRows.findIndex((x) => match(cRows[mi], x)) === j ? 'ok' : ''));
        cRows.forEach((c, j) => {
          const [a, b] = win(j);
          const state = j > last || k < a ? '' : k < b ? 'now' : j === mi ? 'ok' : 'no';
          row(0, RY(j), c[2], state);
        });
        if (found) {
          const sj = sRows.findIndex((x) => match(cRows[mi], x));
          C.arrow(ctx, [[cw - 8, RY(mi)], [sx0 + 8, RY(sj)]], mv(k, win(mi)[1], win(mi)[1] + 0.08), GREEN[1], { width: 1.6 });
        }
        const end = win(last)[1] + 0.08;
        stamp(ctx, w, w / 2, RY(3) + 18, sc.stamp, mi < 0 ? 'bad' : 'ok', (k - end) / 0.06);
        say(`${sc.pill}, ${sc.c[0]}. ${sc.note}`);
      },
    };
  });

  // Fields of one server certificate filled in turn, with what the client checks in each.
  fig('fields', () => {
    const ROWS = [
      ['주체', 'CN=shop.example.com', '이름 확인에 CN은 쓰지 않는다'],
      ['SAN', 'shop.example.com, *.shop.example.com', '접속한 주소가 여기 있는지'],
      ['공개키', 'ECDSA P-256', '핸드셰이크 서명을 이 키로 검증'],
      ['발급자', 'CN=Example Issuing CA', '발급자 인증서를 찾아 체인을 잇는다'],
      ['유효기간', '2026-11-01 ~ 2027-05-19', '오늘이 기간 안인지'],
      ['용도', 'serverAuth, CA:FALSE', '서버 인증용이고 CA가 아닌지'],
      ['서명', 'ecdsa-with-SHA256', '발급자 공개키로 위 내용을 검증'],
    ];
    const N = ROWS.length, STEP = 1.3, HOLDS = 3, TOP = 30, RH = 26, RY = (j) => TOP + 36 + j * RH;
    return {
      height: RY(N) + 40, still: N * STEP + 1,
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, N, STEP, HOLDS), cur = s.done ? -1 : s.active;
        C.pill(ctx, 0, 0, cur < 0 ? '서버 인증서 (X.509)' : ROWS[cur][0], 'info');
        C.box(ctx, 0, TOP, w, RY(N) - TOP + 4, { fill: '#fff' });
        C.text(ctx, '서버 인증서', 12, TOP + 18, { size: 11, weight: 600, color: U.text });
        const lw = 64;
        ROWS.forEach(([name, val], j) => {
          const a = s.k(j), y = RY(j) + RH / 2;
          if (j === cur) C.box(ctx, 4, RY(j), w - 8, RH - 2, { on: true, r: 5 });
          C.text(ctx, name, 12, y, { size: 10, weight: 600, color: a > 0 ? U.text : '#cbd5e1', base: 'middle' });
          ctx.globalAlpha = a;
          C.text(ctx, val, lw + 8, y, { size: 10, color: j === N - 1 ? PURPLE[1] : U.text, base: 'middle' });
          ctx.globalAlpha = 1;
        });
        // Signature covers every field above it.
        if (s.k(N - 1) > 0) {
          const bx = w - 10, a = s.k(N - 1);
          ctx.globalAlpha = a;
          C.line(ctx, [[bx - 4, RY(0) + 4], [bx, RY(0) + 4], [bx, RY(N - 1) - 2], [bx - 4, RY(N - 1) - 2]], PURPLE[2], 1.2);
          C.text(ctx, '서명 대상', bx - 6, TOP + 18, { size: 9, weight: 600, color: PURPLE[1], align: 'right' });
          ctx.globalAlpha = 1;
        }
        const ly = RY(N) + 24;
        if (cur >= 0) {
          C.text(ctx, '확인', 0, ly, { size: 10, weight: 700, color: U.accent, base: 'middle' });
          C.text(ctx, ROWS[cur][2], 30, ly, { size: 11, weight: 600, color: U.text, base: 'middle' });
        } else {
          C.box(ctx, 0, ly - 13, w, 26, { fill: U.plot, dash: [4, 3], r: 6 });
          const fp = '지문 = 인증서 전체의 SHA-256 해시', fp2 = '인증서 안에 없는 값';
          C.text(ctx, fp, 10, ly + 0.5, { size: 10, weight: 600, color: U.text, base: 'middle' });
          if (tw(ctx, fp, 10, 600) + tw(ctx, fp2, 10) + 34 < w) C.text(ctx, fp2, w - 10, ly + 0.5, { size: 10, align: 'right', base: 'middle' });
        }
        say(cur < 0 ? '서버 인증서의 일곱 칸. 지문은 인증서 전체의 해시라 인증서 안에 없다.' : `${ROWS[cur][0]}: ${ROWS[cur][1]}. 확인: ${ROWS[cur][2]}.`);
      },
    };
  });

  // Demo: the server sends its certificate with or without the intermediate; the client climbs to a root it trusts.
  fig('chain', () => {
    const SEC = 6, HOLD = 2, TOP = 30, demo = { modes: ['중간 인증서까지 보냄', '서버 인증서만 보냄'], run: '접속하기' };
    const notes = [
      '중간 인증서까지 보내면 서버 인증서, 중간 CA, 저장소의 루트 순으로 서명이 이어진다.',
      '서버 인증서만 보내면 발급자인 중간 CA를 찾지 못해 첫 칸에서 검증이 멈춘다.',
    ];
    return {
      height: TOP + 262, still: SEC + HOLD + SEC + 0.5, notes, demo: demo,
      frame: (ctx, w, h, time, say, ui) => {
        const { i, run } = play(time, ui, demo, SEC, HOLD, 2), k = clamp(run / SEC), full = i === 0;
        const cw = Math.round(w * 0.58), sw = w - cw - 14, sx0 = w - sw, scx = sx0 + sw / 2, lx = cw / 2;
        const ROOT = TOP + 62, INT = TOP + 128, LEAF = TOP + 186, GB = TOP + 222;
        C.pill(ctx, 0, 0, full ? 'fullchain.crt' : 'server.crt', 'info');
        C.group(ctx, 0, TOP, cw, GB - TOP, '클라이언트');
        C.group(ctx, sx0, TOP, sw, GB - TOP, '서버');
        C.box(ctx, 8, TOP + 26, cw - 16, 50, { fill: '#fff' });
        C.text(ctx, '신뢰 저장소', 16, TOP + 40, { size: 9 });
        const rootOk = full && k >= 0.72;
        ['루트 A', '루트 B', '루트 C'].forEach((s, j) => tag(ctx, s, 8 + (cw - 16) * (j * 2 + 1) / 6, ROOT, j === 1 && rootOk ? GREEN : MUTE));
        [[INT, '중간 CA'], [LEAF, '서버 인증서']].forEach(([y, s]) => {
          C.box(ctx, lx - 50, y - 12, 100, 24, { fill: U.plot, dash: [3, 3], r: 6 });
          if (run < 0 || (y === INT && !full)) C.text(ctx, y === INT && !full && k >= 0.5 ? '발급자 없음' : s, lx, y + 0.5, { size: 9, weight: y === INT && !full && k >= 0.5 ? 700 : 400, color: y === INT && !full && k >= 0.5 ? RED[1] : '#94a3b8', align: 'center', base: 'middle' });
        });
        // Server side: what nginx sends.
        C.text(ctx, full ? 'fullchain.crt' : 'server.crt', sx0 + 10, TOP + 38, { size: 10, weight: 600, color: U.text });
        const SY = [TOP + 62, TOP + 92];
        tag(ctx, '서버 인증서', scx, SY[0], BLUE);
        if (full) tag(ctx, '중간 CA', scx, SY[1], PURPLE);
        else {
          C.box(ctx, scx - 44, SY[1] - 10, 88, 20, { fill: U.plot, dash: [3, 3], r: 6 });
          C.text(ctx, '중간 CA 빠짐', scx, SY[1] + 0.5, { size: 9, weight: 600, color: RED[1], align: 'center', base: 'middle' });
        }
        tag(ctx, 'server.key', scx, TOP + 150, MUTE, { icon: key });
        if (run >= 0) {
          const f1 = mv(k, 0.05, 0.3), f2 = mv(k, 0.12, 0.37);
          if (f1 >= 1) tag(ctx, '서버 인증서', lx, LEAF, BLUE); else if (f1 > 0) tag(ctx, '서버 인증서', ...mix([scx, SY[0]], [lx, LEAF], f1), BLUE);
          if (full) { if (f2 >= 1) tag(ctx, '중간 CA', lx, INT, PURPLE); else if (f2 > 0) tag(ctx, '중간 CA', ...mix([scx, SY[1]], [lx, INT], f2), PURPLE); }
          const l1 = mv(k, 0.42, 0.55), l2 = mv(k, 0.6, 0.72);
          if (full) {
            C.arrow(ctx, [[lx, LEAF - 12], [lx, INT + 12]], l1, GREEN[1], { width: 1.6 });
            C.arrow(ctx, [[lx, INT - 12], [lx, ROOT + 11]], l2, GREEN[1], { width: 1.6 });
          } else C.arrow(ctx, [[lx, LEAF - 12], [lx, INT + 14]], l1, RED[1], { width: 1.6, dash: [4, 3] });
          if (l1 >= 1 && tw(ctx, '발급자 확인', 9, 600) + 64 < cw - lx) C.text(ctx, '발급자 확인', lx + 8, (LEAF + INT) / 2, { size: 9, weight: 600, color: full ? GREEN[1] : RED[1], base: 'middle' });
          const wide = full ? 'Verify return code: 0 (ok)' : 'unable to get local issuer certificate', short = full ? '검증 성공' : '발급자를 찾지 못함';
          stamp(ctx, w, w / 2, GB + 24, tw(ctx, wide, 13, 700) + 40 < w ? wide : short, full ? 'ok' : 'bad', (k - 0.84) / 0.08);
        } else hint(ctx, w, GB + 24, demo);
        say(`${demo.modes[i]}. ${notes[i]}`);
      },
    };
  });

  // Demo: the client asks the CA's OCSP responder itself, or the server staples a response it fetched earlier.
  fig('revocation', () => {
    const SEC = 6.4, HOLD = 2, TOP = 30, demo = { modes: ['직접 확인', 'OCSP stapling'], run: '접속하기' };
    const notes = [
      '직접 확인: 핸드셰이크 중에 CA까지 한 번 더 다녀오고, CA에는 누가 어느 사이트에 접속하는지 남는다.',
      'stapling: 서버가 미리 받아 둔 OCSP 응답을 인증서와 같이 보내서 추가 왕복이 없다.',
    ];
    return {
      height: TOP + 236, still: SEC + HOLD + SEC + 0.5, notes, demo: demo,
      frame: (ctx, w, h, time, say, ui) => {
        const { i, run } = play(time, ui, demo, SEC, HOLD, 2), k = clamp(run / SEC), staple = i === 1;
        const cw = clamp(w * 0.3, 96, 140), cax = Math.round(w * 0.36), CY = TOP + 140;
        const cl = { x: 0, y: CY - 20, w: cw, h: 40, t: '클라이언트', s: '203.0.113.7' }, sv = { x: w - cw, y: CY - 20, w: cw, h: 40, t: '서버', s: 'shop.example.com' };
        const caB = TOP + 74, L = [cw, CY], R = [w - cw, CY], caP = [cax + 24, caB], clT = [cw - 16, CY - 20], svT = [w - cw / 2, CY - 20];
        const rt = staple ? 0 : k >= 0.72 ? 1 : 0;
        C.pill(ctx, 0, 0, staple ? 'OCSP stapling' : 'OCSP 직접 확인', 'info');
        C.text(ctx, `CA 추가 왕복 ${rt}번`, w, 11, { size: 10, weight: 600, color: rt ? RED[1] : U.text, align: 'right', base: 'middle' });
        // CA responder with its access log.
        const ask = !staple && k >= 0.56;
        C.box(ctx, cax, TOP + 4, w - cax, caB - TOP - 4, { fill: '#fff', stroke: ask ? U.accent : U.grid });
        C.text(ctx, 'CA OCSP 응답자', cax + 10, TOP + 20, { size: 10, weight: 600, color: U.text });
        C.text(ctx, '접속 기록', cax + 10, TOP + 38, { size: 9 });
        const logA = staple ? 1 : mv(k, 0.56, 0.62);
        if (logA > 0) {
          ctx.globalAlpha = logA;
          C.text(ctx, staple ? '서버가 미리 조회' : '203.0.113.7 → shop.example.com', cax + 10, TOP + 56, { size: 9, weight: 600, color: staple ? U.muted : RED[1] });
          ctx.globalAlpha = 1;
        }
        C.line(ctx, [L, R], '#e2e8f0', 1);
        if (staple) { C.dashed(ctx, svT[0], svT[1], svT[0], caB, '#cbd5e1'); }
        else C.dashed(ctx, clT[0], clT[1], caP[0], caP[1], '#cbd5e1');
        C.card(ctx, cl, { lit: run >= 0 && k >= 0.84 });
        C.card(ctx, sv);
        if (staple) {
          tag(ctx, 'OCSP 응답', svT[0], CY + 38, GREEN);
          C.text(ctx, '미리 받아 둠', svT[0], CY + 60, { size: 9, align: 'center' });
        }
        if (run >= 0) {
          fly(ctx, 'ClientHello', L, R, mv(k, 0.04, 0.2), BLUE);
          if (staple) {
            fly(ctx, '인증서 + OCSP 응답', R, L, mv(k, 0.22, 0.42), GREEN);
            tag(ctx, 'CA 서명 확인', cw / 2, CY + 38, GREEN, { a: mv(k, 0.46, 0.56) });
          } else {
            fly(ctx, '인증서', R, L, mv(k, 0.2, 0.36), BLUE);
            fly(ctx, 'OCSP 조회', clT, caP, mv(k, 0.42, 0.56), ORANGE);
            fly(ctx, 'good', caP, clT, mv(k, 0.58, 0.72), GREEN);
            if (k >= 0.4 && k < 0.72) tag(ctx, '대기', cw / 2, CY + 38, ORANGE);
          }
          stamp(ctx, w, w / 2, h - 16, staple ? '추가 왕복 없음' : '왕복 +1, 접속 기록 남음', staple ? 'ok' : 'bad', (k - 0.84) / 0.08);
        } else hint(ctx, w, h - 16, demo);
        say(`${demo.modes[i]}. ${notes[i]}`);
      },
    };
  });

  // Maximum public TLS certificate lifetime against Let's Encrypt's default, 2025 to 2030.
  fig('lifetime', () => {
    const SEC = 7.5, HOLD = 2.4, A = 2025, B = 2030, NOW = 2026 + 10 / 12;
    const d = (y, m, dd) => y + (m - 1) / 12 + (dd - 1) / 365;
    // Data: CA/B Forum SC-081 (398, 200, 100, 47 days); Let's Encrypt "Decreasing Certificate Lifetimes to 45 Days" (90, 64, 45).
    const LINES = [['CA/B 상한', U.blue, [[A, 398], [d(2026, 3, 15), 200], [d(2027, 3, 15), 100], [d(2029, 3, 15), 47]]],
      ["Let's Encrypt 기본", U.purple, [[A, 90], [d(2027, 2, 10), 64], [d(2028, 2, 16), 45]]]];
    const val = (steps, x) => steps.filter(([sx]) => sx <= x).pop()[1];
    const Y0 = 76, H = 170;
    return {
      height: Y0 + H + 24, still: SEC + 1,
      frame: (ctx, w, h, time, say) => {
        const { k } = hwa.loop(time, SEC, HOLD, 1), cx = A + (B - A) * k, cur = val(LINES[0][2], cx), cm = Math.min(cx, B - 1e-3);
        const pill = `${Math.floor(cm)}년 ${Math.floor((cm % 1) * 12) + 1}월 상한 ${cur}일`;
        C.pill(ctx, 0, 0, pill, cur > 200 ? 'info' : cur > 47 ? 'warn' : 'bad');
        ctx.font = U.font(10);
        const lgw = LINES.reduce((a, [s]) => a + 24 + ctx.measureText(s).width, 0), oneRow = tw(ctx, pill, 11, 600) + 40 + lgw < w;
        C.legend(ctx, w - lgw + 12, oneRow ? 11 : 38, LINES.map(([s, c]) => [s, c]));
        const x0 = 30, x1 = w - 44, X = (v) => x0 + ((v - A) / (B - A)) * (x1 - x0);
        const Y = C.panel(ctx, x0, Y0, x1 - x0, H, { title: '최대 유효기간 (일)', max: 400, ticks: [[0, '0'], [100, '100'], [200, '200'], [300, '300'], [400, '400']] });
        [2025, 2026, 2027, 2028, 2029, 2030].forEach((v) => C.text(ctx, String(v), X(v), Y0 + H + 16, { size: 10, align: v === A ? 'left' : v === B ? 'right' : 'center' }));
        if (cx >= NOW) C.event(ctx, X(NOW), Y0 + 14, Y0 + H, '지금', U.slate);
        const ends = LINES.map(([, color, steps]) => {
          const pts = [[X(steps[0][0]), Y(steps[0][1])]];
          steps.slice(1).forEach(([sx, v], j) => { if (sx <= cx) pts.push([X(sx), Y(steps[j][1])], [X(sx), Y(v)]); });
          const v = val(steps, cx);
          pts.push([X(cx), Y(v)]);
          C.line(ctx, pts, color, 2);
          return { y: Y(v), v, color };
        });
        ends.slice().sort((a, b) => a.y - b.y).forEach((e, j, arr) => { e.ly = j && e.y - arr[j - 1].ly < 13 ? arr[j - 1].ly + 13 : e.y; });
        ends.forEach((e) => C.dot(ctx, X(cx), e.y, e.color, `${e.v}일`, e.ly));
        if (k < 1) C.dashed(ctx, X(cx), Y0, X(cx), Y0 + H, U.now);
        stamp(ctx, w, (x0 + x1) / 2, Y(300), '2029년부터 47일', 'warn', (time % (SEC + HOLD) - SEC) / 0.4);
        say(`${pill}. Let's Encrypt 기본 ${ends[1].v}일.`);
      },
    };
  });

  // Private CA: make the CA, sign a server CSR, then hand ca.crt to clients. Private keys never move.
  fig('private-ca', () => {
    const SEC = 6.4, HOLD = 2, TOP = 30;
    const S = [
      { pill: 'CA 만들기', stamp: 'CA 준비', note: 'CA 개인키를 만들고, 그 키로 자기 인증서(CA:TRUE)에 직접 서명한다.' },
      { pill: '서버 인증서 발급', stamp: 'CA가 서명', note: '서버가 만든 CSR이 CA로 가고, CA가 서명한 server.crt가 서버로 돌아온다.' },
      { pill: '신뢰와 접속', stamp: '신뢰 성립', note: '클라이언트는 ca.crt 한 장만 신뢰하고, 서버가 내민 server.crt의 서명을 그것으로 확인한다.' },
    ];
    const RY = [TOP + 46, TOP + 96, TOP + 146];
    return {
      height: TOP + 210, still: 2 * (SEC + HOLD) + SEC + 0.5, scenes: hwa.loopScenes(SEC, HOLD, 3), notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), cw = (w - 16) / 3, cx = (c) => c * (cw + 8) + cw / 2;
        C.pill(ctx, 0, 0, S[i].pill, 'info');
        ['CA', '서버', '클라이언트'].forEach((s, c) => C.group(ctx, c * (cw + 8), TOP, cw, 166, s));
        const sub = (s, x, y, a = 1) => { ctx.globalAlpha = a; C.text(ctx, s, x, y + 17, { size: 9, align: 'center', base: 'middle' }); ctx.globalAlpha = 1; };
        // CA column.
        const caKey = i ? 1 : mv(k, 0.08, 0.2), caCrt = i ? 1 : mv(k, 0.45, 0.58);
        tag(ctx, 'ca.key', cx(0), RY[0], PURPLE, { a: caKey, icon: key });
        if (i === 0) C.arrow(ctx, [[cx(0), RY[0] + 11], [cx(0), RY[1] - 11]], mv(k, 0.25, 0.45), PURPLE[1], { width: 1.4 });
        tag(ctx, 'ca.crt', cx(0), RY[1], GREEN, { a: caCrt });
        sub('CA:TRUE', cx(0), RY[1], caCrt);
        if (i === 0 && k > 0.3 && k < 0.6) sub('자체 서명', cx(0), RY[0] + 8);
        // Server column.
        if (i >= 1) {
          tag(ctx, 'server.key', cx(1), RY[0], PURPLE, { a: i > 1 ? 1 : mv(k, 0.05, 0.15), icon: key });
          tag(ctx, 'server.csr', cx(1), RY[1], i > 1 ? MUTE : BLUE, { a: i > 1 ? 1 : mv(k, 0.2, 0.3) });
          sub('공개키, SAN', cx(1), RY[1], i > 1 ? 1 : mv(k, 0.2, 0.3));
        }
        if (i === 1) {
          fly(ctx, 'server.csr', [cx(1), RY[1]], [cx(0), RY[2]], mv(k, 0.36, 0.55), BLUE);
          const sign = mv(k, 0.58, 0.68);
          if (k >= 0.55 && k < 0.72) { tag(ctx, 'server.csr', cx(0), RY[2], BLUE, { a: 1 - sign }); tag(ctx, 'server.crt', cx(0), RY[2], GREEN, { a: sign }); }
          if (k >= 0.55 && k < 0.72) C.arrow(ctx, [[cx(0) - cw / 2 + 12, RY[0] + 4], [cx(0) - cw / 2 + 12, RY[2] - 4]], sign, PURPLE[1], { width: 1.2 });
          fly(ctx, 'server.crt', [cx(0), RY[2]], [cx(1), RY[2]], mv(k, 0.72, 0.86), GREEN);
          tag(ctx, 'server.crt', cx(1), RY[2], GREEN, { a: k >= 0.86 ? 1 : 0 });
        }
        if (i === 2) {
          tag(ctx, 'server.crt', cx(1), RY[2], GREEN);
          fly(ctx, 'ca.crt', [cx(0), RY[1]], [cx(2), RY[0]], mv(k, 0.08, 0.32), GREEN);
          tag(ctx, 'ca.crt', cx(2), RY[0], GREEN, { a: k >= 0.32 ? 1 : 0 });
          sub('신뢰 저장소', cx(2), RY[0], k >= 0.32 ? 1 : 0);
          fly(ctx, 'server.crt', [cx(1), RY[2]], [cx(2), RY[1]], mv(k, 0.42, 0.6), GREEN);
          tag(ctx, 'server.crt', cx(2), RY[1], BLUE, { a: k >= 0.6 ? 1 : 0 });
          sub('접속할 때 받음', cx(2), RY[1], k >= 0.6 ? 1 : 0);
          tag(ctx, '서명 확인', cx(2), RY[2], GREEN, { a: mv(k, 0.7, 0.78) });
        }
        stamp(ctx, w, w / 2, h - 16, S[i].stamp, 'ok', (k - 0.86) / 0.08);
        say(`${S[i].pill}. ${S[i].note}`);
      },
    };
  });

  // The API server reads a client certificate as an account: verify, read CN and O, authorize.
  fig('k8s', () => {
    const SEC = 6.6, HOLD = 2, TOP = 30;
    const S = [
      { who: 'kubelet', sub: 'node-0', col: BLUE, cn: 'system:node:node-0', o: 'system:nodes', res: ['Node 인가: node-0 것만', GREEN], stamp: ['자기 노드 것만', 'ok'],
        note: 'kubelet 인증서는 CN과 O로 node-0의 노드가 되고, Node 인가가 자기 노드 것만 허락한다.' },
      { who: 'admin', sub: 'kubectl', col: BLUE, cn: 'admin', o: 'system:masters', res: ['인가 검사 건너뜀', ORANGE], stamp: ['모든 권한', 'warn'],
        note: 'admin 인증서의 그룹 system:masters는 RBAC 검사를 건너뛰어 무엇이든 할 수 있다.' },
      { who: '유출된 사본', sub: 'admin 인증서', col: RED, cn: 'admin', o: 'system:masters', res: ['인가 검사 건너뜀', RED], stamp: ['만료까지 유효', 'bad'], leak: true,
        note: '새어 나간 admin 인증서도 서명이 맞아 그대로 통과한다. 폐기할 방법이 없어 만료까지 유효하다.' },
    ];
    const ST = [[TOP + 22, 44, '① 인증서 검증'], [TOP + 74, 62, '② 계정 읽기'], [TOP + 144, 48, '③ 인가']];
    return {
      height: TOP + 250, still: 2 * (SEC + HOLD) + SEC + 0.5, scenes: hwa.loopScenes(SEC, HOLD, 3), notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3), sc = S[i], lw = clamp(w * 0.28, 92, 150), gx = lw + 20, gw = w - gx;
        const act = k < 0.3 ? -1 : k < 0.45 ? 0 : k < 0.65 ? 1 : k < 0.86 ? 2 : -1;
        C.pill(ctx, 0, 0, `${sc.who} 인증서`, sc.leak ? 'bad' : 'info');
        const card = { x: 0, y: TOP + 86, w: lw, h: 46, t: sc.who, s: sc.sub };
        C.card(ctx, card, sc.leak ? { fill: RED[0], stroke: RED[2], dash: [4, 3] } : {});
        const go = mv(k, 0.06, 0.3), home = [lw / 2, TOP + 152], dst = [gx + gw - 50, ST[0][0] + 30];
        if (go <= 0) tag(ctx, '인증서', ...home, sc.col, { icon: lock });
        fly(ctx, '인증서', home, dst, go, sc.col, lock);
        C.arrow(ctx, [[lw + 2, TOP + 109], [gx - 2, TOP + 109]], 1, '#cbd5e1', { width: 1.2 });
        C.group(ctx, gx, TOP, gw, 200, 'API 서버', TOP + 14);
        ST.forEach(([y, sh, label], j) => {
          C.box(ctx, gx + 8, y, gw - 16, sh, { fill: '#fff', on: act === j });
          C.text(ctx, label, gx + 16, y + 15, { size: 10, weight: 600, color: U.text, base: 'middle' });
        });
        const v1 = mv(k, 0.3, 0.38), v2 = mv(k, 0.45, 0.55), v3 = mv(k, 0.66, 0.76), lx = (s) => gx + 16 + tagW(ctx, s) / 2;
        tag(ctx, '서명 맞음', lx('서명 맞음'), ST[0][0] + 31, GREEN, { a: v1 });
        if (sc.leak && tagW(ctx, '서명 맞음') + tagW(ctx, '폐기 확인 없음') + 40 < gw) tag(ctx, '폐기 확인 없음', gx + 22 + tagW(ctx, '서명 맞음') + tagW(ctx, '폐기 확인 없음') / 2, ST[0][0] + 31, RED, { a: v1 });
        ctx.globalAlpha = v2;
        C.text(ctx, `user  ${sc.cn}`, gx + 16, ST[1][0] + 34, { size: 10, weight: 600, color: sc.col[1], base: 'middle' });
        C.text(ctx, `group ${sc.o}`, gx + 16, ST[1][0] + 50, { size: 10, weight: 600, color: sc.col[1], base: 'middle' });
        ctx.globalAlpha = 1;
        tag(ctx, sc.res[0], lx(sc.res[0]), ST[2][0] + 32, sc.res[1], { a: v3 });
        stamp(ctx, w, w / 2, h - 16, sc.stamp[0], sc.stamp[1], (k - 0.88) / 0.08);
        say(`${sc.who} 인증서. ${sc.note}`);
      },
    };
  });
})();
