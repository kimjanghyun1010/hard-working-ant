// Redis post: write path, resync, failover, single-thread queue demo, expiry, fork copy-on-write.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'], RED = ['#fee2e2', '#dc2626', '#fca5a5'];
  const PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], GRAY = [U.cell, U.muted, '#e2e8f0'], PLAIN = ['#fff', U.text, U.grid];
  const LINE = '#cbd5e1', STREAM = '#cbd5e1';
  const each = (id, fn) => document.querySelectorAll(`[data-figure="redis-${id}"]`).forEach(fn);
  const at = (pts, k) => C.pathAt(pts, k).pop();
  const fade = (ctx, a, draw) => { if (a <= 0) return; ctx.save(); ctx.globalAlpha = Math.min(1, a); draw(); ctx.restore(); };
  // Chip centred at (x, y). col = [bg, fg, line].
  const tag = (ctx, s, x, y, col, { w, a = 1, size = 10, h = 18 } = {}) => {
    if (a <= 0) return 0;
    const cw = w || tw(ctx, s, size, 600) + 14;
    fade(ctx, a, () => {
      ctx.beginPath();
      ctx.roundRect(x - cw / 2 + 0.5, y - h / 2 + 0.5, cw - 1, h - 1, 5);
      ctx.fillStyle = col[0]; ctx.fill();
      ctx.strokeStyle = col[2]; ctx.lineWidth = 1; ctx.stroke();
      C.text(ctx, s, x, y + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    });
    return cw;
  };
  // Box with a name and an optional second line; col = [bg, fg, line].
  const unit = (ctx, b, name, sub, { col = PLAIN, dash, lit, size = 11, subSize = 10, subColor = U.muted } = {}) => {
    C.box(ctx, b.x, b.y, b.w, b.h, { fill: col[0], stroke: lit ? U.accent : col[2], dash, r: 7 });
    if (lit) { ctx.beginPath(); ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 7); ctx.strokeStyle = U.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    const cy = b.y + b.h / 2;
    C.text(ctx, name, b.x + b.w / 2, sub ? cy - 7 : cy, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    if (sub) C.text(ctx, sub, b.x + b.w / 2, cy + 9, { size: subSize, color: subColor, align: 'center', base: 'middle' });
  };
  // Down or failed part: red fill with hatch. The normal state is never painted.
  const downFill = (ctx, x, y, w, h, r = 7) => {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = RED[0]; ctx.fill(); ctx.fillStyle = C.hatch(ctx, '#fecaca'); ctx.fill();
  };
  const downUnit = (ctx, b, name, sub, size = 11) => {
    downFill(ctx, b.x, b.y, b.w, b.h);
    unit(ctx, b, name, sub, { col: ['transparent', RED[1], RED[1]], dash: [3, 3], size, subColor: RED[1] });
  };
  const hint = (ctx, x, y, s) => C.text(ctx, `${s} 버튼을 눌러 보자`, x, y, { size: 12, align: 'center', base: 'middle' });
  // Label centred at x but kept inside [0, w].
  const label = (ctx, s, x, y, w, opt = {}) => {
    const half = tw(ctx, s, opt.size || 10, opt.weight || 400) / 2;
    C.text(ctx, s, Math.max(half, Math.min(w - half, x)), y, { size: 10, align: 'center', base: 'middle', ...opt });
  };

  each('write', (root) => {
    const STEP = 1.5, HOLD = 2.6;
    const ST = [
      'SET이 소켓 수신 버퍼에 쌓인다',
      '메인 스레드가 차례대로 꺼내 실행한다',
      '메모리의 키 공간에 값을 쓴다',
      '같은 명령을 복제 백로그에 덧붙인다',
      '레플리카를 기다리지 않고 +OK로 응답한다',
      '레플리카가 명령을 받아 offset을 맞춘다',
    ];
    const n = ST.length;
    hwa.scene(root, {
      height: 304, still: n * STEP + 0.5, scenes: hwa.stepScenes(n, STEP, HOLD),
      frame: (ctx, w, h, time, say) => {
        const t = time % (n * STEP + HOLD), cur = Math.min(n - 1, Math.floor(t / STEP));
        const f = t >= n * STEP ? 1 : hwa.smooth((t - cur * STEP) / (STEP * 0.6)), moving = t < n * STEP && f < 1;
        const done = (i) => cur > i || (cur === i && f > 0.95);
        const sm = w < 480, kw = sm ? 52 : 76, gx = kw + 14, gw = w - gx, iw = gw - 20, bw = (iw - 28) / 3, fs = sm ? 10 : 11;
        const yA = 62, hA = 46, cyA = yA + hA / 2;
        const K = { x: 0, y: yA, w: kw, h: hA }, Q = { x: gx + 10, y: yA, w: bw, h: hA };
        const T = { x: Q.x + bw + 14, y: yA, w: bw, h: hA }, M = { x: T.x + bw + 14, y: yA, w: bw, h: hA };
        const BL = { x: gx + 10, y: 158, w: iw, h: 14 }, rw = sm ? 100 : 130, R = { x: w - rw, y: 226, w: rw, h: 44 };
        const po = done(3) ? 1024 : 1000, ro = done(5) ? 1024 : 1000;

        C.pill(ctx, 0, 0, `프라이머리 offset ${po}, 레플리카 ${ro}`);
        C.group(ctx, gx, 32, gw, 168, '프라이머리', 48);
        C.card(ctx, { ...K, t: '클라이언트', size: fs }, { lit: cur === 0 || (cur === 4 && done(4)) });
        unit(ctx, Q, '수신 버퍼', cur === 0 && done(0) ? 'SET 대기' : '소켓', { lit: cur === 0 && done(0), size: fs, subSize: 9 });
        unit(ctx, T, '메인 스레드', '하나씩 실행', { lit: cur === 1 || cur === 3 || cur === 4, size: fs, subSize: 9, col: cur === 1 ? BLUE : PLAIN });
        unit(ctx, M, '키 공간', done(2) ? 'order:42' : '메모리', { lit: cur === 2, size: fs, subSize: 9, subColor: done(2) ? U.accent : U.muted });

        // Backlog strip: grey is older stream, blue is the new SET; ticks mark where each side stands.
        const N = sm ? 14 : 28, cw = BL.w / N, newCell = N - 3;
        C.text(ctx, sm ? '복제 백로그 (1MB)' : '복제 백로그 (repl-backlog-size 1mb, 최근 스트림)', BL.x, BL.y - 8, { size: 10, weight: 600, color: U.text });
        for (let j = 0; j < N; j++) {
          const x = BL.x + j * cw;
          const fill = j < newCell ? STREAM : j === newCell && (cur > 3 || (cur === 3 && f > 0.5)) ? U.blue : U.cell;
          ctx.fillStyle = fill; ctx.fillRect(x + 1, BL.y, cw - 2, BL.h);
        }
        const tick = (j, s, color, below) => {
          const x = BL.x + j * cw;
          C.line(ctx, [[x, BL.y - 2], [x, BL.y + BL.h + 4]], color, 1.5);
          if (below) label(ctx, s, x, BL.y + BL.h + 13, w, { size: 9, weight: 600, color });
        };
        tick(done(3) ? newCell + 1 : newCell, '', U.text, false);
        tick(done(5) ? newCell + 1 : newCell, `레플리카 ${ro}`, ro < po ? ORANGE[1] : U.muted, true);
        C.text(ctx, `offset ${po}`, BL.x + BL.w, BL.y - 8, { size: 10, weight: 600, color: U.text, align: 'right' });

        unit(ctx, R, '레플리카', `offset ${ro}`, { lit: cur === 5, size: fs, subColor: ro < po ? ORANGE[1] : U.muted });

        const P = [
          [[kw, cyA], [Q.x, cyA]],
          [[Q.x + Q.w, cyA], [T.x, cyA]],
          [[T.x + T.w, cyA], [M.x, cyA]],
          [[T.x + T.w / 2 + 10, yA + hA], [T.x + T.w / 2 + 10, BL.y - 2]],
          [[T.x + T.w / 2 - 10, yA + hA], [T.x + T.w / 2 - 10, 120], [kw / 2, 120], [kw / 2, yA + hA]],
          [[R.x + R.w / 2, BL.y + BL.h], [R.x + R.w / 2, R.y]],
        ];
        P.forEach((p, j) => {
          if (j > cur) return;
          const on = j === cur;
          C.arrow(ctx, p, on ? f : 1, on ? U.accent : LINE, { width: on ? 2 : 1.4 });
          if (j === 4) C.badge(ctx, p, 5, on, 'down', 0.5);
        });
        if (moving) {
          const s = cur === 4 ? '+OK' : 'SET', col = cur === 4 ? BLUE : PURPLE;
          tag(ctx, s, ...at(P[cur], f), col, { size: 9, h: 16 });
        }
        if (cur === 4 || (cur === 5 && f < 0.4)) C.stamp(ctx, (w - R.w) / 2 - 6, R.y + R.h / 2, '레플리카는 아직 1000', 'warn', cur === 4 ? (f - 0.7) / 0.3 : 1 - f / 0.4);
        C.text(ctx, `${cur + 1}. ${ST[cur]}`, 0, h - 10, { size: 12, weight: 600, color: U.text, base: 'middle' });
        say(`${cur + 1}단계: ${ST[cur]}. 프라이머리 offset ${po}, 레플리카 offset ${ro}.`);
      },
    });
  });

  each('resync', (root) => {
    const SEC = 6.6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = ['끊긴 동안의 쓰기가 백로그 안에 남아 있어 빠진 부분만 받는다.', '쓰기가 많아 백로그가 이미 덮어써졌고, RDB 스냅숏부터 다시 받는다.'];
    hwa.scene(root, {
      height: 246, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), full = i === 1, sm = w < 480;
        const BW = 0.22, rep = 0.38, head = 0.42 + ease(t, 0.8, 2.4) * (full ? 0.5 : 0.12), winL = Math.max(0, head - BW);
        const by = 54, bh = 16, X = (v) => v * w;
        const catchUp = full ? ease(t, 5.8, 6.3) : ease(t, 4.3, 5.6), rx = rep + (head - rep) * catchUp;
        C.pill(ctx, 0, 0, full ? '전체 동기화' : '부분 재동기화');
        C.text(ctx, '복제 스트림 (offset →)', w, 11.5, { size: 10, align: 'right', base: 'middle' });
        ctx.fillStyle = U.cell; ctx.fillRect(0, by, w, bh);
        ctx.fillStyle = STREAM; ctx.fillRect(0, by, X(head), bh);
        // Backlog window: the last BW of the stream, still kept in memory.
        ctx.fillStyle = U.accentSoft; ctx.fillRect(X(winL), by, X(head) - X(winL), bh);
        ctx.strokeStyle = U.accentLine; ctx.lineWidth = 1; ctx.strokeRect(X(winL) + 0.5, by + 0.5, X(head) - X(winL) - 1, bh - 1);
        label(ctx, '백로그', (X(winL) + X(head)) / 2, by - 9, w, { size: 10, weight: 600, color: U.accent });
        if (winL > rep) {
          downFill(ctx, X(rep), by, X(winL) - X(rep), bh, 2);
          label(ctx, '덮어써짐', (X(rep) + X(winL)) / 2, by + bh + 12, w, { size: 9, weight: 700, color: RED[1] });
        } else if (t > 2.4 && catchUp < 1) {
          C.line(ctx, [[X(rep), by + bh + 4], [X(rep), by + bh + 8], [X(head), by + bh + 8], [X(head), by + bh + 4]], ORANGE[1], 1.2);
          label(ctx, '빠진 부분', (X(rep) + X(head)) / 2, by + bh + 18, w, { size: 9, weight: 700, color: ORANGE[1] });
        }
        C.line(ctx, [[X(head), by - 3], [X(head), by + bh + 3]], U.text, 2);
        C.line(ctx, [[X(rx), by + bh], [X(rx), by + bh + 26]], ORANGE[1], 1.5);
        label(ctx, '레플리카 offset', X(rx), by + bh + 34, w, { size: 9, weight: 600, color: ORANGE[1] });

        const pw = sm ? 96 : 150, ly = 150, P = { x: 0, y: ly - 26, w: pw, h: 52 }, R = { x: w - pw, y: ly - 26, w: pw, h: 52 };
        const cut = t > 0.3 && t < 2.6, fork = full && t > 4.1 && t < 5.1;
        unit(ctx, P, '프라이머리', fork ? 'fork, RDB 생성' : `offset 끝 ${Math.round(head * 1000)}`, { size: sm ? 11 : 12, subColor: fork ? ORANGE[1] : U.muted });
        if (fork) { ctx.fillStyle = ORANGE[2]; ctx.fillRect(P.x + 8, P.y + P.h - 7, (P.w - 16) * ease(t, 4.1, 5.0), 3); }
        const loading = full && t > 5.0 && t < 6.3;
        unit(ctx, R, '레플리카', loading ? 'RDB 적재, 요청 못 받음' : `offset ${Math.round(rx * 1000)}`, { size: sm ? 11 : 12, subSize: sm ? 8.5 : 10, col: loading ? ORANGE : PLAIN, subColor: ORANGE[1] });
        const L = [[P.x + P.w, ly], [R.x, ly]];
        if (cut) { ctx.save(); ctx.setLineDash([3, 3]); C.line(ctx, L, RED[1], 1.4); ctx.restore(); C.stamp(ctx, w / 2, ly, '연결 끊김', 'bad', Math.min(ease(t, 0.3, 0.6), 1 - ease(t, 2.3, 2.6))); }
        else C.line(ctx, L, LINE, 1.4);
        const fwd = (k) => at(L, k);
        if (t > 2.6 && t < 3.4) tag(ctx, 'PSYNC', ...at([L[1], L[0]], ease(t, 2.6, 3.3)), BLUE, { size: 9, h: 16 });
        if (t > 3.4 && t < 4.2) tag(ctx, full ? '+FULLRESYNC' : '+CONTINUE', ...fwd(ease(t, 3.4, 4.1)), full ? ORANGE : BLUE, { size: 9, h: 16 });
        if (!full) [0, 0.35, 0.7].forEach((d) => { const k = ease(t, 4.3 + d, 5.0 + d); if (k > 0 && k < 1) tag(ctx, '', ...fwd(k), BLUE, { w: 14, h: 12 }); });
        if (full && t > 5.0 && t < 5.8) tag(ctx, 'RDB 전체', ...fwd(ease(t, 5.0, 5.7)), ORANGE, { size: 9, h: 16 });
        C.text(ctx, sm ? '' : 'PSYNC <복제 ID> <offset>', w / 2, ly + 40, { size: 10, align: 'center', base: 'middle' });
        C.stamp(ctx, w / 2, 222, full ? '데이터 전체를 다시 전송' : '빠진 바이트만 전송', full ? 'bad' : 'info', ease(t, 5.9, 6.3));
        say(`${full ? '전체 동기화' : '부분 재동기화'}: ${notes[i]}`);
      },
    });
  });

  each('failover', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 3);
    const notes = ['프라이머리는 offset 1000까지 응답했고, 레플리카는 960과 940까지 받았다.', 'Sentinel 2대가 다운에 동의해 쿼럼 2를 넘고, 과반 투표로 S1이 페일오버를 맡는다.', 'offset이 큰 레플리카 1이 승격되고, 응답까지 받은 961~1000의 쓰기는 사라진다.'];
    const PILL = ['평소: 비동기 복제', '장애 감지', '승격과 유실'];
    hwa.scene(root, {
      height: 262, still: S.at(2) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), sm = w < 480, fs = sm ? 10 : 11;
        const aw = sm ? 40 : 64, gx = aw + 14, nw = (w - gx - 20) / 3, ny = 112, nh = 48;
        const A = { x: 0, y: ny, w: aw, h: nh }, N = [0, 1, 2].map((j) => ({ x: gx + j * (nw + 10), y: ny, w: nw, h: nh }));
        const SN = [0, 1, 2].map((j) => ({ x: gx + j * (nw + 10), y: 30, w: nw, h: 36 }));
        const dead = i > 0 && (i > 1 || t > 0.4), promoted = i === 2 && t > 1.0;
        const offs = [1000, 960, 940];
        C.pill(ctx, 0, 0, PILL[i]);
        C.text(ctx, '쿼럼 2', w, 11.5, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });

        // Sentinels: SDOWN opinions, then ODOWN, then the vote for a leader.
        const sdown = (j) => i === 2 || (i === 1 && t > 1.2 + j * 0.6), odown = i === 2 || (i === 1 && t > 2.6), leader = i === 2 || (i === 1 && t > 3.8);
        SN.forEach((b, j) => {
          const sub = i === 0 ? 'PING' : leader && j === 0 ? '리더' : j < 2 && sdown(j) ? 'SDOWN' : 'PING';
          unit(ctx, b, `Sentinel ${j + 1}`, sub, { size: sm ? 9 : 11, subSize: 9, lit: leader && j === 0 && i === 1, subColor: sub === 'SDOWN' ? ORANGE[1] : sub === '리더' ? U.accent : U.muted });
        });
        if (i === 1) {
          C.stamp(ctx, w / 2 + aw / 2, 90, 'ODOWN, 2/3 동의', 'warn', Math.min(ease(t, 2.6, 2.9), 1 - ease(t, 3.6, 3.8)));
          [1, 2].forEach((j) => { const k = ease(t, 3.8 + j * 0.2, 4.4 + j * 0.2); if (k > 0) C.arrow(ctx, [[SN[j].x + 6, SN[j].y + SN[j].h + 4], [SN[0].x + SN[0].w - 6, SN[0].y + SN[0].h + 4]], k, U.accent, { width: 1.2, dash: [3, 2] }); });
        }

        C.card(ctx, { ...A, t: '앱', size: fs });
        const name = (j) => (j === 0 ? '프라이머리' : promoted && j === 1 ? '새 프라이머리' : `레플리카 ${j}`);
        N.forEach((b, j) => {
          const sub = j === 0 ? 'offset 1000' : promoted && j === 2 ? '1을 따름' : `offset ${offs[j]}`;
          if (j === 0 && dead) downUnit(ctx, b, name(0), '꺼짐', sm ? 9.5 : 11);
          else unit(ctx, b, name(j), sub, { size: sm ? 9.5 : 11, subSize: 9, col: promoted && j === 1 ? BLUE : PLAIN });
        });

        // Offset bars 900..1000 under each node; the primary's un-replicated tail turns into the loss.
        const Y = ny + nh + 14, X = (b, v) => b.x + 4 + ((v - 900) / 100) * (b.w - 8);
        N.forEach((b, j) => {
          ctx.fillStyle = U.cell; ctx.fillRect(b.x + 4, Y, b.w - 8, 8);
          ctx.fillStyle = STREAM; ctx.fillRect(b.x + 4, Y, X(b, offs[j]) - b.x - 4, 8);
        });
        const P0 = N[0], lost = i === 2;
        if (lost) downFill(ctx, X(P0, 960), Y, X(P0, 1000) - X(P0, 960), 8, 1);
        else { ctx.fillStyle = ORANGE[2]; ctx.fillRect(X(P0, 960), Y, X(P0, 1000) - X(P0, 960), 8); }
        C.text(ctx, lost ? '961~1000 유실' : '응답했지만 복제 전', X(P0, 980), Y + 20, { size: 9, weight: 700, color: lost ? RED[1] : ORANGE[1], align: 'center', base: 'middle' });
        if (!sm) C.text(ctx, 'offset 900~1000', N[2].x + N[2].w, Y + 20, { size: 9, align: 'right', base: 'middle' });

        // Writes: app to primary and replication to the replicas, until the primary goes down; after promotion, to the new one.
        const ph = (time * 0.9) % 1, cy = ny + nh / 2, lane = ny - 12;
        const rep = (j) => [[P0.x + P0.w / 2 + (j - 1.5) * 8, ny], [P0.x + P0.w / 2 + (j - 1.5) * 8, lane], [N[j].x + N[j].w / 2, lane], [N[j].x + N[j].w / 2, ny]];
        if (!dead) [1, 2].forEach((j) => C.line(ctx, rep(j), LINE, 1));
        if (!dead) {
          tag(ctx, '', aw + 7 + (gx - aw - 14) * ph, cy, BLUE, { w: 10, h: 10, a: 1 - ph });
          [1, 2].forEach((j) => { tag(ctx, '', ...at(rep(j), (ph + j * 0.3) % 1), BLUE, { w: 9, h: 9 }); });
        } else if (i === 1 && t > 0.6) tag(ctx, '실패', aw + 14, cy - 20, RED, { size: 9, h: 16, a: 1 - ph });
        if (i === 2) {
          const ask = [[aw / 2, ny], [aw / 2, SN[0].y + SN[0].h / 2], [SN[0].x, SN[0].y + SN[0].h / 2]];
          const go = [[aw / 2, ny + nh], [aw / 2, Y + 32], [N[1].x + N[1].w / 2, Y + 32], [N[1].x + N[1].w / 2, Y + 10]];
          C.arrow(ctx, ask, ease(t, 1.6, 2.4), U.accent, { width: 1.4 });
          if (t > 1.6 && t < 2.5 && !sm) C.text(ctx, '주소 묻기', aw / 2 + 6, ny - 8, { size: 9, color: U.accent });
          C.arrow(ctx, go, ease(t, 2.6, 3.4), U.accent, { width: 1.4 });
          C.stamp(ctx, w / 2 + aw / 2, h - 16, '성공 응답한 40건이 사라짐', 'bad', ease(t, 3.8, 4.2));
        }
        say(`${PILL[i]}. ${notes[i]}`);
      },
    });
  });

  each('queue', (root) => {
    // Illustrative case numbers: 25 scripts of 10ms in a burst, payment GETs of 0.2ms every 24ms; timeout 100ms.
    const LUA = 10, GET = 0.2, TO = 100, SIM = 0.016;
    const jobs = [
      ...Array.from({ length: 25 }, (_, j) => ({ k: 'lua', a: j * 0.2, d: LUA })),
      ...Array.from({ length: 10 }, (_, j) => ({ k: 'get', a: 10 + j * 24, d: GET })),
    ];
    const plan = (lanes) => lanes.map((pick) => {
      let end = 0;
      return jobs.filter(pick).sort((x, y) => x.a - y.a).map((j) => { const s = Math.max(j.a, end); end = s + j.d; return { ...j, s, e: end }; });
    });
    const PLANS = [plan([() => true]), plan([(j) => j.k === 'lua', (j) => j.k === 'get'])];
    const maxWait = PLANS.map((p) => Math.round(Math.max(...p.flat().filter((j) => j.k === 'get').map((j) => j.s - j.a))));
    const notes = ['스크립트와 결제 GET이 한 줄에 선다. GET은 스크립트 25개가 끝나길 240ms 기다린다.', '결제 GET은 자기 인스턴스에서 바로 처리된다. 스크립트가 끝나는 시각은 250ms로 같다.'];
    hwa.scene(root, {
      height: 248, still: 0, notes, demo: { modes: ['한 인스턴스 공유', '용도별 분리'], run: '스크립트 몰리게 하기' },
      frame: (ctx, w, h, time, say, ui) => {
        const mode = ui.mode, lanes = PLANS[mode], run = ui.runAt === null ? -1 : time - ui.runAt, s = run < 0 ? -1 : run / SIM;
        const sm = w < 480, srcW = sm ? 56 : 84, lx = srcW + 22, thW = sm ? 50 : 70, qx = lx + 8, qR = w - thW - 10, scale = (qR - qx) / 255;
        const Y = mode === 0 ? [118] : [80, 160], srcY = [80, 160];
        let worst = 0;
        lanes.forEach((L) => L.forEach((j) => { if (j.k === 'get' && j.a <= s) worst = Math.max(worst, Math.min(s, j.s) - j.a); }));
        const bad = worst >= TO;
        C.pill(ctx, 0, 0, mode === 0 ? 'Redis 하나를 함께 씀' : '이벤트용과 결제용 분리');
        C.text(ctx, `결제 GET 최대 대기 ${Math.round(worst)}ms`, w, 11.5, { size: 11, weight: 700, color: bad ? U.red : U.text, align: 'right', base: 'middle' });
        const src = [{ x: 0, y: srcY[0] - 20, w: srcW, h: 40, t: '이벤트 API', s: 'EVAL', size: sm ? 10 : 11 }, { x: 0, y: srcY[1] - 20, w: srcW, h: 40, t: '결제 API', s: 'GET', size: sm ? 10 : 11 }];
        src.forEach((b) => C.card(ctx, b));
        src.forEach((b, j) => {
          const ty = Y[mode === 0 ? 0 : j];
          C.arrow(ctx, [[srcW, b.y + 20], [srcW + 10, b.y + 20], [srcW + 10, ty], [lx, ty]], 1, LINE, { width: 1.2 });
        });
        lanes.forEach((L, li) => {
          const cy = Y[li], top = cy - 22;
          C.box(ctx, lx, top, w - lx, 44, { fill: U.plot, r: 8 });
          C.text(ctx, mode === 0 ? 'Redis (공유)' : li === 0 ? 'Redis A' : 'Redis B', lx + 8, top - 6, { size: 10, weight: 600, color: U.text });
          C.line(ctx, [[qx, cy + 14], [qR, cy + 14]], U.grid, 1);
          const busy = L.find((j) => j.s <= s && s < j.e);
          const T = { x: w - thW - 4, y: top + 4, w: thW, h: 36 };
          unit(ctx, T, '메인 스레드', busy ? (busy.k === 'lua' ? 'EVAL' : 'GET') : '', { size: sm ? 9 : 10, subSize: 9, col: busy ? BLUE : PLAIN, subColor: U.accent });
          // Queue as time: a job sits as far left of the thread as the work still ahead of it.
          let g = 0;
          L.forEach((j) => {
            if (j.k === 'get' && j.e <= s && s - j.e < 14) tag(ctx, 'GET', T.x - 18, cy - 1, BLUE, { size: 8, h: 14, a: 1 - (s - j.e) / 14 });
            if (j.a > s || j.s <= s) return;
            const xr = qR - (j.s - s) * scale;
            if (j.k === 'lua') { ctx.fillStyle = PURPLE[2]; ctx.fillRect(xr - j.d * scale + 0.5, cy - 9, Math.max(1, j.d * scale - 1), 18); return; }
            // GETs queued back to back are spread apart so the reader can count them.
            const wait = s - j.a, col = wait >= TO ? RED : wait >= TO / 2 ? ORANGE : BLUE;
            tag(ctx, '', Math.max(qx + 4, xr - 4 - 9 * g++), cy, col, { w: 7, h: 22 });
          });
        });
        const end = Math.max(...lanes.flat().map((j) => j.e));
        if (run < 0) hint(ctx, (lx + w) / 2, 212, '스크립트 몰리게 하기');
        else if (s < end + 10) C.text(ctx, `${Math.min(Math.round(s), 250)}ms 경과, 보라 칸 하나가 스크립트 10ms`, (lx + w) / 2, 212, { size: 10, align: 'center', base: 'middle' });
        else C.stamp(ctx, (lx + w) / 2, 214, mode === 0 ? `250ms에 끝, GET ${maxWait[0]}ms 대기` : '250ms에 끝, GET 바로 처리', mode === 0 ? 'bad' : 'ok', (s - end - 10) / 25);
        say(`${mode === 0 ? '공유' : '분리'}: ${notes[mode]} 지금 결제 GET 최대 대기 ${Math.round(worst)}ms.`);
      },
    });
  });

  each('expire', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2), NK = 60;
    const notes = ['GET이 만료된 키를 건드리면 그때 지운다. 아무도 읽지 않는 만료 키는 남는다.', '100ms마다 표본 20개를 뽑아 만료된 것을 지우고, 25%를 넘으면 바로 다시 뽑는다.'];
    // Fixed shuffle so every reader sees the same keys and samples.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const order = Array.from({ length: NK }, (_, j) => j).sort(() => rnd() - 0.5);
    const expired = new Set(order.slice(0, 18)), live = order.slice(18);
    const spare = [order[0], ...order.slice(12, 18)], A = [...order.slice(1, 9), ...live.slice(0, 12)];
    const B = [...order.slice(9, 12), ...live.slice(12, 29)];
    hwa.scene(root, {
      height: 262, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), sm = w < 480, kw = sm ? 44 : 64;
        const cols = sm ? 10 : 15, rows = NK / cols, gx = kw + 16, cs = Math.min(34, (w - gx) / cols), gy = 40;
        const cell = (j) => ({ x: gx + (j % cols) * cs, y: gy + Math.floor(j / cols) * cs });
        const near = (j) => (j % cols) * 10 + Math.abs(Math.floor(j / cols) - (rows - 1) / 2), read = spare.reduce((a, b) => (near(b) < near(a) ? b : a));
        const gone = new Set();
        if (i === 0 && t > 2.4) gone.add(read);
        if (i === 1) {
          gone.add(read);
          if (t > 1.8) A.forEach((j) => expired.has(j) && gone.add(j));
          if (t > 3.8) B.forEach((j) => expired.has(j) && gone.add(j));
        }
        const sample = i === 1 ? (t > 0.6 && t < 2.2 ? A : t > 2.8 && t < 4.2 ? B : []) : [];
        const left = [...expired].filter((j) => !gone.has(j)).length;
        C.pill(ctx, 0, 0, i === 0 ? '지연 만료: 읽을 때 지움' : '능동 만료: 표본 검사');
        C.text(ctx, `만료됐지만 남은 키 ${left}개`, w, 11.5, { size: 10, weight: 700, color: RED[1], align: 'right', base: 'middle' });
        for (let j = 0; j < NK; j++) {
          const { x, y } = cell(j), g = 2;
          if (gone.has(j)) C.box(ctx, x + g, y + g, cs - 2 * g, cs - 2 * g, { fill: '#fff', stroke: U.grid, dash: [2, 2], r: 4 });
          else if (expired.has(j)) { downFill(ctx, x + g, y + g, cs - 2 * g, cs - 2 * g, 4); ctx.strokeStyle = RED[2]; ctx.lineWidth = 1; ctx.stroke(); }
          else C.box(ctx, x + g, y + g, cs - 2 * g, cs - 2 * g, { fill: '#fff', stroke: U.grid, r: 4 });
        }
        sample.forEach((j) => { const { x, y } = cell(j); ctx.strokeStyle = U.accent; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2); ctx.lineWidth = 1; });
        const K = { x: 0, y: gy + (rows * cs) / 2 - 22, w: kw, h: 44, t: '앱', s: i === 0 ? 'GET' : '', size: 11 };
        C.card(ctx, K, { dim: i === 1 });
        const base = gy + rows * cs + 18;
        if (i === 0) {
          const c = cell(read), path = [[kw, K.y + 22], [kw + 8, K.y + 22], [kw + 8, c.y + cs / 2], [c.x + cs / 2, c.y + cs / 2]];
          C.arrow(ctx, path, ease(t, 0.8, 2.0), U.accent, { width: 1.4 });
          if (t > 2.4) tag(ctx, '(nil)', ...at(path.slice().reverse(), ease(t, 2.5, 3.4)), BLUE, { size: 9, h: 16, a: 1 - ease(t, 3.6, 4.0) });
          C.text(ctx, t > 2.4 ? '읽힌 키 하나만 지워졌다' : '만료된 키에 GET', gx, base, { size: 11, weight: 600, color: U.text, base: 'middle' });
          C.stamp(ctx, (gx + w) / 2, base + 30, `${left}개는 메모리에 남음`, 'bad', ease(t, 4.2, 4.6));
        } else {
          const msg = t < 0.6 ? '100ms마다 만료 키 중 20개를 뽑는다'
            : t < 2.8 ? '표본 20개 중 만료 8개(40%) → 다시 뽑기'
              : '표본 20개 중 만료 3개(15%) → 다음 주기까지 쉼';
          C.text(ctx, msg, gx, base, { size: sm ? 10 : 11, weight: 600, color: U.text, base: 'middle' });
          C.stamp(ctx, (gx + w) / 2, base + 30, `${left}개는 다음 주기를 기다림`, 'warn', ease(t, 4.4, 4.8));
        }
        say(`${i === 0 ? '지연 만료' : '능동 만료'}: ${notes[i]} 남은 만료 키 ${left}개.`);
      },
    });
  });

  each('fork', (root) => {
    const STEP = 1.6, HOLD = 2.6;
    const ST = ['부모가 데이터 페이지 8개를 쓰고 있다', 'fork: 자식이 같은 페이지를 함께 가리킨다', '부모가 고친 페이지만 커널이 복사한다', '자식이 RDB를 다 쓰고 끝나면 옛 페이지가 풀린다'];
    const n = ST.length, NP = 8, MOD = [1, 4, 6];
    hwa.scene(root, {
      height: 262, still: n * STEP + 0.5, scenes: hwa.stepScenes(n, STEP, HOLD),
      frame: (ctx, w, h, time, say) => {
        const t = time % (n * STEP + HOLD), cur = Math.min(n - 1, Math.floor(t / STEP));
        const f = t >= n * STEP ? 1 : hwa.smooth((t - cur * STEP) / (STEP * 0.6));
        const sm = w < 480, dw = sm ? 64 : 90, aw = w - dw - 14, pg = Math.min(46, (aw - (NP - 1) * 6) / NP), px = (aw - (NP * pg + (NP - 1) * 6)) / 2;
        const PX = (j) => px + j * (pg + 6), Pp = { x: 0, y: 30, w: aw, h: 36 }, Ch = { x: 0, y: 186, w: aw, h: 36 }, D = { x: w - dw, y: 186, w: dw, h: 36 };
        const oy = 124, cyy = 88, ph = 26;
        const child = cur >= 1 && cur < 3 ? (cur === 1 ? f : 1) : cur === 3 ? 1 - f : 0;
        const copied = (j) => MOD.includes(j) && (cur > 2 || (cur === 2 && f > (MOD.indexOf(j) + 1) / 4));
        const freed = cur === 3 && f > 0.6;
        const pages = NP + MOD.filter(copied).length - (freed ? MOD.length : 0);
        C.pill(ctx, 0, 0, `메모리 ${pages} 페이지`);
        if (pages > NP) C.text(ctx, `+${pages - NP} 페이지 복사`, w, 11.5, { size: 10, weight: 700, color: ORANGE[1], align: 'right', base: 'middle' });
        unit(ctx, Pp, '부모 프로세스 (메인 스레드)', cur === 2 ? 'SET이 페이지를 고침' : '', { size: sm ? 10 : 11, subSize: 9, lit: cur === 0 || cur === 2 });
        C.text(ctx, '물리 메모리 페이지', PX(0), oy + ph + 14, { size: 9 });
        for (let j = 0; j < NP; j++) {
          const x = PX(j), cp = copied(j), cx = x + pg / 2;
          const orig = !(freed && MOD.includes(j));
          // Parent points to its own copy once a page is modified; the child keeps the original.
          C.line(ctx, [[cx, Pp.y + Pp.h], [cx, cp ? cyy : oy]], cp ? ORANGE[2] : LINE, 1);
          if (child > 0 && orig) fade(ctx, child, () => C.line(ctx, [[cx + (cp ? 0 : 3), oy + ph], [cx + (cp ? 0 : 3), Ch.y]], LINE, 1));
          if (orig) C.box(ctx, x, oy, pg, ph, { fill: '#fff', stroke: '#94a3b8', r: 4 });
          else C.box(ctx, x, oy, pg, ph, { fill: '#fff', stroke: U.grid, dash: [2, 2], r: 4 });
          if (cp) {
            ctx.beginPath(); ctx.roundRect(x, cyy, pg, ph - 4, 4); ctx.fillStyle = ORANGE[0]; ctx.fill(); ctx.strokeStyle = ORANGE[2]; ctx.stroke();
            C.text(ctx, '복사', cx, cyy + (ph - 4) / 2, { size: 9, weight: 600, color: ORANGE[1], align: 'center', base: 'middle' });
          }
        }
        fade(ctx, child, () => unit(ctx, Ch, '자식 프로세스', 'RDB를 쓰는 동안 페이지를 고치지 않음', { size: sm ? 10 : 11, subSize: sm ? 8.5 : 9, dash: cur === 3 ? [3, 3] : null }));
        unit(ctx, D, 'dump.rdb', cur === 3 ? '저장 끝' : cur >= 1 ? '쓰는 중' : '', { size: sm ? 10 : 11, subSize: 9, dash: cur === 0 ? [3, 3] : null });
        if (child > 0 && cur < 3) C.arrow(ctx, [[Ch.x + Ch.w, Ch.y + Ch.h / 2], [D.x, D.y + D.h / 2]], cur === 1 ? f : 1, U.accent, { width: 1.4 });
        if (cur === 1) C.stamp(ctx, aw / 2, cyy + 10, '페이지 테이블 복사, 메인 스레드 멈춤', 'warn', Math.min(1, f * 1.5) - ease(f, 0.85, 1));
        C.text(ctx, `${cur + 1}. ${ST[cur]}`, 0, h - 10, { size: 12, weight: 600, color: U.text, base: 'middle' });
        say(`${cur + 1}단계: ${ST[cur]}. 메모리 ${pages} 페이지.`);
      },
    });
  });
})();
