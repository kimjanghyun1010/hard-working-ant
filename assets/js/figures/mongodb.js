// MongoDB post: oplog and elections, write concern, driver pools, WiredTiger stall, shared storage, shards, query routing.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], GREEN = ['#dcfce7', '#15803d', '#86efac'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'];
  const RED = ['#fee2e2', '#dc2626', '#fca5a5'], PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], GRAY = [U.cell, U.muted, '#e2e8f0'];
  const WHITE = ['#fff', U.text, U.grid], LINE = '#cbd5e1';
  const each = (id, fn) => document.querySelectorAll(`[data-figure="mongodb-${id}"]`).forEach(fn);
  const num = (n) => Math.round(n).toLocaleString('en-US');
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
  const fade = (ctx, a, draw) => { if (a <= 0) return; ctx.save(); ctx.globalAlpha = Math.min(1, a); draw(); ctx.restore(); };
  // Box with a name and a second line; col = [bg, fg, line].
  const unit = (ctx, b, name, sub, { col = WHITE, dash, lit, size = 11, subSize = 10, subColor = U.muted } = {}) => {
    C.box(ctx, b.x, b.y, b.w, b.h, { fill: col[0], stroke: lit ? U.accent : col[2], dash, r: 7 });
    if (lit) { ctx.beginPath(); ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 7); ctx.strokeStyle = U.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    const cy = b.y + b.h / 2;
    C.text(ctx, name, b.x + b.w / 2, sub ? cy - 7 : cy, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    if (sub) C.text(ctx, sub, b.x + b.w / 2, cy + 9, { size: subSize, color: subColor, align: 'center', base: 'middle' });
  };
  // Only the broken part is painted: red face and hatch under a dashed red box.
  const bad = (ctx, b, name, sub, size = 11) => {
    ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 7);
    ctx.fillStyle = RED[0]; ctx.fill(); ctx.fillStyle = C.hatch(ctx, '#fecaca'); ctx.fill();
    unit(ctx, b, name, sub, { col: ['transparent', RED[1], RED[1]], dash: [3, 3], subColor: RED[1], size });
  };
  const hatchRect = (ctx, x, y, w, h) => {
    if (w <= 0) return;
    ctx.fillStyle = RED[0]; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = C.hatch(ctx, '#fca5a5'); ctx.fillRect(x, y, w, h);
  };
  const hint = (ctx, w, y, s) => C.text(ctx, `${s} 버튼을 눌러 보자`, w / 2, y, { size: 12, align: 'center', base: 'middle' });
  const NAMES = ['프라이머리', '세컨더리 A', '세컨더리 B'];

  each('oplog', (root) => {
    const SEC = 5.5, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 3);
    const notes = [
      '프라이머리가 쓰기를 oplog에 한 줄 적으면 A가 그 줄을 당겨 가고, B는 체이닝으로 A에게서 받는다.',
      'A가 늦으면 A를 소스로 둔 B도 함께 늦는다. 프라이머리의 oplog만 앞서 나간다.',
      '프라이머리가 10초 넘게 응답하지 않으면 A가 term 2로 선거를 열고, B의 표까지 2표로 과반을 얻는다.',
    ];
    // Member box with its oplog as a row of cells; n cells are filled, the newest eased in by fresh.
    const member = (ctx, b, name, role, n, { col = WHITE, lit = false, roleColor = U.muted, fresh = 1 } = {}) => {
      C.box(ctx, b.x, b.y, b.w, b.h, { fill: col[0], stroke: lit ? U.accent : col[2], r: 7 });
      if (lit) { ctx.beginPath(); ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 7); ctx.strokeStyle = U.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
      const cx = b.x + b.w / 2, small = b.w < 90;
      C.text(ctx, name, cx, b.y + 16, { size: small ? 10 : 11, weight: 600, color: col[1], align: 'center', base: 'middle' });
      C.text(ctx, role, cx, b.y + 32, { size: small ? 9 : 10, color: roleColor, align: 'center', base: 'middle' });
      const k = 5, g = 3, cw = (b.w - 16 - (k - 1) * g) / k;
      for (let j = 0; j < k; j++) {
        const x = b.x + 8 + j * (cw + g), on = j < n;
        ctx.fillStyle = U.cell;
        ctx.fillRect(x, b.y + 48, cw, 16);
        if (on) fade(ctx, j === n - 1 ? fresh : 1, () => { ctx.fillStyle = BLUE[2]; ctx.fillRect(x, b.y + 48, cw, 16); });
      }
      C.text(ctx, 'oplog', b.x + 8, b.y + 78, { size: 9, base: 'middle' });
    };
    hwa.scene(root, {
      height: 250, still: S.at(2) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), small = w < 480;
        const aw = small ? 34 : 60, gap = small ? 10 : 24, mx = aw + gap + 2, mw = (w - mx - 2 * gap) / 3;
        const [P, A, B] = [0, 1, 2].map((j) => ({ x: mx + j * (mw + gap), y: 68, w: mw, h: 90 }));
        const cx = (b) => b.x + b.w / 2, bot = P.y + P.h;
        const app = { x: 0, y: 91, w: aw, h: 44, t: '앱', size: 11 };
        const won = i === 2 && t >= 3.7, cand = i === 2 && t >= 2.5 && !won, down = i === 2 && t >= 0.5;
        C.pill(ctx, 0, 0, ['복제', '복제 지연', '선거'][i]);
        C.text(ctx, won ? 'term 2' : 'term 1', w, 11, { size: 11, weight: 700, color: won ? U.accent : U.text, align: 'right', base: 'middle' });
        C.card(ctx, app);
        C.line(ctx, [[aw, 113], [P.x, 113]], LINE, 1);
        const pa = [[cx(P) + 6, P.y], [cx(P) + 6, 50], [cx(A) - 8, 50], [cx(A) - 8, A.y]];
        const ab = [[cx(A) + 8, A.y], [cx(A) + 8, 50], [cx(B), 50], [cx(B), B.y]];
        C.arrow(ctx, pa, 1, LINE, { width: 1.2, dash: down ? [3, 3] : null });
        C.arrow(ctx, ab, 1, LINE, { width: 1.2 });
        C.text(ctx, 'oplog', (cx(P) + cx(A)) / 2, 43, { size: 9, align: 'center' });
        C.text(ctx, '체이닝', (cx(A) + cx(B)) / 2, 43, { size: 9, align: 'center' });
        // Scene 1: one entry travels P, A, B. Scene 2: A stalls with P running ahead.
        if (i === 0) {
          const k = ease(t, 0.3, 1.2);
          if (k < 1) tag(ctx, 'insert', ...mix([aw + 4, 113], [P.x - 4, 113], k), BLUE, { size: 9 });
          member(ctx, P, NAMES[0], '쓰기 받음', 3 + (t > 1.2), { col: BLUE, roleColor: BLUE[1], fresh: ease(t, 1.2, 1.5) });
          member(ctx, A, NAMES[1], 'P에게서 받음', 3 + (t > 2.8), { lit: t > 1.6 && t < 2.9, fresh: ease(t, 2.8, 3.1) });
          member(ctx, B, NAMES[2], 'A에게서 받음', 3 + (t > 4.0), { lit: t > 2.9 && t < 4.1, fresh: ease(t, 4.0, 4.3) });
          const k1 = ease(t, 1.6, 2.8), k2 = ease(t, 2.9, 4.0);
          if (k1 > 0 && k1 < 1) tag(ctx, 'op', ...at(pa, k1), BLUE, { size: 9 });
          if (k2 > 0 && k2 < 1) tag(ctx, 'op', ...at(ab, k2), BLUE, { size: 9 });
          C.stamp(ctx, w / 2, 214, '세 멤버가 같은 순서로 적용', 'info', (t - 4.4) / 0.4);
        } else if (i === 1) {
          const n = 3 + (t > 1.0) + (t > 2.2) + (t > 3.4);
          [[0.4, 1.0], [1.6, 2.2], [2.8, 3.4]].forEach(([a, b]) => { const k = ease(t, a, b); if (k > 0 && k < 1) tag(ctx, 'insert', ...mix([aw + 4, 113], [P.x - 4, 113], k), BLUE, { size: 9 }); });
          member(ctx, P, NAMES[0], '쓰기 받음', n, { col: BLUE, roleColor: BLUE[1], fresh: ease(t % 1.2, 0, 0.3) });
          member(ctx, A, NAMES[1], '지연', 3, { col: ORANGE, roleColor: ORANGE[1] });
          member(ctx, B, NAMES[2], 'A를 기다림', 3, { roleColor: ORANGE[1] });
          C.stamp(ctx, w / 2, 214, 'A가 늦으면 B도 늦음', 'warn', (t - 3.8) / 0.4);
        } else {
          if (down) bad(ctx, P, NAMES[0], '응답 없음', small ? 10 : 11);
          else member(ctx, P, NAMES[0], '쓰기 받음', 4, { col: BLUE, roleColor: BLUE[1] });
          member(ctx, A, NAMES[1], won ? '새 프라이머리' : cand ? '후보, term 2' : 'P에게서 받음', 4, { col: won ? BLUE : WHITE, lit: cand, roleColor: won ? BLUE[1] : cand ? U.accent : U.muted });
          member(ctx, B, NAMES[2], 'A에게서 받음', 4);
          const tk = ease(t, 0.8, 2.4), tb = 1 - ease(t, 2.5, 2.8);
          fade(ctx, tb * ease(t, 0.6, 0.9), () => {
            const x0 = A.x, x1 = B.x + B.w;
            ctx.fillStyle = U.cell; ctx.fillRect(x0, bot + 12, x1 - x0, 6);
            ctx.fillStyle = ORANGE[2]; ctx.fillRect(x0, bot + 12, (x1 - x0) * tk, 6);
            C.text(ctx, `하트비트 끊김 ${Math.round(tk * 10)}초`, x0, bot + 32, { size: 10, weight: 600, color: ORANGE[1] });
          });
          const vote = [[cx(B), bot], [cx(B), bot + 24], [cx(A) + 10, bot + 24], [cx(A) + 10, bot]];
          const vk = ease(t, 2.7, 3.5);
          if (t > 2.6 && t < 3.8) C.line(ctx, vote, '#c4b5fd', 1);
          if (vk > 0 && vk < 1) tag(ctx, '표', ...at(vote, vk), PURPLE, { size: 9 });
          if (cand || won) C.text(ctx, `표 ${t >= 3.5 ? 2 : 1}/3`, cx(A), bot + 40, { size: 10, weight: 700, color: t >= 3.5 ? U.accent : U.muted, align: 'center' });
          if (won) {
            const go = [[aw / 2, app.y + app.h], [aw / 2, bot + 50], [cx(A) - 10, bot + 50], [cx(A) - 10, bot]], gk = ease(t, 4.0, 5.0);
            C.line(ctx, go, LINE, 1);
            if (gk < 1) tag(ctx, 'insert', ...at(go, gk), BLUE, { size: 9 });
          }
          C.stamp(ctx, w / 2, 232, 'term 2, 새 프라이머리', 'info', (t - 4.4) / 0.4);
        }
        say(notes[i]);
      },
    });
  });

  each('wc', (root) => {
    const notes = [
      'w: 1은 프라이머리가 적용하면 바로 응답한다. 세컨더리 복제는 응답 뒤에 따라간다.',
      'w: "majority"는 A가 저널에 적고 위치를 보고해 과반 2/3이 찰 때까지 응답을 미룬다.',
    ];
    const TMAX = 4.4;
    hwa.scene(root, {
      height: 262, still: 0, notes, demo: { modes: ['w: 1', 'w: "majority"'], run: '쓰기 보내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const maj = ui.mode === 1, r = ui.runAt === null ? -1 : time - ui.runAt, small = w < 480;
        const ackAt = maj ? 3.1 : 1.4, got = r >= ackAt + 0.8;
        const cw = small ? 34 : 60, g = small ? 14 : 28, px = cw + g, pw = Math.min(190, (w - px - g) * 0.48), sx = px + pw + g, sw = w - sx;
        const app = { x: 0, y: 70, w: cw, h: 60, t: '앱', size: 11 };
        const P = { x: px, y: 40, w: pw, h: 116 }, SA = { x: sx, y: 40, w: sw, h: 52 }, SB = { x: sx, y: 104, w: sw, h: 52 };
        C.pill(ctx, 0, 0, `${maj ? 'w: "majority"' : 'w: 1'}${r < 0 ? '' : got ? ', 응답 받음' : ', 응답 대기'}`);
        C.card(ctx, app, { lit: got && r < ackAt + 1.6 });
        // Primary: apply state and the majority commit point.
        const applied = r >= 1.4, commit = r >= 3.0;
        C.box(ctx, P.x, P.y, P.w, P.h, { fill: BLUE[0], stroke: r >= 1.0 && r < 1.4 ? U.accent : BLUE[2], r: 8 });
        C.text(ctx, '프라이머리', P.x + P.w / 2, P.y + 16, { size: 11, weight: 700, color: BLUE[1], align: 'center', base: 'middle' });
        const row = (y, k, v, col) => {
          C.text(ctx, k, P.x + 8, y, { size: 10, base: 'middle' });
          C.text(ctx, v, P.x + P.w - 8, y, { size: 10, weight: 700, color: col, align: 'right', base: 'middle' });
        };
        row(P.y + 44, '적용', applied ? 'op 42' : 'op 41', applied ? BLUE[1] : U.text);
        row(P.y + 68, '커밋 지점', commit ? 'op 42' : 'op 41', commit ? PURPLE[1] : U.text);
        row(P.y + 92, '응답', r >= ackAt ? '보냄' : r >= 1.4 ? '대기' : '-', r >= ackAt ? GREEN[1] : r >= 1.4 ? ORANGE[1] : U.muted);
        const sec = (b, name, got2, jAt) => {
          const s = r >= jAt ? 'op 42 저널' : r >= got2 ? 'op 42 받음' : 'op 41까지';
          unit(ctx, b, name, s, { size: small ? 10 : 11, lit: r >= got2 && r < jAt, subColor: r >= jAt ? U.text : U.muted });
        };
        sec(SA, NAMES[1], 2.2, 2.4);
        sec(SB, NAMES[2], 2.9, 3.1);
        const send = [[cw, 92], [P.x, 92]], ack = [[P.x, 120], [cw, 120]];
        const rA = [[P.x + pw, 60], [SA.x, 60]], rB = [[P.x + pw, 130], [SB.x, 130]], rep = [[SA.x, 78], [P.x + pw, 78]];
        [send, ack, rA, rB].forEach((p) => C.line(ctx, p, LINE, 1));
        if (maj) C.line(ctx, rep, '#ddd6fe', 1);
        if (r >= 0) {
          const k0 = ease(r, 0.2, 1.0), ka = ease(r, ackAt, ackAt + 0.8), k1 = ease(r, 1.4, 2.2), k2 = ease(r, 1.4, 2.9), k3 = ease(r, 2.4, 3.0);
          if (k0 < 1) tag(ctx, 'insert', ...at(send, k0), BLUE, { size: 9 });
          if (ka > 0 && ka < 1) tag(ctx, 'ack', ...at(ack, ka), GREEN, { size: 9 });
          if (k1 > 0 && k1 < 1) tag(ctx, 'op', ...at(rA, k1), BLUE, { size: 9 });
          if (k2 > 0 && k2 < 1) tag(ctx, 'op', ...at(rB, k2), BLUE, { size: 9 });
          if (maj && k3 > 0 && k3 < 1) tag(ctx, '위치', ...at(rep, k3), PURPLE, { size: 9 });
        }
        // Timeline of this one write: work, then the write-concern wait, then the reply.
        const ty = 186, X = (s) => (s / TMAX) * w, now = r < 0 ? 0 : Math.min(r, TMAX);
        C.text(ctx, '쓰기 한 건의 시간', 0, ty - 10, { size: 10, weight: 600, color: U.text });
        ctx.fillStyle = U.cell; ctx.fillRect(0, ty, w, 14);
        const blk = (a, b, col) => { const e = Math.min(b, now); if (e > a) { ctx.fillStyle = col; ctx.fillRect(X(a), ty, X(e) - X(a), 14); } };
        blk(1.0, 1.4, U.blue);
        if (maj) blk(1.4, ackAt, ORANGE[2]);
        blk(ackAt, ackAt + 0.8, GREEN[2]);
        if (maj && now > 1.6) C.text(ctx, 'waitForWriteConcern', X(1.4), ty + 26, { size: 9, weight: 600, color: ORANGE[1] });
        if (got) C.event(ctx, X(ackAt + 0.8), ty - 4, ty + 18, '', GREEN[1]);
        if (r >= 0) C.stamp(ctx, w / 2, 240, maj ? '복제 확인 뒤 응답, 롤백 없음' : '바로 응답, 장애 때 롤백 위험', maj ? 'info' : 'warn', (r - 4.4) / 0.4);
        else hint(ctx, w, 240, '쓰기 보내기');
        say(notes[ui.mode]);
      },
    });
  });

  each('pool', (root) => {
    const MAX = [100, 10], TOP = [81, 10];
    const notes = [
      'maxPoolSize 100: 몰릴 때 파드마다 연결을 80개 넘게 열고, 몰림이 지나도 닫지 않아 약 2만 5천 개가 남는다.',
      'maxPoolSize 10: 파드마다 10개에서 멈춰 약 3천 6백 개에 그친다. 몰린 순간 넘친 요청은 앱의 풀 대기열에서 기다린다.',
    ];
    hwa.scene(root, {
      height: 278, still: 0, notes, demo: { modes: ['maxPoolSize 100', 'maxPoolSize 10'], run: '파드 늘리고 몰기' },
      frame: (ctx, w, h, time, say, ui) => {
        const m = ui.mode, r = ui.runAt === null ? -1 : time - ui.runAt, small = w < 480;
        const pods = r < 0 ? 30 : Math.round(30 + 270 * ease(r, 0.3, 2.4));
        const burst = r < 0 ? 0 : ease(r, 2.8, 3.4) * (1 - ease(r, 4.6, 5.2));
        const per = 5 + (TOP[m] - 5) * (r < 0 ? 0 : ease(r, 2.8, 3.8));
        const base = pods * 3, active = base + burst * (Math.min(pods * per, 20000) - base);
        const open = pods * (per + 2), phase = r < 0 ? '' : r < 2.8 ? ', 파드 늘어나는 중' : r < 4.6 ? ', 트래픽 몰림' : ', 몰림 지나감';
        C.pill(ctx, 0, 0, `maxPoolSize ${MAX[m]}${phase}`);
        // Pod grid: one cell is ten pods; grey fill is open connections per pod, blue the busy share.
        const gw = Math.floor(w * (small ? 0.47 : 0.44)), cols = small ? 6 : 10, rows = 30 / cols;
        const gy = 56, cg = 5, cw = (gw - 16 - (cols - 1) * cg) / cols, ch = Math.min(30, (150 - (rows - 1) * cg) / rows), gb = gy + rows * (ch + cg) - cg + 24;
        C.group(ctx, 0, 34, gw, gb - 34, `API 파드 ${pods}개`);
        for (let c = 0; c < 30; c++) {
          const x = 8 + (c % cols) * (cw + cg), y = gy + Math.floor(c / cols) * (ch + cg), on = c < pods / 10;
          C.box(ctx, x, y, cw, ch, { fill: '#fff', stroke: on ? U.grid : '#e9ecef', dash: on ? null : [2, 2], r: 3 });
          if (!on) continue;
          const fh = (ch - 2) * (per / 100), bh = (ch - 2) * Math.min(per, active / pods) / 100;
          ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x + 1, y + ch - 1 - fh, cw - 2, fh);
          ctx.fillStyle = U.blue; ctx.fillRect(x + 1, y + ch - 1 - bh, cw - 2, bh);
        }
        C.text(ctx, '칸 하나 = 파드 10개', 8, gb - 9, { size: 9 });
        // Primary: open versus busy connections, the idle part hatched red.
        const px = gw + (small ? 26 : 56), P = { x: px, y: 34, w: w - px, h: 180 }, bw = P.w - 20;
        C.box(ctx, P.x, P.y, P.w, P.h, { fill: '#fff', r: 8 });
        C.text(ctx, '프라이머리', P.x + 10, P.y + 18, { size: 11, weight: 700, color: U.text, base: 'middle' });
        C.text(ctx, '열린 연결', P.x + 10, P.y + 42, { size: 10, base: 'middle' });
        const many = open > 10000;
        C.text(ctx, num(open), P.x + 10, P.y + 64, { size: small ? 17 : 20, weight: 700, color: many ? U.red : U.text, base: 'middle' });
        const X = (v) => (Math.min(v, 30000) / 30000) * bw, by = P.y + 84;
        ctx.fillStyle = U.cell; ctx.fillRect(P.x + 10, by, bw, 12);
        hatchRect(ctx, P.x + 10 + X(active), by, X(open) - X(active), 12);
        ctx.fillStyle = U.blue; ctx.fillRect(P.x + 10, by, X(active), 12);
        C.text(ctx, `일하는 연결 ${num(active)}`, P.x + 10, by + 30, { size: 11, weight: 600, color: U.blue, base: 'middle' });
        C.text(ctx, `스레드 ${num(open)}개`, P.x + 10, by + 54, { size: 10, color: many ? U.red : U.muted, base: 'middle' });
        C.text(ctx, `연결 메모리 최대 ${(open / 1024).toFixed(1)}GB`, P.x + 10, by + 72, { size: 10, color: many ? U.red : U.muted, base: 'middle' });
        // Requests in flight between the pods and the primary.
        const n = Math.min(14, 2 + Math.round(active / 1500));
        for (let k = 0; k < n; k++) {
          const p = (time * 0.7 + k / n) % 1, y = 70 + ((k * 37) % 110);
          dot(ctx, mix([gw + 3, y], [px - 3, y], p), U.blue, 2.6);
        }
        if (r >= 0) C.stamp(ctx, w / 2, 252, m ? '열린 3,600, 일하는 900' : '열린 24,900, 일하는 900', m ? 'ok' : 'bad', (r - 5.8) / 0.4);
        else hint(ctx, w, 252, '파드 늘리고 몰기');
        say(`maxPoolSize ${MAX[m]}. 파드 ${pods}개, 열린 연결 ${num(open)}, 일하는 연결 ${num(active)}.`);
      },
    });
  });

  each('stall', (root) => {
    const SEC = 6, HOLD = 2.4, S = hwa.loopScenes(SEC, HOLD, 2), N = 30, A0 = 15, A1 = 19;
    const dirty = (s) => (s < 8 ? 4 + s * 0.4 : s < 15 ? 7.2 + (s - 8) * 2 : s < 19 ? 21.2 + (s - 15) * 0.2 : s < 21 ? 22 - (s - 19) * 8 : 5.5);
    const ticket = (s) => (s < 8 ? 20 : s < 15 ? 20 + (s - 8) * 8 : s < 19 ? 128 : s < 21 ? 128 - (s - 19) * 45 : 30);
    const writes = (s) => (s < 8 ? 6 : s < 15 ? 11 : s < 19 ? 0 : s < 21 ? 15 : 7);
    const SER = [dirty, ticket, writes].map((f) => Array.from({ length: N + 1 }, (_, s) => f(s)));
    // 15-second averages, as a monitoring graph would draw them.
    const AVG = SER.map((a) => [a.slice(0, 15), a.slice(15)].map((x) => x.reduce((p, q) => p + q, 0) / x.length));
    const PAN = [
      { title: 'dirty 비율', right: '캐시 대비 %', max: 25, ticks: [[0, '0'], [20, '20%']], lim: 20, col: U.blue },
      { title: '쓰기 티켓 사용', right: '최대 128', max: 140, ticks: [[0, '0'], [128, '128']], lim: 128, col: U.purple },
      { title: '초당 쓰기', right: '천 건', max: 16, ticks: [[0, '0'], [15, '15k']], col: U.blue },
    ];
    const notes = ['1초 단위: dirty가 트리거 20%를 넘고 티켓이 바닥난 4초 동안 쓰기가 0이 된다.', '15초 평균: 같은 데이터를 15초씩 묶으면 쓰기 그래프에 멈춤이 보이지 않는다.'];
    hwa.scene(root, {
      height: 268, still: S.at(0) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), x0 = 34, pw = w - x0 - 2, X = (s) => x0 + (s / N) * pw;
        const rv = i === 0 ? N * ease(t, 0.2, 4.6) : N;
        C.pill(ctx, 0, 0, i ? '15초 평균으로 본 같은 구간' : '1초 단위 (FTDC)');
        PAN.forEach((p, j) => {
          const y = 52 + j * 70, ph = 44, Y = C.panel(ctx, x0, y, pw, ph, { title: p.title, right: p.right, max: p.max, ticks: p.ticks });
          if (i === 0 && rv > A0) { ctx.fillStyle = 'rgba(250,82,82,0.10)'; ctx.fillRect(X(A0), y, X(Math.min(rv, A1)) - X(A0), ph); }
          if (p.lim) C.dashed(ctx, x0, Y(p.lim), x0 + pw, Y(p.lim), U.red);
          if (i === 0) {
            const pts = [];
            for (let s = 0; s <= Math.floor(rv); s++) pts.push([X(s), Y(SER[j][s])]);
            if (rv < N && rv % 1) pts.push([X(rv), Y(SER[j][Math.floor(rv)] + (SER[j][Math.ceil(rv)] - SER[j][Math.floor(rv)]) * (rv % 1))]);
            plot(ctx, pts, p.col);
            const hot = pts.filter(([x]) => x >= X(A0) - 0.5 && x <= X(A1) + 0.5);
            plot(ctx, hot, U.red);
          } else {
            const k = ease(t, 0.3, 1.2), a = AVG[j], pts = [[X(0), Y(a[0])], [X(15), Y(a[0])], [X(15), Y(a[1])], [X(N), Y(a[1])]];
            fade(ctx, k, () => plot(ctx, pts, p.col));
          }
        });
        [[0, '0초', 'left'], [15, '15초', 'center'], [30, '30초', 'right']].forEach(([s, l, al]) => C.text(ctx, l, X(s), 258, { size: 10, align: al }));
        if (i === 0) C.stamp(ctx, X(17), 52 + 140 + 22, '쓰기 4초 멈춤', 'bad', (t - 4.2) / 0.4);
        else C.stamp(ctx, x0 + pw / 2, 52 + 140 + 22, '평균에는 멈춤이 안 보임', 'warn', (t - 2.0) / 0.4);
        say(notes[i]);
      },
    });
    function plot(ctx, pts, col) { C.line(ctx, pts, col, 1.8); }
  });

  each('storage', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2), ST = [1.4, 4.8];
    const notes = [
      '프라이머리와 A의 볼륨이 같은 저장 노드 X에 있다. X가 멈추면 2대가 함께 멈춰 커밋 지점이 서고, majority 쓰기가 전부 기다린다.',
      'A를 다른 저장 노드 Z로 옮기면 Z가 멈춰도 A 하나만 늦는다. 프라이머리와 B로 과반이 서서 쓰기가 이어진다.',
    ];
    hwa.scene(root, {
      height: 248, still: S.at(0) + 3.0, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), small = w < 480;
        const cw = small ? 34 : 56, gap = small ? 10 : 22, mx = cw + gap, mw = (w - mx - 2 * gap) / 3;
        const M = [0, 1, 2].map((j) => ({ x: mx + j * (mw + gap), y: 64, w: mw, h: 50 }));
        const stall = t >= ST[0] && t < ST[1], hit = i === 0 ? [0, 1] : [1], stuck = stall && i === 0, cx = (b) => b.x + b.w / 2;
        const NODE = i === 0
          ? [{ x: M[0].x, w: M[1].x + mw - M[0].x, n: '저장 노드 X', on: [0, 1], s: 1 }, { x: M[2].x, w: mw, n: '노드 Y', on: [2] }]
          : [{ x: M[0].x, w: mw, n: '노드 X', on: [0] }, { x: M[1].x, w: mw, n: '노드 Z', on: [1], s: 1 }, { x: M[2].x, w: mw, n: '노드 Y', on: [2] }];
        const op = 100 + Math.floor(2 * (i === 0 && t >= ST[0] && t < ST[1] ? ST[0] : t));
        C.pill(ctx, 0, 0, i ? '멤버마다 다른 저장 노드' : '두 멤버가 한 저장 노드');
        C.text(ctx, `커밋 지점 op ${op}`, w, 11, { size: 11, weight: 700, color: stuck ? U.red : U.text, align: 'right', base: 'middle' });
        const app = { x: 0, y: 64, w: cw, h: 50, t: '앱', size: 11 };
        C.card(ctx, app);
        C.line(ctx, [[cw, 89], [M[0].x, 89]], LINE, 1);
        // Replication from the primary; a stalled end stops the flow.
        const pa = [[cx(M[0]) - 6, M[0].y], [cx(M[0]) - 6, 50], [cx(M[1]), 50], [cx(M[1]), M[1].y]];
        const pb = [[cx(M[0]) + 6, M[0].y], [cx(M[0]) + 6, 40], [cx(M[2]), 40], [cx(M[2]), M[2].y]];
        [[pa, 1], [pb, 2]].forEach(([p, j]) => {
          const blocked = stall && (hit.includes(0) || hit.includes(j));
          C.arrow(ctx, p, 1, LINE, { width: 1.1 });
          if (!blocked) [0, 0.5].forEach((o) => dot(ctx, at(p, (time * 0.8 + o) % 1), U.blue, 3));
        });
        M.forEach((b, j) => {
          if (stall && hit.includes(j)) bad(ctx, b, NAMES[j], '디스크 멈춤', small ? 10 : 11);
          else unit(ctx, b, NAMES[j], j ? null : '쓰기 받음', { col: j ? WHITE : BLUE, size: small ? 10 : 11, subColor: BLUE[1] });
        });
        NODE.forEach((nd) => {
          const b = { x: nd.x, y: 158, w: nd.w, h: 40 };
          nd.on.forEach((j) => C.line(ctx, [[cx(M[j]), M[j].y + M[j].h], [cx(M[j]), b.y]], LINE, 1));
          if (stall && nd.s) bad(ctx, b, nd.n, '1초 정지', small ? 10 : 11);
          else unit(ctx, b, nd.n, null, { col: GRAY, size: small ? 10 : 11 });
        });
        C.text(ctx, '볼륨', cx(M[0]) + 4, 136, { size: 9 });
        // Writes waiting on the majority pile up beside the app while the commit point is stuck.
        if (stuck) {
          const q = Math.min(6, 1 + Math.floor((t - ST[0]) / 0.35));
          for (let k = 0; k < q; k++) tag(ctx, '', cw + gap / 2, 124 + k * 6, ORANGE, { w: Math.max(12, gap), h: 5 });
          C.text(ctx, `대기 ${q}`, cw / 2, 134, { size: 10, weight: 700, color: ORANGE[1], align: 'center' });
        } else tag(ctx, 'w', ...mix([cw + 2, 89], [M[0].x - 8, 89], (time * 1.2) % 1), BLUE, { size: 9, h: 16 });
        const ok = i === 1;
        C.stamp(ctx, w / 2, 226, ok ? 'A만 늦음, 과반 유지' : '2대가 함께 멈춤, 쓰기 대기', ok ? 'ok' : 'bad', Math.min((t - 2.2) / 0.4, (ST[1] - t) / 0.3));
        say(notes[i]);
      },
    });
  });

  each('shard', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2), KEY = [17, 42, 8, 91, 33, 64, 120, 5, 77];
    const notes = [
      '레플리카 셋: 세 API의 쓰기가 전부 프라이머리 한 대로 간다. 세컨더리는 같은 쓰기를 다시 실행할 뿐 나눠 받지 못한다.',
      '샤드 클러스터: mongos가 계정 ID로 샤드를 골라 보내서, 샤드마다 프라이머리가 쓰기를 나눠 받는다.',
    ];
    // Load bar; the part over the limit is hatched red.
    const load = (ctx, x, y, bw, v) => {
      const lim = bw / 1.3;
      ctx.fillStyle = U.cell; ctx.fillRect(x, y, bw, 8);
      ctx.fillStyle = U.blue; ctx.fillRect(x, y, Math.min(v, 1) * lim, 8);
      if (v > 1) hatchRect(ctx, x + lim, y, (v - 1) * lim, 8);
      C.dashed(ctx, x + lim, y - 3, x + lim, y + 11, U.red);
    };
    hwa.scene(root, {
      height: 244, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), small = w < 480, aw = small ? 34 : 56;
        const apps = [0, 1, 2].map((j) => ({ x: 0, y: 46 + j * 58, w: aw, h: 40, t: 'API', size: 10 })), acy = (j) => apps[j].y + 20;
        C.pill(ctx, 0, 0, i ? '샤드 클러스터' : '레플리카 셋');
        apps.forEach((b) => C.card(ctx, b));
        const v = ease(t, 0.3, 3.0);
        if (i === 0) {
          const gx = aw + (small ? 36 : 90), gw = w - gx, P = { x: gx + 10, y: 60, w: gw - 20, h: 64 };
          C.group(ctx, gx, 34, gw, 172, '레플리카 셋');
          C.box(ctx, P.x, P.y, P.w, P.h, { fill: BLUE[0], stroke: BLUE[2], r: 7 });
          C.text(ctx, '프라이머리', P.x + 10, P.y + 18, { size: 11, weight: 700, color: BLUE[1], base: 'middle' });
          C.text(ctx, '쓰기 부하', P.x + 10, P.y + 38, { size: 9, base: 'middle' });
          load(ctx, P.x + 10, P.y + 48, P.w - 20, 1.3 * v);
          const sw = (P.w - 10) / 2;
          [0, 1].forEach((j) => {
            const b = { x: P.x + j * (sw + 10), y: 150, w: sw, h: 40 };
            C.line(ctx, [[b.x + sw / 2, P.y + P.h], [b.x + sw / 2, b.y]], LINE, 1);
            unit(ctx, b, `세컨더리 ${'AB'[j]}`, '같은 쓰기 반복', { size: 10, subSize: 9 });
          });
          KEY.forEach((_, k) => {
            const p = (time * 0.45 + k / KEY.length) % 1, j = k % 3;
            dot(ctx, mix([aw + 3, acy(j)], [P.x - 3, P.y + 20 + j * 12], p), U.blue, 3.4);
          });
          C.stamp(ctx, w / 2, 224, '쓰기 전부 프라이머리 한 대로', 'bad', (t - 3.2) / 0.4);
        } else {
          const g = small ? 14 : 34, mw = small ? 52 : 80, mg = { x: aw + g, y: 92, w: mw, h: 56, t: 'mongos', size: 10 };
          const sx = mg.x + mw + g, sw = w - sx;
          const SH = [0, 1, 2].map((j) => ({ x: sx, y: 34 + j * 60, w: sw, h: 52 }));
          C.card(ctx, mg);
          SH.forEach((b, j) => {
            C.box(ctx, b.x, b.y, b.w, b.h, { fill: U.plot, r: 8 });
            C.text(ctx, `샤드 ${j + 1}`, b.x + 8, b.y + 14, { size: 10, weight: 600, color: U.text, base: 'middle' });
            const pb = { x: b.x + 8, y: b.y + 22, w: Math.min(72, b.w * 0.42), h: 22 };
            unit(ctx, pb, '프라이머리', null, { col: BLUE, size: 9 });
            [0, 1].forEach((s) => C.box(ctx, pb.x + pb.w + 6 + s * 16, pb.y + 5, 12, 12, { fill: '#fff', r: 3 }));
            const lx = pb.x + pb.w + 42, lw = b.x + b.w - 8 - lx;
            if (lw > 20) load(ctx, lx, pb.y + 7, lw, 0.42 * v);
          });
          KEY.forEach((key, k) => {
            const p = (time * 0.45 + k / KEY.length) % 1, j = k % 3, s = key % 3, my = mg.y + mg.h / 2;
            const pt = p < 0.5 ? mix([aw + 3, acy(j)], [mg.x - 3, my], p * 2) : mix([mg.x + mw + 3, my], [sx - 3, SH[s].y + 33], (p - 0.5) * 2);
            dot(ctx, pt, U.blue, 3.4);
          });
          C.text(ctx, '샤드 키: 계정 ID', mg.x + mw / 2, mg.y + mg.h + 14, { size: 9, align: 'center' });
          C.stamp(ctx, w / 2, 224, '프라이머리 3대가 나눠 받음', 'ok', (t - 3.2) / 0.4);
        }
        say(notes[i]);
      },
    });
  });

  each('route', (root) => {
    const STEP = 1.6, HOLD = 2.6;
    const ST = [
      '샤드 키가 든 쿼리가 도착한다',
      '캐시에서 142가 든 범위를 찾는다',
      '샤드 B 하나에만 보낸다',
      'B의 결과만 받아 돌려준다',
      '샤드 키가 없으면 모든 샤드로 보낸다',
      '가장 느린 샤드까지 기다려 합친다',
    ];
    const n = ST.length;
    hwa.scene(root, {
      height: 284, still: n * STEP + 0.5, scenes: hwa.stepScenes(n, STEP, HOLD),
      frame: (ctx, w, h, time, say) => {
        const t = time % (n * STEP + HOLD), cur = Math.min(n - 1, Math.floor(t / STEP)), f = t >= n * STEP ? 1 : hwa.smooth((t - cur * STEP) / (STEP * 0.7));
        const small = w < 480, aw = small ? 32 : 56, g = small ? 12 : 30, mgw = small ? 108 : 180;
        const scat = cur >= 4, app = { x: 0, y: 132, w: aw, h: 44, t: '앱', size: 11 };
        const MG = { x: aw + g, y: 96, w: mgw, h: 116 }, CF = { x: aw + g, y: 52, w: mgw, h: 28, t: 'config 서버', size: 10 };
        const sx = MG.x + mgw + g, sw = w - sx, SH = [0, 1, 2].map((j) => ({ x: sx, y: 52 + j * 64, w: sw, h: 52 }));
        const RANGE = ['~99', '100~199', '200~'];
        C.pill(ctx, 0, 0, scat ? 'scatter-gather 쿼리' : 'targeted 쿼리');
        C.text(ctx, scat ? 'find({ status: "open" })' : 'find({ accountId: 142 })', 0, 36, { size: 10, weight: 600, color: U.text });
        C.card(ctx, app);
        C.card(ctx, CF);
        C.dashed(ctx, CF.x + mgw / 2, CF.y + CF.h, CF.x + mgw / 2, MG.y, LINE);
        C.box(ctx, MG.x, MG.y, MG.w, MG.h, { fill: U.plot, r: 9 });
        C.text(ctx, 'mongos', MG.x + 10, MG.y + 16, { size: 11, weight: 700, color: U.text, base: 'middle' });
        C.text(ctx, '라우팅 캐시', MG.x + mgw - 10, MG.y + 16, { size: 9, align: 'right', base: 'middle' });
        RANGE.forEach((rg, j) => {
          const b = { x: MG.x + 8, y: MG.y + 30 + j * 26, w: mgw - 16, h: 22 }, hit = !scat && cur >= 1 && j === 1;
          C.box(ctx, b.x, b.y, b.w, b.h, { fill: '#fff', on: hit && cur === 1, r: 5 });
          C.text(ctx, `${rg} → ${'ABC'[j]}`, b.x + 8, b.y + 11.5, { size: 10, weight: hit ? 700 : 400, color: hit ? U.accent : U.text, base: 'middle' });
        });
        const slow = scat && cur === 5 && f < 0.75;
        SH.forEach((b, j) => {
          const lit = (!scat && j === 1 && (cur === 2 && f > 0.8 || cur === 3 && f < 0.3)) || (scat && cur === 4 && f > 0.8);
          if (slow && j === 2) unit(ctx, b, `샤드 ${'ABC'[j]}`, '느림, 기다리는 중', { col: ORANGE, subColor: ORANGE[1], size: 11 });
          else unit(ctx, b, `샤드 ${'ABC'[j]}`, RANGE[j], { lit, size: 11 });
        });
        const ay = app.y + app.h / 2, to = (j) => [[MG.x + mgw, ay], [sx, SH[j].y + SH[j].h / 2]];
        C.line(ctx, [[aw, ay], [MG.x, ay]], LINE, 1);
        [0, 1, 2].forEach((j) => C.line(ctx, to(j), j === 1 || scat ? LINE : '#e9ecef', 1));
        const go = [[aw + 2, ay], [MG.x - 2, ay]], back = go.slice().reverse();
        if (cur === 0 || cur === 4) tag(ctx, 'find', ...at(go, cur === 4 ? Math.min(1, f * 2) : f), BLUE, { size: 9 });
        if (cur === 2) C.arrow(ctx, to(1), f, U.accent, { width: 2 });
        if (cur === 3) {
          if (f < 0.5) tag(ctx, '결과', ...at(to(1).slice().reverse(), f * 2), GREEN, { size: 9 });
          else tag(ctx, '결과', ...at(back, (f - 0.5) * 2), GREEN, { size: 9 });
        }
        if (cur === 4 && f > 0.5) [0, 1, 2].forEach((j) => C.arrow(ctx, to(j), (f - 0.5) * 2, U.accent, { width: 2 }));
        if (cur === 5) {
          [0, 1, 2].forEach((j) => {
            const k = j === 2 ? ease(f, 0.45, 0.75) : ease(f, 0, 0.3);
            if (k > 0 && k < 1) tag(ctx, '결과', ...at(to(j).slice().reverse(), k), GREEN, { size: 9 });
          });
          if (f > 0.8) tag(ctx, '합침', ...at(back, ease(f, 0.8, 1)), GREEN, { size: 9 });
        }
        C.text(ctx, `${cur + 1}. ${ST[cur]}`, 0, h - 12, { size: 12, weight: 600, color: U.text, base: 'middle' });
        say(`${cur + 1}단계: ${ST[cur]}.`);
      },
    });
  });
})();
