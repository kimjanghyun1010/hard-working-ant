// K8S pod replacement post: probes, rolling update, termination, drain with PDB, and spreading.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const each = (id, fn) => document.querySelectorAll(`[data-figure="k8s-best-practices-${id}"]`).forEach(fn);
  // Chip colours as [background, text, border].
  const T = {
    blue: ['#dbeafe', '#1d4ed8', '#93c5fd'], orange: ['#fef3c7', '#b45309', '#fcd34d'], red: ['#fee2e2', '#dc2626', '#fca5a5'],
    green: ['#dcfce7', '#15803d', '#86efac'], gray: [U.cell, U.muted, '#e2e8f0'], white: ['#fff', U.text, '#cbd5e1'],
  };
  const tag = (ctx, s, x, cy, col, { a = 1, size = 10, align = 'center', h = 18 } = {}) => {
    if (a <= 0) return 0;
    const cw = tw(ctx, s, size, 600) + 12, x0 = align === 'right' ? x - cw : align === 'left' ? x : x - cw / 2;
    ctx.globalAlpha = clamp(a);
    ctx.beginPath();
    ctx.roundRect(x0 + 0.5, cy - h / 2 + 0.5, cw - 1, h - 1, 5);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x0 + cw / 2, cy + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
    return cw;
  };
  const user = (ctx, x, y, w, h) => {
    C.box(ctx, x, y, w, h, { fill: '#fff', r: 8 });
    const cx = x + w / 2, cy = y + h / 2;
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath(); ctx.arc(cx, cy - 6, 5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy + 8, 8.5, 6, 0, Math.PI, 0); ctx.fill();
  };
  // Request dot; a failed one is red with a cross.
  const dot = (ctx, x, y, fail, a = 1) => {
    if (a <= 0) return;
    ctx.globalAlpha = clamp(a);
    ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fillStyle = fail ? U.red : U.blue; ctx.fill();
    if (fail) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(x - 2.2, y - 2.2); ctx.lineTo(x + 2.2, y + 2.2); ctx.moveTo(x + 2.2, y - 2.2); ctx.lineTo(x - 2.2, y + 2.2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const strike = (ctx, x0, x1, y) => C.line(ctx, [[x0, y], [x1, y]], '#94a3b8', 1.2);
  // Pod card: bold name on the left, a state chip on the right, an optional sub line under the name.
  const pod = (ctx, b, name, state, col, { sub, fill = '#fff', stroke = U.grid, dash, dim = false } = {}) => {
    C.box(ctx, b.x, b.y, b.w, b.h, { fill, stroke, dash, r: 7 });
    const cy = b.y + b.h / 2;
    C.text(ctx, name, b.x + 8, sub ? cy - 7 : cy + 0.5, { size: 11, weight: 700, color: dim ? U.muted : U.text, base: 'middle' });
    if (sub) C.text(ctx, sub, b.x + 8, cy + 9, { size: 9, base: 'middle' });
    if (state) tag(ctx, state, b.x + b.w - 6, sub ? cy - 6 : cy, col, { align: 'right', size: 9, h: 16 });
  };
  const stampIf = (ctx, cx, cy, s, tone, k) => { if (k > 0) C.stamp(ctx, cx, cy, s, tone, k); };
  // Bottom hint shown before a demo has been run.
  const hint = (ctx, w, y, run) => C.text(ctx, `'${run}' 버튼을 눌러 보자`, w / 2, y, { size: 12, align: 'center', base: 'middle' });

  // Group: lane timelines. One lane per pod or per probe, blocks for states, dots for requests or probe results.
  {
    const KIND = { run: U.blue, wait: '#f59e0b', stop: '#cbd5e1', bad: U.red };
    const MARK = { ok: '#16a34a', bad: U.red, skip: '#94a3b8' };
    const LH = 40, TOP = 46;
    const mark = (ctx, x, y, kind) => {
      ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fillStyle = MARK[kind]; ctx.fill();
      if (kind === 'bad') {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath();
        ctx.moveTo(x - 1.8, y - 1.8); ctx.lineTo(x + 1.8, y + 1.8); ctx.moveTo(x + 1.8, y - 1.8); ctx.lineTo(x - 1.8, y + 1.8); ctx.stroke();
      }
    };
    const lanes = (id, scenes, { SEC = 7, HOLD = 2 } = {}) => each(id, (root) => {
      const n = scenes.length, maxL = Math.max(...scenes.map((s) => s.lanes.length));
      hwa.scene(root, {
        height: TOP + maxL * LH + 70, still: (n - 1) * (SEC + HOLD) + SEC,
        scenes: n > 1 ? hwa.loopScenes(SEC, HOLD, n) : undefined, notes: scenes.map((s) => s.note),
        frame: (ctx, w, h, time, say) => {
          const { i, k } = hwa.loop(time, SEC, HOLD, n), s = scenes[i], t = k * s.span, run = (time % ((SEC + HOLD) * n)) - i * (SEC + HOLD);
          C.pill(ctx, 0, 0, s.pill, s.tone);
          let lx = w;
          (s.legend || []).slice().reverse().forEach(([kind, label]) => {
            lx -= tw(ctx, label, 10) + 2;
            C.text(ctx, label, lx, 11.5, { size: 10, base: 'middle' });
            mark(ctx, lx - 8, 11, kind);
            lx -= 20;
          });
          const lw = Math.min(76, Math.round(w * 0.22)), x0 = lw, x1 = w - 6, base = TOP + s.lanes.length * LH;
          const X = (v) => x0 + clamp(v / s.span) * (x1 - x0), ly = (j) => TOP + j * LH;
          s.lanes.forEach((name, j) => {
            C.text(ctx, name, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' });
            if (j) C.dashed(ctx, x0, ly(j), x1, ly(j), U.grid);
          });
          C.line(ctx, [[x0, TOP - 4], [x0, base], [x1, base]], U.text, 1.2);
          for (let v = s.tick; v <= s.span + 1e-6 && v <= t + 1e-6; v += s.tick) {
            C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
            C.text(ctx, `${v}초`, X(v), base + 14, { size: 9, align: v >= s.span ? 'right' : 'center' });
          }
          (s.segs || []).forEach(([j, a, b, kind, label]) => {
            if (t <= a) return;
            const y = ly(j) + 9, bx = X(a) + 1, bw = X(Math.min(t, b)) - bx - 1;
            if (bw <= 0) return;
            ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 18, Math.min(6, bw / 2)); ctx.fillStyle = KIND[kind]; ctx.fill();
            if (t >= b && label && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 18) / 2 + 0.5, { size: 10, weight: 700, color: kind === 'stop' ? U.muted : '#fff', align: 'center', base: 'middle' });
          });
          (s.marks || []).forEach(([j, at, kind]) => { if (t >= at) mark(ctx, X(at), ly(j) + LH / 2, kind); });
          (s.events || []).forEach(([at, label, row, color = U.red]) => {
            if (t < at) return;
            C.dashed(ctx, X(at), TOP - 4, X(at), base, color);
            const lw2 = tw(ctx, label, 10, 700), y = row ? base + 30 : TOP - 9, lx2 = clamp(X(at) - lw2 / 2, 0, w - lw2);
            C.text(ctx, label, lx2, y, { size: 10, weight: 700, color });
          });
          if (k > 0 && k < 1) C.dashed(ctx, X(t), TOP - 4, X(t), base, U.now);
          if (s.stamp) stampIf(ctx, (x0 + x1) / 2, base + 50, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
          say(`${s.pill}. ${s.note}`);
        },
      });
    });
    const reqs = (lane, from, to, gap, fate) => {
      const out = [];
      for (let v = from; v <= to + 1e-6; v += gap) out.push([lane, +v.toFixed(2), fate(v)]);
      return out;
    };

    // Startup: liveness defaults (period 10s, failureThreshold 3) against a 60s start. Backoff 10s then 20s per pod-lifecycle docs.
    lanes('startup', [
      { pill: 'startupProbe 없음', tone: 'bad', span: 90, tick: 30, lanes: ['앱', 'liveness'], legend: [['ok', '성공'], ['bad', '실패']],
        segs: [[0, 0, 30, 'wait', '기동 중'], [0, 30, 40, 'stop', ''], [0, 40, 70, 'wait', '기동 중'], [0, 70, 90, 'stop', '대기']],
        marks: [10, 20, 30, 50, 60, 70].map((v) => [1, v, 'bad']), events: [[30, '재시작'], [70, '재시작']],
        stamp: ['기동을 못 끝내고 재시작', 'bad'], note: 'liveness가 30초에 재시작시키고, 다시 떠도 30초 만에 또 끊는다. 재시작 사이 대기는 10초, 20초로 늘어난다.' },
      { pill: 'startupProbe 있음', tone: 'ok', span: 90, tick: 30, lanes: ['앱', 'startup', 'liveness'], legend: [['ok', '성공'], ['skip', '기다림']],
        segs: [[0, 0, 60, 'wait', '기동 중'], [0, 60, 90, 'run', '서비스']],
        marks: [...[10, 20, 30, 40, 50].map((v) => [1, v, 'skip']), [1, 60, 'ok'], ...[70, 80, 90].map((v) => [2, v, 'ok'])],
        events: [[60, 'startup 성공', 0, U.tones.ok[1]]],
        stamp: ['60초 기동을 기다림', 'ok'], note: 'startup이 성공할 때까지 liveness가 돌지 않아, 60초 기동을 끝까지 기다린다.' },
    ], { SEC: 7 });
  }

  // Group: request flow maps. User on the left, routing rows in the middle, pods on the right.
  {
    // Rows line up across the routing box and the pod column, so a request runs straight across.
    const map = (w, n, rowH, top = 34) => {
      const uw = Math.min(40, w * 0.11), mx = Math.round(w * 0.22), mw = Math.round(w * 0.3), px = Math.round(w * 0.6), pw = w - px;
      const ry = (j) => top + 26 + j * rowH + rowH / 2, bottom = top + 26 + n * rowH + 4, uy = (ry(0) + ry(n - 1)) / 2;
      return {
        uw, mx, mw, px, pw, ry, bottom, uy, top,
        path: (j) => [[uw, uy], [mx, ry(j)], [mx + mw, ry(j)], [px + 6, ry(j)]],
        card: (j) => ({ x: px + 6, y: ry(j) - rowH / 2 + 3, w: pw - 12, h: rowH - 6 }),
      };
    };
    const frameMap = (ctx, M, mid, right) => {
      user(ctx, 0, M.uy - 20, M.uw, 40);
      C.group(ctx, M.mx, M.top, M.mw, M.bottom - M.top, mid, M.top + 16);
      C.group(ctx, M.px, M.top, M.pw, M.bottom - M.top, right, M.top + 16);
    };
    // Request times from segments [[start, gap], ...]; each segment runs until the next one starts.
    const times = (a, b, segs) => {
      const out = [];
      segs.forEach(([s0, g], i) => {
        const s1 = i + 1 < segs.length ? segs[i + 1][0] : Infinity;
        for (let j = Math.ceil((Math.max(a, s0) - s0) / g - 1e-9); s0 + j * g < Math.min(b, s1); j++) out.push({ s: s0 + j * g, j: j + i * 7 });
      });
      return out;
    };
    // Draws requests in flight. pick(q) -> row or -1 when no endpoint is left; fail(row, arrive) -> true when it fails there.
    const LEG = 1.1;
    const flow = (ctx, M, now, qs, pick, fail) => qs.forEach((q) => {
      const age = now - q.s;
      if (age < 0 || age > LEG + 0.6) return;
      const j = pick(q), path = j < 0 ? [[M.uw, M.uy], [M.mx + 4, M.uy]] : M.path(j), dur = j < 0 ? LEG * 0.4 : LEG;
      const bad = j < 0 || fail(j, q.s + LEG);
      if (age < dur) dot(ctx, ...C.pathAt(path, age / dur).pop(), false);
      else if (bad) dot(ctx, ...path[path.length - 1], true, 1 - (age - dur) / 0.6);
    });
    const failures = (qs, now, pick, fail) => qs.filter((q) => q.s + LEG <= now && (pick(q) < 0 || fail(pick(q), q.s + LEG))).length;
    const endpoint = (ctx, M, j, name, state, extra) => {
      const x = M.mx + 8, y = M.ry(j), on = state === 'on';
      const cw = tag(ctx, name, x, y, on ? T.blue : T.gray, { align: 'left' });
      if (state === 'out') strike(ctx, x - 2, x + cw + 2, y);
      if (extra) C.text(ctx, extra[0], x + cw + 6, y + 0.5, { size: 9, weight: 600, color: extra[1], base: 'middle' });
    };

    // Readiness: new pod C joins the endpoints at Running (no probe) or once the app is ready (probe). Times are rough.
    each('readiness', (root) => {
      const SEC = 7.5, HOLD = 2, MADE = 0.8, READY = 4.6, ROW = 44, S = hwa.loopScenes(SEC, HOLD, 2);
      const notes = ['readiness가 없으면 C가 Running이 되자마자 엔드포인트에 들어가, 기동이 끝날 때까지 받은 요청이 실패한다.', 'readiness가 있으면 C는 검사를 통과한 뒤에 들어가고, 그동안 요청은 A와 B로만 간다.'];
      hwa.scene(root, {
        height: 34 + 26 + 3 * ROW + 10, still: S.at(1) + SEC, scenes: S, notes,
        frame: (ctx, w, h, time, say) => {
          const { i, t } = hwa.loop(time, SEC, HOLD, 2), run = (time % (2 * (SEC + HOLD))) - S.at(i), M = map(w, 3, ROW), wide = w > 460;
          const join = i ? READY : MADE, eps = (s) => (s >= join ? [0, 1, 2] : [0, 1]);
          const pick = (q) => { const e = eps(q.s); return e[q.j % e.length]; }, fail = (j, at) => j === 2 && at < READY;
          const qs = times(-1.6, t, [[-100, 0.25]]), sofar = failures(qs, t, pick, fail);
          C.pill(ctx, 0, 0, i ? 'readiness 있음' : 'readiness 없음', i ? 'ok' : 'warn');
          C.text(ctx, `실패 ${sofar}건`, w, 11, { size: 11, weight: 700, color: sofar ? U.tones.bad[1] : U.text, align: 'right', base: 'middle' });
          frameMap(ctx, M, wide ? 'Service 엔드포인트' : '엔드포인트', '파드');
          ['A', 'B', 'C'].forEach((name, j) => {
            if (j < 2) return endpoint(ctx, M, j, name, 'on', wide ? ['10.0.1.' + (5 + j), U.muted] : null);
            if (t < MADE) return;
            endpoint(ctx, M, j, name, t >= join ? 'on' : 'off', t >= join ? (wide ? ['10.0.1.7', U.muted] : null) : ['준비 안 됨', T.orange[1]]);
          });
          [0, 1].forEach((j) => pod(ctx, M.card(j), `파드 ${'AB'[j]}`, '준비', T.green));
          const c = M.card(2);
          if (t < MADE) C.box(ctx, c.x, c.y, c.w, c.h, { fill: U.plot, dash: [4, 3], r: 7 });
          else {
            const ready = t >= READY;
            pod(ctx, c, '파드 C', ready ? '준비' : '기동 중', ready ? T.green : T.orange, { fill: ready ? '#fff' : '#fffbeb', stroke: ready ? U.grid : T.orange[2] });
            if (!ready) { const f = clamp((t - MADE) / (READY - MADE)); ctx.fillStyle = '#f59e0b'; ctx.fillRect(c.x + 8, c.y + c.h - 6, (c.w - 16) * f, 2.5); }
          }
          flow(ctx, M, t, qs, pick, fail);
          const n = failures(times(-1.6, SEC, [[-100, 0.25]]), SEC, pick, fail);
          stampIf(ctx, w / 2, M.ry(1), n ? `요청 ${n}건 실패` : '실패 0건', n ? 'bad' : 'ok', (run - SEC) / 0.4);
          say(`${i ? 'readiness 있음' : 'readiness 없음'}. ${notes[i]}`);
        },
      });
    });

    // Liveness, interactive: a load spike slows every pod. Strict liveness (timeout 1s) restarts A, its share moves to B and C, and they follow.
    each('liveness', (root) => {
      const ROW = 48, SPIKE = [0.6, 5.0], END = 7, RUN = '부하 몰리게 하기';
      // Restart times follow checks every 0.5 after latency passes 1s: A from 0.9, B and C once A's share lands on them.
      const DOWN = [1.9, 3.05, 3.2], CHECK = [0.9, 2.05, 2.2];
      const notes = ['느린 응답도 실패로 보면 A가 재시작되고, A 몫이 몰린 B와 C도 차례로 재시작된다.', '멈춤만 실패로 보면 A가 느려지기만 하고, 부하가 지나가면 돌아온다.'];
      hwa.scene(root, {
        height: 34 + 26 + 3 * ROW + 10 + 28, still: 0, notes,
        demo: { modes: ['느리면 재시작', '멈추면 재시작'], run: RUN },
        frame: (ctx, w, h, time, say, ui) => {
          const M = map(w, 3, ROW), on = ui.runAt !== null, strict = ui.mode === 0, r = on ? Math.min(time - ui.runAt, END) : -1;
          const spike = r >= SPIKE[0] && r < SPIKE[1];
          const down = (j, at) => strict && at >= DOWN[j];
          const up = [0, 1, 2].filter((j) => !down(j, r));
          const lat = (j) => (down(j, r) ? null : !spike ? 0.2 : j === 0 ? 1.3 : strict && r >= DOWN[0] ? 1.6 : 0.9 - j * 0.1);
          const fails = (j) => (strict && spike ? clamp(Math.floor((r - CHECK[j]) / 0.5) + 1, 0, 3) : 0);
          const segs = on ? [[-100, 0.3], [SPIKE[0], 0.14], [SPIKE[1], 0.3]] : [[-100, 0.3]], now = on ? r : time;
          const qs = times(now - 2, now, segs);
          const pick = (q) => { const e = on ? [0, 1, 2].filter((j) => !down(j, q.s)) : [0, 1, 2]; return e.length ? e[q.j % e.length] : -1; };
          const fail = (j, at) => on && down(j, at);
          C.pill(ctx, 0, 0, strict ? 'timeoutSeconds 1, 느림도 실패' : '멈춤만 실패', strict ? 'warn' : 'ok');
          C.text(ctx, `서비스 중 ${up.length}/3`, w, 11, { size: 11, weight: 700, color: up.length < 3 ? U.tones.bad[1] : U.text, align: 'right', base: 'middle' });
          frameMap(ctx, M, 'Service', '파드');
          [0, 1, 2].forEach((j) => {
            const name = 'ABC'[j], dn = down(j, r), l = lat(j);
            endpoint(ctx, M, j, name, dn ? 'out' : 'on', dn ? ['빠짐', U.muted] : null);
            const slow = l !== null && l > 1, f = fails(j);
            const sub = dn ? '재시작 대기' : `응답 ${l.toFixed(1)}초${f && !dn ? `, 실패 ${f}/3` : ''}`;
            pod(ctx, M.card(j), `파드 ${name}`, dn ? '재시작' : slow ? '느림' : '정상', dn ? T.red : slow ? T.orange : T.green,
              { sub, fill: dn ? U.plot : '#fff', dash: dn ? [4, 3] : null, dim: dn });
          });
          flow(ctx, M, now, qs, pick, fail);
          const by = M.bottom + 16;
          if (!on) hint(ctx, w, by, RUN);
          else if (spike) C.text(ctx, '부하 3배', w / 2, by, { size: 11, weight: 700, color: T.orange[1], align: 'center', base: 'middle' });
          if (on) stampIf(ctx, w / 2, M.ry(1), strict ? '파드 3개 모두 재시작' : '느려졌다 회복', strict ? 'bad' : 'ok', (r - END + 0.6) / 0.4);
          say(`${strict ? '느리면 재시작' : '멈추면 재시작'}. 서비스 중인 파드 ${up.length}개. ${notes[ui.mode]}`);
        },
      });
    });

    // preStop, interactive: deleting pod A starts SIGTERM and endpoint removal together. Removal reaching kube-proxy at 2s is a rough value.
    each('prestop', (root) => {
      const ROW = 50, OUT = 2, END = 7, RUN = '파드 A 삭제';
      const MODES = [{ term: 0, down: 0.3 }, { term: 5, down: 5.3 }];
      const notes = ['preStop이 없으면 A는 삭제 직후 내려가는데, 규칙에서는 2초 뒤에 빠져 그 사이 A로 간 요청이 실패한다.', 'preStop에서 5초 기다리면 규칙에서 먼저 빠지고 그다음 SIGTERM이 온다. 기다리는 동안에도 A는 요청을 처리한다.'];
      hwa.scene(root, {
        height: 34 + 26 + 2 * ROW + 4 + 74, still: 0, notes,
        demo: { modes: ['preStop 없음', 'preStop sleep 5'], run: RUN },
        frame: (ctx, w, h, time, say, ui) => {
          const M = map(w, 2, ROW), on = ui.runAt !== null, m = MODES[ui.mode], r = on ? Math.min(time - ui.runAt, END) : -1, wide = w > 460;
          const now = on ? r : time, qs = times(now - 2, now, [[-100, 0.3]]);
          const inRule = (s) => !on || s < OUT;
          const pick = (q) => (inRule(q.s) ? q.j % 2 : 1), fail = (j, at) => on && j === 0 && at >= m.down;
          C.pill(ctx, 0, 0, ui.mode ? 'preStop sleep 5' : 'preStop 없음', ui.mode ? 'ok' : 'warn');
          if (on) C.text(ctx, `삭제 후 ${Math.max(0, r).toFixed(1)}초`, w, 11, { size: 11, weight: 700, color: U.text, align: 'right', base: 'middle' });
          frameMap(ctx, M, wide ? '노드의 kube-proxy 규칙' : 'kube-proxy', '파드');
          endpoint(ctx, M, 0, 'A', on && r >= OUT ? 'out' : 'on', on && r >= OUT ? ['빠짐', U.muted] : null);
          endpoint(ctx, M, 1, 'B', 'on');
          const st = !on ? ['서비스', T.green, null] : r < m.term ? ['preStop', T.orange, '요청 계속 처리'] : r < m.down ? ['SIGTERM', T.red, '종료 중'] : ['종료됨', T.gray, '프로세스 없음'];
          const gone = on && r >= m.down;
          pod(ctx, M.card(0), '파드 A', st[0], st[1], { sub: st[2], fill: gone ? U.plot : '#fff', dash: gone ? [4, 3] : null, dim: gone });
          pod(ctx, M.card(1), '파드 B', '서비스', T.green);
          flow(ctx, M, now, qs, pick, fail);
          // Mini time axis: when A stops against when it leaves the rules.
          const ax = 8, bx = w - 8, ay = M.bottom + 26, X = (v) => ax + (v / END) * (bx - ax);
          C.line(ctx, [[ax, ay], [bx, ay]], '#cbd5e1', 1);
          if (on) {
            const band = ui.mode ? [0, m.term, T.orange, 'preStop 5초'] : [m.down, OUT + LEG, T.red, '실패 구간'];
            const b1 = Math.min(r, band[1]);
            if (b1 > band[0]) {
              ctx.fillStyle = band[2][0]; ctx.fillRect(X(band[0]), ay - 9, X(b1) - X(band[0]), 9);
              if (r >= band[1]) C.text(ctx, band[3], (X(band[0]) + X(band[1])) / 2, ay - 14, { size: 9, weight: 700, color: band[2][1], align: 'center' });
            }
            const ev = ui.mode ? [[0, '삭제'], [OUT, '규칙에서 빠짐'], [m.term, 'SIGTERM']] : [[0, '삭제, SIGTERM'], [OUT, '규칙에서 빠짐']];
            ev.forEach(([v, label], j) => {
              if (r < v) return;
              C.line(ctx, [[X(v), ay - 4], [X(v), ay + 4]], label.includes('SIGTERM') ? U.red : U.slate, 1.5);
              const lw = tw(ctx, label, 9, 600), lx = clamp(X(v) - lw / 2, 0, w - lw);
              C.text(ctx, label, lx, ay + 15 + (j % 2) * 13, { size: 9, weight: 600, color: label.includes('SIGTERM') ? U.red : U.slate });
            });
            if (r < END) C.dashed(ctx, X(r), ay - 12, X(r), ay + 4, U.now);
            const n = failures(times(-2, END, [[-100, 0.3]]), END, pick, fail);
            stampIf(ctx, w / 2, M.ry(0) + ROW / 2, n ? `요청 ${n}건 실패` : '실패 0건', n ? 'bad' : 'ok', (r - END + 0.6) / 0.4);
          } else hint(ctx, w, ay + 18, RUN);
          say(`${ui.mode ? 'preStop sleep 5' : 'preStop 없음'}. ${notes[ui.mode]}`);
        },
      });
    });
  }

  // Group: nodes holding pods. Drain with and without a PDB, and spreading replicas.
  {
    const nodes = (ctx, w, y, h, list) => {
      const nw = (w - 16) / 3;
      return list.map((nd, i) => {
        const x = i * (nw + 8);
        C.box(ctx, x, y, nw, h, { fill: nd.dead ? '#fef2f2' : U.plot, stroke: nd.dead ? T.red[2] : U.grid, r: 10 });
        C.text(ctx, nd.name, x + 8, y + 15, { size: 10, weight: 600, color: nd.dead ? U.tones.bad[1] : U.text });
        if (nd.tag) tag(ctx, nd.tag[0], x + nw - 6, y + 13, nd.tag[1], { align: 'right', size: 9, h: 16 });
        return { slot: (s) => ({ x: x + 6, y: y + 24 + s * 38, w: nw - 12, h: 32 }) };
      });
    };
    const slotPod = (ctx, b, p) => {
      if (!p) return C.box(ctx, b.x, b.y, b.w, b.h, { fill: '#fff', dash: [3, 3], stroke: '#e2e8f0', r: 6 });
      const S = {
        ready: ['준비', T.green, {}], start: ['기동 중', T.orange, { fill: '#fffbeb', stroke: T.orange[2] }], stop: ['종료 중', T.gray, { fill: U.plot, dash: [4, 3], dim: true }],
        deny: ['거부됨', T.red, { stroke: T.red[2] }], dead: ['멈춤', T.red, { fill: U.plot, dash: [4, 3], dim: true }], other: ['', T.gray, { fill: U.plot, dim: true }],
      }[p.st];
      pod(ctx, b, p.name, S[0], S[1], S[2]);
    };

    // PDB: replicas 3 with A1 and A2 on node 1. Drain evicts both at once, or one at a time under minAvailable 2.
    each('pdb', (root) => {
      const NH = 24 + 2 * 38 + 4, END = 8.5, LEAD = 0.6, SEC = END + LEAD, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
      // [evict, gone] per old pod, [made, ready] per replacement. Startup takes 3.4 s, a rough value.
      const MODES = [{ a2: [0.3, 1.3], r2: [0.6, 4.0] }, { a2: [4.3, 5.3], r2: [4.6, 8.0] }];
      const notes = ['PDB가 없으면 A1과 A2가 같이 내려가, 새 파드가 준비될 때까지 1개로 버틴다.', 'minAvailable 2면 A2의 eviction이 거부되고, A1의 대체 파드가 준비된 뒤에 A2가 내려간다.'];
      const state = (m, r, [a, b]) => (r < a ? 'ready' : r < b ? 'stop' : null), born = (r, [a, b]) => (r < a ? null : r < b ? 'start' : 'ready');
      const readyN = (m, r) => [state(m, r, [0.3, 1.3]), state(m, r, m.a2), 'ready', born(r, [0.6, 4.0]), born(r, m.r2)].filter((s) => s === 'ready').length;
      hwa.scene(root, {
        height: 34 + NH + 128, still: S.at(1) + SEC, scenes: S, notes,
        frame: (ctx, w, h, time, say) => {
          const { i, t } = hwa.loop(time, SEC, HOLD, 2), r = t - LEAD, on = r >= 0, m = MODES[i], n = readyN(m, r);
          C.pill(ctx, 0, 0, `준비된 파드 ${n}/3`, n === 3 ? 'ok' : n === 2 ? 'warn' : 'bad');
          if (i) C.text(ctx, 'minAvailable 2', w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
          const N = nodes(ctx, w, 34, NH, [{ name: '노드 1', tag: on && r >= 0.2 ? ['drain', T.orange] : null }, { name: '노드 2' }, { name: '노드 3' }]);
          const a1 = state(m, r, [0.3, 1.3]), a2 = state(m, r, m.a2), blocked = i && r >= 0.3 && r < m.a2[0];
          slotPod(ctx, N[0].slot(0), a1 && { name: 'A1', st: a1 });
          slotPod(ctx, N[0].slot(1), a2 && { name: 'A2', st: blocked ? 'deny' : a2 });
          slotPod(ctx, N[1].slot(0), { name: 'A3', st: 'ready' });
          slotPod(ctx, N[1].slot(1), null);
          const b1 = born(r, [0.6, 4.0]), b2 = born(r, m.r2);
          slotPod(ctx, N[2].slot(0), b1 && { name: 'A1\'', st: b1 });
          slotPod(ctx, N[2].slot(1), b2 && { name: 'A2\'', st: b2 });
          // Ready count over time, with the minAvailable line.
          const gy = 34 + NH + 34, gh = 64, x0 = 22, x1 = w - 4, X = (v) => x0 + (v / END) * (x1 - x0);
          const Y = C.panel(ctx, x0, gy, x1 - x0, gh, { title: '준비된 파드 수', max: 3, ticks: [[0, '0'], [1, '1'], [2, '2'], [3, '3']] });
          C.dashed(ctx, x0, Y(2), x1, Y(2), i ? U.tones.ok[1] : '#cbd5e1');
          {
            const pts = [];
            for (let v = 0; v <= r + 1e-6; v += 0.05) pts.push([X(v), Y(readyN(m, v))]);
            C.line(ctx, pts, U.blue, 2);
            const lo = pts.length ? pts[pts.length - 1] : [X(0), Y(3)];
            C.dot(ctx, lo[0], lo[1], n < 2 ? U.red : U.blue);
            stampIf(ctx, (x0 + x1) / 2, gy + gh / 2, i ? '2개 아래로 안 내려감' : '1개까지 줄어듦', i ? 'ok' : 'bad', (r - END + 0.6) / 0.4);
          }
          C.text(ctx, '시간', x1, gy + gh + 14, { size: 10, align: 'right' });
          say(`${i ? 'PDB minAvailable 2' : 'PDB 없음'}. 준비된 파드 ${n}개. ${notes[i]}`);
        },
      });
    });

    // Spread: replicas 3 packed on node 1 against one per node, then node 1 stops.
    each('spread', (root) => {
      const SEC = 6, HOLD = 2, FAIL = 2.6, NH = 24 + 3 * 38 + 2, S = hwa.loopScenes(SEC, HOLD, 2);
      const PLACE = [[['A1', 'A2', 'A3'], ['B1'], ['B2']], [['A1'], ['A2', 'B1'], ['A3', 'B2']]];
      const notes = ['분산 규칙이 없으면 세 파드가 노드 1에 몰릴 수 있고, 노드 1이 멈추면 하나도 남지 않는다.', 'topology spread로 노드마다 하나씩 두면 노드 1이 멈춰도 둘이 남는다.'];
      hwa.scene(root, {
        height: 34 + NH + 6, still: S.at(1) + SEC, scenes: S, notes,
        frame: (ctx, w, h, time, say) => {
          const { i, t } = hwa.loop(time, SEC, HOLD, 2), run = (time % (2 * (SEC + HOLD))) - S.at(i), dead = t >= FAIL;
          const left = PLACE[i].slice(1).flat().filter((p) => p[0] === 'A').length, n = dead ? left : 3;
          C.pill(ctx, 0, 0, i ? 'maxSkew 1, 노드 기준' : '분산 규칙 없음', i ? 'ok' : 'warn');
          C.text(ctx, `남은 파드 ${n}/3`, w, 11, { size: 11, weight: 700, color: n === 0 ? U.tones.bad[1] : U.text, align: 'right', base: 'middle' });
          const N = nodes(ctx, w, 34, NH, [{ name: '노드 1', dead, tag: dead ? ['장애', T.red] : null }, { name: '노드 2' }, { name: '노드 3' }]);
          PLACE[i].forEach((list, ni) => [0, 1, 2].forEach((s) => {
            const p = list[s];
            slotPod(ctx, N[ni].slot(s), p && { name: p, st: p[0] === 'B' ? 'other' : ni === 0 && dead ? 'dead' : 'ready' });
          }));
          stampIf(ctx, w / 2, 34 + NH / 2 + 8, i ? '2개가 남음' : '하나도 안 남음', i ? 'ok' : 'bad', (run - SEC + 0.8) / 0.4);
          say(`${i ? 'topology spread' : '규칙 없음'}. 노드 1 ${dead ? '장애' : '정상'}, 남은 파드 ${n}개. ${notes[i]}`);
        },
      });
    });
  }

  // Rolling update with replicas 4: default 25% surge and unavailability against maxUnavailable 0. One pod per step, simplified.
  each('rolling', (root) => {
    const SEC = 7.5, HOLD = 2, D = 1.2, STEP = 1.6, SPAN = 0.4 + 4 * STEP, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = ['기본값(maxSurge 25%, maxUnavailable 25%)은 새 파드를 띄우면서 옛 파드도 내려, 준비된 파드가 3개까지 준다.', 'maxUnavailable 0이면 새 파드가 준비된 뒤에 옛 파드를 내려, 4개를 유지한다.'];
    const at = (i, k) => 0.4 + k * STEP + (i ? D : 0);
    const oldSt = (i, k, t) => (t < at(i, k) ? 'ready' : t < at(i, k) + 0.5 ? 'stop' : null);
    const newSt = (k, t) => (t < 0.4 + k * STEP ? null : t < 0.4 + k * STEP + D ? 'start' : 'ready');
    const readyN = (i, t) => [0, 1, 2, 3].reduce((a, k) => a + (oldSt(i, k, t) === 'ready') + (newSt(k, t) === 'ready'), 0);
    hwa.scene(root, {
      height: 246, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 2), t = k * SPAN, run = (time % (2 * (SEC + HOLD))) - S.at(i), n = readyN(i, t);
        C.pill(ctx, 0, 0, i ? 'maxSurge 1, maxUnavailable 0' : '기본값 25%, 25%', i ? 'ok' : 'warn');
        C.text(ctx, `준비 ${n}/4`, w, 11, { size: 11, weight: 700, color: n < 4 ? U.tones.bad[1] : U.text, align: 'right', base: 'middle' });
        const lw = Math.min(70, w * 0.2), sw = (w - lw - 18) / 4, rows = [['옛 버전', 40], ['새 버전', 80]];
        rows.forEach(([name, y]) => C.text(ctx, name, 0, y + 15, { size: 10, weight: 600, color: U.text, base: 'middle' }));
        [0, 1, 2, 3].forEach((q) => {
          const x = lw + q * (sw + 6);
          [[oldSt(i, q, t), 'v1', 40], [newSt(q, t), 'v2', 80]].forEach(([st, v, y]) => {
            if (!st) return C.box(ctx, x, y, sw, 30, { fill: '#fff', dash: [3, 3], stroke: '#e2e8f0', r: 6 });
            const col = st === 'start' ? T.orange : st === 'stop' ? T.gray : v === 'v2' ? T.blue : T.white;
            C.box(ctx, x, y, sw, 30, { fill: col[0], stroke: col[2], dash: st === 'stop' ? [4, 3] : null, r: 6 });
            C.text(ctx, st === 'start' ? '기동' : st === 'stop' ? '종료' : v, x + sw / 2, y + 15.5, { size: 11, weight: 700, color: col[1], align: 'center', base: 'middle' });
          });
        });
        const x0 = 22, x1 = w - 4, gy = 140, gh = 76, X = (v) => x0 + (v / SPAN) * (x1 - x0);
        const Y = C.panel(ctx, x0, gy, x1 - x0, gh, { title: '준비된 파드 수', max: 5, ticks: [[0, '0'], [3, '3'], [4, '4'], [5, '5']] });
        C.dashed(ctx, x0, Y(4), x1, Y(4), U.slate);
        const pts = [];
        for (let v = 0; v <= t + 1e-6; v += 0.02) pts.push([X(v), Y(readyN(i, v))]);
        C.area(ctx, pts.map(([x, y]) => [x, Math.max(y, Y(4))]), Y(4), 'rgba(239,68,68,0.14)');
        C.line(ctx, pts, U.blue, 2);
        if (pts.length) C.dot(ctx, ...pts[pts.length - 1], n < 4 ? U.red : U.blue);
        C.text(ctx, '시간', x1, gy + gh + 14, { size: 10, align: 'right' });
        stampIf(ctx, (x0 + x1) / 2, gy + gh / 2, i ? '4개 유지' : '3개로 버티는 구간', i ? 'ok' : 'bad', (run - SEC) / 0.4);
        say(`${i ? 'maxUnavailable 0' : '기본값'}. 준비된 파드 ${n}개. ${notes[i]}`);
      },
    });
  });
})();
