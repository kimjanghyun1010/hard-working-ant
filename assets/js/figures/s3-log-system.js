// S3 log system post: search engine storage, Glue cost, bookmark edge, Athena scans, small files.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  // [fill, text, line]
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], GREEN = ['#dcfce7', '#15803d', '#86efac'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'];
  const RED = ['#fee2e2', '#dc2626', '#fca5a5'], PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], GRAY = [U.cell, U.muted, '#e2e8f0'], COLD = ['#e2e8f0', '#475569', '#94a3b8'];
  const each = (id, fn) => document.querySelectorAll(`[data-figure="s3-log-system-${id}"]`).forEach(fn);
  // Scene index and time inside it for hwa.loop scenes.
  const at = (time, SEC, HOLD, n) => { const l = hwa.loop(time, SEC, HOLD, n); return { ...l, run: (time % ((SEC + HOLD) * n)) - l.i * (SEC + HOLD) }; };
  const rect = (ctx, x, y, w, h, col, { a = 1, r = 3, line = true } = {}) => {
    if (a <= 0 || w <= 0) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, Math.min(r, w / 2));
    ctx.fillStyle = col[0];
    ctx.fill();
    if (line) { ctx.strokeStyle = col[2]; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.globalAlpha = 1;
  };
  const dot = (ctx, [x, y], color, r = 4.5) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); };

  // One log line into Elasticsearch (source, index structures, a replica) and into S3 (one compressed object).
  each('es-store', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = [
      'Elasticsearch는 원문 옆에 검색용 색인을 함께 만들고, 복제본까지 두 벌을 노드 디스크에 둔다.',
      'S3에는 압축한 파일 한 벌만 올린다. 여러 가용 영역에 나눠 두는 일은 S3가 맡는다.',
    ];
    // Block widths show shape only, not measured ratios.
    const PARTS = [['원문', 0.62, U.blue], ['역색인', 0.5, '#60a5fa'], ['열 데이터', 0.46, '#93c5fd']];
    hwa.scene(root, {
      height: 262, still: S.at(1) + SEC + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = at(time, SEC, HOLD, 2);
        C.pill(ctx, 0, 0, i ? 'S3에 넣기' : 'Elasticsearch에 넣기', i ? 'ok' : 'info');
        C.text(ctx, '로그 1줄', w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        const lw = Math.round(clamp(w * 0.17, 52, 84)), gx = lw + 18, gw = w - gx;
        const app = { x: 0, y: 132, w: lw, h: 42, t: '앱', s: 'Fluentd' };
        const ey = 34, nw = (gw - 30) / 2, ny = ey + 26;
        const nodes = [0, 1].map((j) => ({ x: gx + 10 + j * (nw + 10), y: ny, w: nw, h: 84 }));
        const sy = 172, sb = { x: gx + 10, y: sy + 24, w: gw - 20, h: 42 };
        C.line(ctx, [[lw, 146], [lw + 9, 146], [lw + 9, ny + 42], [nodes[0].x, ny + 42]], '#cbd5e1', 1);
        C.line(ctx, [[lw, 160], [lw + 9, 160], [lw + 9, sb.y + 21], [sb.x, sb.y + 21]], '#cbd5e1', 1);
        C.card(ctx, app);

        C.group(ctx, gx, ey, gw, 122, 'Elasticsearch', ey + 16);
        nodes.forEach((n, j) => {
          C.box(ctx, n.x, n.y, n.w, n.h, { fill: '#fff' });
          C.text(ctx, `노드 ${j + 1}`, n.x + 8, n.y + 14, { size: 10, weight: 600, color: U.text });
          C.text(ctx, j ? '복제본' : '주 샤드', n.x + n.w - 8, n.y + 14, { size: 9, align: 'right' });
          PARTS.forEach(([name, f, color], p) => {
            const a = i ? 1 : ease(t, (j ? 3.4 : 1.3) + p * 0.45, (j ? 3.7 : 1.6) + p * 0.45);
            if (a <= 0) return;
            const bw = (n.w - 16) * f * a;
            ctx.globalAlpha = i ? 0.45 : 1;
            ctx.beginPath(); ctx.roundRect(n.x + 8, n.y + 24 + p * 18, bw, 14, 3); ctx.fillStyle = color; ctx.fill();
            if (a > 0.95) C.text(ctx, name, n.x + 13, n.y + 31.5 + p * 18, { size: 9, weight: 700, color: '#fff', base: 'middle' });
            ctx.globalAlpha = 1;
          });
        });
        if (!i && t > 0.1 && t < 1.3) dot(ctx, C.pathAt([[lw + 9, 146], [lw + 9, ny + 42], [nodes[0].x + 8, ny + 42]], ease(t, 0.1, 1.2)).pop(), U.blue);
        if (!i && t > 2.6 && t < 3.5) dot(ctx, mix([nodes[0].x + nodes[0].w - 10, ny + 42], [nodes[1].x + 8, ny + 42], ease(t, 2.6, 3.4)), U.blue);

        C.group(ctx, gx, sy, gw, 74, 'S3', sy + 16);
        C.box(ctx, sb.x, sb.y, sb.w, sb.h, { fill: '#fff' });
        C.text(ctx, 'log-bucket/', sb.x + 8, sb.y + 14, { size: 10, weight: 600, color: U.text });
        if (!i) C.stamp(ctx, gx + gw / 2, sb.y + 24, '원문 + 색인, 두 벌', 'warn', (run - 5.2) / 0.4);
        const full = (nw - 16) * 0.62, ka = i ? ease(t, 1.2, 2.2) : 0;
        if (i && t > 0.1 && t < 1.3) dot(ctx, C.pathAt([[lw + 9, 160], [lw + 9, sb.y + 21], [sb.x + 8, sb.y + 21]], ease(t, 0.1, 1.2)).pop(), U.blue);
        if (ka > 0) {
          const bw = full + (full * 0.2 - full) * ka;
          ctx.beginPath(); ctx.roundRect(sb.x + 8, sb.y + 22, bw, 14, 3); ctx.fillStyle = U.blue; ctx.fill();
          if (ka >= 1) C.text(ctx, 'json.gz, 압축 한 벌', sb.x + 14 + bw, sb.y + 29.5, { size: 9, weight: 600, color: U.text, base: 'middle' });
          C.stamp(ctx, gx + gw / 2, sy - 6, '압축본 한 벌', 'ok', (run - 5.2) / 0.4);
        }
        say(`${i ? 'S3' : 'Elasticsearch'}에 로그 한 줄 넣기. ${notes[i]}`);
      },
    });
  });

  // One Spark job holds 10 DPUs while one or two do the work; one crawl is billed 10 minutes even when it ends in 1.
  each('glue-bill', (root) => {
    const SEC = 6, HOLD = 2.2, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = [
      'Spark 잡은 기본 10 DPU를 잡는다. 옮길 파일이 몇 개뿐이면 대부분의 DPU는 놀면서 과금된다.',
      '크롤러는 한 번 돌 때마다 최소 10분을 과금한다. 1분 만에 끝나도 10분어치다.',
    ];
    hwa.scene(root, {
      height: 248, still: S.at(1) + SEC + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = at(time, SEC, HOLD, 2), k = clamp(t / (SEC - 0.6));
        C.pill(ctx, 0, 0, i ? '크롤러 한 번' : 'Spark 잡 한 번, 10 DPU', i ? 'bad' : 'warn');
        C.legend(ctx, w - 92, 11, i ? [['과금', PURPLE[2]], ['일함', '#7c3aed']] : [['과금', BLUE[2]], ['일함', U.blue]]);
        const lw = 44, x0 = lw, x1 = w - 6, X = (v, span) => x0 + (v / span) * (x1 - x0), top = 38;
        if (!i) {
          const span = 3, end = 2, cur = k * span, rh = 11, gap = 3;
          for (let r = 0; r < 10; r++) {
            const y = top + r * (rh + gap);
            C.text(ctx, r ? (r === 1 ? '실행기' : '') : '드라이버', 0, y + rh / 2, { size: 9, base: 'middle' });
            ctx.fillStyle = U.cell; ctx.fillRect(x0, y, x1 - x0, rh);
            const bill = Math.min(cur, end);
            ctx.fillStyle = BLUE[2]; ctx.fillRect(x0, y, X(bill, span) - x0, rh);
            const work = r === 0 ? [0, end] : r === 1 ? [0.4, 1.6] : null;
            if (work && cur > work[0]) { ctx.fillStyle = U.blue; ctx.fillRect(X(work[0], span), y, X(Math.min(cur, work[1]), span) - X(work[0], span), rh); }
          }
          C.text(ctx, 'DPU 10개', 0, top + 10 * (rh + gap) + 2, { size: 9, weight: 600, color: U.text });
          const base = top + 10 * (rh + gap) + 6;
          [[0, '0'], [1, '1분'], [2, '2분'], [3, '3분']].forEach(([v, s]) => C.text(ctx, s, X(v, span), base + 14, { size: 9, align: v ? (v === span ? 'right' : 'center') : 'left' }));
          if (cur < span) C.dashed(ctx, X(cur, span), top - 4, X(cur, span), base, U.now);
          C.stamp(ctx, (x0 + x1) / 2, base + 46, '10 DPU 과금, 2 DPU 일함', 'warn', (run - SEC + 0.4) / 0.4);
        } else {
          const span = 12, cur = k * span, y = top + 50, lh = 30;
          C.text(ctx, '크롤러', 0, y + lh / 2, { size: 10, weight: 600, color: U.text, base: 'middle' });
          ctx.fillStyle = U.cell; ctx.fillRect(x0, y, x1 - x0, lh);
          ctx.fillStyle = PURPLE[2]; ctx.fillRect(x0, y, X(Math.min(cur, 10), span) - x0, lh);
          ctx.fillStyle = '#7c3aed'; ctx.fillRect(x0, y, X(Math.min(cur, 1), span) - x0, lh);
          if (cur >= 1) C.text(ctx, '실제 1분', X(1, span) + 6, y + lh / 2, { size: 9, weight: 700, color: PURPLE[1], base: 'middle' });
          if (cur >= 10) C.event(ctx, X(10, span), y - 16, y + lh + 6, '최소 10분', U.red, 'center');
          const base = y + lh + 10;
          [[0, '0'], [5, '5분'], [10, '10분'], [12, '12분']].forEach(([v, s]) => C.text(ctx, s, X(v, span), base + 14, { size: 9, align: v ? (v === span ? 'right' : 'center') : 'left' }));
          if (cur < span) C.dashed(ctx, X(cur, span), y - 6, X(cur, span), base, U.now);
          C.stamp(ctx, (x0 + x1) / 2, y + lh + 62, '1분 일하고 10분 과금', 'bad', (run - SEC + 0.4) / 0.4);
        }
        say(notes[i]);
      },
    });
  });

  // Demo: X is listed late but stamped before the watermark. A watermark alone skips it; a lookback window with tags recovers it.
  each('edge', (root) => {
    const SEC = 6.4, SPAN = 210, L1 = 120, L2 = 180, WM = 110, WIN = 45;
    const F = [['a', 15, 0], ['b', 45, 0], ['c', 75, 0], ['d', WM, 0], ['X', 95, 1], ['e', 150, 1]];
    const notes = [
      '기준선만 보면 두 번째 목록에서 기준선보다 늦은 e만 읽는다. 늦게 보인 X는 기준선보다 이른 시각이라 영영 안 읽힌다.',
      '기준선 이전 45초를 다시 보고 태그가 없는 파일을 회수한다. X는 태그가 없어 두 번째 실행에서 처리된다.',
    ];
    const clock = (s) => `${s < 120 ? '11:5' + (8 + Math.floor(s / 60)) : '12:0' + Math.floor((s - 120) / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    hwa.scene(root, {
      height: 230, still: SEC + 1, notes,
      demo: { modes: ['기준선만', '되돌아보는 창'], run: '목록 뜨기' },
      frame: (ctx, w, h, time, say, ui) => {
        const r = ui.runAt === null ? -1 : time - ui.runAt, B = ui.mode === 1;
        C.pill(ctx, 0, 0, B ? '되돌아보는 창 45초' : '기준선만', 'info');
        const lw = w >= 420 ? 64 : 0, x0 = lw + 6, x1 = w - 6, X = (s) => x0 + (s / SPAN) * (x1 - x0), ry = [64, 112], y0 = 44, base = 140;
        if (lw) { C.text(ctx, '첫 목록', 0, ry[0] + 9, { size: 9, weight: 600, base: 'middle' }); C.text(ctx, '늦게 보임', 0, ry[1] + 9, { size: 9, weight: 600, color: ORANGE[1], base: 'middle' }); }
        C.line(ctx, [[x0, base], [x1, base]], U.text, 1);
        [[0, '11:58'], [60, '11:59'], [120, '12:00'], [180, '12:01']].forEach(([s, l]) => { C.line(ctx, [[X(s), base - 3], [X(s), base + 3]], U.muted, 1); C.text(ctx, l, X(s), base + 14, { size: 9, align: s ? 'center' : 'left' }); });
        if (lw) C.text(ctx, 'LastModified', x1, base + 28, { size: 9, align: 'right' });
        else { C.text(ctx, '1차 목록에 보인 파일', x0, ry[0] - 6, { size: 9, weight: 600 }); C.text(ctx, '늦게 보인 파일', x0, ry[1] - 6, { size: 9, weight: 600, color: ORANGE[1] }); }
        if (r >= 0) C.event(ctx, X(L1), y0, base, '1차 목록', U.slate, 'center');
        if (r >= 3.4) C.event(ctx, X(L2), y0, base, '2차 목록', U.slate, 'center');
        const wmK = ease(r, 1.6, 2.2);
        if (B && r >= 3.6) {
          const a = ease(r, 3.6, 4.0);
          ctx.globalAlpha = a; ctx.fillStyle = 'rgba(139,92,246,0.10)'; ctx.fillRect(X(WM - WIN), y0 + 10, X(WM) - X(WM - WIN), base - y0 - 10); ctx.globalAlpha = 1;
          if (a >= 1) C.text(ctx, '되돌아보는 창', (X(WM - WIN) + X(WM)) / 2, y0 + 6, { size: 9, weight: 700, color: '#7c3aed', align: 'center' });
        }
        if (wmK > 0) {
          C.dashed(ctx, X(WM), y0 + 8, X(WM), base, '#7c3aed');
          C.text(ctx, `기준선 ${clock(WM)}`, X(WM) - 4, base + 28, { size: 9, weight: 700, color: '#7c3aed', align: 'right' });
        }
        F.forEach(([id, s, row]) => {
          const late = row === 1, seen = late ? ease(r, 2.4 + (id === 'e' ? 0.3 : 0), 2.9 + (id === 'e' ? 0.3 : 0)) : 1;
          let col = GRAY, mark = '';
          if (!late && r >= 0.4 + s / 200) { col = GREEN; mark = '✓'; }
          if (late && seen > 0) col = ORANGE;
          if (id === 'e' && r >= 4.4) col = GREEN;
          if (id === 'X' && r >= 4.6) col = B ? GREEN : RED;
          const a = r < 0 ? (late ? 0 : 0.45) : late ? seen : 1;
          rect(ctx, X(s) - 7, ry[row], 14, 20, col, { a, r: 3 });
          if (a > 0) { ctx.globalAlpha = a; C.text(ctx, id, X(s), ry[row] + 10.5, { size: 10, weight: 700, color: col[1], align: 'center', base: 'middle' }); ctx.globalAlpha = 1; }
          if (mark && B && r >= 4.0 && s >= WM - WIN) C.text(ctx, '태그', X(s), ry[row] - 5, { size: 8, weight: 700, color: GREEN[1], align: 'center' });
        });
        if (r >= 4.0 && B) C.text(ctx, '태그 없음', X(95) - 10, ry[1] + 10.5, { size: 9, weight: 700, color: '#7c3aed', align: 'right', base: 'middle' });
        if (r >= SEC) C.stamp(ctx, (x0 + x1) / 2, 184, B ? 'X 회수' : 'X 누락', B ? 'ok' : 'bad', (r - SEC) / 0.4);
        if (r < 0) C.text(ctx, '목록 뜨기 버튼을 눌러 보자', (x0 + x1) / 2, 184, { size: 12, align: 'center', base: 'middle' });
        say(r < 0 ? '목록 뜨기 버튼을 누르면 두 번의 실행을 보여 준다.' : notes[ui.mode]);
      },
    });
  });

  // Athena reads the table definition from the Glue catalog, then Iceberg metadata, then only the data files it needs.
  each('catalog', (root) => {
    const STEP = 1.2, HOLD = 2.6, N = 5;
    const SAY = ['쿼리 받음', '테이블 위치 조회', '현재 스냅샷 찾기', '파일 목록과 파티션 값', '필요한 파일만 읽기'];
    hwa.scene(root, {
      height: 262, still: N * STEP + 1,
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, N, STEP, HOLD), cur = s.done ? N - 1 : s.active;
        C.pill(ctx, 0, 0, `${cur + 1}. ${SAY[cur]}`, 'info');
        const gap = 24, cw = (w - 2 * gap) / 3, col = (j) => j * (cw + gap), y1 = 38, y2 = 150, ch = 46;
        const top = [{ t: 'SQL', s: 'WHERE dt = ...' }, { t: 'Athena', s: '쿼리 엔진' }, { t: 'Glue 카탈로그', s: '테이블 정의' }];
        const bot = [{ t: 'metadata.json', s: '현재 스냅샷' }, { t: 'manifest', s: '파일 목록' }, { t: '데이터 파일', s: '' }];
        C.group(ctx, 0, y2 - 28, w, ch + 52, 'S3  iceberg/', y2 - 12);
        const lit = (j) => s.active === j;
        top.forEach((b, j) => C.card(ctx, { x: col(j), y: y1, w: cw, h: ch, size: 11, ...b }, { lit: lit(j === 0 ? 0 : j) }));
        bot.forEach((b, j) => { if (j < 2) C.card(ctx, { x: col(j), y: y2, w: cw, h: ch, size: 11, ...b }, { lit: lit(j + 2) }); });
        // Data files: two match the partition predicate, the rest are skipped.
        const dx = col(2);
        C.box(ctx, dx, y2, cw, ch, { fill: '#fff', stroke: lit(4) ? U.accent : U.grid });
        C.text(ctx, '데이터 파일', dx + cw / 2, y2 + 11, { size: 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
        const fw = Math.min(12, (cw - 20) / 6 - 3);
        for (let f = 0; f < 6; f++) {
          const hit = f === 2 || f === 3, k = s.k(4);
          const fx = dx + (cw - 6 * (fw + 3) + 3) / 2 + f * (fw + 3);
          rect(ctx, fx, y2 + 22, fw, 16, k > 0.5 && hit ? [U.blue, '#fff', '#1d4ed8'] : COLD, { a: k > 0.5 && !hit ? 0.4 : 1, r: 2 });
        }
        const arrows = [
          [[col(0) + cw, y1 + ch / 2], [col(1), y1 + ch / 2]],
          [[col(1) + cw, y1 + ch / 2], [col(2), y1 + ch / 2]],
          [[col(2) + cw / 2, y1 + ch], [col(2) + cw / 2, y1 + ch + 14], [col(0) + cw / 2, y1 + ch + 14], [col(0) + cw / 2, y2]],
          [[col(0) + cw, y2 + ch / 2], [col(1), y2 + ch / 2]],
          [[col(1) + cw, y2 + ch / 2], [col(2), y2 + ch / 2]],
        ];
        arrows.forEach((p, j) => {
          C.arrow(ctx, p, s.k(j), s.active === j ? U.accent : '#94a3b8');
          if (s.k(j) > 0) C.badge(ctx, p, j + 1, s.active === j, j === 2 ? 'down' : 'up', j === 2 ? 0.5 : 0.5);
        });
        if (s.done) C.stamp(ctx, w / 2, y2 + ch + 40, '두 파일만 읽음', 'ok', (time % (N * STEP + HOLD) - N * STEP) / 0.4);
        say(`${cur + 1}단계, ${SAY[cur]}. Athena는 Glue 카탈로그에서 테이블 위치를, Iceberg 메타데이터에서 파일 목록을 읽고 조건에 맞는 파일만 읽는다.`);
      },
    });
  });

  // Demo: one hour asked, dt only scans the whole day's 24 hour folders; dt and hour scans one.
  each('scan', (root) => {
    const SEC = 5.4, GB = 1, HOUR = 14;
    const notes = [
      'dt만 걸면 그날 24시간 폴더를 전부 읽는다. 결과는 14시 것만 나오지만 스캔은 24배다.',
      'hour까지 걸면 hour=14 폴더 하나만 읽는다. 결과는 같고 스캔은 1GB다.',
    ];
    hwa.scene(root, {
      height: 300, still: SEC + 1, notes,
      demo: { modes: ['dt만 걸기', 'dt와 hour 걸기'], run: '14시 로그 조회' },
      frame: (ctx, w, h, time, say, ui) => {
        const r = ui.runAt === null ? -1 : time - ui.runAt, B = ui.mode === 1;
        const cells = B ? [HOUR] : Array.from({ length: 24 }, (_, j) => j), k = clamp(r / (SEC - 0.6)), n = r < 0 ? 0 : Math.min(cells.length, Math.floor(k * cells.length + (k > 0 ? 1 : 0)));
        const gb = n * GB;
        C.pill(ctx, 0, 0, `스캔 ${gb}GB`, r < 0 ? 'info' : gb > 1 ? 'bad' : 'ok');
        C.text(ctx, `약 $${(gb / 1000 * 5).toFixed(3)}`, w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        const sql = B ? "WHERE dt = '20261102' AND hour = '14'" : "WHERE dt = '20261102'";
        C.box(ctx, 0, 30, w, 24, { fill: U.plot, r: 6 });
        C.text(ctx, sql, 8, 42, { size: 10, weight: 600, color: B ? U.tones.ok[1] : U.text, base: 'middle' });
        const lw = 64, cols = 12, gx = lw, cs = Math.min(26, (w - lw - (cols - 1) * 3) / cols), rh = cs * 0.72;
        const DAYS = [['dt=20261101', 0], ['dt=20261102', 1], ['dt=20261103', 0]];
        DAYS.forEach(([name, on], d) => {
          const y = 70 + d * (2 * rh + 20);
          C.text(ctx, name.slice(3), 0, y + rh, { size: 9, weight: 600, color: on ? U.text : U.muted, base: 'middle' });
          C.text(ctx, 'dt=', 0, y + rh - 12, { size: 8, base: 'middle' });
          for (let j = 0; j < 24; j++) {
            const x = gx + (j % cols) * (cs + 3), yy = y + Math.floor(j / cols) * (rh + 3), idx = cells.indexOf(j), hit = on && idx >= 0 && idx < n;
            if (!on) { ctx.fillStyle = C.hatch(ctx, '#e2e8f0'); ctx.fillRect(x, yy, cs, rh); continue; }
            rect(ctx, x, yy, cs, rh, hit ? (B || j === HOUR ? BLUE : RED) : GRAY, { r: 2 });
            if (j === HOUR) { ctx.strokeStyle = U.accent; ctx.lineWidth = 1.5; ctx.strokeRect(x - 1, yy - 1, cs + 2, rh + 2); }
            if (cs >= 20) C.text(ctx, String(j).padStart(2, '0'), x + cs / 2, yy + rh / 2 + 0.5, { size: 8, color: hit ? '#fff' : U.muted, align: 'center', base: 'middle' });
            if (hit) { ctx.fillStyle = B || j === HOUR ? U.blue : '#f87171'; ctx.beginPath(); ctx.roundRect(x, yy, cs, rh, 2); ctx.fill(); if (cs >= 20) C.text(ctx, String(j).padStart(2, '0'), x + cs / 2, yy + rh / 2 + 0.5, { size: 8, weight: 600, color: '#fff', align: 'center', base: 'middle' }); }
          }
        });
        const ly = 70 + 3 * (2 * rh + 20) + 4;
        C.legend(ctx, 0, ly, [['보려는 14시', U.blue], ['같이 읽은 시간', '#f87171'], ['dt로 건너뜀', '#e2e8f0']]);
        if (r >= SEC) C.stamp(ctx, w / 2, ly + 34, B ? '결과 같음, 스캔 1GB' : '결과 같음, 스캔 24배', B ? 'ok' : 'bad', (r - SEC) / 0.4);
        if (r < 0) C.text(ctx, '14시 로그 조회 버튼을 눌러 보자', w / 2, ly + 34, { size: 12, align: 'center', base: 'middle' });
        say(r < 0 ? '14시 로그 조회 버튼을 누르면 스캔하는 폴더를 보여 준다.' : `스캔 ${gb}GB. ${notes[ui.mode]}`);
      },
    });
  });

  // File count in one day partition: 10-second commits pile up, OPTIMIZE needs several runs to merge them.
  each('small-files', (root) => {
    const S = { n: 2, at: (j) => j * 8.2, of: (tm) => Math.floor((tm % 16.4) / 8.2) };
    const RUNS = [[1, 8640], [2, 5400], [3, 2200], [4, 24]];
    const notes = [
      '10초마다 커밋하면 시간 파티션마다 360개, 하루에 8,640개의 작은 파일이 생긴다.',
      'OPTIMIZE는 한 번에 다 못 합쳐 "더 남음"으로 끝나기도 한다. 성공할 때까지 다시 돌리면 시간 파티션마다 하나 남짓이 남는다.',
    ];
    hwa.scene(root, {
      height: 254, still: 8.2 + 6.4, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const i = S.of(time), run = (time % 16.4) - S.at(i), t = Math.min(run, 6);
        const x0 = 46, x1 = w - 8, y0 = 44, H = 160;
        const Y = C.panel(ctx, x0, y0, x1 - x0, H, { max: 9000, ticks: [[0, '0'], [3000, '3,000'], [6000, '6,000'], [9000, '9,000']] });
        if (!i) {
          const hr = clamp(t / 5.4) * 24, X = (v) => x0 + (v / 24) * (x1 - x0);
          C.pill(ctx, 0, 0, `파일 ${fmt(hr * 360)}개`, hr > 12 ? 'warn' : 'info');
          C.text(ctx, '10초마다 커밋', w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
          [0, 6, 12, 18, 24].forEach((v) => C.text(ctx, `${v}시`, X(v), y0 + H + 15, { size: 9, align: v ? (v === 24 ? 'right' : 'center') : 'left' }));
          const pts = [[X(0), Y(0)], [X(hr), Y(hr * 360)]];
          C.area(ctx, pts, Y(0), 'rgba(245,158,11,0.12)');
          C.line(ctx, pts, '#f59e0b');
          C.dot(ctx, X(hr), Y(hr * 360), '#b45309', '', 0);
          C.stamp(ctx, (x0 + x1) / 2, y0 + H * 0.45, '하루 8,640개', 'warn', (run - 6) / 0.4);
          say(`파일 ${fmt(hr * 360)}개. ${notes[0]}`);
        } else {
          const X = (v) => x0 + ((v - 1) / 3) * (x1 - x0 - 20), shown = Math.min(3, Math.floor(t / 1.6)), last = RUNS[shown][1];
          C.pill(ctx, 0, 0, `OPTIMIZE ${shown}회, 파일 ${fmt(last)}개`, shown === 3 ? 'ok' : 'warn');
          C.text(ctx, 'dt=20261102', w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
          const pts = [[X(1), Y(RUNS[0][1])]];
          for (let j = 1; j <= shown; j++) { pts.push([X(RUNS[j][0]), Y(RUNS[j - 1][1])]); pts.push([X(RUNS[j][0]), Y(RUNS[j][1])]); }
          C.line(ctx, pts, U.blue);
          for (let j = 1; j <= shown; j++) {
            const done = j === 3;
            C.event(ctx, X(RUNS[j][0]), y0 + 14, y0 + H, done ? '완료' : '더 남음', done ? '#16a34a' : '#b45309', done ? 'center' : 'left');
          }
          [[1, '합치기 전'], [2, '1회'], [3, '2회'], [4, '3회']].forEach(([v, s]) => C.text(ctx, s, X(v), y0 + H + 15, { size: 9, align: v === 1 ? 'left' : 'center' }));
          C.dot(ctx, pts[pts.length - 1][0], pts[pts.length - 1][1], U.blue, fmt(last), pts[pts.length - 1][1] - 10);
          if (shown === 3) C.stamp(ctx, (x0 + x1) / 2, y0 + H * 0.45, '24개 남짓으로', 'ok', (t - 4.8 - 0.2) / 0.4);
          say(`OPTIMIZE ${shown}회, 파일 ${fmt(last)}개. ${notes[1]}`);
        }
      },
    });
  });

  // Partition spec with and without hour: file floor after compaction against bytes read for a one-hour query.
  each('partition', (root) => {
    const SEC = 5.6, HOLD = 2.2, S = hwa.loopScenes(SEC, HOLD, 2), SVC = ['api', 'web', 'batch'], FILE = ['#94a3b8', '#fff', '#64748b'], HIT = [U.blue, '#fff', '#1d4ed8'];
    const notes = [
      'hour를 파티션에 넣으면 하루 72칸이 생긴다. 1시간 조회는 한 칸만 읽지만, 합쳐도 파일이 72개 아래로 줄지 않는다.',
      'hour를 빼면 하루 3칸이라 파일은 3개까지 준다. 대신 1시간 조회가 그날 칸 하나를 통째로, 24시간 분량을 읽는다.',
    ];
    hwa.scene(root, {
      height: 244, still: S.at(1) + SEC + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = at(time, SEC, HOLD, 2), hourly = i === 0;
        C.pill(ctx, 0, 0, hourly ? '(env, service, dt, hour)' : '(env, service, dt)', 'info');
        const lw = 42, gx = lw, gw = w - lw, cs = (gw - 23 * 2) / 24, rh = 22, y0 = 52;
        C.text(ctx, 'dt=20261102 하루', gx, y0 - 8, { size: 9, weight: 600 });
        SVC.forEach((sv, r) => {
          const y = y0 + r * (rh + 8);
          C.text(ctx, sv, 0, y + rh / 2, { size: 10, weight: 600, color: U.text, base: 'middle' });
          const q = ease(t, 2.4, 3.0) * (r === 0 ? 1 : 0);
          if (hourly) {
            for (let j = 0; j < 24; j++) {
              const x = gx + j * (cs + 2), fk = ease(t, 0.2 + (r * 24 + j) * 0.02, 0.5 + (r * 24 + j) * 0.02);
              rect(ctx, x, y, cs, rh, GRAY, { r: 2 });
              if (fk > 0) rect(ctx, x + cs * 0.2, y + 5, cs * 0.6, rh - 10, q > 0 && j === 14 ? HIT : FILE, { a: fk, r: 1, line: false });
              if (q > 0 && j === 14) { ctx.strokeStyle = U.accent; ctx.lineWidth = 1.5; ctx.strokeRect(x - 1, y - 1, cs + 2, rh + 2); }
            }
          } else {
            rect(ctx, gx, y, gw, rh, q > 0 ? ['rgba(239,68,68,0.10)', U.red, RED[2]] : GRAY, { r: 3 });
            rect(ctx, gx + gw - 18, y + 5, 10, rh - 10, FILE, { a: ease(t, 0.3 + r * 0.3, 0.7 + r * 0.3), r: 1, line: false });
            if (q > 0) C.text(ctx, '1시간을 보려고 24시간을 읽음', gx + 8, y + rh / 2, { size: 9, weight: 700, color: U.red, base: 'middle' });
          }
        });
        const my = y0 + 3 * (rh + 8) + 18, half = w / 2;
        C.text(ctx, '합친 뒤 파일 수 하한', 0, my, { size: 10 });
        C.text(ctx, hourly ? '72개' : '3개', 0, my + 24, { size: 18, weight: 700, color: hourly ? U.tones.warn[1] : U.tones.ok[1] });
        C.text(ctx, '1시간 조회 스캔', half, my, { size: 10 });
        C.text(ctx, hourly ? '1칸' : '24칸 분량', half, my + 24, { size: 18, weight: 700, color: hourly ? U.tones.ok[1] : U.tones.bad[1] });
        C.stamp(ctx, w / 2, my + 52, hourly ? '읽기 1칸, 파일 72개' : '파일 3개, 읽기 24배', hourly ? 'warn' : 'bad', (run - SEC + 0.2) / 0.4);
        say(notes[i]);
      },
    });
  });
})();
