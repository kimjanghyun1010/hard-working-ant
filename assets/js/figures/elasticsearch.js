// Elasticsearch cluster post: node layout, master overload, routing, write path, copies, write queue, relocation.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], ORANGE = ['#fef3c7', '#b45309', '#fcd34d'], RED = ['#fee2e2', '#dc2626', '#fca5a5'];
  const PURPLE = ['#ede9fe', '#6d28d9', '#c4b5fd'], WHITE = ['#fff', U.text, U.grid], REP = ['#fff', '#1d4ed8', '#93c5fd'];
  const LINE = '#cbd5e1';
  const each = (id, fn) => document.querySelectorAll(`[data-figure="elasticsearch-${id}"]`).forEach(fn);
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
  const rev = (p) => p.slice().reverse();
  const fade = (ctx, a, draw) => { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= Math.min(1, a); draw(); ctx.restore(); };
  // Box with a name and a second line; col = [bg, fg, line].
  const unit = (ctx, b, name, sub, { col = WHITE, dash, lit, size = 11, subSize = 10, subColor = U.muted, top } = {}) => {
    C.box(ctx, b.x, b.y, b.w, b.h, { fill: col[0], stroke: lit ? U.accent : col[2], dash, r: 7 });
    if (lit) { ctx.beginPath(); ctx.roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 7); ctx.strokeStyle = U.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    const cy = top ? b.y + top : b.y + b.h / 2;
    C.text(ctx, name, b.x + b.w / 2, sub ? cy - 7 : cy, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    if (sub) C.text(ctx, sub, b.x + b.w / 2, cy + 9, { size: subSize, color: subColor, align: 'center', base: 'middle' });
  };
  // Down part: red face with hatch, the only state the figures paint.
  const down = (ctx, b, r = 7) => {
    ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, r);
    ctx.fillStyle = RED[0]; ctx.fill(); ctx.fillStyle = C.hatch(ctx, '#fecaca'); ctx.fill();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = RED[1]; ctx.stroke(); ctx.setLineDash([]);
  };
  // Shard copy chip: a primary is filled, a replica is outlined.
  const copy = (ctx, s, x, y, { w = 30, a = 1, dash, lit } = {}) => {
    tag(ctx, s, x, y, s[0] === 'P' ? BLUE : REP, { w, a, dash, size: 10 });
    if (lit) { ctx.beginPath(); ctx.roundRect(x - w / 2 - 1.5, y - 10.5, w + 3, 21, 6); ctx.strokeStyle = U.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
  };
  const hint = (ctx, w, y, s) => C.text(ctx, `${s} 버튼을 눌러 보자`, w / 2, y, { size: 12, align: 'center', base: 'middle' });

  each('layout', (root) => {
    const SEC = 5.5, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const NODES = [['data-1', ['P0', 'R2']], ['data-2', ['P1', 'R0']], ['data-3', ['P2', 'R1']]];
    const notes = ['검색: 조정 노드가 샤드마다 복사본 하나에 요청을 보내고, 샤드별 상위 결과를 받아 하나로 합친다.', '색인: 조정 노드가 bulk를 샤드별로 나눠 프라이머리에 보내고, 프라이머리가 레플리카에 복제한다.'];
    hwa.scene(root, {
      height: 268, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), small = w < 480;
        const cw = small ? 46 : 70, ow = small ? 62 : 96, ox = cw + 14, gx = ox + ow + 20, gw = w - gx, oy = 182;
        C.pill(ctx, 0, 0, i ? 'bulk 색인' : '검색');
        C.group(ctx, gx, 28, gw, 54, '마스터 후보 3대', 44);
        const mw = Math.min(70, (gw - 20 - 12) / 3);
        ['m-1', 'm-2', 'm-3'].forEach((s, j) => unit(ctx, { x: gx + gw - 10 - (3 - j) * mw - (2 - j) * 6, y: 52, w: mw, h: 22 }, s, null, { size: 10 }));
        C.group(ctx, gx, 92, gw, 156, '데이터 노드', 108);
        const rx = gx + 8, rw = gw - 16, row = (j) => ({ x: rx, y: 118 + j * 42, w: rw, h: 36 });
        const cx = (k) => rx + rw - (k ? 22 : 58), cy = (j) => row(j).y + 18;
        const client = { x: 0, y: oy - 22, w: cw, h: 44 }, coord = { x: ox, y: oy - 30, w: ow, h: 60 };
        // Which copy each step touches: [row, slot].
        const READ = [[1, 1], [2, 1], [0, 1]], PRI = [[0, 0], [1, 0], [2, 0]], REPL = [[1, 1], [2, 1], [0, 1]];
        const hit = i ? (t > 2.4 && t < 4 ? [...PRI, ...(t > 3 ? REPL : [])] : []) : (t > 2.2 && t < 3.2 ? READ : []);
        NODES.forEach(([name, cs], j) => {
          const b = row(j);
          C.box(ctx, b.x, b.y, b.w, b.h, { r: 7 });
          C.text(ctx, name, b.x + 9, cy(j), { size: 10, weight: 600, color: U.text, base: 'middle' });
          cs.forEach((s, k) => copy(ctx, s, cx(k), cy(j), { lit: hit.some(([r, q]) => r === j && q === k) }));
        });
        unit(ctx, client, '클라이언트', null, { size: small ? 9 : 11 });
        unit(ctx, coord, small ? '조정' : '조정 노드', 'roles: [ ]', { size: small ? 10 : 11, subSize: 9, lit: (i ? t > 1 && t < 1.6 : (t > 1 && t < 1.6) || (t > 3.3 && t < 4)) });
        const toRow = (j) => [[ox + ow, oy], [gx - 8, oy], [gx - 8, cy(j)], [rx + 2, cy(j)]];
        const inP = [[cw, oy], [ox, oy]];
        if (i === 0) {
          if (t < 1.2) tag(ctx, 'query', ...at(inP, ease(t, 0.2, 1.1)), BLUE, { size: 9 });
          READ.forEach(([j]) => {
            const p = toRow(j);
            if (t > 1.3 && t < 2.3) dot(ctx, at(p, ease(t, 1.3, 2.2)), U.blue, 4);
            if (t > 2.3 && t < 3.3) tag(ctx, '상위 10', ...at(rev(p), ease(t, 2.4, 3.3)), PURPLE, { size: 9 });
          });
          if (t > 3.9) tag(ctx, '결과', ...at(rev(inP), ease(t, 3.9, 4.6)), PURPLE, { size: 9, a: 1 - ease(t, 4.8, 5.2) });
          C.stamp(ctx, w / 2, h - 12, '샤드 3개의 결과를 합침', 'info', (t - 4.3) / 0.4);
        } else {
          if (t < 1.2) tag(ctx, 'bulk 6건', ...at(inP, ease(t, 0.2, 1.1)), BLUE, { size: 9 });
          PRI.forEach(([j]) => { if (t > 1.3 && t < 2.5) tag(ctx, '2건', ...at(toRow(j), ease(t, 1.3, 2.4)), BLUE, { size: 9 }); });
          if (t > 2.6) PRI.forEach(([j], n) => {
            const [rj] = REPL[n], a = [cx(0), cy(j) + (rj > j ? 10 : -10)], b = [cx(1), cy(rj) + (rj > j ? -10 : 10)];
            C.line(ctx, [a, b], LINE, 1);
            if (t < 3.6) dot(ctx, mix(a, b, ease(t, 2.6, 3.5)), U.blue, 3.5);
          });
          C.stamp(ctx, w / 2, h - 12, '샤드별로 나눠 프라이머리에 먼저 쓴다', 'info', (t - 4.1) / 0.4);
        }
        say(notes[i]);
      },
    });
  });

  each('master', (root) => {
    const P = 0.9, F0 = 2.4, OUT = F0 + 3 * P;
    const notes = ['역할 겸용: 집계가 선출된 마스터의 힙까지 채워 leader check에 답하지 못하고, 세 번 실패하면 재선출이 일어난다.', '전용 마스터: 집계는 데이터 노드만 받는다. 데이터 노드가 바빠도 마스터는 확인에 계속 답한다.'];
    hwa.scene(root, {
      height: 262, still: 0, notes, demo: { modes: ['역할 겸용', '전용 마스터'], run: '무거운 집계 보내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const ded = ui.mode === 1, run = ui.runAt === null ? -1 : time - ui.runAt, small = w < 480;
        const nw = (w - 20) / 3, col = (j) => j * (nw + 10), nodeY = 62, nodeH = 84;
        const fails = ded || run < F0 ? 0 : Math.min(3, Math.floor((run - F0) / P) + 1), out = !ded && run >= OUT;
        C.pill(ctx, 0, 0, out ? '마스터 재선출 중' : ded ? 'master 3대 + data 3대' : 'node 3대, 역할 겸용');
        const heap = (j) => {
          const top = ded ? 82 : j === 0 ? 96 : 84;
          return run < 0 ? 38 : 38 + (top - 38) * ease(run, 0.3, F0);
        };
        const nodes = [0, 1, 2].map((j) => ({ x: col(j), y: nodeY, w: nw, h: nodeH }));
        nodes.forEach((b, j) => {
          const isOut = out && j === 0;
          if (isOut) down(ctx, b);
          else C.box(ctx, b.x, b.y, b.w, b.h, { r: 8 });
          C.text(ctx, ded ? `data-${j + 1}` : `node-${j + 1}`, b.x + b.w / 2, b.y + 16, { size: 11, weight: 600, color: isOut ? RED[1] : U.text, align: 'center', base: 'middle' });
          const role = isOut ? '응답 없음' : ded ? 'data' : j === 0 ? (small ? '선출 마스터' : 'master(선출), data') : 'master, data';
          C.text(ctx, role, b.x + b.w / 2, b.y + 32, { size: 9, weight: !ded && j === 0 ? 600 : 400, color: isOut ? RED[1] : !ded && j === 0 ? U.accent : U.muted, align: 'center', base: 'middle' });
          const v = heap(j), bx = b.x + 8, bw = b.w - 16, by = b.y + 60;
          C.text(ctx, `힙 ${Math.round(v)}%`, bx, by - 8, { size: 9, color: v >= 90 ? RED[1] : v >= 75 ? ORANGE[1] : U.muted, base: 'middle' });
          ctx.fillStyle = U.cell; ctx.fillRect(bx, by, bw, 10);
          ctx.fillStyle = v >= 90 ? U.red : v >= 75 ? '#f59e0b' : '#94a3b8'; ctx.fillRect(bx, by, bw * v / 100, 10);
          // Aggregations dropping in from above while the load runs.
          if (run >= 0 && run < 6) for (let n = 0; n < 2; n++) {
            const ph = ((run + n * 0.45 + j * 0.2) % 0.9) / 0.9;
            if (run > n * 0.45) tag(ctx, '집계', b.x + b.w / 2, 30 + ph * (b.y - 30), ORANGE, { size: 9, a: 1 - ph * 0.6, h: 16 });
          }
        });
        // Leader checks: each node asks the elected master once per period.
        const ly = 172, mb = ded ? { x: col(0), y: 186, w: nw, h: 40 } : nodes[0];
        if (ded) [0, 1, 2].forEach((j) => unit(ctx, { x: col(j), y: 186, w: nw, h: 40 }, `m-${j + 1}`, j ? 'master' : 'master(선출)', { size: 10, subSize: 9, subColor: j ? U.muted : U.accent }));
        const askers = ded ? [0, 1, 2] : [1, 2];
        askers.forEach((j, n) => {
          const sx = col(j) + nw / 2 + (ded ? 0 : -8), tx = mb.x + mb.w / 2 + (ded ? (j - 1) * 12 : 8 + n * 10), yy = ded ? ly : ly - 8 + n * 8;
          const path = ded ? [[sx, nodeY + nodeH], [sx, yy], [tx, yy], [tx, mb.y]] : [[sx, nodeY + nodeH], [sx, yy], [tx, yy], [tx, nodeY + nodeH]];
          C.line(ctx, path, LINE, 1);
          if (run < 0 || out) return;
          const ph = ((run + n * 0.3) % P) / P, failing = !ded && run >= F0;
          if (ph < 0.5) dot(ctx, at(path, ph * 2), failing ? U.red : U.accent, 3.5);
          else if (!failing) dot(ctx, at(rev(path), (ph - 0.5) * 2), U.accent, 3.5);
        });
        if (!ded) {
          const s = out ? '마스터를 잃음, 새 선거 시작' : fails ? `leader check 실패 ${fails}/3` : 'leader check: 1초마다, 10초 무응답 3번이면 고장';
          C.text(ctx, s, w / 2, 200, { size: small ? 10 : 11, weight: fails ? 700 : 500, color: fails ? U.red : U.muted, align: 'center', base: 'middle' });
        }
        if (run >= 0) C.stamp(ctx, w / 2, 244, ded ? '데이터 노드만 바쁘고 마스터는 응답' : '마스터 재선출, 상태 변경 멈춤', ded ? 'ok' : 'bad', (run - OUT - 0.3) / 0.4);
        else hint(ctx, w, 244, '무거운 집계 보내기');
        say(`${ded ? '전용 마스터' : '역할 겸용'}. ${notes[ui.mode]}`);
      },
    });
  });

  each('routing', (root) => {
    const SEC = 5.6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 3), N = [3, 4, 6];
    const HASH = [24, 13, 38, 51, 16, 29, 42, 7, 20, 33, 46, 59], ORDER = [[0, 1, 2], [0, 1, 2, 3], [0, 3, 1, 4, 2, 5]];
    const notes = ['프라이머리 3개: 문서는 hash % 3이 가리키는 샤드에 들어간다.', '4개로 바꾸면 나머지가 달라져 12개 중 9개가 다른 샤드에 있어야 한다.', 'split으로 6개가 되면 문서는 원래 샤드에서 갈라진 두 샤드 중 하나로만 간다.'];
    hwa.scene(root, {
      height: 248, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), n = N[i], order = ORDER[i];
        C.pill(ctx, 0, 0, `shard = hash % ${n}`);
        C.text(ctx, i === 2 ? 'split 3 → 6' : `프라이머리 ${n}개`, w, 11, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        const dw = Math.min(36, (w - 11 * 4) / 12), dx = (d) => (w - 12 * dw - 44) / 2 + d * (dw + 4) + dw / 2, dy = 46;
        C.text(ctx, '들어온 문서(해시값)', 0, 30, { size: 9 });
        const gap = 6, bw = (w - (n - 1) * gap) / n, by = 104, bh = 92;
        const per = Math.max(1, Math.floor((bw - 8) / (dw + 3)));
        const bx = (s) => order.indexOf(s) * (bw + gap);
        if (i === 2) [0, 1, 2].forEach((p) => {
          const x0 = bx(p), x1 = bx(p + 3) + bw;
          C.line(ctx, [[x0 + 4, by - 8], [x0 + 4, by - 12], [x1 - 4, by - 12], [x1 - 4, by - 8]], LINE, 1);
          C.text(ctx, `원래 샤드 ${p}`, (x0 + x1) / 2, by - 18, { size: 9, align: 'center', base: 'middle' });
        });
        order.forEach((s) => {
          C.box(ctx, bx(s), by, bw, bh, { fill: U.plot, r: 7 });
          C.text(ctx, `샤드 ${s}`, bx(s) + 8, by + 14, { size: 10, weight: 600, color: U.text, base: 'middle' });
        });
        const fill = {};
        let moved = 0;
        HASH.forEach((hv, d) => {
          const s = hv % n, slot = (fill[s] = (fill[s] || 0) + 1) - 1, was = hv % 3, move = i === 1 && was !== s;
          const tx = bx(s) + 4 + (slot % per) * (dw + 3) + dw / 2, ty = by + 36 + Math.floor(slot / per) * 26;
          const k = ease(t, 0.3 + d * 0.16, 0.9 + d * 0.16);
          if (k < 1) C.box(ctx, dx(d) - dw / 2, dy - 10, dw, 20, { fill: U.plot, dash: [2, 2], r: 5 });
          if (move && k >= 1) moved++;
          tag(ctx, String(hv), ...mix([dx(d), dy], [tx, ty], k), move && k > 0.5 ? ORANGE : BLUE, { w: dw, size: 9, dash: move && k > 0.5 ? [3, 2] : null });
        });
        if (i === 1) C.text(ctx, `다른 샤드로 가야 할 문서 ${moved}개`, w, by + bh + 16, { size: 10, weight: 600, color: moved ? ORANGE[1] : U.muted, align: 'right', base: 'middle' });
        const st = [['샤드 3개에 고르게 흩어짐', 'info'], ['12개 중 9개가 자리를 옮겨야 함', 'bad'], ['원래 샤드 안에서 둘로 나뉨', 'info']][i];
        C.stamp(ctx, w / 2, h - 14, st[0], st[1], (t - 3.3) / 0.4);
        say(notes[i]);
      },
    });
  });

  each('write', (root) => {
    const STEP = 1.6, HOLD = 2.6;
    const ST = ['조정 노드가 hash % 3으로 샤드 0을 찾는다', '프라이머리가 색인하고 순번 101을 매긴다', '같은 작업을 레플리카 둘에 동시에 보낸다', '레플리카가 색인하고 로컬 체크포인트 101로 답한다', '글로벌 체크포인트를 101로 올리고 응답한다'];
    const n = ST.length;
    hwa.scene(root, {
      height: 300, still: n * STEP + 0.5, scenes: hwa.stepScenes(n, STEP, HOLD),
      frame: (ctx, w, h, time, say) => {
        const t = time % (n * STEP + HOLD), cur = Math.min(n - 1, Math.floor(t / STEP)), f = t >= n * STEP ? 1 : hwa.smooth((t - cur * STEP) / (STEP * 0.6));
        const small = w < 480, cw = small ? 44 : 70, ow = small ? 56 : 90, ox = cw + 12, gx = ox + ow + 18, gw = w - gx;
        const R = { top: { x: gx, y: 34, w: gw, h: 60 }, mid: { x: gx, y: 120, w: gw, h: 60 }, bot: { x: gx, y: 206, w: gw, h: 60 } };
        const my = R.mid.y + R.mid.h / 2, gcp = cur === 4 && f > 0.6 ? 101 : 100;
        const reached = (s) => cur > s || (cur === s && f > 0.9);
        C.pill(ctx, 0, 0, 'PUT 문서 하나');
        C.text(ctx, `글로벌 체크포인트 ${gcp}`, w, 11, { size: 10, weight: 700, color: gcp === 101 ? U.accent : U.text, align: 'right', base: 'middle' });
        const client = { x: 0, y: my - 22, w: cw, h: 44 }, coord = { x: ox, y: my - 30, w: ow, h: 60 };
        unit(ctx, client, '클라이언트', null, { size: small ? 9 : 11 });
        unit(ctx, coord, small ? '조정' : '조정 노드', null, { lit: cur === 0, size: small ? 10 : 11 });
        if (cur === 0 && f > 0.5 || cur > 0) tag(ctx, 'hash % 3 = 0', ox + ow / 2, coord.y + coord.h + 14, PURPLE, { size: 9, h: 16, a: cur ? 1 : (f - 0.5) * 2 });
        [['mid', 'node-1', 'P0', 1], ['top', 'node-2', 'R0', 2], ['bot', 'node-3', 'R0', 2]].forEach(([k, name, c, s]) => {
          const b = R[k], lit = (k === 'mid' && (cur === 1 || cur === 4)) || (k !== 'mid' && (cur === 2 && f > 0.9 || cur === 3));
          C.box(ctx, b.x, b.y, b.w, b.h, { on: lit, r: 8 });
          C.text(ctx, name, b.x + 9, b.y + 17, { size: 10, weight: 600, color: U.text, base: 'middle' });
          copy(ctx, c, b.x + 66, b.y + 17, { w: 28 });
          if (!small) C.text(ctx, c[0] === 'P' ? '프라이머리' : '레플리카', b.x + 86, b.y + 17, { size: 9, base: 'middle' });
          const has = reached(s), cwid = small ? 22 : 28;
          [98, 99, 100, 101].forEach((q, m) => {
            const cx = b.x + 9 + m * (cwid + 3), on = q < 101 || has;
            C.box(ctx, cx, b.y + 32, cwid, 18, { fill: q === 101 && has ? BLUE[0] : on ? U.cell : '#fff', stroke: q === 101 && has ? BLUE[2] : U.grid, dash: on ? null : [2, 2], r: 4 });
            C.text(ctx, String(q), cx + cwid / 2, b.y + 41.5, { size: 9, weight: q === 101 && has ? 700 : 400, color: q === 101 && has ? BLUE[1] : on ? U.text : U.muted, align: 'center', base: 'middle' });
          });
          const lcp = (k === 'mid' ? reached(1) : reached(2)) ? 101 : 100;
          C.text(ctx, small ? `LCP ${lcp}` : `로컬 체크포인트 ${lcp}`, b.x + b.w - 9, b.y + 41, { size: 9, weight: 600, color: lcp === 101 ? U.text : U.muted, align: 'right', base: 'middle' });
        });
        const ax = gx + gw * 0.62, top = R.top, bot = R.bot, mid = R.mid;
        const P = [
          [[[cw, my], [ox, my]]],
          [[[ox + ow, my], [gx, my]]],
          [[[ax, mid.y], [ax, top.y + top.h]], [[ax, mid.y + mid.h], [ax, bot.y]]],
          [[[ax + 16, top.y + top.h], [ax + 16, mid.y]], [[ax + 16, bot.y], [ax + 16, mid.y + mid.h]]],
          [[[gx, my + 8], [ox + ow, my + 8]], [[ox, my + 8], [cw, my + 8]]],
        ];
        P.forEach((ps, j) => {
          if (j > cur) return;
          const on = j === cur;
          ps.forEach((p, m) => {
            const k = on ? (j === 4 ? ease(f, m * 0.45, m * 0.45 + 0.55) : f) : 1;
            C.arrow(ctx, p, k, on ? U.accent : LINE, { width: on ? 2 : 1.4, dash: j === 3 || j === 4 ? [4, 3] : null });
            if (m === 0 || j === 2 || j === 3) C.badge(ctx, p, j + 1, on, j === 2 ? 'left' : j === 3 ? 'right' : j === 4 ? 'down' : 'up');
          });
        });
        if (cur === 3) [[ax + 16, top.y + top.h], [ax + 16, bot.y]].forEach((p0, m) => tag(ctx, 'LCP 101', ...mix([p0[0] + 34, p0[1]], [ax + 50, m ? mid.y + mid.h : mid.y], f), PURPLE, { size: 9, h: 16 }));
        C.text(ctx, `${cur + 1}. ${ST[cur]}`, 0, h - 12, { size: small ? 11 : 12, weight: 600, color: U.text, base: 'middle' });
        say(`${cur + 1}단계: ${ST[cur]}. 글로벌 체크포인트 ${gcp}.`);
      },
    });
  });

  each('copies', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const QUEUE = [5, 2, 1], PICK = [2, 2, 0, 2, 2, 2];
    const notes = ['샤드 0의 검색은 search 큐가 짧은 node-3의 R0로 더 많이 간다(적응형 복제본 선택).', 'node-1이 꺼지면 node-3의 R0가 프라이머리로 승격되고, 빠진 복사본은 다른 노드에 새로 만든다.'];
    hwa.scene(root, {
      height: 258, still: S.at(1) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), small = w < 480;
        const cw = small ? 48 : 76, gx = cw + 18, nw = (w - gx - 16) / 3, colX = (j) => gx + j * (nw + 8), ny = 48, nh = 166, cy = 130;
        const off = i === 1 && t > 0.8, promo = i === 1 && t > 2.0, rebuilt = i === 1 ? ease(t, 3.0, 3.6) : 0;
        C.pill(ctx, 0, 0, i ? (off ? 'node-1 꺼짐' : '노드 장애') : '샤드 0 검색 분산');
        unit(ctx, { x: 0, y: cy - 26, w: cw, h: 52 }, small ? '조정' : '조정 노드', null, { size: small ? 10 : 11 });
        const chips = [
          [['P0', 0], ['R1', 1]],
          [['P1', 1], ['R2', 2], ...(rebuilt > 0 ? [['R0', 0, 'new']] : [])],
          [['P2', 2], [promo ? 'P0' : 'R0', 0, promo ? 'promo' : ''], ...(rebuilt > 0 ? [['R1', 1, 'new']] : [])],
        ];
        let reads = [0, 0, 0];
        [0, 1, 2].forEach((j) => {
          const b = { x: colX(j), y: ny, w: nw, h: nh }, dead = off && j === 0;
          if (dead) down(ctx, b, 8); else C.box(ctx, b.x, b.y, b.w, b.h, { r: 8 });
          C.text(ctx, `node-${j + 1}`, b.x + b.w / 2, b.y + 15, { size: 11, weight: 600, color: dead ? RED[1] : U.text, align: 'center', base: 'middle' });
          if (dead) { C.text(ctx, '꺼짐', b.x + b.w / 2, b.y + 34, { size: 10, weight: 700, color: RED[1], align: 'center', base: 'middle' }); return; }
          C.text(ctx, 'search 큐', b.x + 8, b.y + 34, { size: 9, base: 'middle' });
          const qw = (b.w - 16 - 5 * 2) / 6;
          for (let q = 0; q < 6; q++) {
            const busy = i === 0 && q < QUEUE[j];
            C.box(ctx, b.x + 8 + q * (qw + 2), b.y + 42, qw, 10, { fill: busy ? ORANGE[2] : '#fff', stroke: busy ? ORANGE[2] : U.grid, r: 2 });
          }
          chips[j].forEach(([s, sh, kind], m) => {
            const yy = b.y + 78 + m * 28, ww = Math.min(54, b.w - 20);
            const lit = i === 0 && sh === 0 && PICK.some((p, r) => p === j && t > 0.9 + r * 0.55 && t < 1.3 + r * 0.55);
            copy(ctx, s, b.x + b.w / 2, yy, { w: ww, a: kind === 'new' ? rebuilt : 1, dash: kind === 'new' && t < 4.4 ? [3, 2] : null, lit });
            if (kind === 'promo' && t < 3.2) C.stamp(ctx, b.x + b.w / 2, yy, '승격', 'info', (t - 2.0) / 0.3);
            if (kind === 'new' && t < 4.4) C.text(ctx, '복구 중', b.x + b.w / 2, yy + 15, { size: 8, color: U.muted, align: 'center', base: 'middle' });
          });
        });
        if (i === 0) {
          PICK.forEach((j, r) => {
            const t0 = 0.4 + r * 0.55, tx = colX(j) + nw / 2, p = [[cw, cy], [gx - 8, cy], [gx - 8, 36], [tx, 36], [tx, ny + 2]];
            if (t > t0 && t < t0 + 0.9) dot(ctx, at(p, ease(t, t0, t0 + 0.9)), U.blue, 4);
            if (t > t0 + 0.9) reads[j]++;
          });
          C.text(ctx, `샤드 0 검색 6건: node-1 ${reads[0]}건, node-3 ${reads[2]}건`, w / 2, h - 32, { size: small ? 10 : 11, weight: 600, color: U.text, align: 'center', base: 'middle' });
          C.stamp(ctx, w / 2, h - 12, '덜 바쁜 복사본으로 보낸다', 'info', (t - 4.4) / 0.4);
        } else {
          C.text(ctx, promo ? 'primary term 1 → 2' : 'primary term 1', w / 2, h - 32, { size: 10, weight: 600, color: promo ? U.accent : U.muted, align: 'center', base: 'middle' });
          C.stamp(ctx, w / 2, h - 12, '남은 복사본으로 읽기와 쓰기 계속', 'info', (t - 4.6) / 0.4);
        }
        say(notes[i]);
      },
    });
  });

  // Write pool model: 4 threads, 0.5 s per request, 60 bulk items at 16/s and one API write at 3 s.
  const simQueue = (Q, backoff) => {
    const N = 60, TH = 4, SV = 0.5, GAP = 1 / 16, DT = 0.02, API = 3;
    let t = 0, sent = 0, next = 0, k = 0, retry = false, done = 0, rej = 0, seed = 7, apiNext = API, apiK = 0, apiIn = false, apiStart = null, fin = null;
    const q = [], th = [], frames = [], sends = [], rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    while (t < 12) {
      for (let j = th.length - 1; j >= 0; j--) if (t >= th[j].end - 1e-9) { th.splice(j, 1); done++; }
      while (th.length < TH && q.length) { const x = q.shift(); if (x) apiStart = t; th.push({ start: t, end: t + SV, api: x }); }
      if (!apiIn && t >= apiNext - 1e-9) {
        const ok = q.length < Q;
        sends.push({ at: t, ok, api: true });
        if (ok) { q.push(true); apiIn = true; } else { rej++; apiNext = t + 0.2 * 2 ** apiK++; }
      }
      if (t >= next - 1e-9 && (sent < N || retry)) {
        const ok = q.length < Q;
        sends.push({ at: t, ok });
        if (ok) { q.push(false); if (retry) retry = false; else sent++; k = 0; next = t + GAP; } else {
          rej++;
          if (!retry) { sent++; retry = true; }
          next = t + (backoff ? 0.4 * 2 ** k * (0.75 + 0.5 * rnd()) : GAP);
          k++;
        }
      }
      if (fin === null && done >= N + 1) fin = t;
      frames.push({ q: q.slice(), th: th.map((x) => ({ ...x })), done, rej, left: N - sent + (retry ? 1 : 0) });
      t += DT;
    }
    return { DT, frames, sends, fin, apiWait: apiStart - API, maxQ: Math.max(...frames.map((x) => x.q.length)) };
  };

  each('queue', (root) => {
    const SIMS = [simQueue(40, false), simQueue(6, true)], QS = [40, 6];
    const notes = ['큐 키우기: 429는 없지만 큐가 길게 쌓여, 3초에 들어온 API 쓰기가 앞선 bulk 뒤에서 오래 대기한다.', '429 백오프: 큐가 차면 거절하고 클라이언트가 잠시 멈춘다. 큐가 짧아 API 쓰기가 금방 처리되고, 끝나는 시각은 같다.'];
    hwa.scene(root, {
      height: 286, still: 0, notes, demo: { modes: ['큐 키우기', '429 받고 백오프'], run: 'bulk 60건 보내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const m = ui.mode, sim = SIMS[m], run = ui.runAt === null ? -1 : time - ui.runAt, small = w < 480;
        const fr = run < 0 ? null : sim.frames[Math.min(sim.frames.length - 1, Math.floor(run / sim.DT))];
        const cw = small ? 50 : 76, gx = cw + 24, gw = w - gx, qx = gx + 10, qw = gw - 20, cellW = (qw - 19 * 2) / 20;
        const q = fr ? fr.q : [], th = fr ? fr.th : [], done = fr ? fr.done : 0, ended = run >= 0 && sim.fin !== null && run >= sim.fin;
        C.pill(ctx, 0, 0, m ? 'queue_size 6 + 백오프' : 'queue_size 40');
        C.text(ctx, `큐 ${q.length}  429 ${fr ? fr.rej : 0}`, w, 11, { size: 10, weight: 700, color: q.length > 12 ? ORANGE[1] : U.text, align: 'right', base: 'middle' });
        const bulk = { x: 0, y: 70, w: cw, h: 56 }, api = { x: 0, y: 178, w: cw, h: 44 };
        unit(ctx, bulk, 'bulk', `남은 ${fr ? fr.left : 60}`, { size: 11, subSize: 9 });
        unit(ctx, api, 'API', '쓰기 1건', { size: 11, subSize: 9, col: PURPLE });
        C.group(ctx, gx, 34, gw, 212, 'data 노드', 50);
        C.text(ctx, 'write 큐', qx, 66, { size: 9, base: 'middle' });
        for (let c = 0; c < 40; c++) {
          const x = qx + (c % 20) * (cellW + 2), y = 74 + Math.floor(c / 20) * 14, item = c < q.length ? q[c] : null;
          if (c >= QS[m]) { C.box(ctx, x, y, cellW, 11, { fill: U.plot, stroke: '#eef0f2', r: 2 }); continue; }
          C.box(ctx, x, y, cellW, 11, { fill: item === null ? '#fff' : item ? PURPLE[2] : ORANGE[2], stroke: item === null ? U.grid : item ? PURPLE[2] : ORANGE[2], r: 2 });
        }
        if (m) { const lx = qx + 6 * (cellW + 2) - 1; C.line(ctx, [[lx, 70], [lx, 103]], U.red, 1.5); C.text(ctx, '여기서 429', lx + 4, 110, { size: 9, weight: 600, color: U.red, base: 'middle' }); }
        C.text(ctx, '스레드 4개', qx, 124, { size: 9, base: 'middle' });
        const tw4 = (qw - 18) / 4;
        for (let j = 0; j < 4; j++) {
          const x = qx + j * (tw4 + 6), job = th[j];
          C.box(ctx, x, 132, tw4, 26, { r: 5 });
          if (job && run >= 0) {
            ctx.fillStyle = job.api ? PURPLE[0] : BLUE[0];
            ctx.fillRect(x + 1, 133, (tw4 - 2) * Math.min(1, (run - job.start) / 0.5), 24);
            C.text(ctx, job.api ? 'API' : 'bulk', x + tw4 / 2, 145.5, { size: 9, weight: 600, color: job.api ? PURPLE[1] : BLUE[1], align: 'center', base: 'middle' });
          }
        }
        C.text(ctx, `처리 ${Math.min(done, 61)}/61 (bulk 60, API 1)`, qx, 178, { size: 9, base: 'middle' });
        C.box(ctx, qx, 186, qw, 10, { fill: U.cell, stroke: U.cell, r: 3 });
        if (done) C.box(ctx, qx, 186, qw * Math.min(1, done / 61), 10, { fill: '#94a3b8', stroke: '#94a3b8', r: 3 });
        C.text(ctx, run < 0 ? '' : `${Math.min(run, sim.fin || run).toFixed(1)}초`, qx + qw, 178, { size: 10, weight: 600, color: U.text, align: 'right', base: 'middle' });
        // Requests in flight: out to the queue, and a red 429 back when the queue was full.
        if (run >= 0) sim.sends.forEach((s) => {
          const from = s.api ? [cw, api.y + api.h / 2] : [cw, bulk.y + bulk.h / 2], to = [qx - 2, 80], d = run - s.at;
          if (d >= 0 && d < 0.35) dot(ctx, mix(from, to, d / 0.35), s.api ? U.purple : U.blue, 3.5);
          else if (!s.ok && d >= 0.35 && d < 0.8) tag(ctx, '429', ...mix(to, from, (d - 0.35) / 0.45), RED, { size: 9, h: 16 });
        });
        if (run >= 0 && run > 3 + sim.apiWait + 0.5) C.text(ctx, `대기 ${sim.apiWait.toFixed(1)}초`, cw / 2, api.y + api.h + 12, { size: 10, weight: 700, color: m ? U.text : U.red, align: 'center', base: 'middle' });
        if (run >= 0) C.stamp(ctx, w / 2, h - 18, `${sim.fin.toFixed(1)}초에 끝, API ${sim.apiWait.toFixed(1)}초 대기`, m ? 'ok' : 'bad', ended ? (run - sim.fin - 0.2) / 0.4 : 0);
        else hint(ctx, w, h - 18, 'bulk 60건 보내기');
        say(`${m ? '429 백오프' : '큐 키우기'}. 큐 최대 ${sim.maxQ}건, ${sim.fin.toFixed(1)}초에 끝, API 쓰기 ${sim.apiWait.toFixed(1)}초 대기.`);
      },
    });
  });

  each('relocate', (root) => {
    const SEC = 6, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 3);
    const notes = ['파일 복사: 새 노드가 세그먼트 파일을 40MB/s로 받는 동안, 요청은 원본 P0가 받고 새 쓰기는 순번으로 쌓인다.', '따라잡기: 새 복사본이 복제 그룹에 들어가 새 쓰기를 함께 받고, 복사 중 쌓인 작업 101~103을 재생한다.', '전환: 순번을 따라잡으면 마스터가 샤드 위치를 node-4로 바꾸고, 요청이 새 복사본으로 간 뒤 원본을 지운다.'];
    hwa.scene(root, {
      height: 296, still: S.at(2) + SEC, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), small = w < 480;
        const cw = small ? 46 : 72, gx = cw + 20, gw = w - gx, nw = (gw - 12) / 2;
        const src = { x: gx, y: 60, w: nw, h: 168 }, dst = { x: gx + nw + 12, y: 60, w: nw, h: 168 };
        const flipped = i === 2 && t > 2.2, gone = i === 2 ? ease(t, 3.4, 4.2) : 0;
        C.pill(ctx, 0, 0, ['1. 파일 복사', '2. 따라잡기', '3. 전환'][i]);
        unit(ctx, { x: w - (small ? 92 : 120), y: 24, w: small ? 92 : 120, h: 26 }, flipped ? 'P0 → node-4' : 'P0 → node-1', null, { size: 10, lit: i === 2 && t > 1.6 && t < 2.8 });
        C.text(ctx, '마스터의 상태', w - (small ? 96 : 124), 37, { size: 9, align: 'right', base: 'middle' });
        unit(ctx, { x: 0, y: 112, w: cw, h: 48 }, '요청', '검색, 쓰기', { size: 11, subSize: 9 });
        // Source and target nodes; the source copy fades out once deleted.
        fade(ctx, 1 - gone * 0.6, () => C.box(ctx, src.x, src.y, src.w, src.h, { r: 8 }));
        C.box(ctx, dst.x, dst.y, dst.w, dst.h, { r: 8, dash: i === 0 ? [4, 3] : null });
        C.text(ctx, 'node-1', src.x + 9, src.y + 15, { size: 11, weight: 600, color: U.text, base: 'middle' });
        C.text(ctx, small ? 'node-4' : 'node-4 (새 노드)', dst.x + 9, dst.y + 15, { size: 11, weight: 600, color: U.text, base: 'middle' });
        fade(ctx, (1 - gone) * (flipped ? 0.45 : 1), () => copy(ctx, 'P0', src.x + src.w - 26, src.y + 15, { w: 34, dash: flipped ? [3, 2] : null }));
        const synced = i === 2 || (i === 1 && t > 3.4);
        copy(ctx, flipped ? 'P0' : 'R0', dst.x + dst.w - 26, dst.y + 15, { w: 34, dash: synced ? null : [3, 2] });
        // Segment files: five blocks copied one by one in scene 1.
        const segW = (nw - 18 - 4 * 3) / 5;
        C.text(ctx, '세그먼트', src.x + 9, src.y + 40, { size: 9, base: 'middle' });
        C.text(ctx, '세그먼트', dst.x + 9, dst.y + 40, { size: 9, base: 'middle' });
        for (let s = 0; s < 5; s++) {
          const ks = i ? 1 : ease(t, 0.4 + s * 0.8, 1.1 + s * 0.8);
          fade(ctx, 1 - gone, () => C.box(ctx, src.x + 9 + s * (segW + 3), src.y + 48, segW, 22, { fill: '#e2e8f0', stroke: '#cbd5e1', r: 3 }));
          C.box(ctx, dst.x + 9 + s * (segW + 3), dst.y + 48, segW, 22, { fill: ks >= 1 ? '#e2e8f0' : '#fff', stroke: ks >= 1 ? '#cbd5e1' : U.grid, dash: ks >= 1 ? null : [2, 2], r: 3 });
          if (ks > 0 && ks < 1) dot(ctx, mix([src.x + 9 + s * (segW + 3) + segW / 2, src.y + 59], [dst.x + 9 + s * (segW + 3) + segW / 2, dst.y + 59], ks), '#64748b', 4);
        }
        if (i === 0) C.text(ctx, '40MB/s 제한', dst.x + 9, dst.y + 82, { size: 9, weight: 600, color: ORANGE[1], base: 'middle' });
        // Operation log: 101..103 arrive during the copy; scene 2 replays them on the target.
        C.text(ctx, '작업(순번)', src.x + 9, src.y + 100, { size: 9, base: 'middle' });
        C.text(ctx, '작업(순번)', dst.x + 9, dst.y + 100, { size: 9, base: 'middle' });
        const opW = Math.min(30, (nw - 18 - 9) / 4);
        [100, 101, 102, 103].forEach((q, m) => {
          const born = q === 100 ? 1 : i ? 1 : ease(t, 1.0 + m * 1.2, 1.4 + m * 1.2);
          const replay = q === 100 ? (i ? 1 : t > 4.6 ? 1 : 0) : i === 0 ? 0 : i === 1 ? ease(t, 0.8 + m * 0.7, 1.3 + m * 0.7) : 1;
          const sx = src.x + 9 + m * (opW + 3), dx = dst.x + 9 + m * (opW + 3), y = src.y + 108;
          fade(ctx, born * (1 - gone), () => tag(ctx, String(q), sx + opW / 2, y + 9, q > 100 && i === 0 ? ORANGE : WHITE, { w: opW, size: 9 }));
          if (replay > 0) tag(ctx, String(q), dx + opW / 2, y + 9, q > 100 && i === 1 && replay < 1 ? ORANGE : WHITE, { w: opW, size: 9, a: replay });
          else C.box(ctx, dx, y, opW, 18, { dash: [2, 2], r: 5 });
          if (i === 1 && replay > 0 && replay < 1) dot(ctx, mix([sx + opW / 2, y + 9], [dx + opW / 2, y + 9], replay), U.orange, 3.5);
        });
        const lag = synced ? 'in-sync' : i ? '따라잡는 중' : '뒤처짐';
        C.text(ctx, lag, dst.x + 9, dst.y + 146, { size: 10, weight: 700, color: lag === 'in-sync' ? U.accent : U.muted, base: 'middle' });
        if (gone > 0.5) C.text(ctx, '원본 삭제', src.x + 9, src.y + 146, { size: 10, weight: 700, color: U.muted, base: 'middle' });
        // Live traffic: every request reaches whichever copy currently serves; in scene 2 writes also copy to the target.
        const ph = (time % 1.1) / 1.1, toSrc = [[cw, 136], [src.x, 136]], toDst = [[cw / 2, 160], [cw / 2, 254], [dst.x + dst.w * 0.6, 254], [dst.x + dst.w * 0.6, dst.y + dst.h]];
        if (flipped) { C.line(ctx, toDst, LINE, 1); dot(ctx, at(toDst, ph), U.blue, 4); } else { C.line(ctx, toSrc, LINE, 1); dot(ctx, at(toSrc, ph), U.blue, 4); }
        if (i === 1 || (i === 2 && !flipped)) {
          const rp = [[src.x + src.w * 0.7, src.y + src.h], [src.x + src.w * 0.7, 240], [dst.x + dst.w * 0.3, 240], [dst.x + dst.w * 0.3, dst.y + dst.h]];
          C.line(ctx, rp, LINE, 1);
          if (ph > 0.6) dot(ctx, at(rp, (ph - 0.6) / 0.4), U.blue, 3.5);
        }
        const st = [['원본이 계속 요청을 받는다', 'info'], ['쓰기는 두 곳에, 밀린 작업은 재생', 'info'], ['요청 끊김 없이 전환', 'ok']][i];
        C.stamp(ctx, (gx + w) / 2, h - 14, st[0], st[1], (t - 4.6) / 0.4);
        say(notes[i]);
      },
    });
  });
})();
