// Prometheus post figures: scrape, probes, metric types, alerting, Thanos.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'], RED = ['#fee2e2', '#dc2626', '#fca5a5'];
  const GREEN = ['#dcfce7', '#15803d', '#86efac'], PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], MUTE = [U.cell, U.muted, '#e2e8f0'];
  const LINE = '#e2e8f0';
  const each = (id, fn) => document.querySelectorAll(`[data-figure="${id}"]`).forEach(fn);
  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  // Chip centred at (cx, cy). col = [bg, fg, line].
  const tag = (ctx, s, cx, cy, col, a = 1, size = 10) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, size, 600) + 12;
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
  // Chip riding a polyline while 0 < k < 1.
  const ride = (ctx, s, pts, k, col, size) => { if (k > 0 && k < 1) { const p = C.pathAt(pts, k).pop(); tag(ctx, s, p[0], p[1], col, 1, size); } };
  const dot = (ctx, x, y, r, fill) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  const hint = (ctx, run, cx, cy) => C.text(ctx, `${run} 버튼을 눌러 보자`, cx, cy, { size: 12, align: 'center', base: 'middle' });
  const cursor = (ctx, x, y0, y1) => C.dashed(ctx, x, y0, x, y1, U.now);

  // Scrape: every 15 s Prometheus sends GET /metrics to three targets and writes one sample per series.
  each('prometheus-scrape', (root) => {
    const SEC = 6.5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2), ROWS = [92, 152, 212];
    const T = [['app', ':8000'], ['node_exporter', ':9100'], ['windows_exporter', ':9182']];
    const notes = [
      '15초마다 세 대상에 GET /metrics를 보내고, 받은 값을 시각과 함께 TSDB에 한 칸씩 적는다.',
      '가운데 대상이 응답하지 않으면 값 대신 up 0이 적힌다. 대상이 죽은 것도 Prometheus가 먼저 안다.',
    ];
    hwa.scene(root, {
      height: 256, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), down = i === 1, narrow = w < 420;
        C.pill(ctx, 0, 0, down ? 'node_exporter 응답 없음' : '15초마다 수집', down ? 'bad' : 'info');
        const cw = Math.min(150, Math.round(w * 0.36)), gx = cw + Math.max(34, Math.round(w * 0.1));
        C.group(ctx, gx, 34, w - gx, 214, 'Prometheus', 52);
        const sec = Math.min(15, Math.floor((t / SEC) * 15));
        C.text(ctx, narrow ? `${sec}초` : `수집 후 ${sec}초 / 15초`, w - 10, 52, { size: 10, align: 'right' });
        C.box(ctx, gx + 8, 62, w - gx - 16, 178, { fill: '#fff' });
        C.text(ctx, 'TSDB', gx + 16, 76, { size: 9, weight: 600 });
        const rx = w - 58, lx = narrow ? gx + 24 : gx + 110, n = Math.max(3, Math.min(20, Math.floor((rx - lx) / 14) + 1)), slot = (j) => rx - (n - 1 - j) * 14;
        ROWS.forEach((y, r) => {
          const off = down && r === 1, sent = 0.6 + r * 0.25, got = 3.4 + r * 0.25;
          C.line(ctx, [[cw, y], [gx + 8, y]], LINE, 1);
          const lit = t > sent + 1.1 && t < got - 0.6 && !off;
          C.card(ctx, { x: 0, y: y - 23, w: cw, h: 46, t: T[r][0], s: `${T[r][1]}/metrics`, size: narrow ? 10 : 12 },
            off && t > sent + 1.1 ? { fill: RED[0], stroke: U.red, dash: [4, 3] } : { lit });
          if (!narrow) C.text(ctx, `job="${T[r][0].split('_')[0]}"`, gx + 18, y, { size: 10, base: 'middle' });
          for (let j = 0; j < n - 1; j++) dot(ctx, slot(j), y, 4, BLUE[2]);
          if (t >= got) dot(ctx, slot(n - 1), y, 5, off ? U.red : U.blue);
          else { ctx.beginPath(); ctx.arc(slot(n - 1), y, 4, 0, Math.PI * 2); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.stroke(); }
          const last = t >= got ? (off ? 0 : 1) : 1;
          C.text(ctx, `up ${last}`, rx + 12, y, { size: 10, weight: 600, color: last ? U.tones.ok[1] : U.red, base: 'middle' });
          ride(ctx, 'GET', [[gx + 4, y - 9], [cw + 16, y - 9]], ease(t, sent, sent + 1.1), MUTE, 9);
          if (!off) ride(ctx, '200', [[cw + 16, y + 9], [slot(n - 1), y + 9]], ease(t, sent + 1.7, got), GREEN, 9);
          else if (t > sent + 1.2 && t < got) C.text(ctx, '응답 없음', cw + 6, y + 14, { size: 9, weight: 600, color: U.red });
        });
        if (down) C.stamp(ctx, gx + (w - gx) / 2, 122, 'up 0 기록', 'bad', (t - 4) / 0.4);
        say(`${notes[i]} 지금 수집 후 ${sec}초.`);
      },
    });
  });

  // Demo: the same 9 s burst between two scrapes, exported as a gauge of the last second or as a counter read with rate.
  each('prometheus-gauge-counter', (root) => {
    const SEC = 7, SPAN = 60, DT = 0.25, B0 = 18, B1 = 27, SCR = [0, 15, 30, 45, 60];
    const rps = (s) => 10 + 3 * Math.sin(s * 0.9) + 2 * Math.sin(s * 2.3 + 1) + 90 * clamp((s - B0) / 0.6) * clamp((B1 - s) / 0.6);
    const cum = [0];
    for (let j = 1; j <= SPAN / DT; j++) cum.push(cum[j - 1] + rps((j - 0.5) * DT) * DT);
    const at = (s) => cum[Math.round(s / DT)];
    const VAL = [SCR.map((s) => rps(s)), SCR.map((s) => (s ? (at(s) - at(s - 15)) / 15 : rps(0)))];
    const peak = Math.round(VAL[1][2]);
    const demo = { modes: ['Gauge로 내보내기', 'Counter로 내보내기'], run: '요청 몰리게 하기' };
    const notes = [
      'Gauge는 수집하는 순간의 값만 남는다. 15초와 30초 사이의 몰림은 그래프에 없다.',
      `Counter는 두 수집 사이에 늘어난 양이 남아, 30초 값이 초당 ${peak}건으로 솟는다.`,
    ];
    const STAMP = [['몰림이 안 남음', 'bad'], [`30초에 초당 ${peak}건으로 잡힘`, 'ok']];
    hwa.scene(root, {
      height: 304, still: SEC + 1, notes, demo: demo,
      frame: (ctx, w, h, time, say, ui) => {
        const m = ui.mode, run = ui.runAt === null ? -1 : time - ui.runAt, s = clamp(run / SEC) * SPAN;
        C.pill(ctx, 0, 0, m ? 'Counter와 rate' : 'Gauge', 'info');
        C.text(ctx, '15초마다 수집', w, 11, { size: 10, align: 'right', base: 'middle' });
        const x0 = 30, x1 = w - 8, X = (v) => x0 + (v / SPAN) * (x1 - x0), P1 = 52, P2 = 168, PH = 78;
        const ticks = [[0, '0'], [50, '50'], [100, '100']];
        const Y1 = C.panel(ctx, x0, P1, x1 - x0, PH, { title: '실제 초당 요청', max: 110, ticks });
        const Y2 = C.panel(ctx, x0, P2, x1 - x0, PH, { title: m ? 'Prometheus에 남은 값 (rate)' : 'Prometheus에 남은 값 (Gauge)', max: 110, ticks });
        SCR.forEach((v) => {
          C.dashed(ctx, X(v), P1, X(v), P2 + PH, run >= 0 && v <= s ? '#94a3b8' : LINE);
          C.text(ctx, `${v}초`, X(v), P2 + PH + 14, { size: 10, align: v ? (v === SPAN ? 'right' : 'center') : 'left' });
        });
        if (run < 0) { hint(ctx, demo.run, (x0 + x1) / 2, P1 + PH / 2); say('요청 몰리게 하기 버튼을 누르면 60초 동안의 요청과 수집 결과를 보여 준다.'); return; }
        if (m) {
          SCR.slice(1).forEach((b, j) => {
            const a = SCR[j], e = Math.min(b, s);
            if (e <= a) return;
            const top = [];
            for (let v = a; v <= e + 1e-9; v += DT) top.push([X(v), Y1(rps(v))]);
            C.area(ctx, top, Y1(0), j % 2 ? 'rgba(59,130,246,0.10)' : 'rgba(59,130,246,0.20)');
          });
        }
        const pts = [];
        for (let v = 0; v <= s + 1e-9; v += DT) pts.push([X(v), Y1(rps(v))]);
        C.line(ctx, pts, U.slate, 1.6);
        if (s >= B1) C.text(ctx, '몰림', X((B0 + B1) / 2), Y1(100) - 4, { size: 10, weight: 600, color: U.red, align: 'center' });
        const got = SCR.map((v, j) => [v, VAL[m][j]]).filter(([v]) => v <= s);
        if (!m) got.forEach(([v, val]) => dot(ctx, X(v), Y1(val), 4, U.blue));
        C.line(ctx, got.map(([v, val]) => [X(v), Y2(val)]), U.blue, 2);
        got.forEach(([v, val]) => {
          dot(ctx, X(v), Y2(val), 4, U.blue);
          C.text(ctx, `${Math.round(val)}`, X(v) + (v === SPAN ? -6 : 6), Y2(val) - 8, { size: 10, weight: 600, color: U.blue, align: v === SPAN ? 'right' : 'left' });
        });
        if (run < SEC) cursor(ctx, X(s), P1, P2 + PH);
        else C.stamp(ctx, (x0 + x1) / 2, P2 + PH + 38, STAMP[m][0], STAMP[m][1], (run - SEC) / 0.4);
        say(`${m ? 'Counter와 rate' : 'Gauge'}, ${Math.round(s)}초. ${notes[m]}`);
      },
    });
  });

  // Histogram: requests fill cumulative le buckets; then the axis zooms to 900..1000 and the 990th request marks p99.
  each('prometheus-histogram', (root) => {
    const S = seq([6.5, 6], 2), LE = ['0.1', '0.25', '0.5', '1', '+Inf'], EDGE = [0.1, 0.25, 0.5, 1, Infinity];
    // Data: made-up 1,000 requests; sum 118.5 s gives the 0.12 s average in the post.
    const CUM = [700, 900, 970, 995, 1000], DROPS = [0.07, 0.31, 0.05, 0.12, 0.08, 0.62, 0.04, 0.2, 0.09, 1.4, 0.06, 0.18];
    const notes = [
      '요청은 자기 시간 이상인 버킷을 모두 올린다. 0.31초 요청은 0.5, 1, +Inf 버킷을 하나씩 올린다.',
      '세로축을 900~1000으로 늘리면 990번째 요청이 0.5초와 1초 버킷 사이에 있다. 그 사이를 고르게 나눠 p99는 0.9초다.',
    ];
    hwa.scene(root, {
      height: 276, still: S.at(1) + 6 + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = S.pos(time), n = i ? 1000 : Math.round(1000 * ease(t, 0.3, 6));
        C.pill(ctx, 0, 0, i ? 'p99 계산' : '요청 1,000건 세기', 'info');
        C.text(ctx, i ? '평균 0.12초' : `요청 ${n.toLocaleString('en-US')}건`, w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        const z = i ? ease(t, 0.3, 1.6) : 0, lo = 900 * z, x0 = 40, x1 = w - 8, y0 = 48, ph = 170;
        const Y = (v) => y0 + ph - clamp((v - lo) / (1000 - lo)) * ph;
        ctx.fillStyle = U.plot;
        ctx.fillRect(x0, y0, x1 - x0, ph);
        (z < 0.5 ? [0, 500, 1000] : [900, 950, 1000]).forEach((v) => {
          const yy = Math.round(Y(v)) + 0.5;
          C.line(ctx, [[x0, yy], [x1, yy]], LINE, 1);
          C.text(ctx, `${v}`, x0 - 6, yy, { size: 10, align: 'right', base: 'middle' });
        });
        const cw = (x1 - x0) / 5, bw = Math.min(46, cw * 0.62), cx = (j) => x0 + cw * (j + 0.5);
        const flash = new Set();
        if (!i) DROPS.forEach((v, d) => { const st = 0.3 + d * 0.45, b = EDGE.findIndex((e) => v <= e); if (t > st + 0.5 && t < st + 0.85) for (let j = b; j < 5; j++) flash.add(j); });
        CUM.forEach((c, j) => {
          const v = (c * n) / 1000, top = Y(v), hot = i && (j === 2 || j === 3) && t > 2.4;
          ctx.beginPath();
          ctx.roundRect(cx(j) - bw / 2, top, bw, y0 + ph - top, [4, 4, 0, 0]);
          ctx.fillStyle = hot ? ORANGE[2] : BLUE[2];
          ctx.fill();
          if (flash.has(j) || hot) { ctx.strokeStyle = hot ? ORANGE[1] : U.accent; ctx.lineWidth = 1.5; ctx.stroke(); }
          C.text(ctx, `${Math.round(v)}`, cx(j), Math.max(top - 5, y0 + 11), { size: 10, weight: 600, color: U.text, align: 'center' });
          C.text(ctx, LE[j], cx(j), y0 + ph + 14, { size: 10, align: 'center' });
        });
        C.text(ctx, 'le (초 이하, 누적)', x1, y0 + ph + 30, { size: 10, align: 'right' });
        if (!i) DROPS.forEach((v, d) => {
          const st = 0.3 + d * 0.45, k = ease(t, st, st + 0.5), b = EDGE.findIndex((e) => v <= e);
          if (k > 0 && k < 1) tag(ctx, `${v}초`, cx(b), y0 + 12 + k * (Y((CUM[b] * n) / 1000) - y0 - 24), MUTE, 1, 9);
        });
        if (i && t > 1.6) {
          const yy = Y(990);
          C.dashed(ctx, x0, yy, x1, yy, U.red);
          C.text(ctx, '990번째 (99%)', x0 + 4, yy - 5, { size: 10, weight: 600, color: U.red });
          C.stamp(ctx, (cx(0) + cx(1)) / 2 + 8, y0 + ph * 0.62, 'p99 ≈ 0.9초', 'bad', (t - 3.2) / 0.4);
        }
        say(i ? `세로축 ${Math.round(lo)}~1000. ${notes[1]}` : `요청 ${n}건. ${notes[0]}`);
      },
    });
  });

  // blackbox: Prometheus asks the exporter to probe the public URL; inside, it also scrapes the app directly.
  each('prometheus-blackbox', (root) => {
    const SEC = 7, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = [
      '프로브가 Ingress를 지나 앱까지 가서 200을 받아 오면 probe_success는 1이다. 안쪽 스크레이프의 up도 1이다.',
      '인증서가 만료되면 프로브는 TLS 연결에서 실패해 probe_success가 0이 된다. 앱은 멀쩡해서 up은 그대로 1이다.',
    ];
    hwa.scene(root, {
      height: 262, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), bad = i === 1, narrow = w < 420;
        C.pill(ctx, 0, 0, bad ? '인증서 만료' : '정상', bad ? 'bad' : 'ok');
        const sw = Math.round(w * 0.28), pw = Math.max(70, Math.round(w * 0.2)), px = w - pw, bw = Math.max(72, Math.round(w * 0.2)), bx = Math.round((sw + px - bw) / 2);
        const sz = narrow ? 10 : 12, mx = sw / 2;
        C.group(ctx, 0, 32, sw, 186, '서비스', 50);
        const ingBad = bad && t > 1.9;
        C.card(ctx, { x: 8, y: 60, w: sw - 16, h: 46, t: 'Ingress', s: bad ? '인증서 만료' : '인증서', size: sz }, ingBad ? { fill: RED[0], stroke: U.red } : { lit: !bad && t > 1.9 && t < 3.4 });
        C.card(ctx, { x: 8, y: 150, w: sw - 16, h: 46, t: '앱', s: 'Running', size: sz }, { lit: (!bad && t > 2.5 && t < 3.0) || (t > 1.4 && t < 1.8) });
        C.card(ctx, { x: bx, y: 60, w: bw, h: 46, t: 'blackbox', s: ':9115', size: sz }, { lit: t > 1.1 && t < 1.4 });
        C.card(ctx, { x: px, y: 60, w: pw, h: 136, t: 'Prometheus', size: narrow ? 10 : 12 });
        [[[px, 76], [bx + bw, 76]], [[bx, 76], [sw - 8, 76]], [[mx, 106], [mx, 150]], [[px, 173], [sw - 8, 173]]].forEach((p) => C.line(ctx, p, LINE, 1));
        ride(ctx, '/probe', [[px, 76], [bx + bw, 76]], ease(t, 0.3, 1.1), MUTE, 9);
        ride(ctx, 'https', [[bx, 76], [sw - 8, 76]], ease(t, 1.2, 2.0), MUTE, 9);
        if (!bad) {
          ride(ctx, 'GET', [[mx - 10, 106], [mx - 10, 150]], ease(t, 2.0, 2.5), MUTE, 9);
          ride(ctx, '200', [[mx + 10, 150], [mx + 10, 106]], ease(t, 2.6, 3.1), GREEN, 9);
          ride(ctx, '200', [[sw - 8, 92], [bx, 92]], ease(t, 3.2, 4.0), GREEN, 9);
          ride(ctx, '1', [[bx + bw, 92], [px, 92]], ease(t, 4.1, 4.9), GREEN, 10);
        } else {
          ride(ctx, 'TLS 실패', [[sw - 8, 92], [bx, 92]], ease(t, 2.1, 2.9), RED, 9);
          ride(ctx, '0', [[bx + bw, 92], [px, 92]], ease(t, 3.0, 3.8), RED, 10);
        }
        ride(ctx, 'GET', [[px, 166], [sw - 8, 166]], ease(t, 0.5, 1.4), MUTE, 9);
        ride(ctx, 'up 1', [[sw - 8, 182], [px, 182]], ease(t, 1.8, 2.8), GREEN, 9);
        const upNew = t >= 2.8, prNew = t >= (bad ? 3.8 : 4.9), pv = bad && prNew ? 0 : 1;
        const ry = 240, lx = w * 0.28, lr = w * 0.68;
        C.text(ctx, '안에서', lx, ry - 16, { size: 9, align: 'center' });
        C.text(ctx, '밖에서', lr, ry - 16, { size: 9, align: 'center' });
        tag(ctx, 'up 1', lx, ry, upNew ? GREEN : MUTE, 1, 10);
        tag(ctx, `probe_success ${pv}`, lr, ry, prNew ? (pv ? GREEN : RED) : MUTE, 1, 10);
        if (bad) C.stamp(ctx, bx + bw / 2, 132, narrow ? '밖은 0' : '안은 1, 밖은 0', 'bad', (t - 4.2) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Demo: the same error-rate curve, alerted with no for and with for 5m. One rule evaluation per minute.
  each('prometheus-for', (root) => {
    const SEC = 8, SPAN = 30, TH = 5;
    const bump = (m, a, b) => clamp((m - a) / 0.3) * clamp((b - m) / 0.3);
    const err = (m) => 1.3 + 0.4 * Math.sin(m * 1.3) + 7.6 * bump(m, 4.5, 6.5) + 10.4 * bump(m, 13.5, 23.5);
    const evalFor = (need) => {
      const st = [], msg = [];
      let since = -1, prev = 0;
      for (let k = 0; k < SPAN; k++) {
        const on = err(k) > TH;
        since = on ? (since < 0 ? k : since) : -1;
        const s = on ? (k - since >= need ? 2 : 1) : 0;
        if (s === 2 && prev !== 2) msg.push([k, 1]);
        if (s !== 2 && prev === 2) msg.push([k, 0]);
        st.push(s);
        prev = s;
      }
      return { st, msg };
    };
    const R = [evalFor(0), evalFor(5)];
    const demo = { modes: ['for 없음', 'for 5m'], run: '30분 재생하기' };
    const notes = [
      'for가 없으면 2분짜리 튐에도 발생과 해소 알림이 오고, 장애는 14분에 바로 알린다.',
      'for 5m이면 튐은 pending에서 끝나 조용하고, 장애는 5분 늦은 19분에 알린다.',
    ];
    const STAMP = [['알림 4건, 2건은 잡음', 'bad'], ['알림 2건, 5분 늦게', 'ok']];
    const COL = ['', '#fbbf24', U.red];
    hwa.scene(root, {
      height: 264, still: SEC + 1, notes, demo: demo,
      frame: (ctx, w, h, time, say, ui) => {
        const m = ui.mode, run = ui.runAt === null ? -1 : time - ui.runAt, s = clamp(run / SEC) * SPAN, r = R[m];
        const sent = run < 0 ? 0 : r.msg.filter(([k]) => k <= s).length;
        C.pill(ctx, 0, 0, demo.modes[m], 'info');
        C.text(ctx, `Slack 알림 ${sent}건`, w, 11, { size: 10, weight: 600, color: sent ? U.text : U.muted, align: 'right', base: 'middle' });
        const x0 = 40, x1 = w - 8, X = (v) => x0 + (v / SPAN) * (x1 - x0), P = 46, PH = 92, SY = 158, MY = 194;
        const Y = C.panel(ctx, x0, P, x1 - x0, PH, { title: '오류율', max: 15, ticks: [[0, '0%'], [5, '5%'], [10, '10%'], [15, '15%']] });
        C.dashed(ctx, x0, Y(TH), x1, Y(TH), U.red);
        C.text(ctx, '기준 5%', x1 - 4, Y(TH) - 5, { size: 9, weight: 600, color: U.red, align: 'right' });
        C.text(ctx, '상태', 0, SY + 9, { size: 10, weight: 600, color: U.text, base: 'middle' });
        C.text(ctx, 'Slack', 0, MY + 9, { size: 10, weight: 600, color: U.text, base: 'middle' });
        C.box(ctx, x0, SY, x1 - x0, 18, { fill: U.cell, stroke: U.cell, r: 4 });
        C.box(ctx, x0, MY, x1 - x0, 18, { fill: U.plot, r: 4 });
        [0, 10, 20, 30].forEach((v) => C.text(ctx, `${v}분`, X(v), MY + 32, { size: 10, align: v ? (v === SPAN ? 'right' : 'center') : 'left' }));
        C.legend(ctx, x0, MY + 52, [['pending', COL[1]], ['firing, 발생 알림', COL[2]], ['해소 알림', '#16a34a']]);
        if (run < 0) { hint(ctx, demo.run, (x0 + x1) / 2, P + PH / 2); say('30분 재생하기 버튼을 누르면 오류율과 알림 상태를 보여 준다.'); return; }
        const pts = [];
        for (let v = 0; v <= s + 1e-9; v += 0.1) pts.push([X(v), Y(err(v))]);
        C.line(ctx, pts, U.blue, 2);
        r.st.forEach((st, k) => {
          if (!st || k > s) return;
          const a = X(k), b = X(Math.min(k + 1, s));
          ctx.fillStyle = COL[st];
          ctx.fillRect(a, SY + 2, Math.max(0, b - a), 14);
        });
        r.msg.forEach(([k, fire]) => { if (k <= s) dot(ctx, X(k), MY + 9, 5.5, fire ? U.red : '#16a34a'); });
        if (s >= 6.5) C.text(ctx, '튐', X(5.5), Y(10) - 4, { size: 10, weight: 600, color: U.muted, align: 'center' });
        if (s >= 16) C.text(ctx, '장애', X(18.5), Y(13) - 4, { size: 10, weight: 600, color: U.red, align: 'center' });
        if (run < SEC) cursor(ctx, X(s), P, MY + 18);
        else C.stamp(ctx, (x0 + x1) / 2, P + PH * 0.42, STAMP[m][0], STAMP[m][1], (run - SEC) / 0.4);
        say(`${demo.modes[m]}, ${Math.floor(s)}분, Slack 알림 ${sent}건. ${notes[m]}`);
      },
    });
  });

  // Alertmanager: eight HostDown alerts become one message; a cert alert is routed to its own channel.
  each('prometheus-alertmanager', (root) => {
    const S = seq([6.6, 6], 1.8);
    const notes = [
      '노드 8대의 HostDown이 group_wait 30초 동안 한 묶음으로 모였다가 메시지 하나로 나간다.',
      '인증서 알림은 경로 규칙에 걸려 #cert로 가고, 해결될 때까지 168시간마다 다시 보낸다.',
    ];
    hwa.scene(root, {
      height: 252, still: S.at(1) + 6 + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = S.pos(time), narrow = w < 460;
        C.pill(ctx, 0, 0, i ? '경로 고르기' : '묶기', 'info');
        const pw = narrow ? 70 : 104, ch = narrow ? 70 : 104, cx0 = w - ch, ax = pw + 22, aw = cx0 - 22 - ax;
        C.card(ctx, { x: 0, y: 60, w: pw, h: 150, t: 'Prometheus', size: narrow ? 10 : 12 });
        C.group(ctx, ax, 34, aw, 196, 'Alertmanager', 52);
        const B = [{ y: 62, label: 'HostDown 묶음' }, { y: 156, label: 'Cert 묶음' }];
        B.forEach((b, j) => {
          C.box(ctx, ax + 8, b.y, aw - 16, 50, { fill: '#fff', on: j === i });
          C.text(ctx, b.label, ax + 16, b.y + 13, { size: 9, weight: 600 });
          C.line(ctx, [[pw, b.y + 25], [ax + 8, b.y + 25]], LINE, 1);
          C.line(ctx, [[ax + aw - 8, b.y + 25], [cx0, b.y + 25]], LINE, 1);
        });
        const route = narrow ? 'route: Cert' : 'route: alertname=~"Cert.*"';
        C.text(ctx, route, ax + aw / 2, 134, { size: 9, weight: 600, color: i && t > 0.4 ? U.accent : U.muted, align: 'center', base: 'middle' });
        const sp = Math.min(14, (aw - 40) / 8), sx = (j) => ax + 20 + j * sp, sy = 87;
        for (let j = 0; j < 8; j++) {
          const st = 0.4 + j * 0.22, k = i ? 1 : ease(t, st, st + 0.7);
          if (k >= 1) dot(ctx, sx(j), sy, 4.5, i ? RED[2] : U.red);
          else if (k > 0) { const p = C.pathAt([[pw, 87], [sx(j), sy]], k).pop(); dot(ctx, p[0], p[1], 4.5, U.red); }
        }
        const bar = (y, k) => {
          const bx0 = ax + 16, bx1 = ax + aw - 16;
          ctx.fillStyle = U.cell;
          ctx.fillRect(bx0, y, bx1 - bx0, 4);
          ctx.fillStyle = ORANGE[2];
          ctx.fillRect(bx0, y, (bx1 - bx0) * k, 4);
          if (k > 0 && k < 1) C.text(ctx, 'group_wait 30s', bx1, y - 4, { size: 9, color: ORANGE[1], align: 'right' });
        };
        bar(100, i ? 1 : ease(t, 0.6, 4.0));
        if (i) {
          const k = ease(t, 0.4, 1.4);
          if (k >= 1) dot(ctx, sx(0), 181, 4.5, U.red);
          else if (k > 0) { const p = C.pathAt([[pw, 181], [sx(0), 181]], k).pop(); dot(ctx, p[0], p[1], 4.5, U.red); }
          bar(194, ease(t, 1.4, 3.0));
          ride(ctx, 'Cert', [[ax + aw - 8, 181], [cx0, 181]], ease(t, 3.1, 4.0), RED, 9);
        } else ride(ctx, '×8', [[ax + aw - 8, 87], [cx0, 87]], ease(t, 4.1, 5.0), RED, 9);
        const sent0 = i || t >= 5.0, sent1 = i && t >= 4.0;
        C.card(ctx, { x: cx0, y: 64, w: ch, h: 46, t: '#alerts', s: sent0 ? '메시지 1개' : 'Slack', size: narrow ? 11 : 12 }, { lit: !i && sent0 });
        C.card(ctx, { x: cx0, y: 158, w: ch, h: 46, t: '#cert', s: sent1 ? '168h마다' : 'Slack', size: narrow ? 11 : 12 }, { lit: sent1 });
        C.stamp(ctx, ax + aw / 2, 134, i ? '#cert로, 일주일에 한 번' : '알림 8개, 메시지 1개', 'ok', (t - (i ? 4.4 : 5.3)) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Thanos: sidecars upload 2-hour blocks; a long query fans out to both sidecars and the store gateway.
  each('prometheus-thanos', (root) => {
    const S = seq([6.6, 6.2], 1.8);
    const notes = [
      '두 클러스터의 Prometheus가 2시간 블록을 완성할 때마다 sidecar가 객체 저장소로 올린다.',
      'query는 최근 구간을 두 sidecar에, 이전 구간을 store gateway에 묻고 세 결과를 합친다.',
    ];
    hwa.scene(root, {
      height: 262, still: S.at(1) + 6.2 + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = S.pos(time), narrow = w < 460, sz = narrow ? 10 : 12;
        C.pill(ctx, 0, 0, i ? '30일 조회' : '2시간마다 업로드', 'info');
        const cw = narrow ? Math.round(w * 0.5) : 300, rx = cw + 22, rw = w - rx, half = (cw - 24) / 2;
        const CL = [{ y: 34, label: '클러스터 main', col: BLUE }, { y: 146, label: '클러스터 sub-1', col: PURPLE }];
        const Q = { x: rx, y: 40, w: rw, h: 44, t: 'query', size: sz }, G = { x: rx, y: 112, w: rw, h: 44, t: 'store gateway', size: sz }, ST = { x: rx, y: 180, w: rw, h: 72 };
        const up = (c) => [[cw - 8, c.y + 53], [cw + 14, c.y + 53], [cw + 14, 220], [rx, 220]];
        const ask = (c) => [[rx, 62], [cw + 4, 62], [cw + 4, c.y + 45], [cw - 8, c.y + 45]];
        CL.forEach((c) => {
          C.line(ctx, up(c), LINE, 1);
          C.line(ctx, ask(c), LINE, 1);
        });
        C.line(ctx, [[rx + rw / 2, 84], [rx + rw / 2, 112]], LINE, 1);
        C.line(ctx, [[rx + rw / 2, 156], [rx + rw / 2, 180]], LINE, 1);
        CL.forEach((c, j) => {
          C.group(ctx, 0, c.y, cw, 98, c.label, c.y + 16);
          C.card(ctx, { x: 8, y: c.y + 28, w: half, h: 52, t: 'Prometheus', s: narrow ? '' : '최근 데이터', size: narrow ? 9 : 12 });
          C.card(ctx, { x: 16 + half, y: c.y + 28, w: half, h: 52, t: 'sidecar', size: sz }, { lit: (!i && Math.abs(t - (1.4 + j * 2.0)) < 0.8) || (i && t > 1.9 && t < 3.2) });
        });
        C.card(ctx, Q, { lit: i && ((t > 0.9 && t < 1.4) || (t > 3.9 && t < 4.6)) });
        C.card(ctx, G, { lit: i && t > 1.9 && t < 3.2 });
        C.box(ctx, ST.x, ST.y, ST.w, ST.h, { fill: U.plot, on: i && t > 2.2 && t < 3.0 });
        C.text(ctx, '객체 저장소', ST.x + 8, ST.y + 14, { size: 10, weight: 600 });
        const sent = i ? 3 : [0.6, 2.6, 4.6].filter((s) => t >= s + 1.4).length, blocks = 6 + sent;
        const bw = 16, per = Math.max(4, Math.floor((rw - 16) / (bw + 4)));
        for (let j = 0; j < blocks; j++) {
          const x = ST.x + 8 + (j % per) * (bw + 4), y = ST.y + 24 + Math.floor(j / per) * 14;
          ctx.fillStyle = (j < 6 ? j % 2 : (j - 6) % 2) ? PURPLE[2] : BLUE[2];
          ctx.fillRect(x, y, bw, 10);
        }
        if (!i) [0.6, 2.6, 4.6].forEach((s, j) => ride(ctx, '2h', up(CL[j % 2]), ease(t, s, s + 1.4), CL[j % 2].col, 9));
        else {
          C.text(ctx, 'Grafana', rx + rw / 2, 30, { size: 9, align: 'center' });
          ride(ctx, '30일', [[rx + rw / 2 + 30, 22], [rx + rw / 2 + 30, 40]], ease(t, 0.2, 0.9), MUTE, 9);
          CL.forEach((c) => ride(ctx, '?', ask(c), ease(t, 1.2, 2.0), MUTE, 9));
          ride(ctx, '?', [[rx + rw / 2, 84], [rx + rw / 2, 112]], ease(t, 1.2, 1.8), MUTE, 9);
          CL.forEach((c) => ride(ctx, '최근', ask(c).slice().reverse(), ease(t, 3.0, 3.9), c.col, 9));
          ride(ctx, '과거', [[rx + rw / 2, 112], [rx + rw / 2, 84]], ease(t, 3.2, 3.9), GREEN, 9);
          C.stamp(ctx, rx + rw / 2, 98, '세 곳 결과를 합침', 'ok', (t - 4.6) / 0.4);
        }
        say(notes[i]);
      },
    });
  });

})();
