// High availability post: request path, VIP, storage replication, replica set votes, failover time, split brain.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const lerp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], PURPLE = ['#ede9fe', '#6d28d9', '#a78bfa'], GREEN = ['#dcfce7', '#15803d', '#86efac'];
  const RED = ['#fee2e2', '#dc2626', '#fca5a5'], GRAY = [U.cell, U.muted, '#e2e8f0'], AMBER = ['#fef3c7', '#b45309', '#fcd34d'];
  const fig = (id, o) => document.querySelectorAll(`[data-figure="high-availability-${id}"]`).forEach((root) => hwa.scene(root, o));
  const sceneOf = (time, SEC, HOLD, n) => { const { i, t } = hwa.loop(time, SEC, HOLD, n); return { i, t, run: (time % (n * (SEC + HOLD))) - i * (SEC + HOLD) }; };

  // Server box b = { x, y, w, h, t, s, sc }. st: ok, down, idle, on, warn. part lets dots pass between box and text.
  const node = (ctx, b, st = 'ok', part = 'all') => {
    const down = st === 'down', idle = st === 'idle';
    if (part !== 'text') {
      ctx.beginPath();
      ctx.roundRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 8);
      ctx.fillStyle = down ? '#fef2f2' : idle ? U.plot : '#fff';
      ctx.fill();
      ctx.setLineDash(idle ? [4, 3] : []);
      ctx.strokeStyle = down ? RED[2] : st === 'on' ? U.accent : st === 'warn' ? AMBER[2] : U.grid;
      ctx.lineWidth = st === 'on' ? 2 : 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
    if (part === 'box') return;
    const cy = b.y + b.h / 2;
    C.text(ctx, b.t, b.x + b.w / 2, b.s ? cy - 7 : cy, { size: b.size || 11, weight: 600, color: down || idle ? U.muted : U.text, align: 'center', base: 'middle' });
    if (b.s) C.text(ctx, b.s, b.x + b.w / 2, cy + 8, { size: 10, weight: b.sc ? 600 : 400, color: b.sc || U.muted, align: 'center', base: 'middle' });
    if (down) {
      const x = b.x + b.w - 10, y = b.y + 10;
      C.line(ctx, [[x - 3.5, y - 3.5], [x + 3.5, y + 3.5]], U.red, 1.8);
      C.line(ctx, [[x + 3.5, y - 3.5], [x - 3.5, y + 3.5]], U.red, 1.8);
    }
  };
  // Chip centred at (x, y). col = [bg, fg, line].
  const tag = (ctx, s, x, y, col, a = 1, size = 10) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, size, 600) + 14;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x - cw / 2 + 0.5, y - 9, cw - 1, 18, 6);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.stroke();
    C.text(ctx, s, x, y + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  const dot = (ctx, x, y, color = U.blue, r = 4) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
  };
  const FADE = 0.45;
  // Requests born every gap seconds take dur to run route(tb, j).pts. fail turns one red where it ends; it then fades.
  const flow = (ctx, t, gap, dur, route) => {
    for (let j = Math.floor((t - dur - FADE) / gap); j * gap <= t; j++) {
      const tb = j * gap, r = route(tb, j), k = (t - tb) / dur;
      if (!r || k < 0 || (k > 1 && (!r.fail || t - tb - dur > FADE))) continue;
      const [x, y] = C.pathAt(r.pts, Math.min(k, 1)).pop();
      ctx.globalAlpha = k > 1 ? 1 - (t - tb - dur) / FADE : 1;
      dot(ctx, x, y, r.fail && k >= 0.97 ? U.red : r.color || U.blue);
      ctx.globalAlpha = 1;
    }
  };
  // Red counter of failed requests whose end has passed.
  const failed = (t, gap, dur, route) => {
    let n = 0;
    for (let j = 0; j * gap + dur <= t; j++) if ((route(j * gap, j) || {}).fail) n++;
    return n;
  };
  const metric = (ctx, w, label, value, bad) => {
    C.text(ctx, value, w, 12, { size: 13, weight: 700, color: bad ? U.red : U.text, align: 'right', base: 'middle' });
    C.text(ctx, label, w - tw(ctx, value, 13, 700) - 6, 12, { size: 10, align: 'right', base: 'middle' });
  };
  const xmark = (ctx, x, y, s = 5) => {
    C.line(ctx, [[x - s, y - s], [x + s, y + s]], U.red, 2);
    C.line(ctx, [[x + s, y - s], [x - s, y + s]], U.red, 2);
  };

  // One copy of every layer: a dead DB stops every response; two copies keep answering.
  {
    const SEC = 6, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3), FAIL = 1.6, GAP = 0.42, DUR = 2.6;
    const NAMES = ['사용자', 'DNS', 'CDN', 'LB', '앱', 'DB'];
    const SC = [
      ['평소', 'info', null, '요청은 DNS부터 DB까지 모든 계층을 지나야 응답이 된다.'],
      ['DB 장애', 'bad', ['앞 계층이 멀쩡해도 응답 0', 'bad'], 'DB 한 대가 멈추면 앞 계층이 멀쩡해도 응답은 0이 된다. DB가 단일 장애점이다.'],
      ['계층마다 두 대', 'ok', ['남은 DB로 계속 응답', 'ok'], '계층마다 두 대를 두면 DB 한 대가 멈춰도 남은 쪽으로 응답한다.'],
    ];
    fig('spof', {
      height: 214, still: S.at(1) + SEC + 1, scenes: S, notes: SC.map((s) => s[3]),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = sceneOf(time, SEC, HOLD, 3), pair = i === 2, bw = w < 420 ? 42 : Math.min(84, (w - 90) / 6), g = (w - bw * 6) / 5, cy = 118;
        const X = (c) => c * (bw + g), ys = (c) => (pair && c > 0 ? [cy - 22, cy + 22] : [cy]), bh = pair ? 36 : 46;
        const dead = (tt) => i > 0 && tt >= FAIL;
        C.pill(ctx, 0, 0, SC[i][0], SC[i][1]);
        for (let c = 0; c < 5; c++) ys(c).forEach((a) => ys(c + 1).forEach((b) => C.line(ctx, [[X(c) + bw, a], [X(c + 1), b]], '#e2e8f0', 1)));
        const box = (c, y, part) => {
          const st = c === 5 && y === ys(5)[0] && dead(t) ? 'down' : 'ok';
          node(ctx, { x: X(c), y: y - bh / 2, w: bw, h: bh, t: NAMES[c], size: w < 420 ? 10 : 11 }, st, part);
        };
        const route = (tb, j) => {
          const lane = pair ? j % 2 : 0, down = dead(tb + DUR), db = pair && down ? 1 : lane;
          const pts = [[X(0) + bw / 2, cy]];
          for (let c = 1; c < 6; c++) pts.push([c === 5 && !pair && down ? X(5) - 5 : X(c) + bw / 2, ys(c)[c === 5 ? db : lane]]);
          return { pts, fail: !pair && down };
        };
        flow(ctx, t, GAP, DUR, route);
        for (let c = 0; c < 6; c++) ys(c).forEach((y) => box(c, y, 'all'));
        for (let c = 1; c < 6; c++) C.text(ctx, pair ? '2대' : '1대', X(c) + bw / 2, cy + (pair ? 22 + 18 : 23) + 14, { size: 10, align: 'center' });
        const last = route(Math.floor((t - DUR) / GAP) * GAP, Math.floor((t - DUR) / GAP));
        metric(ctx, w, '응답', last.fail ? '0%' : '100%', last.fail);
        if (SC[i][2]) C.stamp(ctx, w / 2, 48, SC[i][2][0], SC[i][2][1], (run - SEC) / 0.4);
        say(`${SC[i][0]}. ${SC[i][3]}`);
      },
    });
  }

  // Same failure of server A under Active-Active and Active-Standby: load on B against requests lost while switching.
  {
    const SEC = 7, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2), FAIL = 2.0, GAP = 0.3, DUR = 1.6, AT = 0.45;
    const SC = [
      { pill: 'Active-Active', tone: 'info', detect: 0.4, stamp: ['B 혼자 2배 부하', 'warn'], note: '둘 다 받다가 A가 멈추면 B가 전부 받는다. 빨리 넘어가지만 B는 평소의 두 배를 받는다.' },
      { pill: 'Active-Standby', tone: 'warn', detect: 2.2, stamp: ['전환 동안 요청 실패', 'bad'], note: 'A만 받다가 A가 멈추면 B로 넘긴다. 감지하고 넘기는 동안 들어온 요청은 실패한다.' },
    ];
    fig('modes', {
      height: 252, still: S.at(1) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = sceneOf(time, SEC, HOLD, 2), sc = SC[i], aa = i === 0, sw = clamp(w * 0.34, 108, 180);
        const user = { x: 0, y: 104, w: 50, h: 44, t: '사용자' }, lb = { x: Math.max(68, w * 0.3), y: 100, w: 58, h: 52, t: 'LB' };
        const sv = [0, 1].map((k) => ({ x: w - sw, y: 46 + k * 104, w: sw, h: 58 }));
        const swAt = FAIL + sc.detect, cy = (b) => b.y + b.h / 2;
        const target = (td, j) => (td >= swAt ? 1 : aa ? j % 2 : 0);
        const route = (tb, j) => {
          const td = tb + DUR * AT, k = target(td, j), b = sv[k];
          return { pts: [[user.x + user.w / 2, cy(user)], [lb.x + lb.w / 2, cy(lb)], k === 0 && tb + DUR >= FAIL ? [b.x - 5, cy(b) - 8] : [b.x + 30, cy(b) - 8]], fail: k === 0 && tb + DUR >= FAIL };
        };
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        metric(ctx, w, '실패한 요청', `${failed(t, GAP, DUR, route)}건`, failed(t, GAP, DUR, route) > 0);
        sv.forEach((b) => C.line(ctx, [[lb.x + lb.w, cy(lb)], [b.x, cy(b) - 8]], '#e2e8f0', 1));
        C.line(ctx, [[user.x + user.w, cy(user)], [lb.x, cy(lb)]], '#e2e8f0', 1);
        const stA = t >= FAIL ? 'down' : 'ok', stB = !aa && t < swAt ? 'idle' : 'ok';
        flow(ctx, t, GAP, DUR, route);
        [user, lb].forEach((b) => node(ctx, b));
        node(ctx, sv[0], stA, 'box');
        node(ctx, sv[1], stB, 'box');
        // Load bar: share of all traffic each server takes now.
        const loadA = t < FAIL ? (aa ? 0.5 : 1) : 0, loadB = t >= swAt ? 1 : aa ? 0.5 : 0;
        [[sv[0], '서버 A', loadA, stA], [sv[1], '서버 B', loadB, stB]].forEach(([b, name, v, st]) => {
          C.text(ctx, name, b.x + 12, b.y + 17, { size: 11, weight: 600, color: st === 'ok' ? U.text : U.muted, base: 'middle' });
          const lab = st === 'down' ? '멈춤' : st === 'idle' ? '대기' : `몫 ${Math.round(v * 100)}%`;
          C.text(ctx, lab, b.x + b.w - 12, b.y + 17, { size: 10, weight: 600, color: st === 'down' ? U.red : v > 0.9 && aa ? AMBER[1] : U.muted, align: 'right', base: 'middle' });
          const bx = b.x + 12, bw = b.w - 24;
          ctx.fillStyle = U.cell;
          ctx.fillRect(bx, b.y + 34, bw, 10);
          ctx.fillStyle = v > 0.9 && aa ? '#f59e0b' : U.blue;
          ctx.fillRect(bx, b.y + 34, bw * v, 10);
        });
        if (t >= FAIL && t < swAt + 0.6 && !aa) C.text(ctx, '감지하고 넘기는 중', sv[1].x + sv[1].w / 2, sv[1].y - 10, { size: 10, weight: 600, color: U.red, align: 'center' });
        C.stamp(ctx, w / 2, 232, sc.stamp[0], sc.stamp[1], (run - SEC) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    });
  }

  // Route 53 weighted records 70:30 with health checks: one CDN down, then both down.
  {
    const SEC = 6.5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3), FT = 1.4, GAP = 0.3, DUR = 2.0;
    const SC = [
      { pill: '둘 다 정상', tone: 'ok', note: '두 레코드 모두 정상이면 가중치 70 : 30 비율로 답한다.' },
      { pill: 'CloudFront 비정상', tone: 'warn', stamp: ['Front Door만 답함', 'ok'], note: 'CloudFront 헬스체크가 실패하면 그 레코드를 빼고 Front Door만 답한다.' },
      { pill: '둘 다 비정상', tone: 'bad', stamp: ['전부 정상으로 보고 70 : 30', 'warn'], note: '둘 다 실패하면 Route 53은 전부 정상으로 보고 다시 가중치대로 답한다. 죽은 주소라도 답을 준다.' },
    ];
    const pickA = (j) => (j * 0.618034) % 1 < 0.7;
    fig('dns', {
      height: 250, still: S.at(2) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = sceneOf(time, SEC, HOLD, 3), narrow = w < 420;
        const downA = (tt) => i >= 1 && (i === 2 || tt >= FT), downB = (tt) => i === 2 && tt >= FT;
        const user = { x: 0, y: 106, w: 48, h: 44, t: '사용자' }, cw = clamp(w * 0.3, 96, 170);
        const r53 = { x: 62, y: 62, w: w - cw - 62 - (narrow ? 12 : 40), h: 132 };
        const cdn = [{ x: w - cw, y: 52, w: cw, h: 52, t: 'CloudFront', s: 'AWS' }, { x: w - cw, y: 152, w: cw, h: 52, t: 'Front Door', s: 'Azure' }];
        const ry = [r53.y + 52, r53.y + 96];
        const answer = (tt, j) => {
          const a = downA(tt), b = downB(tt);
          return a && !b ? 1 : !a && b ? 0 : pickA(j) ? 0 : 1;
        };
        const route = (tb, j) => {
          const k = answer(tb + DUR * 0.4, j), c = cdn[k];
          return { pts: [[user.x + user.w / 2, 128], [r53.x, ry[k]], [r53.x + r53.w, ry[k]], [c.x, c.y + c.h / 2]], fail: (k ? downB : downA)(tb + DUR) };
        };
        C.pill(ctx, 0, 0, SC[i].pill, SC[i].tone);
        const share = i === 1 && t >= FT ? '0 : 100' : '70 : 30';
        metric(ctx, w, narrow ? 'CF : FD' : 'CloudFront : Front Door', share, i === 2 && t >= FT);
        C.line(ctx, [[user.x + user.w, 128], [r53.x, 128]], '#e2e8f0', 1);
        cdn.forEach((c, k) => C.line(ctx, [[r53.x + r53.w, ry[k]], [c.x, c.y + c.h / 2]], '#e2e8f0', 1));
        C.box(ctx, r53.x, r53.y, r53.w, r53.h, { fill: U.plot, r: 10 });
        C.text(ctx, 'Route 53', r53.x + 10, r53.y + 16, { size: 11, weight: 600, color: U.text });
        if (!narrow) C.text(ctx, 'cdn.example.com, TTL 60초', r53.x + r53.w - 10, r53.y + 16, { size: 10, align: 'right' });
        node(ctx, user, 'ok', 'box');
        cdn.forEach((c, k) => node(ctx, c, (k ? downB : downA)(t) ? 'down' : 'ok', 'box'));
        flow(ctx, t, GAP, DUR, route);
        node(ctx, user, 'ok', 'text');
        cdn.forEach((c, k) => node(ctx, c, (k ? downB : downA)(t) ? 'down' : 'ok', 'text'));
        [['CloudFront', '70', downA(t)], ['Front Door', '30', downB(t)]].forEach(([name, wt, bad], k) => {
          const y = ry[k], x = r53.x + 10, rw = r53.w - 20;
          ctx.globalAlpha = 0.92;
          C.box(ctx, x, y - 15, rw, 30, { fill: '#fff', r: 6 });
          ctx.globalAlpha = 1;
          dot(ctx, x + 11, y, bad ? U.red : '#22c55e', 3.5);
          C.text(ctx, narrow ? (k ? 'FD' : 'CF') : name, x + 21, y + 0.5, { size: 10, weight: 600, color: U.text, base: 'middle' });
          C.text(ctx, `가중치 ${wt}`, x + rw - 8, y + 0.5, { size: 10, align: 'right', base: 'middle' });
        });
        if (SC[i].stamp) C.stamp(ctx, w / 2, 230, SC[i].stamp[0], SC[i].stamp[1], (run - SEC) / 0.4);
        say(`${SC[i].pill}. ${SC[i].note}`);
      },
    });
  }

  // Timeline lanes, as in the CPU post: blocks are work, double arrows are waits. demo turns scenes into modes.
  {
    const FILL = { try: '#f87171', ok: '#16a34a', sec: U.purple, write: U.blue, repl: U.purple, back: U.red, pri: '#60a5fa', mute: '#94a3b8' };
    const ARC = { wait: '#94a3b8', down: U.red };
    const LH = 46;
    const dbl = (ctx, x0, x1, y, color) => {
      if (x1 - x0 < 6) return;
      C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
      [[x0, 1], [x1, -1]].forEach(([x, d]) => {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
      });
    };
    const tl = (id, scenes, { SEC = 7, HOLD = 1.8, demo } = {}) => {
      const n = scenes.length, maxL = Math.max(...scenes.map((s) => s.lanes.length));
      fig(id, {
        height: 44 + maxL * LH + 30, still: (n - 1) * (SEC + HOLD) + SEC,
        scenes: n > 1 && !demo ? hwa.loopScenes(SEC, HOLD, n) : undefined,
        notes: scenes.map((s) => s.say), demo,
        frame: (ctx, w, h, time, say, ui) => {
          const auto = hwa.loop(time, SEC, HOLD, n), i = demo ? ui.mode : auto.i, s = scenes[i];
          const run = demo ? (ui.runAt === null ? -1 : time - ui.runAt) : (time % ((SEC + HOLD) * n)) - auto.i * (SEC + HOLD);
          const k = clamp(run / SEC), t = k * s.span;
          C.pill(ctx, 0, 0, s.pill, s.tone);
          const x0 = Math.min(76, w * 0.2), x1 = w - 8, top = 40, base = top + s.lanes.length * LH + 4;
          const X = (v) => x0 + (clamp(v, 0, s.span) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
          s.lanes.forEach((name, j) => C.text(ctx, name, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
          C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
          C.text(ctx, '시간', x1, base - 6, { size: 9, align: 'right' });
          (s.ticks || []).forEach(([v, label]) => {
            if (t < v) return;
            C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
            C.text(ctx, label, X(v), base + 14, { size: 9, align: 'center' });
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
            ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 16, Math.min(7, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
            if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 16) / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
          });
          if (s.event && t >= s.event[0]) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
          if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
          if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, ly(s.stampLane) + LH / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
          if (demo && run < 0) C.text(ctx, `${demo.run} 버튼을 눌러 보자`, (x0 + x1) / 2, top + (base - top) / 2, { size: 12, align: 'center', base: 'middle' });
          say(`${s.pill}. ${s.say}`);
        },
      });
    };

    // Data: CloudFront origin failover docs, default 3 attempts x 10 s; 1-3 attempts and 1-10 s are allowed.
    const ot = [[10, '10초'], [20, '20초'], [30, '30초']], ol = ['요청', '1차 오리진', '2차 오리진'];
    tl('origin', [
      { pill: '기본값 10초 × 3회', tone: 'bad', span: 36, lanes: ol, ticks: ot, segs: [[1, 0, 9.6, 'try', '시도 1'], [1, 10, 19.6, 'try', '시도 2'], [1, 20, 29.6, 'try', '시도 3'], [2, 30, 32, 'sec', ''], [0, 32, 34, 'ok', '']], arcs: [[0, 0, 32, 'wait', '응답 대기']], event: [0, '1차 장애'], stamp: ['30초 기다린 뒤 넘어감', 'bad'], stampLane: 2, say: '기본값이면 1차 오리진에 10초씩 세 번 연결을 시도한 뒤에야 2차로 넘어간다. 그동안 요청은 기다린다.' },
      { pill: '줄인 값 2초 × 1회', tone: 'ok', span: 36, lanes: ol, ticks: ot, segs: [[1, 0, 2, 'try', ''], [2, 2, 4, 'sec', ''], [0, 4, 6, 'ok', '']], arcs: [[0, 0, 4, 'wait', '']], event: [0, '1차 장애'], stamp: ['2초 만에 넘어감', 'ok'], stampLane: 2, say: '연결 제한 2초, 시도 1회로 줄이면 2초 만에 2차 오리진으로 넘어간다. 1차가 잠깐 느릴 때도 넘어가는 대가가 있다.' },
    ], { demo: { modes: ['기본값', '줄인 값'], run: '1차 오리진 끊기' } });

    // Data: MongoDB elections typically under 12 s with defaults; times here are rounded for shape.
    const rl = ['클라이언트', 'rs0', 'rs1'], rt = [[10, '10초'], [20, '20초']];
    tl('rollback', [
      { pill: 'w: 1', tone: 'bad', span: 24, lanes: rl, ticks: rt, segs: [[1, 0.4, 2.4, 'write', 'X'], [0, 2.4, 3.6, 'ok', '성공'], [2, 16, 24, 'pri', 'Primary'], [1, 19, 21.4, 'back', '롤백'], [1, 21.4, 24, 'mute', '']], arcs: [[1, 4, 19, 'down', 'rs0 멈춤'], [2, 4, 16, 'wait', '선거']], event: [4, 'rs0 장애'], stamp: ['성공한 쓰기 X 사라짐', 'bad'], stampLane: 0, say: 'Primary rs0만 X를 받고 바로 성공을 돌려준 뒤 멈췄다. X가 없는 rs1이 Primary가 되고, 돌아온 rs0은 X를 롤백한다.' },
      { pill: 'w: majority', tone: 'ok', span: 24, lanes: rl, ticks: rt, segs: [[1, 0.4, 2.4, 'write', 'X'], [2, 2.4, 3.2, 'repl', ''], [0, 3.2, 4, 'ok', ''], [2, 16, 24, 'pri', 'Primary, X 있음'], [1, 19, 24, 'mute', 'Secondary']], arcs: [[1, 4, 19, 'down', 'rs0 멈춤'], [2, 4, 16, 'wait', '선거']], event: [4, 'rs0 장애'], stamp: ['쓰기 X 남음', 'ok'], stampLane: 0, say: 'X가 rs1까지 복제된 뒤에 성공을 돌려준다. rs0이 멈춰도 X를 가진 rs1이 Primary가 되어 X가 남는다.' },
    ], { SEC: 7.5, demo: { modes: ['w: 1', 'w: majority'], run: '쓰고 Primary 끄기' } });
  }

  // nginx in front of two containers on one host: update standby, reload to it, update active, switch back.
  {
    const SEC = 6, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3), GAP = 0.34, DUR = 1.7;
    const SC = [
      { pill: 'standby 갱신', tone: 'info', note: 'standby를 v2로 올리고 nginx 안에서 curl로 200이 오는지 확인한다. 요청은 계속 active로 간다.' },
      { pill: 'nginx reload', tone: 'ok', stamp: ['끊김 없이 standby로', 'ok'], note: 'proxy_pass를 standby로 바꾸고 reload한다. 새 요청은 standby로, 처리 중이던 요청은 끝까지 active에서 끝난다.' },
      { pill: 'active 갱신 후 복귀', tone: 'ok', stamp: ['둘 다 v2, active로 복귀', 'ok'], note: 'active도 v2로 올리고 다시 active로 돌린 뒤 standby를 멈춘다.' },
    ];
    // Per scene: [standby update start, end], health check time, switch time, target before and after, active update, standby stop.
    const P = [
      { sb: [0.8, 2.4], hc: [2.8, 3.8, 1], sw: null, from: 0 },
      { sw: 2.0, from: 0, to: 1 },
      { ac: [0.6, 2.0], hc: [2.3, 3.2, 0], sw: 3.5, from: 1, to: 0, stop: 4.6 },
    ];
    fig('app', {
      height: 270, still: S.at(1) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = sceneOf(time, SEC, HOLD, 3), p = P[i], narrow = w < 420;
        const user = { x: 0, y: 118, w: 48, h: 44, t: '사용자' }, hx = 60, cw = clamp(w * 0.3, 92, 170);
        const ng = { x: hx + 12, y: 112, w: clamp(w * 0.24, 70, 130), h: 56 };
        const ct = [0, 1].map((k) => ({ x: w - cw - 12, y: 66 + k * 92, w: cw, h: 56 }));
        const target = (tt) => (p.sw !== null && p.sw !== undefined && tt >= p.sw ? p.to : p.from);
        const ver = (k) => {
          if (k === 1) return i === 0 ? (t < p.sb[0] ? 'v1' : t < p.sb[1] ? '갱신 중' : 'v2') : i === 2 && t >= p.stop ? '중지' : 'v2';
          return i < 2 ? 'v1' : t < p.ac[0] ? 'v1' : t < p.ac[1] ? '갱신 중' : 'v2';
        };
        const st = (k) => (ver(k) === '갱신 중' || ver(k) === '중지' ? 'idle' : 'ok');
        const cy = (b) => b.y + b.h / 2;
        C.pill(ctx, 0, 0, SC[i].pill, SC[i].tone);
        C.group(ctx, hx, 34, w - hx, 226, narrow ? '서버 한 대' : '서버 한 대 (Docker 브리지 네트워크)', 52);
        C.line(ctx, [[user.x + user.w, cy(user)], [ng.x, cy(ng)]], '#e2e8f0', 1);
        ct.forEach((c) => C.line(ctx, [[ng.x + ng.w, cy(ng)], [c.x, cy(c)]], '#e2e8f0', 1));
        const cards = () => ct.map((c, k) => ({ ...c, t: k ? 'standby' : 'active', s: ver(k), sc: ver(k) === 'v2' ? U.blue : undefined }));
        flow(ctx, t, GAP, DUR, (tb) => {
          const k = target(tb + DUR * 0.45), c = ct[k];
          return { pts: [[user.x + user.w / 2, cy(user)], [ng.x + ng.w / 2, cy(ng)], [c.x + c.w / 2, cy(c)]] };
        });
        node(ctx, user);
        node(ctx, { ...ng, t: 'nginx', s: `→ ${target(t) ? 'standby' : 'active'}`, sc: U.accent });
        cards().forEach((c, k) => node(ctx, c, st(k)));
        if (p.hc && t >= p.hc[0] && t < p.hc[1] + 0.6) {
          const c = ct[p.hc[2]], q = lerp([ng.x + ng.w, cy(ng)], [c.x, cy(c) + (p.hc[2] ? -14 : 14)], ease(t, p.hc[0], p.hc[1]));
          tag(ctx, t >= p.hc[1] ? '200' : 'curl', q[0], q[1], t >= p.hc[1] ? GREEN : GRAY);
        }
        if (p.sw && t >= p.sw - 0.2 && t < p.sw + 1.6) tag(ctx, 'nginx -s reload', ng.x + ng.w / 2, ng.y - 16, BLUE, ease(t, p.sw - 0.2, p.sw + 0.2));
        if (SC[i].stamp) C.stamp(ctx, (hx + w) / 2, 246, SC[i].stamp[0], SC[i].stamp[1], (run - SEC) / 0.4);
        say(`${SC[i].pill}. ${SC[i].note}`);
      },
    });
  }

  // keepalived pair in front of three kube-apiservers: VRRP adverts every second, VIP moves about 3 s after they stop.
  {
    const SEC = 7.5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2), FAIL = 1.5, GAP = 0.36, DUR = 1.8, AT = 0.4;
    // Data: keepalived.conf(5), master down timer = 3 x advert_int + skew; advert_int 1.
    const MOVE = FAIL + 3.2;
    const SC = [
      { pill: 'VRRP 광고 1초마다', tone: 'info', note: 'MASTER가 1초마다 VRRP 광고를 보내고, VIP로 온 요청을 살아 있는 apiserver로 나눈다.' },
      { pill: 'MASTER 장애', tone: 'bad', stamp: ['약 3초 뒤 VIP 이동', 'warn'], note: 'MASTER가 멈추면 BACKUP은 광고가 3초쯤 끊긴 뒤 VIP를 가져간다. kubectl이 쓰는 주소는 그대로다.' },
    ];
    fig('vip', {
      height: 272, still: S.at(1) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = sceneOf(time, SEC, HOLD, 2), narrow = w < 420, dead = i === 1 && t >= FAIL;
        const hw = clamp(w * 0.32, 100, 170), mw = clamp(w * 0.24, 70, 130);
        const cl = { x: 0, y: 118, w: 52, h: 44, t: 'kubectl' }, hx = clamp(w * 0.24, 66, 200);
        const hp = [0, 1].map((k) => ({ x: hx, y: 58 + k * 120, w: hw, h: 50 }));
        const ms = [0, 1, 2].map((k) => ({ x: w - mw, y: 44 + k * 66, w: mw, h: 48, t: `master${k + 1}`, s: 'apiserver' }));
        const owner = (tt) => (i === 1 && tt >= MOVE ? 1 : 0);
        const cy = (b) => b.y + b.h / 2;
        C.pill(ctx, 0, 0, SC[i].pill, SC[i].tone);
        C.line(ctx, [[cl.x + cl.w, cy(cl)], [hp[0].x, cy(hp[0])]], '#e2e8f0', 1);
        C.line(ctx, [[cl.x + cl.w, cy(cl)], [hp[1].x, cy(hp[1])]], '#e2e8f0', 1);
        hp.forEach((a) => ms.forEach((m) => C.line(ctx, [[a.x + a.w, cy(a)], [m.x, cy(m)]], '#f1f5f9', 1)));
        // VRRP link between the two haproxy nodes, with one advert per second while MASTER lives.
        const lx = hp[0].x + 22;
        C.line(ctx, [[lx, hp[0].y + hp[0].h], [lx, hp[1].y]], '#e2e8f0', 1);
        C.text(ctx, 'VRRP', lx + 6, (hp[0].y + hp[0].h + hp[1].y) / 2, { size: 9, weight: 600, color: PURPLE[1], base: 'middle' });
        const beat = t % 1;
        if (!dead && beat < 0.5) dot(ctx, lx, lerp([0, hp[0].y + hp[0].h], [0, hp[1].y], beat / 0.5)[1], U.purple, 3);
        flow(ctx, t, GAP, DUR, (tb, j) => {
          const td = tb + DUR * AT, o = owner(td), a = hp[o], m = ms[j % 3];
          const fail = i === 1 && o === 0 && tb + DUR * AT >= FAIL;
          const pts = [[cl.x + cl.w / 2, cy(cl)], fail ? [a.x - 5, cy(a)] : [a.x + a.w / 2, cy(a)]];
          if (!fail) pts.push([m.x + m.w / 2, cy(m)]);
          return { pts, fail };
        });
        node(ctx, cl);
        const role = (k) => (k === 0 && dead ? '멈춤' : owner(t) === k ? 'MASTER' : 'BACKUP');
        hp.forEach((a, k) => node(ctx, { ...a, t: `haproxy${k + 1}`, s: role(k) === '멈춤' ? '멈춤' : `${role(k)} ${k ? 100 : 101}`, sc: role(k) === 'MASTER' ? U.accent : undefined }, k === 0 && dead ? 'down' : 'ok'));
        ms.forEach((m) => node(ctx, m));
        // VIP chip rides on the owner's top edge and slides down when ownership moves.
        const vy = lerp([0, hp[0].y], [0, hp[1].y], i === 1 ? ease(t, MOVE, MOVE + 0.6) : 0)[1];
        tag(ctx, narrow ? 'VIP' : 'VIP 10.0.0.100', hp[0].x + hp[0].w - (narrow ? 22 : 46), vy, BLUE);
        if (dead && t < MOVE) {
          const gone = Math.min(3, Math.floor(t - FAIL) + 1);
          C.text(ctx, `광고 끊김 ${gone}초`, hp[1].x + hp[1].w / 2, hp[1].y + hp[1].h + 16, { size: 10, weight: 600, color: AMBER[1], align: 'center' });
        }
        if (SC[i].stamp) C.stamp(ctx, w / 2, 254, SC[i].stamp[0], SC[i].stamp[1], (run - SEC) / 0.4);
        say(`${SC[i].pill}. ${SC[i].note}`);
      },
    });
  }

  // Two-way replication between Seoul and Tokyo buckets: a replica is never sent back.
  {
    const SEC = 6.5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2);
    const SC = [
      { pill: '서울에 올림', tone: 'info', stamp: ['복제본은 되돌아오지 않음', 'ok'], note: '서울에 올린 app.js가 도쿄로 복제된다. 복제로 생긴 객체는 다시 복제하지 않아 순환이 없다.' },
      { pill: '도쿄에 올림', tone: 'info', stamp: ['어느 쪽에 써도 양쪽이 같음', 'ok'], note: '도쿄에 올린 logo.png는 반대 규칙으로 서울에 복제된다. 어느 쪽에 써도 양쪽 내용이 같아진다.' },
    ];
    fig('replication', {
      height: 268, still: S.at(0) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = sceneOf(time, SEC, HOLD, 2), narrow = w < 420, bw = clamp(w * 0.34, 104, 220);
        const bk = [{ x: 0, y: 92, w: bw, h: 120, t: '서울 버킷' }, { x: w - bw, y: 92, w: bw, h: 120, t: '도쿄 버킷' }];
        const ci = { x: w / 2 - 44, y: 32, w: 88, h: 36, t: 'CI 배포' };
        const ay = [132, 178], ax0 = bw + 8, ax1 = w - bw - 8;
        C.pill(ctx, 0, 0, SC[i].pill, SC[i].tone);
        bk.forEach((b) => { C.box(ctx, b.x, b.y, b.w, b.h, { fill: U.plot, r: 10 }); C.text(ctx, b.t, b.x + 10, b.y + 17, { size: 11, weight: 600, color: U.text }); });
        node(ctx, ci);
        C.arrow(ctx, [[ax0, ay[0]], [ax1, ay[0]]], 1, i === 0 ? U.purple : '#cbd5e1', { width: 1.2 });
        C.arrow(ctx, [[ax1, ay[1]], [ax0, ay[1]]], 1, i === 1 ? U.purple : '#cbd5e1', { width: 1.2 });
        C.text(ctx, narrow ? '서울→도쿄' : '규칙 서울→도쿄', w / 2, ay[0] - 7, { size: 9, align: 'center' });
        C.text(ctx, narrow ? '도쿄→서울' : '규칙 도쿄→서울', w / 2, ay[1] + 15, { size: 9, align: 'center' });
        // Objects: name, home bucket, scene it was uploaded in. Orig is blue, replica purple.
        const OBJ = [['app.js', 0, 0], ['logo.png', 1, 1]];
        const up = [0.5, 1.5], rep = [2.1, 3.6];
        OBJ.forEach(([name, home, sc], k) => {
          if (sc > i) return;
          const now = sc === i, slotY = bk[0].y + 42 + k * 30, mid = (b) => b.x + b.w / 2;
          const upK = now ? ease(t, up[0], up[1]) : 1, repK = now ? ease(t, rep[0], rep[1]) : 1;
          if (upK < 1 && upK > 0) {
            const q = lerp([w / 2, ci.y + ci.h], [mid(bk[home]), slotY], upK);
            tag(ctx, name, q[0], q[1], BLUE);
          } else if (upK >= 1) tag(ctx, name, mid(bk[home]), slotY, BLUE);
          const other = 1 - home;
          if (repK > 0 && repK < 1) {
            const q = lerp([home ? ax1 : ax0, ay[home]], [home ? ax0 : ax1, ay[home]], repK);
            tag(ctx, name, q[0], q[1], PURPLE);
          } else if (repK >= 1) tag(ctx, narrow ? name : `${name} 복제본`, mid(bk[other]), slotY, PURPLE);
        });
        // The replica does not travel back: a dashed stub with a cross on the reverse arrow.
        if (t >= 4.2) {
          const a = ease(t, 4.2, 4.8), y = ay[1 - i], xs = i ? ax0 + 10 : ax1 - 10, xe = (ax0 + ax1) / 2 + (i ? -10 : 10);
          ctx.globalAlpha = a;
          C.dashed(ctx, xs, y, xe, y, U.red);
          xmark(ctx, xe, y, 4);
          if (ax1 - ax0 > 120) C.text(ctx, '복제본은 안 보냄', (xs + xe) / 2, y + (i ? 15 : -8), { size: 9, weight: 600, color: U.red, align: 'center' });
          ctx.globalAlpha = 1;
        }
        C.text(ctx, '복제는 보통 몇 초, RTC를 켜면 99.9%를 15분 안에', w / 2, 226, { size: 10, align: 'center' });
        C.stamp(ctx, w / 2, 250, SC[i].stamp[0], SC[i].stamp[1], (run - SEC) / 0.4);
        say(`${SC[i].pill}. ${SC[i].note}`);
      },
    });
  }

  // One Multi-Region Access Point name in front of two buckets: closest active bucket, then Seoul set passive.
  {
    const SEC = 6.5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2), SET = 1.4, APPLY = 3.2, GAP = 0.34, DUR = 1.8;
    const SC = [
      { pill: '둘 다 활성', tone: 'info', note: '앱은 MRAP 이름 하나만 안다. 요청은 활성 상태인 가장 가까운 버킷으로 간다.' },
      { pill: '서울을 비활성으로', tone: 'warn', stamp: ['앱 설정은 그대로', 'ok'], note: '서울을 비활성으로 돌리면 약 2분 뒤부터 모든 요청이 도쿄로 간다. 앱이 쓰는 이름은 바뀌지 않는다.' },
    ];
    fig('mrap', {
      height: 236, still: S.at(1) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = sceneOf(time, SEC, HOLD, 2), narrow = w < 420, bw = clamp(w * 0.3, 92, 170);
        const apps = [0, 1].map((k) => ({ x: 0, y: 50 + k * 110, w: narrow ? 56 : 76, h: 46, t: k ? '도쿄 앱' : '서울 앱' }));
        const mx = apps[0].w + (narrow ? 14 : 40), mw = w - bw - mx - (narrow ? 14 : 40);
        const mr = { x: mx, y: 60, w: mw, h: 136 };
        const bk = [0, 1].map((k) => ({ x: w - bw, y: 50 + k * 110, w: bw, h: 46 }));
        const passive = (tt) => i === 1 && tt >= APPLY;
        const cy = (b) => b.y + b.h / 2;
        C.pill(ctx, 0, 0, SC[i].pill, SC[i].tone);
        apps.forEach((a) => C.line(ctx, [[a.x + a.w, cy(a)], [mr.x, cy(a)]], '#e2e8f0', 1));
        bk.forEach((b) => C.line(ctx, [[mr.x + mr.w, cy(b)], [b.x, cy(b)]], '#e2e8f0', 1));
        C.box(ctx, mr.x, mr.y, mr.w, mr.h, { fill: U.plot, r: 10 });
        flow(ctx, t, GAP, DUR, (tb, j) => {
          const from = j % 2, to = passive(tb + DUR * 0.5) ? 1 : from, a = apps[from], b = bk[to];
          return { pts: [[a.x + a.w / 2, cy(a)], [mr.x, cy(a)], [mr.x + mr.w, cy(b)], [b.x + b.w / 2, cy(b)]] };
        });
        apps.forEach((a) => node(ctx, a));
        bk.forEach((b, k) => {
          const off = k === 0 && passive(t);
          node(ctx, { ...b, t: k ? '도쿄 버킷' : '서울 버킷', s: off ? '비활성' : '활성', sc: off ? U.muted : GREEN[1] }, off ? 'idle' : 'ok');
        });
        C.text(ctx, 'MRAP', mr.x + mr.w / 2, mr.y + 20, { size: 11, weight: 600, color: U.text, align: 'center' });
        C.text(ctx, narrow ? '이름 하나' : '전역 엔드포인트 하나', mr.x + mr.w / 2, mr.y + mr.h - 12, { size: 10, align: 'center' });
        if (i === 1 && t >= SET && t < APPLY) {
          tag(ctx, '라우팅 상태 변경', bk[0].x + bk[0].w / 2, bk[0].y - 12, AMBER, ease(t, SET, SET + 0.3));
          C.text(ctx, '반영까지 약 2분', bk[0].x + bk[0].w / 2, bk[0].y + bk[0].h + 14, { size: 10, weight: 600, color: AMBER[1], align: 'center' });
        }
        if (SC[i].stamp) C.stamp(ctx, w / 2, 218, SC[i].stamp[0], SC[i].stamp[1], (run - SEC) / 0.4);
        say(`${SC[i].pill}. ${SC[i].note}`);
      },
    });
  }

  // Demo: a three-member replica set loses one member or two. Votes from a majority elect a new Primary.
  {
    const F = 0.5, D1 = 3.5, E1 = 4.9, SEC = 6.2, GAP = 0.42, DUR = 1.4;
    const notes = [
      '하나가 멈추면 남은 둘이 10초 무응답을 확인하고 투표한다. 2/3 과반이라 새 Primary가 나온다.',
      '둘이 멈추면 남은 하나는 1/3 표뿐이라 Primary가 될 수 없다. 쓰기가 멈춘다.',
    ];
    fig('quorum', {
      height: 268, still: 0, notes,
      demo: { modes: ['1대 장애', '2대 장애'], run: '장애 내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const two = ui.mode === 1, r = ui.runAt === null ? -1 : time - ui.runAt, narrow = w < 420;
        const cl = { x: 0, y: 118, w: 50, h: 44, t: '앱' }, nw = clamp(w * 0.3, 96, 160), nx = clamp(w * 0.3, 88, 220);
        const ns = [0, 1, 2].map((k) => ({ x: nx, y: 38 + k * 72, w: nw, h: 50 }));
        const down = (k) => r >= F && (k === 0 || (two && k === 1));
        const cand = two ? 2 : 1, elected = !two && r >= E1;
        const primary = elected ? 1 : r >= F ? -1 : 0;
        const cy = (b) => b.y + b.h / 2, bx = nx + nw + 14, ix = bx + 16;
        C.pill(ctx, 0, 0, r < 0 ? '정상, Primary rs0' : two ? '2대 장애' : '1대 장애', r < 0 ? 'ok' : r < E1 ? 'warn' : two ? 'bad' : 'ok');
        ns.forEach((b) => C.line(ctx, [[cl.x + cl.w, cy(cl)], [b.x, cy(b)]], '#f1f5f9', 1));
        // Heartbeat rail on the right of the members: a pulse every second between live members.
        C.line(ctx, [[bx, cy(ns[0])], [bx, cy(ns[2])]], '#e2e8f0', 1);
        ns.forEach((b, k) => { C.line(ctx, [[b.x + b.w, cy(b)], [bx, cy(b)]], '#e2e8f0', 1); if (!down(k)) dot(ctx, bx, cy(b), '#cbd5e1', 2.5); });
        C.text(ctx, '하트비트', bx, ns[0].y - 8, { size: 9, align: 'center' });
        const ph = (time * 1.2) % 1;
        if (ph < 0.6) {
          const live = [0, 1, 2].filter((k) => !down(k));
          if (live.length > 1) dot(ctx, bx, lerp([0, cy(ns[live[0]])], [0, cy(ns[live[live.length - 1]])], ph / 0.6)[1], U.purple, 3);
        }
        ns.forEach((b, k) => node(ctx, b, down(k) ? 'down' : k === primary ? 'on' : 'ok', 'box'));
        flow(ctx, r < 0 ? time : r, GAP, DUR, (tb) => {
          const p = r < 0 ? 0 : tb + DUR >= F ? (!two && tb + DUR >= E1 ? 1 : -1) : 0, k = p < 0 ? (two && tb + DUR >= E1 ? 2 : 0) : p, b = ns[k];
          return { pts: [[cl.x + cl.w / 2, cy(cl)], [b.x + 8, cy(b)]], fail: p < 0 };
        });
        node(ctx, cl, 'ok', 'all');
        ns.forEach((b, k) => node(ctx, { ...b, t: `rs${k}`, s: down(k) ? '멈춤' : k === primary ? 'Primary' : 'Secondary', sc: k === primary ? U.accent : undefined }, down(k) ? 'down' : k === primary ? 'on' : 'ok', 'text'));
        // Info column: silence timer, then votes.
        const live = [0, 1, 2].filter((k) => !down(k));
        if (r >= F && r < D1 + 0.4) {
          const k = clamp((r - F) / (D1 - F)), bw2 = Math.max(40, w - ix - 4);
          live.forEach((n) => {
            const y = cy(ns[n]);
            ctx.fillStyle = U.cell; ctx.fillRect(ix, y - 3, bw2, 6);
            ctx.fillStyle = '#f59e0b'; ctx.fillRect(ix, y - 3, bw2 * k, 6);
            C.text(ctx, `무응답 ${Math.round(k * 10)}초`, ix, y - 10, { size: 9, weight: 600, color: AMBER[1] });
          });
        }
        if (r >= D1) {
          const v = live.length, need = 2, a = ease(r, D1, D1 + 0.4);
          ctx.globalAlpha = a;
          C.text(ctx, `표 ${v}/3`, ix, cy(ns[cand]) + 1, { size: 13, weight: 700, color: v >= need ? GREEN[1] : U.red, base: 'middle' });
          C.text(ctx, v >= need ? '과반' : '과반 아님', ix, cy(ns[cand]) + 17, { size: 9, weight: 600, color: v >= need ? GREEN[1] : U.red });
          ctx.globalAlpha = 1;
          if (!two && r < E1 + 0.5) {
            const q = lerp([bx, cy(ns[2])], [bx, cy(ns[1])], ease(r, D1 + 0.2, E1 - 0.2));
            tag(ctx, '투표', q[0], q[1], GREEN, 1, 9);
          }
        }
        if (r >= SEC) C.stamp(ctx, nx + nw / 2, 254 - 4, two ? '과반 없음, 쓰기 멈춤' : '2/3 과반, 새 Primary rs1', two ? 'bad' : 'ok', (r - SEC) / 0.4);
        if (r < 0) C.text(ctx, '장애 내기 버튼을 눌러 보자', nx + nw / 2, 254 - 6, { size: 12, align: 'center', base: 'middle' });
        say(r < 0 ? 'rs0이 Primary인 세 대 레플리카셋.' : notes[ui.mode]);
      },
    });
  }

  // Failover time per layer after the same failure: detection, then switching. Linear axis, 150 s.
  {
    const SEC = 7.5, HOLD = 2.4, SPAN = 150;
    // Data: keepalived 3 x advert_int; MongoDB median election under 12 s; CloudFront 3 x 10 s; MRAP about 2 min; Route 53 30 s x 3 + TTL 60.
    const ROWS = [
      ['VIP', 'keepalived VIP', 3, 0, '약 3초'],
      ['MongoDB', 'MongoDB 선거', 10, 2, '약 12초'],
      ['CDN', 'CDN 오리진 그룹', 30, 0, '30초'],
      ['MRAP', 'S3 MRAP 전환', 0, 120, '약 2분'],
      ['DNS', 'Route 53 가중치', 90, 60, '약 2분 30초'],
    ];
    fig('time', {
      height: 258, still: SEC + 0.5,
      notes: ['같은 장애라도 계층마다 감지와 전환에 걸리는 시간이 50배까지 차이 난다. 설정값과 문서 기준의 대략값이다.'],
      frame: (ctx, w, h, time, say) => {
        const { t: tt, k } = hwa.loop(time, SEC, HOLD, 1), t = k * SPAN, narrow = w < 460, done = tt >= SEC;
        const x0 = narrow ? 58 : 118, x1 = w - 6, top = 44, RH = 36, X = (v) => x0 + (v / SPAN) * (x1 - x0);
        C.pill(ctx, 0, 0, `장애 뒤 ${Math.round(t)}초`, done ? 'bad' : 'warn');
        C.legend(ctx, w - 92, 12, [['감지', '#f59e0b'], ['전환', U.purple]]);
        [0, 30, 60, 90, 120, 150].forEach((v) => {
          C.dashed(ctx, X(v), top - 4, X(v), top + ROWS.length * RH, '#eef2f7');
          if (!narrow || v % 60 === 0) C.text(ctx, v ? `${v}초` : '0', X(v), top + ROWS.length * RH + 14, { size: 9, align: v === 150 ? 'right' : 'center' });
        });
        ROWS.forEach(([short, long, det, sw, label], j) => {
          const y = top + j * RH + 8, bh = RH - 16, end = det + sw;
          C.text(ctx, narrow ? short : long, 0, y + bh / 2, { size: 10, weight: 600, color: U.text, base: 'middle' });
          ctx.fillStyle = U.cell;
          ctx.fillRect(X(0), y, X(SPAN) - X(0), bh);
          const dw = X(Math.min(t, det)) - X(0), sx = X(det), swd = X(Math.min(t, end)) - sx;
          ctx.fillStyle = '#f59e0b';
          if (det && dw > 0) ctx.fillRect(X(0), y, Math.max(2, dw), bh);
          ctx.fillStyle = U.purple;
          if (sw && t > det && swd > 0) ctx.fillRect(sx, y, Math.max(2, swd), bh);
          if (t >= end) {
            const lw = tw(ctx, label, 10, 700), inside = X(end) - X(0) > lw + 12;
            C.text(ctx, label, inside ? X(end) - 6 : X(end) + 6, y + bh / 2 + 0.5, { size: 10, weight: 700, color: inside ? '#fff' : U.text, align: inside ? 'right' : 'left', base: 'middle' });
          }
        });
        if (!done) C.dashed(ctx, X(t), top - 4, X(t), top + ROWS.length * RH, U.now);
        else C.stamp(ctx, (x0 + x1) / 2 + 20, top + RH * 1.5, '3초에서 2분 30초까지', 'warn', (tt - SEC) / 0.4);
        say(`장애 뒤 ${Math.round(t)}초. ` + ROWS.map((r) => `${r[1]} ${r[4]}`).join(', '));
      },
    });
  }

  // Split brain: two keepalived nodes lose the VRRP link and both hold the VIP; three voters keep one Primary.
  {
    const SEC = 7, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2), CUT = 1.4;
    const SC = [
      { pill: '두 대, 투표 없음', tone: 'bad', stamp: ['VIP 두 곳, 스플릿 브레인', 'bad'], note: 'VRRP가 끊기면 BACKUP은 MASTER가 죽은 줄 알고 VIP를 잡는다. 둘 다 살아 있어 VIP가 두 곳에 생긴다.' },
      { pill: '세 대, 과반 투표', tone: 'ok', stamp: ['Primary는 한 곳만', 'ok'], note: '네트워크가 1 : 2로 갈리면 과반을 못 보는 rs0은 스스로 내려오고, 과반 쪽에서만 새 Primary가 나온다.' },
    ];
    fig('split', {
      height: 238, still: S.at(0) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = sceneOf(time, SEC, HOLD, 2), nw = clamp(w * 0.3, 96, 160), cut = t >= CUT;
        C.pill(ctx, 0, 0, SC[i].pill, SC[i].tone);
        if (i === 0) {
          const a = { x: 0, y: 96, w: nw, h: 52 }, b = { x: w - nw, y: 96, w: nw, h: 52 }, y = 122, mid = w / 2, TAKE = CUT + 3.2;
          C.line(ctx, [[a.x + a.w, y], [b.x, y]], cut ? RED[2] : '#cbd5e1', 1.2);
          if (!cut && t % 1 < 0.6) dot(ctx, lerp([a.x + a.w, 0], [b.x, 0], (t % 1) / 0.6)[0], y, U.purple, 3);
          if (cut) { xmark(ctx, mid, y, 6); C.text(ctx, 'VRRP 막힘', mid, y + 22, { size: 10, weight: 600, color: U.red, align: 'center' }); }
          const both = t >= TAKE;
          node(ctx, { ...a, t: '노드 A', s: 'MASTER', sc: both ? U.red : U.accent }, both ? 'warn' : 'on');
          node(ctx, { ...b, t: '노드 B', s: both ? 'MASTER' : 'BACKUP', sc: both ? U.red : undefined }, both ? 'warn' : 'ok');
          tag(ctx, 'VIP', a.x + a.w / 2, a.y - 14, both ? RED : BLUE);
          if (both) tag(ctx, 'VIP', b.x + b.w / 2, b.y - 14, RED, ease(t, TAKE, TAKE + 0.3));
          else if (cut) C.text(ctx, `광고 끊김 ${Math.min(3, Math.floor(t - CUT) + 1)}초`, b.x + b.w / 2, b.y + b.h + 16, { size: 10, weight: 600, color: AMBER[1], align: 'center' });
        } else {
          const r0 = { x: 0, y: 108, w: nw, h: 52 }, rs = [0, 1].map((k) => ({ x: w - nw, y: 60 + k * 96, w: nw, h: 52 }));
          const mid = (r0.x + r0.w + rs[0].x) / 2, STEP = CUT + 2.2, ELECT = CUT + 3.4;
          const c0 = [r0.x + r0.w, r0.y + 26];
          rs.forEach((b) => C.line(ctx, [c0, [b.x, b.y + 26]], cut ? '#f1f5f9' : '#cbd5e1', 1));
          C.line(ctx, [[rs[0].x + 20, rs[0].y + 52], [rs[1].x + 20, rs[1].y]], '#cbd5e1', 1);
          if (cut) {
            C.dashed(ctx, mid, 40, mid, 206, U.red);
            C.text(ctx, '네트워크 분리', mid, 222, { size: 10, weight: 600, color: U.red, align: 'center' });
          }
          const p0 = t < STEP, p1 = t >= ELECT;
          node(ctx, { ...r0, t: 'rs0', s: p0 ? 'Primary' : 'Secondary', sc: p0 ? U.accent : undefined }, p0 ? 'on' : 'ok');
          rs.forEach((b, k) => node(ctx, { ...b, t: `rs${k + 1}`, s: k === 0 && p1 ? 'Primary' : 'Secondary', sc: k === 0 && p1 ? U.accent : undefined }, k === 0 && p1 ? 'on' : 'ok'));
          if (cut && t >= STEP - 0.6) C.text(ctx, '1/3, 내려옴', r0.x + r0.w / 2, r0.y + r0.h + 16, { size: 10, weight: 600, color: AMBER[1], align: 'center' });
          if (t >= ELECT - 0.6) C.text(ctx, '2/3, 선출', rs[1].x + rs[1].w / 2, rs[1].y + rs[1].h + 16, { size: 10, weight: 600, color: GREEN[1], align: 'center' });
        }
        C.stamp(ctx, w / 2, 38, SC[i].stamp[0], SC[i].stamp[1], (run - SEC) / 0.4);
        say(`${SC[i].pill}. ${SC[i].note}`);
      },
    });
  }
})();
