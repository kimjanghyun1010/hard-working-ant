// S3 log system post: search engine storage, ILM, bucket layout, Glue cost, bookmarks, Athena scans, small files.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
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
  const tag = (ctx, s, x, y, col, { a = 1, size = 10 } = {}) => {
    const cw = tw(ctx, s, size, 600) + 14;
    rect(ctx, x - cw / 2, y - 9, cw, 18, col, { a, r: 5 });
    if (a > 0) { ctx.globalAlpha = Math.min(1, a); C.text(ctx, s, x, y + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' }); ctx.globalAlpha = 1; }
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

  // Daily indices age to the right. Without a policy they pile up past disk capacity; delete at 5d holds five.
  each('ilm', (root) => {
    const SEC = 7, HOLD = 2, END = 9.6, CAP = 8, KEEP = 5, S = hwa.loopScenes(SEC, HOLD, 2);
    const notes = [
      '보관 정책이 없으면 인덱스가 하루에 하나씩 쌓이고, 디스크가 차면 노드를 늘려야 한다.',
      'delete 단계에 min_age 5d를 걸면 만든 지 5일 된 인덱스가 지워져 디스크가 5일치에서 멈춘다.',
    ];
    hwa.scene(root, {
      height: 212, still: S.at(1) + SEC + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = at(time, SEC, HOLD, 2), d = clamp(t / SEC) * END, sw = w / 11, by = 62, bh = 40;
        C.pill(ctx, 0, 0, i ? 'delete, min_age 5d' : 'ILM 없음', i ? 'ok' : 'warn');
        C.text(ctx, `${Math.min(10, Math.floor(d) + 1)}일째`, w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        C.text(ctx, '오늘 인덱스', 2, by - 8, { size: 9, weight: 600, color: U.blue });
        C.text(ctx, '오래된 인덱스 →', w - 2, by - 8, { size: 9, align: 'right' });
        C.line(ctx, [[0, by + bh + 6], [w, by + bh + 6]], U.grid, 1);
        let n = 0;
        for (let j = 0; j < 10; j++) {
          if (d < j) continue;
          const age = d - j, gone = i && age >= KEEP ? clamp((age - KEEP) / 0.5) : 0, a = clamp((d - j) / 0.3) * (1 - gone);
          if (a <= 0) continue;
          n += a;
          const x = age * sw + 2, col = gone > 0 ? RED : age < 1 ? BLUE : GRAY;
          rect(ctx, x, by, sw - 4, bh, col, { a, r: 4 });
          ctx.globalAlpha = a;
          C.text(ctx, `11.${String(j + 1).padStart(2, '0')}`, x + (sw - 4) / 2, by + bh / 2, { size: 9, weight: 600, color: col[1], align: 'center', base: 'middle' });
          ctx.globalAlpha = 1;
        }
        if (i) C.event(ctx, KEEP * sw, by - 4, by + bh + 6, '', U.red);
        if (i) C.text(ctx, 'min_age 5d', KEEP * sw + 4, by + bh + 20, { size: 9, weight: 700, color: U.red });
        // Disk gauge: one index fills a tenth; capacity line at eight.
        const gy = 138, gx = 34, gw = w - gx, over = n > CAP + 0.05;
        C.text(ctx, '디스크', 0, gy + 6, { size: 10, weight: 600, color: U.text, base: 'middle' });
        rect(ctx, gx, gy, gw, 12, GRAY, { r: 4 });
        ctx.beginPath(); ctx.roundRect(gx, gy, gw * Math.min(n, 10) / 10, 12, 4); ctx.fillStyle = over ? U.red : U.blue; ctx.fill();
        C.dashed(ctx, gx + gw * CAP / 10, gy - 6, gx + gw * CAP / 10, gy + 18, U.red);
        C.text(ctx, '용량', gx + gw * CAP / 10, gy + 30, { size: 9, weight: 600, color: U.red, align: 'center' });
        if (!i && over) C.stamp(ctx, w / 2, gy + 56, '디스크 부족, 노드 증설', 'bad', (d - CAP - 0.2) / 0.4);
        if (i) C.stamp(ctx, (KEEP * sw + w) / 2, by + bh / 2, '5일치만 유지', 'ok', (run - SEC) / 0.4);
        say(`${i ? 'delete min_age 5d' : 'ILM 없음'}, ${Math.min(10, Math.floor(d) + 1)}일째, 인덱스 ${Math.round(n)}개. ${notes[i]}`);
      },
    });
  });

  // One bucket: four input prefixes in two layouts, the bookmark state and the Iceberg output. Lifecycle cools inputs only.
  each('bucket', (root) => {
    const AWS = ['#f1f5f9', U.muted, '#94a3b8'], ICE = ['#64748b', '#fff', '#475569'];
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const ROWS = [
      ['fluentd/{env}/{service}/', 'dt=YYYYMMDD/hour=HH/', BLUE, 'Fluentd'],
      ['datadog/{env}/{service}/', 'dt=YYYYMMDD/hour=HH/', BLUE, 'Datadog'],
      ['cloudfront-{service}-{env}/', 'YYYY/MM/DD/HH/', AWS, 'CloudFront'],
      ['AWSLogs/{acct}/WAFLogs/', '…/YYYY/MM/DD/HH/', AWS, 'WAF'],
      ['bookmarks/', '어디까지 처리했는지', PURPLE],
      ['iceberg/', '출력 테이블', GREEN],
    ];
    const notes = [
      'Fluentd와 Datadog은 Hive 스타일(dt=, hour=)로, CloudFront와 WAF는 AWS 기본형(YYYY/MM/DD/HH)으로 떨어진다.',
      '수명 주기 규칙은 프리픽스로 고른다. 입력 로그만 Glacier로 내리고 bookmarks/와 iceberg/는 그대로 둔다.',
    ];
    hwa.scene(root, {
      height: 304, still: S.at(1) + SEC + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = at(time, SEC, HOLD, 2);
        C.pill(ctx, 0, 0, i ? '수명 주기 30일' : '소스별 경로', i ? 'info' : 'info');
        if (w >= 420 && !i) C.legend(ctx, w - 196, 11, [['Hive 스타일', BLUE[2]], ['AWS 기본형', '#94a3b8']]);
        const sw = Math.round(clamp(w * 0.21, 66, 96)), bx = sw + 14, rx = bx + 8, rw = w - rx - 8, ry = (r) => 58 + r * 40;
        C.group(ctx, bx, 30, w - bx, 272, 's3://log-bucket', 46);
        ROWS.forEach(([pre, sub, col, src], r) => {
          const y = ry(r), cold = i && r < 4 ? ease(t, 1.2 + r * 0.4, 1.8 + r * 0.4) : 0;
          C.box(ctx, rx, y, rw, 34, { fill: '#fff', stroke: col[2], r: 6 });
          C.text(ctx, pre, rx + 8, y + 13, { size: 10, weight: 600, color: U.text, base: 'middle' });
          C.text(ctx, sub, rx + 8, y + 25, { size: 9, color: r < 2 ? BLUE[1] : U.muted, base: 'middle' });
          if (src) {
            C.card(ctx, { x: 0, y, w: sw, h: 34, t: src, size: 11 });
            C.arrow(ctx, [[sw + 2, y + 17], [rx - 2, y + 17]], 1, '#cbd5e1', { width: 1 });
          }
          // Three files per row land one after another in scene 1.
          for (let f = 0; f < 3; f++) {
            const fx = rx + rw - 14 - (2 - f) * 11, start = 0.4 + r * 0.35 + f * 0.9;
            const k = i ? 1 : r < 4 ? ease(t, start, start + 0.7) : r === 5 ? ease(t, 3.6 + f * 0.4, 4.1 + f * 0.4) : ease(t, 3.4, 3.8) * (f === 2 ? 1 : 0);
            if (k <= 0) continue;
            if (k < 1 && src) { dot(ctx, mix([sw, y + 17], [fx + 4, y + 17], k), col[2], 3.5); continue; }
            if (r === 4 && f < 2) continue;
            rect(ctx, fx, y + 10, 8, 14, cold >= 1 ? ICE : col, { a: k, r: 2 });
          }
          if (cold >= 1 && tw(ctx, pre, 10, 600) + 16 < rw - 92) C.text(ctx, 'Glacier', rx + rw - 52, y + 17, { size: 9, weight: 700, color: ICE[2], align: 'right', base: 'middle' });
        });
        C.card(ctx, { x: 0, y: ry(4), w: sw, h: 74, t: 'ETL', s: 'ECS 태스크', size: 11 });
        [4, 5].forEach((r) => C.arrow(ctx, [[sw + 2, ry(r) + 17], [rx - 2, ry(r) + 17]], i ? 1 : ease(t, 3.2, 3.6), U.accentLine, { width: 1 }));
        if (i) C.stamp(ctx, w - tw(ctx, '입력만 Glacier로', 13, 700) / 2 - 30, 12, '입력만 Glacier로', 'info', (run - 3.6) / 0.4);
        say(notes[i]);
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

  // Lane timelines. demo turns scenes into modes; the run button plays the chosen one once.
  {
    const FILL = { prep: '#cbd5e1', cpu: U.blue, crawl: '#a78bfa', live: '#dbeafe' };
    const tl = (name, scenes, { SEC = 7, HOLD = 1.8, demo } = {}) => each(name, (root) => {
      const LH = 46, maxL = Math.max(...scenes.map((s) => s.lanes.length)), n = scenes.length;
      hwa.scene(root, {
        height: 44 + maxL * LH + 30, still: (n - 1) * (SEC + HOLD) + SEC,
        scenes: n > 1 && !demo ? hwa.loopScenes(SEC, HOLD, n) : undefined,
        notes: scenes.map((x) => x.say), demo,
        frame: (ctx, w, h, time, say, ui) => {
          const auto = hwa.loop(time, SEC, HOLD, n), i = demo ? ui.mode : auto.i, s = scenes[i];
          const run = demo ? (ui.runAt === null ? -1 : time - ui.runAt) : (time % ((SEC + HOLD) * n)) - auto.i * (SEC + HOLD), k = clamp(run / SEC), t = k * s.span;
          C.pill(ctx, 0, 0, s.pill, s.tone);
          let lx = w;
          s.legend.slice().reverse().forEach(([kind, label]) => {
            lx -= tw(ctx, label, 10) + 4;
            C.text(ctx, label, lx, 11.5, { size: 10, base: 'middle' });
            lx -= 14;
            ctx.fillStyle = FILL[kind];
            ctx.beginPath(); ctx.roundRect(lx, 6, 10, 10, 2); ctx.fill();
            lx -= 10;
          });
          const lw = Math.min(70, w * 0.2), x0 = lw, x1 = w - 8, top = 40, base = top + maxL * LH + 4;
          const X = (v) => x0 + (clamp(v, 0, s.span) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
          s.lanes.forEach((nm, j) => C.text(ctx, nm, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
          C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
          s.ticks.forEach(([v, label]) => {
            C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
            C.text(ctx, label, X(v), base + 14, { size: 9, align: v >= s.span ? 'right' : 'center' });
          });
          s.segs.forEach(([j, a, b, kind, label]) => {
            if (t <= a) return;
            const y = ly(j) + 8, bx = X(a) + 0.5, bw = X(Math.min(t, b)) - bx - 0.5;
            if (bw <= 0) return;
            ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 16, Math.min(6, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
            if (t >= b && label && tw(ctx, label, 9, 700) + 6 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 16) / 2 + 0.5, { size: 9, weight: 700, color: kind === 'live' ? BLUE[1] : '#fff', align: 'center', base: 'middle' });
          });
          if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
          if (run >= SEC) C.stamp(ctx, (x0 + x1) / 2, top + (base - top) / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
          if (demo && run < 0) C.text(ctx, `${demo.run} 버튼을 눌러 보자`, (x0 + x1) / 2, top + (base - top) / 2, { size: 12, align: 'center', base: 'middle' });
          say(`${s.pill}. ${s.say}`);
        },
      });
    });

    // Demo: the same two hours of logs, run as a 30-minute Glue schedule or as one long-running container loop.
    const runs = [0, 30, 60, 90].flatMap((s) => [[0, s, s + 2, 'prep', ''], [0, s + 2, s + 6, 'cpu', ''], [1, s + 6, s + 16, 'crawl', '10분']]);
    const loop = [[0, 0, 2, 'prep', ''], [0, 2, 120, 'live', ''], ...Array.from({ length: 29 }, (_, j) => [0, 4 + j * 4, 5 + j * 4, 'cpu', ''])];
    const ticks = [[30, '30분'], [60, '60분'], [90, '90분'], [120, '2시간']];
    tl('glue-loop', [
      { pill: '30분마다 Glue 잡', tone: 'bad', span: 120, lanes: ['Glue 잡', '크롤러'], ticks, legend: [['prep', '준비'], ['cpu', '변환'], ['crawl', '크롤러']], segs: runs, stamp: ['10 DPU 4번, 크롤러 40분', 'bad'], say: '잡이 30분마다 10 DPU로 새로 뜨고, 크롤러가 돌 때마다 10분씩 과금된다. 로그는 최대 30분 늦게 테이블에 들어간다.' },
      { pill: '상시 컨테이너', tone: 'ok', span: 120, lanes: ['컨테이너'], ticks, legend: [['prep', '준비'], ['live', '대기'], ['cpu', '변환']], segs: loop, stamp: ['한 번 띄움, 크롤러 없음', 'ok'], say: '컨테이너는 필요한 만큼의 크기로 한 번 떠서 몇 분마다 새 파일만 변환한다. 같은 파일을 처리하는데 크롤러는 없다.' },
    ], { demo: { modes: ['30분마다 Glue 잡', '상시 컨테이너'], run: '2시간 돌리기' } });
  }

  // Files on a LastModified axis; each run processes files past the watermark and commits the new maximum.
  each('bookmark', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const H11 = [3, 9, 17, 24, 31, 38, 44, 50, 55], H12 = [62, 70, 79, 88, 96, 104, 111, 116];
    const notes = [
      '첫 실행은 hour=11의 파일을 읽고, 그중 가장 늦은 LastModified 11:55를 상태 파일에 커밋한다.',
      '다음 실행은 기준선 11:55보다 늦은 파일만 읽는다. 앞쪽은 목록에서 보기만 하고 건너뛴다.',
    ];
    const clock = (m) => `${11 + Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
    hwa.scene(root, {
      height: 226, still: S.at(1) + SEC + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = at(time, SEC, HOLD, 2);
        C.pill(ctx, 0, 0, i ? '두 번째 실행' : '첫 실행', 'info');
        C.text(ctx, 'S3 객체, LastModified 순', w, 11, { size: 10, align: 'right', base: 'middle' });
        const x0 = 4, x1 = w - 4, X = (m) => x0 + (m / 120) * (x1 - x0), y0 = 40, fy = 70;
        [[0, 'hour=11'], [60, 'hour=12']].forEach(([m, s]) => {
          C.box(ctx, X(m) + 1, y0, X(m + 60) - X(m) - 2, 58, { fill: U.plot, r: 6 });
          C.text(ctx, s, X(m) + 8, y0 + 13, { size: 9, weight: 600 });
        });
        [[0, '11:00'], [60, '12:00'], [120, '13:00']].forEach(([m, s]) => C.text(ctx, s, X(m), y0 + 72, { size: 9, align: m ? (m === 120 ? 'right' : 'center') : 'left' }));
        const wm0 = i ? 55 : 0, wm1 = i ? 116 : 55, wm = wm0 + (wm1 - wm0) * ease(t, 4.2, 4.9);
        const runA = i ? 2.4 : 1.0, runB = i ? 4.0 : 3.6;
        const fileAt = (m, j, list, newer) => {
          const show = i && list === H12 ? ease(t, 0.3 + j * 0.2, 0.6 + j * 0.2) : 1;
          const done = (!i && list === H11) || (i && list === H12) ? t >= runA + (j / list.length) * (runB - runA) : i;
          rect(ctx, X(m) - 4, fy, 8, 18, done ? ['#4ade80', '#fff', '#16a34a'] : newer ? BLUE : GRAY, { a: show, r: 2 });
        };
        H11.forEach((m, j) => fileAt(m, j, H11, !i));
        if (i) H12.forEach((m, j) => fileAt(m, j, H12, true));
        if (i && t > runA - 0.4) {
          ctx.fillStyle = C.hatch(ctx, '#e2e8f0');
          ctx.fillRect(X(0) + 1, fy + 22, X(55) - X(0) - 2, 6);
          C.text(ctx, '건너뜀', X(27), fy + 4 - 9, { size: 9, align: 'center', color: U.muted });
        }
        C.event(ctx, X(wm), y0 - 2, y0 + 60, '', '#7c3aed');
        C.text(ctx, `기준선 ${clock(wm)}`, Math.min(X(wm) + 4, x1 - 64), y0 + 84, { size: 9, weight: 700, color: '#7c3aed' });
        // State file: the watermark and file count the next run reads.
        const cy = 140, cw = Math.min(w, 330), cx = 0, committed = t >= 4.9;
        C.box(ctx, cx, cy, cw, 78, { fill: '#fff', stroke: PURPLE[2] });
        C.text(ctx, 'bookmarks/etl/api-gateway.json', cx + 10, cy + 16, { size: 10, weight: 600, color: U.text });
        const val = committed ? `${clock(wm1)}:03` : i ? '11:55:03' : '10:58:41';
        C.text(ctx, '"max_last_modified":', cx + 10, cy + 38, { size: 10 });
        C.text(ctx, `"${val}"`, cx + 128, cy + 38, { size: 10, weight: 700, color: committed ? '#7c3aed' : U.text });
        C.text(ctx, '"files_processed":', cx + 10, cy + 58, { size: 10 });
        C.text(ctx, String(committed ? (i ? H12.length : H11.length) : i ? H11.length : 40), cx + 128, cy + 58, { size: 10, weight: 700, color: committed ? '#7c3aed' : U.text });
        if (w >= 460) C.stamp(ctx, (cw + w) / 2 + 4, cy + 39, i ? '새 파일만 읽음' : 'hour=11 커밋', 'ok', (run - 5.2) / 0.4);
        else C.stamp(ctx, w - 66, cy + 50, i ? '새 파일만 읽음' : 'hour=11 커밋', 'ok', (run - 5.2) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Demo: X is listed late but stamped before the watermark. A watermark alone skips it; a lookback window with tags recovers it.
  each('edge', (root) => {
    const SEC = 6.4, SPAN = 210, L1 = 120, L2 = 180, WM = 110, WIN = 45;
    const F = [['a', 15, 0], ['b', 45, 0], ['c', 75, 0], ['d', WM, 0], ['X', 95, 1], ['e', 150, 1]];
    const notes = [
      '기준선만 보면 두 번째 목록에서 기준선보다 늦은 e만 읽는다. 늦게 보인 X는 기준선보다 앞이라 영영 안 읽힌다.',
      '기준선 앞 45초를 다시 보고 태그가 없는 파일을 회수한다. X는 태그가 없어 두 번째 실행에서 처리된다.',
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

  // Bytes scanned by one query: no limit, a 1TB per-query limit that cancels it, and a dt predicate.
  each('cap', (root) => {
    const SEC = 5.6, HOLD = 2.2, S = hwa.loopScenes(SEC, HOLD, 3);
    const SC = [
      { pill: '조건 없음', tone: 'warn', sql: 'WHERE 없음', end: 1.2, dur: 50, stamp: ['1.2TB 스캔, 약 $6', 'warn'], note: '조건 없이 돌린 쿼리는 테이블 1.2TB를 다 읽고 끝난다. 그만큼 과금된다.' },
      { pill: '쿼리당 한도 1TB', tone: 'bad', sql: 'WHERE 없음', end: 1.2, dur: 50, cap: 1, stamp: ['결과 없이 약 $5', 'bad'], note: '한도에 닿으면 쿼리는 취소되지만 이미 읽은 1TB는 청구된다. 결과는 받지 못한다.' },
      { pill: 'dt 조건', tone: 'ok', sql: "WHERE dt = '20261102'", end: 0.05, dur: 3, stamp: ['50GB 스캔, 약 $0.25', 'ok'], note: '하루치 dt 조건을 걸면 50GB만 읽는다. 비용을 막는 자리는 한도가 아니라 쿼리 조건이다.' },
    ];
    hwa.scene(root, {
      height: 262, still: S.at(2) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = at(time, SEC, HOLD, 3), s = SC[i], tt = clamp(t / (SEC - 0.4)) * 60;
        C.pill(ctx, 0, 0, s.pill, s.tone);
        C.text(ctx, s.sql, w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        const x0 = 34, x1 = w - 6, y0 = 44, H = 170, X = (v) => x0 + (v / 60) * (x1 - x0);
        const Y = C.panel(ctx, x0, y0, x1 - x0, H, { max: 1.5, ticks: [[0, '0'], [0.5, '0.5'], [1, '1TB'], [1.5, '1.5']] });
        [0, 20, 40, 60].forEach((v) => C.text(ctx, `${v}초`, X(v), y0 + H + 15, { size: 9, align: v ? (v === 60 ? 'right' : 'center') : 'left' }));
        if (s.cap) { C.dashed(ctx, x0, Y(s.cap), x1, Y(s.cap), U.red); C.text(ctx, '쿼리당 한도', x0 + 6, Y(s.cap) - 6, { size: 9, weight: 700, color: U.red }); }
        const stop = s.cap ? s.dur * s.cap / s.end : s.dur, upto = Math.min(tt, stop), v = (x) => s.end * Math.min(x, s.dur) / s.dur;
        const pts = []; for (let x = 0; x <= upto + 1e-6; x += 0.5) pts.push([X(x), Y(v(x))]);
        pts.push([X(upto), Y(v(upto))]);
        C.area(ctx, pts, Y(0), s.cap ? 'rgba(239,68,68,0.10)' : s.tone === 'ok' ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.10)');
        C.line(ctx, pts, s.cap ? U.red : s.tone === 'ok' ? '#16a34a' : U.blue);
        const val = v(upto);
        C.dot(ctx, X(upto), Y(val), s.cap ? U.red : s.tone === 'ok' ? '#16a34a' : U.blue, val >= 0.1 ? `${val.toFixed(2)}TB` : `${Math.round(val * 1000)}GB`, Y(val) - (X(upto) > x1 - 60 ? 12 : 0));
        if (tt >= stop) C.event(ctx, X(stop), y0 + 14, y0 + H, s.cap ? '취소' : '완료', s.cap ? U.red : U.slate, X(stop) > x1 - 30 ? 'center' : 'left');
        C.stamp(ctx, (x0 + x1) / 2, y0 + H * 0.62, s.stamp[0], s.stamp[1], (run - SEC + 0.2) / 0.4);
        say(`${s.pill}. 스캔 ${val.toFixed(2)}TB. ${s.note}`);
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
