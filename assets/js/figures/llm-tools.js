// LLM post figures: tokens and context, call timing, tool loop, MCP, local GPU memory.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], GREEN = ['#dcfce7', '#15803d', '#86efac'];
  const ORANGE = ['#fef3c7', '#b45309', '#fcd34d'], GRAY = [U.cell, U.muted, '#e2e8f0'];
  const each = (id, fn) => document.querySelectorAll(`[data-figure="llm-tools-${id}"]`).forEach(fn);
  const demoRun = (ui, time) => (ui.runAt === null ? -1 : time - ui.runAt);
  const idle = (ctx, x, y, label) => C.text(ctx, `${label} 버튼을 눌러 보자`, x, y, { size: 12, align: 'center', base: 'middle' });

  // Centred chip with a border. col = [bg, fg, line].
  const tag = (ctx, s, cx, cy, col, a = 1, size = 10) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, size, 600) + 14;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(cx - cw / 2, cy - 9, cw, 18, 5);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, cx, cy + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  // Chip travelling along pts while t runs a..b, then fading out.
  const fly = (ctx, s, pts, t, a, b, col) => {
    if (t < a || t > b + 0.6) return;
    const [x, y] = C.pathAt(pts, ease(t, a, b)).pop();
    tag(ctx, s, x, y, col, t > b ? 1 - (t - b) / 0.6 : 1);
  };
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  const cell = (ctx, x, y, s, fill, a = 1) => {
    ctx.globalAlpha = a;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  // Context window: every turn resends the system prompt and the whole history, so input grows each turn.
  each('context', (root) => {
    const SYS = 500, Q = 100, A = 500, WIN = 4096, N = 7, MAX = 4900, STEP = 1.1, HOLD = 2.6, RH = 24, TOP = 44;
    const input = (n) => SYS + (n - 1) * (Q + A) + Q;
    hwa.scene(root, {
      height: TOP + N * RH + 30, still: N * STEP + 1,
      notes: ['질문마다 시스템 지시와 이전 대화를 다시 보내서, 입력이 턴마다 600토큰씩 는다. 7번째 질문에서 창 4,096을 넘는다.'],
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, N, STEP, HOLD), shown = s.done ? N : s.active + 1, tt = time % (N * STEP + HOLD);
        C.pill(ctx, 0, 0, `${shown}번째 질문`, shown === N ? 'bad' : 'info');
        const items = [['시스템', '#cbd5e1'], ['이전 대화', BLUE[2]], ['새 질문', U.blue]];
        ctx.font = U.font(10);
        const lgw = items.reduce((a, [l]) => a + 24 + ctx.measureText(l).width, 0) - 12;
        if (lgw + 110 < w) C.legend(ctx, w - lgw, 11, items);
        const x0 = 34, x1 = w - 4, X = (v) => x0 + (v / MAX) * (x1 - x0), wx = X(WIN);
        C.dashed(ctx, wx, TOP - 6, wx, TOP + N * RH, U.red);
        C.text(ctx, '창 4,096', wx, TOP - 10, { size: 10, weight: 700, color: U.red, align: 'center' });
        let sum = 0;
        for (let j = 0; j < shown; j++) {
          const n = j + 1, k = s.k(j), y = TOP + j * RH + 4, tot = input(n), over = tot > WIN;
          sum += tot;
          C.text(ctx, `${n}턴`, 0, y + 8, { size: 10, weight: 600, color: U.text, base: 'middle' });
          [[0, SYS, '#cbd5e1'], [SYS, tot - Q, BLUE[2]], [tot - Q, tot, U.blue]].forEach(([a, b, fill]) => {
            if (b <= a) return;
            ctx.fillStyle = fill;
            ctx.fillRect(X(a * k), y, X(b * k) - X(a * k), 16);
          });
          if (over && k > 0.9) { ctx.fillStyle = C.hatch(ctx, U.red); ctx.fillRect(wx, y, X(tot) - wx, 16); }
          C.text(ctx, fmt(tot), X(tot * k) + 4, y + 8.5, { size: 10, weight: over ? 700 : 400, color: over ? U.red : U.muted, base: 'middle' });
        }
        C.text(ctx, `지금까지 보낸 입력 ${fmt(sum)}토큰`, 0, TOP + N * RH + 20, { size: 11, weight: 600, color: U.text });
        C.stamp(ctx, (X(1400) + wx) / 2, TOP + 12, '창 넘침, 앞 대화 잘림', 'bad', shown === N ? (tt - (N - 1) * STEP - 0.6) / 0.4 : 0);
        say(`${shown}번째 질문의 입력은 ${fmt(input(shown))}토큰이다. 창 한도는 4,096토큰이고, 지금까지 보낸 입력은 ${fmt(sum)}토큰이다.`);
      },
    });
  });

  // Demo: whole document versus the three chunks a similarity search picked.
  each('rag', (root) => {
    const N = 40, CH = 500, BASE = 600, HIT = [6, 17, 31], SEC = 5.2, MAX = 21000;
    const notes = ['문서 40조각을 전부 넣으면 입력이 20,600토큰이 되고, 첫 토큰까지 그만큼 오래 걸린다.', '검색으로 고른 3조각만 넣으면 입력은 2,100토큰으로 줄고 첫 토큰도 빨라진다.'];
    hwa.scene(root, {
      height: 268, still: SEC, notes,
      demo: { modes: ['문서 통째로', '관련 조각만'], run: '질문 보내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const m = ui.mode, run = demoRun(ui, time), t = clamp(run, 0, SEC);
        C.pill(ctx, 0, 0, m ? '관련 조각만' : '문서 통째로', m ? 'ok' : 'warn');
        C.text(ctx, '조각 하나 500토큰', w, 11, { size: 10, align: 'right', base: 'middle' });
        const cs = Math.min(20, Math.floor((w * 0.66 - 36) / 10)), gy = 52, gw = cs * 10 + 36;
        C.text(ctx, '문서 조각 40개', 0, 44, { size: 10, weight: 600 });
        const by = 190, bh = 20, X = (v) => (v / MAX) * w;
        const pick = m ? HIT : Array.from({ length: N }, (_, i) => i);
        const start = (j) => (m ? 1.7 + j * 0.3 : 0.2 + j * 0.06);
        // Search panel: the question becomes a vector and pulls the nearest chunks.
        const sx = gw + (w - gw) / 2;
        if (m && run >= 0) {
          tag(ctx, '질문', sx, gy + 14, BLUE, ease(t, 0, 0.5));
          C.text(ctx, '유사도 검색', sx, gy + 44, { size: 10, weight: 600, color: U.text, align: 'center' });
          tag(ctx, '가까운 3개', sx, gy + 66, GREEN, ease(t, 0.9, 1.4));
        }
        let arrived = 0;
        for (let i = 0; i < N; i++) {
          const cx = (i % 10) * (cs + 4), cy = gy + Math.floor(i / 10) * (cs + 4), j = pick.indexOf(i);
          const hit = m && j >= 0 && t >= 0.9;
          if (j < 0 || run < 0) { cell(ctx, cx, cy, cs, U.cell); cell(ctx, cx, cy, cs, '#cbd5e1', m && t > 0.9 ? 0.35 : 1); continue; }
          const f = ease(t, start(j), start(j) + 0.8);
          cell(ctx, cx, cy, cs, U.cell);
          if (f >= 1) { arrived++; continue; }
          const tx = X(BASE + j * CH), ty = by, tW = X(CH) - 1;
          ctx.fillStyle = hit ? U.blue : '#94a3b8';
          ctx.beginPath();
          ctx.roundRect(cx + (tx - cx) * f, cy + (ty - cy) * f, cs + (tW - cs) * f, cs + (bh - cs) * f, 3);
          ctx.fill();
        }
        const tokens = BASE + arrived * CH;
        C.text(ctx, '모델에 보내는 입력', 0, by - 8, { size: 10, weight: 600 });
        C.text(ctx, `${fmt(run < 0 ? 0 : tokens)}토큰`, w, by - 8, { size: 11, weight: 700, color: tokens > 10000 ? U.red : U.text, align: 'right' });
        C.box(ctx, 0, by, w, bh, { fill: U.plot, r: 4 });
        if (run >= 0) {
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(0, by, X(BASE), bh);
          for (let j = 0; j < arrived; j++) { ctx.fillStyle = m ? U.blue : '#94a3b8'; ctx.fillRect(X(BASE + j * CH), by, X(CH) - 1, bh); }
        }
        const py = 236, done = m ? start(2) + 0.8 : start(N - 1) + 0.8, pf = ease(t, done, done + 1);
        C.text(ctx, '첫 토큰까지 입력 처리', 0, py - 8, { size: 10, weight: 600 });
        C.box(ctx, 0, py, w, 14, { fill: U.plot, r: 4 });
        if (pf > 0) { ctx.fillStyle = m ? '#fcd34d' : '#f59e0b'; ctx.beginPath(); ctx.roundRect(0, py, X(tokens) * pf, 14, 4); ctx.fill(); }
        if (run < 0) idle(ctx, w / 2, by + 10, '질문 보내기');
        C.stamp(ctx, w / 2, gy + 48, m ? '입력 2,100토큰' : '입력 20,600토큰', m ? 'ok' : 'bad', (run - SEC + 0.6) / 0.4);
        say(run < 0 ? '질문 보내기 버튼을 누르면 문서가 프롬프트에 들어간다.' : `${m ? '관련 조각만' : '문서 통째로'}. 입력 ${fmt(tokens)}토큰. ${notes[m]}`);
      },
    });
  });

  // Timeline figures: lanes on a time axis, blocks for work, arrows for waits.
  {
    const FILL = { net: '#94a3b8', pre: '#f59e0b', tok: U.blue, tool: '#64748b', cache: '#22c55e', call: U.purple };
    const ARC = { wait: '#94a3b8' };
    const LH = 44;
    const dbl = (ctx, x0, x1, y, color) => {
      if (x1 - x0 < 6) return;
      C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
      [[x0, 1], [x1, -1]].forEach(([x, d]) => {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
      });
    };
    const toks = (lane, a, n, gap, kind = 'tok') => Array.from({ length: n }, (_, i) => [lane, a + i * gap, a + i * gap + gap * 0.7, kind, '']);
    const tl = (id, scenes, { SEC = 7, HOLD = 1.8 } = {}) => each(id, (root) => {
      const maxL = Math.max(...scenes.map((s) => s.lanes.length)), n = scenes.length;
      const height = 44 + maxL * LH + 26 + (scenes.some((s) => s.below) ? 40 : 4);
      hwa.scene(root, {
        height, still: (n - 1) * (SEC + HOLD) + SEC + 0.6,
        scenes: n > 1 ? hwa.loopScenes(SEC, HOLD, n) : undefined,
        notes: scenes.map((x) => x.say),
        frame: (ctx, w, h, time, say) => {
          const { i } = hwa.loop(time, SEC, HOLD, n), s = scenes[i];
          const run = (time % ((SEC + HOLD) * n)) - i * (SEC + HOLD), k = clamp(run / SEC), t = k * s.span;
          C.pill(ctx, 0, 0, s.pill, s.tone);
          const lgw = (s.legend || []).reduce((a, [, l]) => a + tw(ctx, l, 10) + 28, 0);
          if (s.legend && lgw + tw(ctx, s.pill, 11, 600) + 38 < w) {
            let lx = w;
            s.legend.slice().reverse().forEach(([kind, label]) => {
              lx -= tw(ctx, label, 10) + 4;
              C.text(ctx, label, lx, 11.5, { size: 10, base: 'middle' });
              lx -= 14;
              ctx.fillStyle = FILL[kind];
              ctx.beginPath(); ctx.roundRect(lx, 6, 10, 10, 2); ctx.fill();
              lx -= 10;
            });
          }
          const x0 = Math.min(52, w * 0.15), x1 = w - 8, top = 40, base = top + s.lanes.length * LH + 4;
          const X = (v) => x0 + (clamp(v, 0, s.span) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
          s.lanes.forEach((name, j) => C.text(ctx, name, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
          C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
          (s.ticks || []).forEach(([v, label]) => {
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
            const y = ly(j) + 8, bx = X(a) + 0.5, bw = X(Math.min(t, b)) - bx - 0.5;
            if (bw <= 0) return;
            ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 16, Math.min(6, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
            if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 16) / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
          });
          (s.below || []).forEach(([a, b, label]) => {
            if (t <= a) return;
            dbl(ctx, X(a) + 2, X(Math.min(t, b)) - 2, base + 26, U.text);
            if (t >= b && tw(ctx, label, 9, 600) < X(b) - X(a)) C.text(ctx, label, (X(a) + X(b)) / 2, base + 40, { size: 9, weight: 600, color: U.text, align: 'center' });
          });
          if (s.event && t >= s.event[0]) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
          if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
          if (s.stamp) C.stamp(ctx, (x0 + x1) / 2, top + (base - top) / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
          say(`${s.pill}. ${s.say}`);
        },
      });
    });
    const sec = (n) => Array.from({ length: n }, (_, i) => [(i + 1) * 1000, `${i + 1}초`]);

    // Same output, longer input: the wait before the first token grows, the token rate does not.
    tl('flow', [
      { pill: '입력 600토큰', tone: 'ok', span: 4000, lanes: ['앱', '모델'], ticks: sec(4), legend: [['pre', '입력 처리'], ['tok', '출력 토큰']], segs: [[0, 0, 100, 'net', ''], [1, 100, 300, 'pre', ''], ...toks(1, 300, 40, 60)], arcs: [[0, 100, 300, 'wait', '']], event: [300, '첫 토큰'], below: [[300, 2700, '토큰 40개 생성']], stamp: ['첫 토큰 0.3초', 'ok'], say: '입력이 짧으면 입력 처리가 금방 끝나 0.3초에 첫 토큰이 나온다.' },
      { pill: '입력 20,600토큰', tone: 'warn', span: 4000, lanes: ['앱', '모델'], ticks: sec(4), legend: [['pre', '입력 처리'], ['tok', '출력 토큰']], segs: [[0, 0, 100, 'net', ''], [1, 100, 1300, 'pre', '입력 처리'], ...toks(1, 1300, 40, 60)], arcs: [[0, 100, 1300, 'wait', '첫 토큰 대기']], event: [1300, '첫 토큰'], below: [[1300, 3700, '토큰 40개 생성']], stamp: ['첫 토큰 1.3초', 'warn'], say: '입력이 길면 입력 처리가 길어져 첫 토큰이 늦다. 토큰 40개를 만드는 시간은 같다.' },
    ]);

  }

  // Tool loop: the app sends tools, the model asks for a call, the app runs it and sends the result back.
  each('loop', (root) => {
    const S = seq([5.2, 4.2, 5.4], 1.8);
    const notes = ['앱이 질문과 도구 정의를 보내면, 모델은 답 대신 도구 호출 요청을 돌려준다.', '도구를 실행하는 것은 모델이 아니라 앱이다. 결과는 앱에 돌아온다.', '앱이 결과를 대화에 붙여 모델을 다시 부르면, 모델이 그걸 읽고 답을 만든다.'];
    const PILL = [['모델이 호출 요청', 'info'], ['앱이 도구 실행', 'warn'], ['결과로 답 생성', 'ok']];
    const MSG = [['질문', BLUE], ['도구 정의', GRAY], ['호출: 날씨(서울)', PURPLE], ['결과: 맑음 12도', GREEN], ['답', BLUE]];
    hwa.scene(root, {
      height: 252, still: S.at(2) + 5.4 + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), cw = Math.min(110, Math.round(w * 0.24)), xs = [0, (w - cw) / 2, w - cw], cx = xs.map((x) => x + cw / 2);
        C.pill(ctx, 0, 0, PILL[i][0], PILL[i][1]);
        const U2A = [[xs[0] + cw, 54], [xs[1], 54]], A2U = [[xs[1], 72], [xs[0] + cw, 72]], A2M = [[xs[1] + cw, 54], [xs[2], 54]], M2A = [[xs[2], 72], [xs[1] + cw, 72]];
        const A2T = [[cx[1] - 16, 88], [cx[1] - 16, 122]], T2A = [[cx[1] + 16, 122], [cx[1] + 16, 88]];
        [U2A, A2U, A2M, M2A, A2T, T2A].forEach((p) => C.arrow(ctx, p, 1, '#e2e8f0', { width: 1 }));
        const gen = (i === 0 && t > 2.8 && t < 3.4) || (i === 2 && t > 1.5 && t < 2.2), runT = i === 1 && t > 1.3 && t < 2.3;
        C.card(ctx, { x: xs[0], y: 40, w: cw, h: 46, t: '사용자' });
        C.card(ctx, { x: xs[1], y: 40, w: cw, h: 46, t: '앱', s: '호스트' }, { lit: !gen && !runT && t > 0.2 });
        C.card(ctx, { x: xs[2], y: 40, w: cw, h: 46, t: '모델 API', s: gen ? '생성 중' : '' }, { lit: gen });
        C.card(ctx, { x: xs[1], y: 122, w: cw, h: 40, t: '날씨 API', s: runT ? '실행 중' : '도구' }, { lit: runT });
        if (i === 0) { fly(ctx, '질문', U2A, t, 0.2, 1.2, BLUE); fly(ctx, '질문 + 도구 정의', A2M, t, 1.5, 2.7, BLUE); fly(ctx, '호출 요청', M2A, t, 3.4, 4.5, PURPLE); }
        if (i === 1) { fly(ctx, '서울', A2T, t, 0.2, 1.2, PURPLE); fly(ctx, '맑음 12도', T2A, t, 2.3, 3.3, GREEN); }
        if (i === 2) { fly(ctx, '대화 + 결과', A2M, t, 0.2, 1.4, BLUE); fly(ctx, '답', M2A, t, 2.2, 3.2, BLUE); fly(ctx, '답', A2U, t, 3.6, 4.6, BLUE); }
        // Messages the app keeps and resends: they pile up across the three scenes.
        const have = [i > 0 || t > 1.2, i > 0 || t > 1.5, i > 0 || t > 4.5, i > 1 || (i === 1 && t > 3.3), i === 2 && t > 3.2];
        C.group(ctx, 0, 176, w, 70, '앱이 들고 있는 대화 (매번 다시 보낸다)', 192);
        let mx = 10, my = 214;
        MSG.forEach(([s, col], j) => {
          const mw = tw(ctx, s, 10, 600) + 14;
          if (mx + mw > w - 8) { mx = 10; my += 22; }
          if (have[j]) tag(ctx, s, mx + mw / 2, my, col);
          mx += mw + 6;
        });
        if (i === 2) C.stamp(ctx, w / 2, 104, '모델 호출 2번', 'info', (run - 5.4) / 0.4);
        say(`${PILL[i][0]}. ${notes[i]}`);
      },
    });
  });

  // MCP roles: one host, a client per server; tools/list gathers tools, tools/call routes one call.
  each('mcp', (root) => {
    const S = seq([6, 6.4], 1.8);
    const SV = [['파일 서버', 'stdio', '디스크', 4], ['Unity 서버', 'stdio', 'Unity 에디터', 6], ['DB 서버', 'HTTP', '원격 DB', 2]];
    const notes = ['클라이언트가 서버마다 tools/list를 보내 도구 목록을 모으고, 호스트가 합쳐서 모델에 건넨다.', '모델이 Unity 도구를 고르면 호스트가 그 서버의 클라이언트로 tools/call을 보내고 결과를 모델에 돌려준다.'];
    hwa.scene(root, {
      height: 300, still: S.at(1) + 6.4 + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = S.pos(time), wide = w >= 520;
        const hw = Math.round(wide ? w * 0.34 : w * 0.44), sx = hw + (wide ? 44 : 30), sw = wide ? Math.round(w * 0.27) : w - sx, tx = sx + sw + 34;
        C.pill(ctx, 0, 0, i ? 'tools/call' : 'tools/list', i ? 'warn' : 'info');
        C.text(ctx, i ? '도구 실행' : '도구 모으기', w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        const mc = { x: 10, y: 36, w: hw - 20, h: 38, t: '모델 API' }, hy = 100, cy = (j) => hy + 28 + j * 56;
        C.group(ctx, 0, hy, hw, h - hy - 4, '호스트 (Cursor)', hy + 16);
        const call = i === 1;
        C.card(ctx, mc, { lit: call ? t < 1 || t > 5.6 : t > 5.4 });
        const H2M = [[hw / 2 - 18, hy + 2], [hw / 2 - 18, 76]], M2H = [[hw / 2 + 18, 76], [hw / 2 + 18, hy + 2]];
        SV.forEach(([name, tr, target], j) => {
          const y = cy(j), on = call && j === 1 && t > 1.2 && t < 5;
          C.card(ctx, { x: 10, y, w: hw - 20, h: 44, t: `클라이언트 ${j + 1}` }, { lit: on, fill: '#fff' });
          C.line(ctx, [[hw - 10, y + 15], [sx, y + 15]], '#e2e8f0', 1);
          C.line(ctx, [[hw - 10, y + 29], [sx, y + 29]], '#e2e8f0', 1);
          C.card(ctx, { x: sx, y, w: sw, h: 44, t: name, s: tr }, { lit: on && t > 2.4 });
          if (wide) {
            C.line(ctx, [[sx + sw, y + 22], [tx, y + 22]], '#e2e8f0', 1);
            C.card(ctx, { x: tx, y: y + 4, w: w - tx, h: 36, t: target, size: 11 }, { dash: [3, 3], fill: U.plot, lit: on && t > 2.8 && t < 3.8 });
          }
          if (!call) {
            fly(ctx, 'tools/list', [[hw - 10, y + 15], [sx, y + 15]], t, 0.3 + j * 0.5, 1.3 + j * 0.5, GRAY);
            fly(ctx, `도구 ${SV[j][3]}개`, [[sx, y + 29], [hw - 10, y + 29]], t, 2.2 + j * 0.4, 3.2 + j * 0.4, GREEN);
          }
        });
        if (!call) fly(ctx, '도구 12개', H2M, t, 4.4, 5.4, BLUE);
        if (call) {
          const y = cy(1);
          fly(ctx, 'Unity 도구 호출', M2H, t, 0.2, 1.1, PURPLE);
          fly(ctx, 'tools/call', [[hw - 10, y + 15], [sx, y + 15]], t, 1.4, 2.4, PURPLE);
          fly(ctx, '결과', [[sx, y + 29], [hw - 10, y + 29]], t, 3.8, 4.8, GREEN);
          fly(ctx, '결과', H2M, t, 4.9, 5.6, GREEN);
        }
        say(`${i ? 'tools/call' : 'tools/list'}. ${notes[i]}`);
      },
    });
  });

  // Transports: stdio pipes to a child process on the same PC, or HTTP POST to a remote endpoint.
  each('transport', (root) => {
    const S = seq([5.4, 7.4], 1.8);
    const notes = ['stdio: 호스트가 서버를 자식 프로세스로 띄우고, 표준 입력과 출력으로 JSON 한 줄씩 주고받는다.', 'Streamable HTTP: 요청마다 POST를 보내고, 서버는 JSON 하나나 SSE 스트림으로 답한다.'];
    hwa.scene(root, {
      height: 206, still: S.at(1) + 7.4 + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = S.pos(time), cw = Math.min(124, Math.round(w * 0.3)), cy = 92, y0 = 60, y1 = 108;
        C.pill(ctx, 0, 0, i ? 'Streamable HTTP' : 'stdio', i ? 'info' : 'ok');
        C.text(ctx, i ? '원격 서버' : '같은 PC', w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        const hx = 12, sx = w - 12 - cw;
        if (!i) {
          C.group(ctx, 0, 32, w, 140, '내 PC', 48);
          const up = [[hx + cw, y0 + 8], [sx, y0 + 8]], dn = [[sx, y1], [hx + cw, y1]];
          C.card(ctx, { x: hx, y: 62, w: cw, h: 56, t: '호스트', s: 'Cursor' }, { lit: t < 1.2 });
          C.arrow(ctx, [[hx + cw, 146], [sx, 146]], ease(t, 0.3, 1.1), '#94a3b8', { dash: [4, 3], width: 1.2 });
          if (t > 0.6) C.text(ctx, '프로세스 실행', (hx + cw + sx) / 2, 162, { size: 10, align: 'center' });
          ctx.globalAlpha = ease(t, 0.9, 1.3);
          C.card(ctx, { x: sx, y: 62, w: cw, h: 56, t: 'MCP 서버', s: '자식 프로세스' }, { lit: t > 2.9 && t < 3.6 });
          ctx.globalAlpha = 1;
          if (t > 1.3) {
            C.arrow(ctx, up, 1, '#e2e8f0', { width: 1 });
            C.arrow(ctx, dn, 1, '#e2e8f0', { width: 1 });
            C.text(ctx, 'stdin', (hx + cw + sx) / 2, y0 - 2, { size: 9, align: 'center' });
            C.text(ctx, 'stdout', (hx + cw + sx) / 2, y1 - 6, { size: 9, align: 'center' });
          }
          fly(ctx, '요청 한 줄', up, t, 1.7, 2.9, BLUE);
          fly(ctx, '응답 한 줄', dn, t, 3.6, 4.8, GREEN);
          C.text(ctx, '로그는 stderr로', sx + cw / 2, 140, { size: 10, align: 'center' });
        } else {
          const gw = Math.round(w * 0.38);
          C.group(ctx, 0, 32, gw, 140, '내 PC', 48);
          C.group(ctx, w - gw, 32, gw, 140, '원격 서버', 48);
          C.dashed(ctx, gw + 6, cy, w - gw - 6, cy, '#cbd5e1');
          C.text(ctx, '네트워크', w / 2, 160, { size: 10, align: 'center' });
          const up = [[hx + cw, y0 + 8], [sx, y0 + 8]], dn = [[sx, y1], [hx + cw, y1]];
          C.card(ctx, { x: hx, y: 62, w: cw, h: 56, t: '호스트', s: 'Cursor' });
          C.card(ctx, { x: sx, y: 62, w: cw, h: 56, t: 'MCP 서버', s: 'POST /mcp' }, { lit: (t > 1.4 && t < 1.9) || (t > 4.2 && t < 6.6) });
          fly(ctx, 'POST', up, t, 0.3, 1.4, BLUE);
          fly(ctx, 'JSON 응답', dn, t, 1.9, 3.0, GREEN);
          fly(ctx, 'POST', up, t, 3.3, 4.2, BLUE);
          fly(ctx, '진행', dn, t, 4.4, 5.2, ORANGE);
          fly(ctx, '진행', dn, t, 5.0, 5.8, ORANGE);
          fly(ctx, '결과', dn, t, 5.6, 6.5, GREEN);
          const sse = t > 4.3;
          C.text(ctx, sse ? '두 번째 응답: SSE 스트림' : '첫 응답: JSON 하나', w / 2, 190, { size: 10, weight: 600, color: sse ? ORANGE[1] : U.text, align: 'center' });
        }
        say(notes[i]);
      },
    });
  });

  // Demo: Llama 3.1 8B on a 12GB GPU. FP16 spills 4GB into system memory; 4-bit fits.
    // Data: ollama.com/library/llama3.1/tags (8b-instruct-fp16 16GB, 8b q4_K_M 4.9GB).
  each('quant', (root) => {
    const COLS = 12, SEC = 4.6;
    const notes = ['FP16 16GB는 GPU 12GB에 다 못 올라가 4GB가 시스템 메모리로 밀려난다.', '4비트 4.9GB는 GPU에 다 들어가고, 남은 7GB를 KV 캐시와 여유로 쓴다.'];
    hwa.scene(root, {
      height: 232, still: SEC, notes,
      demo: { modes: ['FP16 (16GB)', '4비트 (4.9GB)'], run: '모델 올리기' },
      frame: (ctx, w, h, time, say, ui) => {
        const m = ui.mode, run = demoRun(ui, time), need = m ? 9.8 : 32, got = run < 0 ? 0 : clamp(run / (SEC - 1)) * need;
        C.pill(ctx, 0, 0, m ? '4비트' : 'FP16', m ? 'ok' : 'warn');
        C.text(ctx, '칸 하나 = 0.5GB', w, 11, { size: 10, align: 'right', base: 'middle' });
        const cs = Math.min(26, Math.floor((w - 20 - (COLS - 1) * 4) / COLS)), gw = COLS * cs + (COLS - 1) * 4, gx = (w - gw) / 2;
        const grid = (y0, from, fill) => {
          for (let i = 0; i < COLS * 2; i++) {
            const x = gx + (i % COLS) * (cs + 4), y = y0 + Math.floor(i / COLS) * (cs + 4), a = clamp(got - from - i);
            cell(ctx, x, y, cs, U.cell);
            if (a > 0) cell(ctx, x, y, cs, fill, a);
          }
        };
        const gy = 34, sy = gy + 2 * cs + 50;
        C.group(ctx, 0, gy, w, 2 * cs + 36, 'GPU 메모리 12GB', gy + 16);
        grid(gy + 24, 0, U.blue);
        C.group(ctx, 0, sy, w, 2 * cs + 36, '시스템 메모리 (CPU 쪽)', sy + 16);
        grid(sy + 24, 24, '#f59e0b');
        if (run < 0) idle(ctx, w / 2, sy - 7, '모델 올리기');
        else if (m && got >= need) C.text(ctx, '남은 7GB는 KV 캐시와 여유', w / 2, sy - 7, { size: 10, weight: 600, color: GREEN[1], align: 'center', base: 'middle' });
        else if (!m && got > 24) C.text(ctx, '넘친 가중치는 CPU 쪽에서 읽는다', w / 2, sy - 7, { size: 10, weight: 600, color: ORANGE[1], align: 'center', base: 'middle' });
        C.stamp(ctx, w / 2, gy + 24 + cs + 2, m ? 'GPU에 다 들어감' : '4GB가 시스템 메모리로', m ? 'ok' : 'bad', (run - SEC + 0.6) / 0.4);
        say(run < 0 ? '모델 올리기 버튼을 누르면 가중치가 GPU 메모리에 올라간다.' : `${m ? '4비트' : 'FP16'}. ${notes[m]}`);
      },
    });
  });

  // KV cache: Llama 3.1 8B FP16 weights stay at 16GB while the cache grows 128KB per token.
  each('kv', (root) => {
    const WGT = 16, PER = 0.125 / 1024, MAXC = 131072, GPU = 24, MAX = 32, SEC = 7, HOLD = 2.2, CROSS = (GPU - WGT) / PER;
    // Data: config.json of Llama 3.1 8B: 2 x 32 layers x 8 KV heads x 128 dim x 2 bytes = 128KB.
    hwa.scene(root, {
      height: 250, still: SEC + 0.6,
      notes: ['가중치 16GB는 그대로인데 KV 캐시가 토큰마다 128KB씩 늘어, 컨텍스트 64k에서 24GB에 닿고 128k에서 KV 캐시만 16GB가 된다.'],
      frame: (ctx, w, h, time, say) => {
        const { k } = hwa.loop(time, SEC, HOLD, 1), c = k * MAXC, over = c >= CROSS, run = time % (SEC + HOLD);
        C.pill(ctx, 0, 0, `컨텍스트 ${fmt(c)}토큰`, over ? 'bad' : 'info');
        const x0 = 40, x1 = w - 46, y0 = 44, H = 160, X = (v) => x0 + (v / MAXC) * (x1 - x0);
        const Y = C.panel(ctx, x0, y0, x1 - x0, H, { max: MAX, ticks: [[0, '0'], [8, '8GB'], [16, '16GB'], [24, '24GB'], [32, '32GB']] });
        const N = 60, pts = (f) => Array.from({ length: N + 1 }, (_, j) => { const v = (c * j) / N; return [X(v), Y(f(v))]; });
        if (c > 0) {
          C.area(ctx, pts(() => WGT), y0 + H, '#dbeafe');
          C.area(ctx, pts((v) => WGT + v * PER), pts(() => WGT), '#ede9fe');
          C.line(ctx, pts((v) => WGT + v * PER), U.purple, 2);
        }
        C.dashed(ctx, x0, Y(GPU), x1, Y(GPU), U.red);
        if (c > 20000) C.text(ctx, '가중치 16GB', x0 + 6, Y(WGT / 2), { size: 10, weight: 600, color: BLUE[1], base: 'middle' });
        if (c > 64000) C.text(ctx, 'KV 캐시', X(c) - 6, Y(WGT + 1.6), { size: 10, weight: 600, color: PURPLE[1], align: 'right', base: 'middle' });
        if (over) C.event(ctx, X(CROSS), y0 + 14, y0 + H, '24GB 넘음', U.red);
        [0, 32768, 65536, 98304, 131072].forEach((v) => C.text(ctx, `${v / 1024}k`, X(v), y0 + H + 16, { size: 10, align: 'center' }));
        if (c > 0) C.dot(ctx, X(c), Y(WGT + c * PER), over ? U.red : U.purple, `${(WGT + c * PER).toFixed(1)}GB`);
        C.stamp(ctx, (x0 + x1) / 2 + 24, Y(7), 'KV 캐시만 16GB', 'bad', (run - SEC) / 0.4);
        say(`컨텍스트 ${fmt(c)}토큰. 가중치 16GB에 KV 캐시 ${(c * PER).toFixed(1)}GB를 더해 ${(WGT + c * PER).toFixed(1)}GB.`);
      },
    });
  });

})();
