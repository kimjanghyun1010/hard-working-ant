// Slack bot post: delivery paths, signatures, the 3 second ack, retries and dedup, tokens.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const COL = {
    blue: ['#eff6ff', '#1d4ed8', '#93c5fd'], ok: ['#dcfce7', '#15803d', '#86efac'], bad: ['#fee2e2', '#dc2626', '#fca5a5'],
    warn: ['#fef3c7', '#b45309', '#fcd34d'], purple: ['#ede9fe', '#6d28d9', '#c4b5fd'], mute: [U.cell, U.muted, '#e2e8f0'],
  };
  const LINE = { blue: U.blue, ok: '#16a34a', bad: U.red, warn: '#f59e0b', purple: U.purple, mute: '#cbd5e1' };
  const tag = (ctx, s, cx, cy, col, a = 1) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, 10, 600) + 14;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(cx - cw / 2, cy - 9, cw, 18, 5);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, cx, cy + 0.5, { size: 10, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  // Orthogonal path between two cards: straight through their shared band, else an elbow. off shifts it sideways.
  const route = (a, b, off = 0) => {
    const ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2];
    if (a.x + a.w <= b.x || b.x + b.w <= a.x) {
      const r = bc[0] > ac[0], x0 = r ? a.x + a.w : a.x, x1 = r ? b.x : b.x + b.w;
      const lo = Math.max(a.y, b.y), hi = Math.min(a.y + a.h, b.y + b.h);
      if (hi - lo > 16) return [[x0, (lo + hi) / 2 + off], [x1, (lo + hi) / 2 + off]];
      const mx = (x0 + x1) / 2;
      return [[x0, ac[1] + off], [mx + off, ac[1] + off], [mx + off, bc[1] + off], [x1, bc[1] + off]];
    }
    const d = bc[1] > ac[1], y0 = d ? a.y + a.h : a.y, y1 = d ? b.y : b.y + b.h;
    const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w);
    return [[(lo + hi) / 2 + off, y0], [(lo + hi) / 2 + off, y1]];
  };

  // Structure figure: cards from layout(w, i); each step carries a chip from one card to another along an arrow.
  const flow = (name, { height, layout, scenes, under, over, STEP = 1.5, HOLD = 2.2 }) => document.querySelectorAll(`[data-figure="${name}"]`).forEach((root) => {
    const lens = scenes.map((s) => s.steps.length * STEP + 0.4), S = seq(lens, HOLD), last = scenes.length - 1;
    hwa.scene(root, {
      height, scenes: scenes.length > 1 ? S : undefined, notes: scenes.map((s) => s.note), still: S.at(last) + lens[last] + 0.6,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), sc = scenes[i], L = layout(w, i), n = sc.steps.length;
        const cur = Math.min(n - 1, Math.floor(t / STEP)), lt = t - cur * STEP, f = ease(lt, 0.1, STEP * 0.7), done = t >= n * STEP;
        const step = sc.steps[cur], lit = new Set([step[0]]), path = (s) => route(L.b[s[0]], L.b[s[1]], s[5] || 0);
        if (f > 0.95) lit.add(step[1]);
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        L.groups.forEach(([x, y, gw, gh, label]) => C.group(ctx, x, y, gw, gh, label));
        if (under) under(ctx, L, i, t, w);
        Object.entries(L.b).forEach(([k, b]) => C.card(ctx, b, { lit: lit.has(k), ...(b.o || {}) }));
        sc.steps.forEach((s, j) => {
          if (j > cur) return;
          C.arrow(ctx, path(s), j === cur ? f : 1, j === cur ? LINE[s[3]] : '#cbd5e1', { width: j === cur ? 2 : 1.5 });
        });
        if (over) over(ctx, L, i, t, w, cur, done);
        if (!done) tag(ctx, step[2], ...C.pathAt(path(step), f).pop(), COL[step[3]], 1 - ease(lt, STEP * 0.8, STEP * 0.98));
        C.text(ctx, `${cur + 1}. ${step[4]}`, 0, h - 8, { size: 12, weight: 600, color: U.text });
        if (sc.stamp) C.stamp(ctx, L.stampX || w / 2, L.stampY || h / 2, sc.stamp[0], sc.stamp[1], (run - n * STEP) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    });
  });

  // Events API: Slack posts to a public HTTPS address; the URL check echoes challenge, events get a 200.
  flow('slack-bot-http', {
    height: 252,
    layout: (w) => {
      const nar = w < 480, sw = nar ? 92 : 170, g = nar ? 44 : 120, bx = sw + g, bw = w - bx;
      return {
        sw, g, stampX: Math.max(sw / 2, 62), stampY: 168,
        groups: [[0, 34, sw, 182, '슬랙'], [bx, 34, bw, 182, '봇 서버']],
        b: {
          ev: { x: 8, y: 62, w: sw - 16, h: 54, t: 'Events API', size: nar ? 10 : 12 },
          px: { x: bx + 8, y: 62, w: bw - 16, h: 54, t: '프록시', s: nar ? 'HTTPS 443' : 'HTTPS 443, 공개 주소' },
          app: { x: bx + 8, y: 150, w: bw - 16, h: 54, t: 'Bolt 앱', s: 'POST /slack/events' },
        },
      };
    },
    under: (ctx, L) => {
      C.box(ctx, L.sw + 6, 34, L.g - 12, 182, { fill: '#fff', dash: [3, 3] });
      C.text(ctx, '인터넷', L.sw + L.g / 2, 204, { size: 9, align: 'center' });
    },
    scenes: [
      { pill: 'URL 확인', tone: 'info', stamp: ['Verified', 'ok'], note: '주소를 처음 넣으면 url_verification이 오고, challenge 값을 그대로 돌려주면 등록된다.', steps: [
        ['ev', 'px', 'url_verification', 'blue', '주소를 넣으면 확인 요청이 온다', -7], ['px', 'app', 'challenge', 'blue', '프록시가 앱으로 넘긴다', -7],
        ['app', 'px', 'challenge', 'ok', '받은 값을 그대로 돌려준다', 7], ['px', 'ev', 'challenge', 'ok', '슬랙이 주소를 등록한다', 7],
      ] },
      { pill: '이벤트 전달', tone: 'info', stamp: ['3초 안에 200', 'ok'], note: '그 뒤로는 이벤트마다 POST가 오고, 봇 서버가 200으로 답해야 전달이 끝난다.', steps: [
        ['ev', 'px', 'event_callback', 'blue', '이벤트마다 POST가 온다', -7], ['px', 'app', 'app_mention', 'blue', '앱이 서명을 검증하고 리스너를 부른다', -7],
        ['app', 'px', '200 OK', 'ok', '앱이 200으로 답한다', 7], ['px', 'ev', '200 OK', 'ok', '슬랙이 전달 완료로 본다', 7],
      ] },
    ],
  });

  // Socket Mode: the bot dials out with the app-level token; events and acks then share that one connection.
  flow('slack-bot-socket', {
    height: 252,
    layout: (w) => {
      const nar = w < 480, sw = nar ? 100 : 170, g = nar ? 40 : 120, bx = sw + g, bw = w - bx;
      return {
        sw, bx, bw, stampX: Math.max(sw / 2, 68), stampY: 131,
        groups: [[0, 34, sw, 182, '슬랙'], [bx, 34, bw, 182, '사내망']],
        b: {
          web: { x: 8, y: 62, w: sw - 16, h: 50, t: 'Web API' },
          sock: { x: 8, y: 150, w: sw - 16, h: 54, t: 'Socket Mode', s: 'wss', size: nar ? 10 : 12 },
          app: { x: bx + 18, y: 62, w: bw - 26, h: 142, t: 'Bolt 앱', s: '봇 서버' },
        },
      };
    },
    under: (ctx, L, i, t) => {
      ctx.fillStyle = C.hatch(ctx, '#fca5a5');
      ctx.fillRect(L.bx + 6, 58, 6, 150);
      C.text(ctx, '들어오는 포트 없음', L.bx + L.bw - 10, 50, { size: 10, weight: 600, color: U.tones.bad[1], align: 'right' });
      const a = i ? 1 : ease(t, 2 * 1.5 + 0.8, 3 * 1.5);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      C.box(ctx, L.sw - 10, 166, L.bx + 20 - (L.sw - 10), 22, { fill: COL.purple[0], stroke: COL.purple[2], r: 11 });
      C.text(ctx, '웹소켓', (L.sw + L.bx) / 2, 160, { size: 9, weight: 600, color: COL.purple[1], align: 'center' });
      ctx.globalAlpha = 1;
    },
    scenes: [
      { pill: '연결 열기', tone: 'info', stamp: ['포트를 열지 않음', 'ok'], note: '봇 서버가 xapp 토큰으로 주소를 받아 슬랙 쪽으로 웹소켓을 연다.', steps: [
        ['app', 'web', 'connections.open', 'blue', 'xapp 토큰으로 연결 주소를 받는다', -7], ['web', 'app', 'wss:// 주소', 'ok', '웹소켓 주소가 돌아온다', 7],
        ['app', 'sock', '연결 열기', 'purple', '봇 서버가 밖으로 연결을 연다'],
      ] },
      { pill: '이벤트와 ack', tone: 'ok', note: '이벤트는 그 연결을 타고 들어오고, 봇은 envelope_id를 돌려보내 받았다고 알린다.', steps: [
        ['sock', 'app', 'envelope', 'blue', '이벤트가 연결을 타고 온다', -5], ['app', 'sock', 'ack', 'ok', 'envelope_id로 ack를 보낸다', 5],
        ['app', 'web', 'chat.postMessage', 'blue', '답은 Web API로 쓴다'],
      ] },
    ],
  });

  // Lane chart drawn up to time tt (span units): blocks grow, marks are chips that appear at their time.
  const LH = 40;
  const lanes = (ctx, w, top, sc, tt) => {
    const lw = w < 480 ? 50 : 72, x0 = lw, x1 = w - 4, base = top + sc.lanes.length * LH + 4;
    const X = (v) => x0 + clamp(v, 0, sc.span) / sc.span * (x1 - x0), ly = (j) => top + j * LH + LH / 2;
    sc.lanes.forEach((s, j) => {
      C.text(ctx, s, 0, ly(j), { size: 10, weight: 600, color: U.text, base: 'middle' });
      if (j) C.dashed(ctx, x0, top + j * LH, x1, top + j * LH, U.grid);
    });
    C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
    for (let v = 0; v <= sc.span; v += sc.tick) C.text(ctx, `${v}초`, X(v), base + 14, { size: 9, align: v === 0 ? 'left' : v >= sc.span ? 'right' : 'center' });
    (sc.events || []).forEach(([v, label]) => { if (tt >= v) C.event(ctx, X(v), top + 2, base, label, U.red); });
    (sc.blocks || []).forEach(([j, a, b, col, label]) => {
      const bx = X(a), bw = X(Math.min(tt, b)) - bx, y = ly(j) - 12;
      if (tt <= a || bw <= 1) return;
      ctx.beginPath();
      ctx.roundRect(bx, y, bw, 24, Math.min(6, bw / 2));
      ctx.fillStyle = COL[col][0];
      ctx.fill();
      ctx.strokeStyle = COL[col][2];
      ctx.lineWidth = 1;
      ctx.stroke();
      if (label && tw(ctx, label, 10, 600) + 12 < bw) C.text(ctx, label, bx + 6, ly(j) + 0.5, { size: 10, weight: 600, color: COL[col][1], base: 'middle' });
    });
    (sc.marks || []).forEach(([j, v, label, col]) => {
      if (tt < v) return;
      const cw = tw(ctx, label, 10, 600) + 14;
      tag(ctx, label, clamp(X(v), x0 + cw / 2 + 2, x1 - cw / 2), ly(j), COL[col]);
    });
    if (tt > 0 && tt < sc.span) C.dashed(ctx, X(tt), top - 4, X(tt), base, U.now);
    return { mid: [(x0 + x1) / 2, top + (base - top) / 2], below: base + 38 };
  };

  // Deadline: past 3 seconds an event is sent again, and a slash command shows an error to the user.
  document.querySelectorAll('[data-figure="slack-bot-deadline"]').forEach((root) => {
    const SEC = 6, HOLD = 2.2, S = hwa.loopScenes(SEC, HOLD, 2), work = [1, 0.1, 5.5, 'warn', '로그 모으기'];
    const SC = [
      { pill: '이벤트', tone: 'info', span: 6, tick: 1, lanes: ['슬랙', '봇 서버'], events: [[3, '3초']], blocks: [work],
        marks: [[0, 0, 'app_mention', 'blue'], [0, 3.1, '재전송', 'bad'], [1, 5.5, '늦은 200', 'bad']], stamp: ['같은 이벤트가 다시 옴', 'bad'],
        note: '이벤트는 3초 안에 2xx가 없으면 실패로 보고 같은 이벤트를 다시 보낸다.' },
      { pill: '슬래시 명령', tone: 'info', span: 6, tick: 1, lanes: ['사용자', '봇 서버'], events: [[3, '3초']], blocks: [work],
        marks: [[0, 0, '/deploy-log', 'blue'], [0, 3.1, 'operation_timeout', 'bad'], [1, 5.5, '늦은 200', 'bad']], stamp: ['사용자에게 오류', 'bad'],
        note: '슬래시 명령은 3000ms 안에 응답이 없으면 사용자에게 operation_timeout을 보여 준다.' },
    ];
    hwa.scene(root, {
      height: 186, scenes: S, notes: SC.map((s) => s.note), still: S.at(1) + SEC + 0.6,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), run = (time % (2 * (SEC + HOLD))) - S.at(i), sc = SC[i];
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        const g = lanes(ctx, w, 44, sc, t / SEC * sc.span);
        C.stamp(ctx, g.mid[0], g.below, sc.stamp[0], sc.stamp[1], (run - SEC) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    });
  });

  // Demo: an 8 s job before the response invites a retry and a second run; acking first ends it at 0.1 s.
  document.querySelectorAll('[data-figure="slack-bot-ack"]').forEach((root) => {
    const SEC = 7.5, base = { span: 12, tick: 2, lanes: ['슬랙', '처리 1', '처리 2', '채널'], events: [[3, '3초']] };
    const SC = [
      { ...base, pill: '처리 후 응답', tone: 'bad', blocks: [[1, 0.1, 8, 'warn', '로그 모으기 8초'], [2, 3.2, 11.1, 'bad', '같은 일 다시']],
        marks: [[0, 3.1, '재전송', 'bad'], [0, 8, '늦은 200', 'bad'], [3, 8, '답', 'ok'], [3, 11.1, '같은 답', 'bad']], stamp: ['답 2번, 1분 뒤 또 옴', 'bad'],
        note: '일을 다 하고 응답하면 3초가 지나 재전송이 오고, 같은 일을 두 번 해서 답이 두 번 달린다.' },
      { ...base, pill: 'ack 먼저', tone: 'ok', blocks: [[1, 0.3, 8.3, 'warn', '로그 모으기 8초']],
        marks: [[0, 0.1, '200 OK', 'ok'], [3, 8.3, '답', 'ok']], stamp: ['200 0.1초, 답 1번', 'ok'],
        note: 'ack를 먼저 보내면 슬랙은 0.1초 만에 200을 받고, 일은 그 뒤에 한 번만 한다.' },
    ];
    hwa.scene(root, {
      height: 266, notes: SC.map((s) => s.note), demo: { modes: SC.map((s) => s.pill), run: '무거운 일 시키기' },
      frame: (ctx, w, h, time, say, ui) => {
        const sc = SC[ui.mode], run = ui.runAt === null ? -1 : time - ui.runAt, tt = clamp(run / SEC, 0, 1) * sc.span;
        const replies = sc.marks.filter(([j, v]) => j === 3 && tt >= v).length;
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        C.text(ctx, `답 ${replies}번`, w, 15, { size: 12, weight: 700, color: replies > 1 ? U.red : U.text, align: 'right' });
        const g = lanes(ctx, w, 44, sc, tt);
        if (run < 0) C.text(ctx, '무거운 일 시키기 버튼을 눌러 보자', g.mid[0], g.mid[1], { size: 12, align: 'center', base: 'middle' });
        C.stamp(ctx, g.mid[0], g.below, sc.stamp[0], sc.stamp[1], (run - SEC) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    });
  });

  // Demo: the original and three retries reach the listener; an event_id store lets only the first through.
  document.querySelectorAll('[data-figure="slack-bot-dedup"]').forEach((root) => {
    const SEC = 7.2, GAP = 1.5, TRY = [['원본', '0초'], ['1회차', '즉시'], ['2회차', '1분 뒤'], ['3회차', '5분 뒤']];
    const MODES = [
      { pill: '거르지 않음', tone: 'bad', stamp: ['답 4번', 'bad'], note: '거르지 않으면 원본과 재시도 세 번이 모두 리스너를 지나 답이 네 번 달린다.' },
      { pill: 'event_id로 거름', tone: 'ok', stamp: ['답 1번', 'ok'], note: '처음 본 event_id만 저장하고 통과시켜, 나머지 세 번은 200만 돌려주고 건너뛴다.' },
    ];
    hwa.scene(root, {
      height: 262, notes: MODES.map((m) => m.note), demo: { modes: MODES.map((m) => m.pill), run: '재전송 일으키기' },
      frame: (ctx, w, h, time, say, ui) => {
        const m = ui.mode, M = MODES[m], run = ui.runAt === null ? -1 : time - ui.runAt, t = Math.max(0, run);
        const nar = w < 480, sl = nar ? 70 : 120, g = nar ? 14 : 44, gx = sl + g, gw = nar ? 118 : 210, cx = gx + gw + g, cw = w - cx;
        const lis = { x: gx + 8, y: 66, w: gw - 16, h: 50, t: '리스너', s: m ? 'event_id 확인' : '바로 처리' };
        const sto = { x: gx + 8, y: 146, w: gw - 16, h: 54, t: m ? '저장소' : '저장소 없음' }, ly = lis.y + 25, lx = lis.x + lis.w / 2;
        const done = (j) => j * GAP + (m ? 2.0 : 1.3), replies = run < 0 ? 0 : m ? (t >= done(0) ? 1 : 0) : [0, 1, 2, 3].filter((j) => t >= done(j)).length;
        C.pill(ctx, 0, 0, M.pill, M.tone);
        C.text(ctx, `답 ${replies}번`, w, 15, { size: 12, weight: 700, color: replies > 1 ? U.red : U.text, align: 'right' });

        C.group(ctx, 0, 40, sl, 170, '슬랙', 56);
        TRY.forEach(([a, b], j) => {
          const on = run >= j * GAP;
          C.text(ctx, a, 10, 84 + j * 31, { size: 10, weight: 600, color: on ? U.text : U.muted });
          C.text(ctx, b, 10, 97 + j * 31, { size: 9, color: on ? COL[j ? 'warn' : 'blue'][1] : U.muted });
        });
        C.group(ctx, gx, 40, gw, 170, '봇 서버', 56);
        C.group(ctx, cx, 40, cw, 170, '#ops', 56);
        C.arrow(ctx, [[sl + 2, ly], [lis.x - 2, ly]], 1, '#cbd5e1');
        C.arrow(ctx, [[lis.x + lis.w + 2, ly], [cx - 2, ly]], 1, '#cbd5e1');
        if (m) { C.line(ctx, [[lx, lis.y + lis.h], [lx, sto.y]], '#cbd5e1', 1.5); }
        C.card(ctx, lis, { fill: '#fff' });
        sto.s = m ? (t >= 1.0 && run >= 0 ? 'Ev06ABC 처리함' : '비어 있음') : '';
        C.card(ctx, sto, m ? { fill: '#fff' } : { dim: true, dash: [4, 3], fill: U.plot });

        for (let j = 0; j < 4; j++) {
          if (run < 0 || t >= done(j)) continue;
          const d = j * GAP;
          if (t < d) continue;
          const col = COL[j ? 'warn' : 'blue'], gate = m && j > 0;
          let p, a = 1;
          if (t < d + 0.7) p = mix([sl - 14, ly], [lx, ly], ease(t, d, d + 0.6));
          else if (!m) p = mix([lx, ly], [cx + cw / 2, ly], ease(t, d + 0.7, d + 1.3));
          else if (t < d + 1.3) p = mix([lx, ly], [lx, sto.y + 10], Math.sin(Math.PI * clamp((t - d - 0.7) / 0.6, 0, 1)));
          else if (gate) { p = [lx, ly]; a = 1 - ease(t, d + 1.6, d + 2.0); }
          else p = mix([lx, ly], [cx + cw / 2, ly], ease(t, d + 1.4, d + 2.0));
          tag(ctx, TRY[j][0], p[0], p[1], gate && t >= d + 1.3 ? COL.mute : col, a);
          if (gate && t >= d + 1.3) C.text(ctx, '건너뜀', lx + 6, lis.y + lis.h + 18, { size: 10, weight: 700, color: U.muted });
        }
        for (let k = 0; k < replies; k++) {
          const y = 66 + k * 34, c = k ? COL.bad : COL.ok;
          C.box(ctx, cx + 8, y, cw - 16, 26, { fill: c[0], stroke: c[2], r: 6 });
          C.text(ctx, k ? '같은 답' : 'api 정상', cx + 16, y + 13.5, { size: 10, weight: 600, color: c[1], base: 'middle' });
        }
        if (run < 0) C.text(ctx, '재전송 일으키기 버튼을 눌러 보자', w / 2, 236, { size: 12, align: 'center', base: 'middle' });
        C.stamp(ctx, w / 2, 236, M.stamp[0], M.stamp[1], (run - SEC) / 0.4);
        say(`${M.pill}. ${M.note}`);
      },
    });
  });

  // Signature check: a real request passes, a forged one fails the HMAC, a replayed copy fails the 5 minute window.
  document.querySelectorAll('[data-figure="slack-bot-signature"]').forEach((root) => {
    const SEC = 5.2, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 3);
    const SC = [
      { pill: '슬랙이 보낸 요청', tone: 'info', who: '슬랙', sub: '서명 맞음', ts: ['1초 통과', 'ok'], sig: ['일치', 'ok'], end: ['리스너 실행', 'ok'],
        note: '슬랙이 보낸 요청은 시각 차이가 작고, signing secret으로 다시 계산한 서명과 맞아 통과한다.' },
      { pill: '위조 요청', tone: 'bad', who: '공격자', sub: '서명 추측', ts: ['2초 통과', 'ok'], sig: ['불일치', 'bad'], end: ['401 거부', 'bad'],
        note: '주소만 아는 공격자는 signing secret이 없어 서명을 맞출 수 없다.' },
      { pill: '재전송 공격', tone: 'bad', who: '공격자', sub: '10분 전 복사본', ts: ['10분 거부', 'bad'], sig: null, end: ['401 거부', 'bad'],
        note: '지나간 요청을 그대로 복사하면 서명은 맞지만 5분이 넘어 시각 검사에서 걸린다.' },
    ];
    hwa.scene(root, {
      height: 236, scenes: S, notes: SC.map((s) => s.note), still: S.at(2) + SEC + 0.5,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), sc = SC[i], nar = w < 480;
        const sl = nar ? 84 : 140, g = nar ? 26 : 70, bx = sl + g, bw = w - bx, ry = [92, 136];
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        C.card(ctx, { x: 0, y: 80, w: sl, h: 68, t: sc.who, s: sc.sub }, { fill: i ? COL.bad[0] : '#fff', stroke: i ? COL.bad[2] : U.grid });
        C.group(ctx, bx, 40, bw, 182, '봇 서버', 56);
        if (!nar) C.text(ctx, 'signing secret으로 다시 계산', bx + bw - 10, 56, { size: 10, align: 'right' });
        const k = ease(t, 0.2, 1.2);
        C.arrow(ctx, [[sl + 2, 114], [bx - 2, 114]], k, i ? U.red : U.blue);
        if (t < 1.4) tag(ctx, 'POST', ...mix([sl / 2, 114], [bx + 30, 114], k), i ? COL.bad : COL.blue, 1 - ease(t, 1.2, 1.4));
        [['시각 차이', sc.ts, 1.5], ['서명 비교', sc.sig, 2.5]].forEach(([label, v, at], j) => {
          C.box(ctx, bx + 8, ry[j] - 17, bw - 16, 34, { fill: '#fff' });
          C.text(ctx, label, bx + 18, ry[j] + 0.5, { size: 11, weight: 600, color: U.text, base: 'middle' });
          if (v) C.chip(ctx, v[0], bx + bw - 16, ry[j], v[1], ease(t, at, at + 0.4));
          else if (t >= at) C.text(ctx, '검사 안 함', bx + bw - 18, ry[j] + 0.5, { size: 10, align: 'right', base: 'middle' });
        });
        C.stamp(ctx, bx + bw / 2, 190, sc.end[0], sc.end[1], (t - 3.6) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    });
  });

  // Tokens and scopes: the same bot token posts to #ops, is refused in a channel it is not in, and lacks a read scope.
  const SCOPES = [['chat:write', true], ['app_mentions:read', true], ['commands', true], ['channels:history', false]];
  flow('slack-bot-tokens', {
    height: 252, STEP: 1.7,
    layout: (w) => {
      const nar = w < 480, bw = nar ? 66 : 120, g = nar ? 16 : 44, aw = nar ? 120 : 200, ax = bw + g, cx = ax + aw + g, cw = w - cx;
      return {
        nar, stampX: w - 70, stampY: 15,
        groups: [[0, 34, bw, 182, '봇 서버'], [ax, 34, aw, 182, 'Web API'], [cx, 34, cw, 182, '채널']],
        b: {
          bot: { x: 6, y: 62, w: bw - 12, h: 142, t: 'Bolt 앱', s: 'xoxb', size: nar ? 11 : 12 },
          api: { x: ax + 8, y: 62, w: aw - 16, h: 142, t: '' },
          ops: { x: cx + 8, y: 62, w: cw - 16, h: 54, t: '#ops', s: '봇 있음' },
          sec: { x: cx + 8, y: 150, w: cw - 16, h: 54, t: '#secret', s: '봇 없음', o: { dash: [4, 3], fill: U.plot } },
        },
      };
    },
    over: (ctx, L, i, t, w, cur, done) => {
      const a = L.b.api, mid = a.x + a.w / 2, size = L.nar ? 9 : 10;
      C.text(ctx, '봇 토큰 권한', mid, a.y + 18, { size: 10, weight: 600, color: U.text, align: 'center', base: 'middle' });
      SCOPES.forEach(([s, has], j) => {
        const y = a.y + 44 + j * 24, hot = i === 2 ? !has : j === 0;
        if (hot) C.box(ctx, a.x + 6, y - 10, a.w - 12, 20, { fill: has ? COL.ok[0] : COL.bad[0], stroke: has ? COL.ok[2] : COL.bad[2], r: 5 });
        C.text(ctx, s, mid, y + 0.5, { size, weight: 600, color: has ? U.tones.ok[1] : hot ? U.red : U.muted, align: 'center', base: 'middle' });
        if (!has) { const sw = tw(ctx, s, size, 600); C.line(ctx, [[mid - sw / 2, y], [mid + sw / 2, y]], hot ? U.red : U.muted, 1); }
      });
      if (i === 1 && (cur >= 1 || done)) {
        const s = L.b.sec, y = s.y + s.h / 2;
        C.dashed(ctx, a.x + a.w + 2, y, s.x - 2, y, U.red);
        C.text(ctx, '×', (a.x + a.w + s.x) / 2, y - 1, { size: 14, weight: 700, color: U.red, align: 'center', base: 'middle' });
      }
    },
    scenes: [
      { pill: '#ops에 쓰기', tone: 'ok', stamp: ['ok: true', 'ok'], note: 'chat:write가 있고 봇이 들어가 있는 채널이라 글이 올라간다.', steps: [
        ['bot', 'api', 'chat.postMessage', 'blue', '봇 토큰으로 #ops에 쓴다', -7], ['api', 'ops', '배포 실패', 'ok', '권한과 채널 둘 다 통과한다'],
      ] },
      { pill: '#secret에 쓰기', tone: 'bad', stamp: ['not_in_channel', 'bad'], note: '권한이 있어도 봇이 없는 채널에는 쓸 수 없다.', steps: [
        ['bot', 'api', 'chat.postMessage', 'blue', '#secret에 쓰려고 한다', -7], ['api', 'bot', 'not_in_channel', 'bad', '봇이 없는 채널이라 거절된다', 7],
      ] },
      { pill: '기록 읽기', tone: 'bad', stamp: ['missing_scope', 'bad'], note: '받지 않은 권한이 필요한 메서드는 missing_scope로 끝난다.', steps: [
        ['bot', 'api', 'conversations.history', 'blue', '채널 기록을 읽으려 한다', -7], ['api', 'bot', 'missing_scope', 'bad', 'channels:history 권한이 없다', 7],
      ] },
    ],
  });
})();
