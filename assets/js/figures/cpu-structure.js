// CPU post, structure figures: data location, lscpu count, request and limit path, Node.js threads.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const mv = (k, a, b) => hwa.smooth((k - a) / (b - a));
  const lerp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#e7f5ff', '#1971c2', '#228be6'], ORANGE = ['#fff4e6', '#e8590c', '#fd7e14'], PURPLE = ['#f3f0ff', '#6741d9', '#9775fa'];
  const MUTE = [U.cell, U.muted, '#e9ecef'];
  // Chip centred at (x, y), or right-aligned at x when right is set. col = [bg, fg, line].
  const tag = (ctx, s, x, y, col, { right = false, a = 1 } = {}) => {
    const cw = tw(ctx, s, 11, 600) + 18, x0 = right ? x - cw : x - cw / 2;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.roundRect(x0 + 0.5, y - 9.5, cw - 1, 19, 6);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x0 + cw / 2, y + 0.5, { weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  const sector = (ctx, x, y, R, f, fill) => {
    if (f <= 0) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + Math.min(f, 1) * TAU);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const ring = (ctx, x, y, R, color = '#ced4da', width = 1) => {
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.lineWidth = 1;
  };
  const layer = (ctx, x0, x1, y, label) => {
    C.dashed(ctx, x0, y, x1, y, '#ced4da');
    C.text(ctx, label, x0 + 2, y + 14, { size: 10, weight: 600 });
  };

  // Server map: one dot makes each round trip from the register; the panel scales 0.2ns to 1 s.
  document.querySelectorAll('[data-figure="cpu-memory"]').forEach((root) => {
    const SEC = 6.5, HOLD = 1.8, MY = 30, MH = 150, BUS = MY + 99;
    // Data: post table, rough values. Scaled seconds = ns x 5 (register 0.2ns = 1 s).
    const D = {
      reg: ['레지스터', '0.2ns', 1, '1초', 'ok'], l1: ['L1', '1ns', 5, '5초', 'ok'], l2: ['L2', '4ns', 20, '20초', 'ok'], l3: ['L3', '15ns', 75, '1분 15초', 'ok'],
      mem: ['메모리', '100ns', 500, '약 8분', 'warn'], ssd: ['SSD', '100µs', 5e5, '약 6일', 'bad'], net: ['다른 서버', '0.1~0.5ms', 2.5e6, '일주일에서 한 달', 'bad'],
    };
    const S = [
      { trips: ['reg', 'l1', 'l2', 'l3'], note: '레지스터 왕복을 1초로 늘리면 칩 안의 L3 캐시까지도 1분 남짓이다.' },
      { trips: ['mem'], stamp: ['8분 거리', 'warn'], note: '칩 밖 메모리는 8분 거리다. 그동안 코어는 데이터를 기다린다.' },
      { trips: ['ssd', 'net'], stamp: ['한 달 거리', 'bad'], note: 'SSD는 6일, 다른 서버는 일주일에서 한 달 거리다.' },
    ];
    const fmt = (s) => (s < 60 ? `${Math.round(s)}초` : s < 3600 ? `${Math.floor(s / 60)}분` : s < 86400 ? `${Math.floor(s / 3600)}시간` : `${Math.floor(s / 86400)}일`);
    const map = (ctx, w, cur, val) => {
      const ow = Math.round(clamp(w * 0.2, 64, 110)), sw = w - ow - 12, at = {};
      const cell = (id, x, y, bw, bh) => {
        const v = val(id), cy = y + bh / 2;
        C.box(ctx, x, y, bw, bh, { fill: '#fff', on: v === 'now', r: 6 });
        C.text(ctx, D[id] ? D[id][0] : '랜카드', x + bw / 2, v ? cy - 6 : cy, { size: 10, weight: 600, color: U.text, align: 'center', base: 'middle' });
        if (v) C.text(ctx, D[id][1], x + bw / 2, cy + 8, { size: 9, weight: v === 'now' ? 700 : 400, color: v === 'now' ? U.tones[D[id][4]][1] : U.muted, align: 'center', base: 'middle' });
        at[id] = [x + bw / 2, cy];
      };
      C.box(ctx, 0, MY, sw, MH, { fill: U.plot, r: 10 });
      C.text(ctx, '서버', 10, MY + 15, { size: 10, weight: 600 });
      const cx = 10, cy = MY + 22, cw = sw - 20, l3w = Math.round(clamp(cw * 0.2, 46, 120)), corew = cw - 22 - l3w, pw = (corew - 20) / 3;
      const rw = (sw - 32) / 3, ry = MY + 106;
      // Bus first so the boxes sit on top of it.
      C.line(ctx, [[cx + 40, cy + 70], [cx + 40, BUS], [10 + 2 * (rw + 6) + rw / 2, BUS]], '#e9ecef', 1);
      [0, 1, 2].forEach((j) => C.line(ctx, [[10 + j * (rw + 6) + rw / 2, BUS], [10 + j * (rw + 6) + rw / 2, ry]], '#e9ecef', 1));
      C.line(ctx, [[sw - 10, ry + 18], [sw + 12, ry + 18]], '#ced4da', 1);
      C.box(ctx, cx, cy, cw, 70, { fill: '#fff', r: 8 });
      C.text(ctx, 'CPU 칩', cx + 8, cy + 13, { size: 9, weight: 600 });
      C.box(ctx, cx + 8, cy + 18, corew, 46, { fill: U.plot, r: 6 });
      C.text(ctx, '코어', cx + 14, cy + 28, { size: 9 });
      ['reg', 'l1', 'l2'].forEach((id, j) => cell(id, cx + 14 + j * (pw + 4), cy + 32, pw, 28));
      cell('l3', cx + 14 + corew, cy + 18, l3w, 46);
      ['mem', 'ssd', 'nic'].forEach((id, j) => cell(id, 10 + j * (rw + 6), ry, rw, 36));
      cell('net', sw + 12, ry, ow, 36);
      return { at, sw };
    };
    const route = (at, id) => (id === 'reg' ? [at.reg, at.reg] : ['l1', 'l2', 'l3'].includes(id) ? [at.reg, at[id]]
      : id === 'net' ? [at.reg, [at.reg[0], BUS], [at.nic[0], BUS], at.nic, at.net] : [at.reg, [at.reg[0], BUS], [at[id][0], BUS], at[id]]);
    hwa.scene(root, {
      height: 296,
      still: 2 * (SEC + HOLD) + SEC + 0.6,
      scenes: hwa.loopScenes(SEC, HOLD, S.length),
      notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, S.length), sc = S[i], n = sc.trips.length;
        const ti = Math.min(n - 1, Math.floor(k * n)), f = k >= 1 ? 1 : k * n - ti, id = sc.trips[ti], d = D[id], fg = U.tones[d[4]][1];
        const seen = new Set(['reg', ...S.slice(0, i).flatMap((x) => x.trips), ...sc.trips.slice(0, ti)]), arrived = f >= 0.4 || id === 'reg';
        C.pill(ctx, 0, 0, id === 'reg' ? '레지스터' : `${d[0]}까지 왕복`, d[4]);
        const { at, sw } = map(ctx, w, id, (x) => (x === id && arrived ? 'now' : seen.has(x) && D[x] ? 'seen' : null));
        // Out in f 0..0.4, back in 0.4..0.8, then the dot rests in the register.
        const path = route(at, id);
        if (id !== 'reg' && f < 0.8) {
          C.line(ctx, path, '#a5d8ff', 1.2);
          const [px, py] = C.pathAt(path, hwa.smooth(f < 0.4 ? f / 0.4 : 1 - (f - 0.4) / 0.4)).pop();
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, TAU);
          ctx.fillStyle = U.blue;
          ctx.fill();
        }

        const py = MY + MH + 22, narrow = w < 420, R = narrow ? 20 : 24, cs = narrow ? 9 : 11, calW = 7 * (cs + 3) - 3, calX = w - calW, clX = calX - 24 - R;
        const p = clamp(f / 0.8), s = id === 'reg' ? p : d[2] ** p, done = p >= 1, val = done ? d[3] : fmt(s);
        C.text(ctx, '레지스터 왕복을 1초로 늘리면', 0, py, { size: 11, weight: 600, color: U.text });
        let size = 22;
        while (size > 13 && tw(ctx, val, size, 700) > clX - R - 14) size--;
        C.text(ctx, val, 0, py + 34, { size, weight: 700, color: fg });
        C.text(ctx, `실제 ${d[1]}`, 0, py + 54, { size: 10 });
        // Clock: one lap is an hour. Calendar: one cell is a day, 30 in all.
        const cy = py + 30;
        ctx.beginPath();
        ctx.arc(clX, cy, R, 0, TAU);
        ctx.fillStyle = '#fff';
        ctx.fill();
        sector(ctx, clX, cy, R, s / 3600, U.tones[d[4]][0]);
        ring(ctx, clX, cy, R);
        for (let j = 0; j < 12; j++) {
          const a = (j / 12) * TAU;
          C.line(ctx, [[clX + Math.cos(a) * (R - 3), cy + Math.sin(a) * (R - 3)], [clX + Math.cos(a) * R, cy + Math.sin(a) * R]], '#ced4da', 1);
        }
        if (s < 3600) {
          const a = -Math.PI / 2 + (s / 3600) * TAU;
          C.line(ctx, [[clX, cy], [clX + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4)]], fg, 1.8);
        }
        C.text(ctx, '1시간', clX, cy + R + 14, { size: 9, align: 'center' });
        const days = s / 86400;
        for (let j = 0; j < 30; j++) {
          const x = calX + (j % 7) * (cs + 3), y = py - 6 + Math.floor(j / 7) * (cs + 3), on = clamp(days - j);
          ctx.fillStyle = U.cell;
          ctx.fillRect(x, y, cs, cs);
          if (on <= 0) continue;
          ctx.globalAlpha = on;
          ctx.fillStyle = id === 'net' && j >= 7 ? U.tones.bad[0] : fg;
          ctx.fillRect(x, y, cs, cs);
          ctx.globalAlpha = 1;
        }
        C.text(ctx, '30일', calX + calW / 2, py - 6 + 5 * (cs + 3) + 10, { size: 9, align: 'center' });
        if (sc.stamp && ti === n - 1) C.stamp(ctx, sw / 2, BUS - 3, sc.stamp[0], sc.stamp[1], (f - 0.8) / 0.08);
        say(`${d[0]}까지 왕복 ${d[1]}. 레지스터 왕복을 1초로 보면 ${d[3]}.`);
      },
    });
  });

  // lscpu CPU(s) 32 built up: the socket, its 16 cores, then 2 hardware threads per core.
  document.querySelectorAll('[data-figure="cpu-count"]').forEach((root) => {
    const SEC = 4.8, HOLD = 1.6, COLS = root.clientWidth < 560 ? 4 : 8, CH = 46, GAP = 6;
    const BY = 30, SY = BY + 26, SH = 30 + (16 / COLS) * (CH + GAP) + 2;
    const notes = ['메인보드에 꽂힌 CPU 칩 하나가 소켓 하나다.', '소켓 안에 물리 코어가 16개 있다.', '코어마다 하드웨어 스레드가 2개라 리눅스는 CPU 32개로 본다.'];
    hwa.scene(root, {
      height: SY + SH + 12,
      still: 2 * (SEC + HOLD) + SEC + 0.6,
      scenes: hwa.loopScenes(SEC, HOLD, 3),
      notes,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, 3);
        const ks = i ? 1 : mv(k, 0.15, 0.5), nc = i === 0 ? 0 : i === 1 ? 16 * clamp((k - 0.05) / 0.8) : 16, nt = i < 2 ? 0 : 16 * clamp((k - 0.05) / 0.75);
        const cores = Math.floor(nc + 1e-6), threads = Math.floor(nt + 1e-6);
        C.pill(ctx, 0, 0, i === 0 ? 'Socket(s): 1' : i === 1 ? `Core(s) per socket: ${cores}` : threads < 16 ? 'Thread(s) per core: 2' : 'CPU(s): 32', 'info');
        C.box(ctx, 0, BY, w, h - BY - 2, { fill: U.plot, r: 10 });
        C.text(ctx, '메인보드', 10, BY + 16, { size: 10, weight: 600 });
        C.box(ctx, 8, SY, w - 16, SH, { fill: U.plot, dash: [4, 3], r: 8 });
        ctx.globalAlpha = ks;
        C.box(ctx, 8, SY, w - 16, SH, { fill: '#fff', stroke: '#ced4da', on: i === 0, r: 8 });
        C.text(ctx, '소켓 0 (CPU 칩)', 18, SY + 17, { size: 11, weight: 600, color: U.text });
        ctx.globalAlpha = 1;
        const hint = '칸 안 숫자 = CPU 번호';
        if (i === 2 && tw(ctx, hint, 10) + tw(ctx, '소켓 0 (CPU 칩)', 11, 600) + 50 < w) C.text(ctx, hint, w - 18, SY + 17, { size: 10, align: 'right' });
        const cw = (w - 36 - (COLS - 1) * GAP) / COLS, pw = (cw - 14) / 2;
        for (let c = 0; c < 16; c++) {
          const kc = clamp(nc - c);
          if (kc <= 0) continue;
          const x = 18 + (c % COLS) * (cw + GAP), y = SY + 28 + Math.floor(c / COLS) * (CH + GAP), kt = clamp(nt - c);
          ctx.globalAlpha = kc;
          C.box(ctx, x, y, cw, CH, { fill: '#fff', stroke: '#ced4da', r: 6, on: (i === 1 && c === cores) || (i === 2 && c === threads) });
          C.text(ctx, `코어 ${c}`, x + 6, y + 10, { size: 9, weight: 600, color: U.text, base: 'middle' });
          ctx.globalAlpha = 1;
          // Data: Intel Linux numbers sibling threads c and c + 16.
          for (let j = 0; j < 2 && kt > 0; j++) {
            const col = j ? PURPLE : BLUE, sx = x + 5 + j * (pw + 4), sy = y + 19, sh = CH - 24, d = (1 - kt) * 4;
            ctx.globalAlpha = kt;
            ctx.beginPath();
            ctx.roundRect(sx + d, sy + d, pw - 2 * d, sh - 2 * d, 4);
            ctx.fillStyle = col[0];
            ctx.fill();
            C.text(ctx, String(c + 16 * j), sx + pw / 2, sy + sh / 2 + 0.5, { size: 10, weight: 700, color: col[1], align: 'center', base: 'middle' });
            ctx.globalAlpha = 1;
          }
        }
        if (i === 2) C.stamp(ctx, w / 2, SY + SH / 2 + 12, '32 = 1 × 16 × 2', 'info', mv(k, 0.84, 0.95));
        say(i === 0 ? '메인보드에 소켓 1개.' : i === 1 ? `소켓 안에 코어 ${cores}개.` : `코어마다 하드웨어 스레드 2개, CPU(s) ${threads * 2}.`);
      },
    });
  });

  // requests (blue) and limits (orange) go down the layers one at a time, changing form at each stop.
  document.querySelectorAll('[data-figure="cpu-layers"]').forEach((root) => {
    const SEC = 5.6, HOLD = 1.6, NY = 94, KH = 34, ORG = ['#fff4e6', '#e8590c', '#fd7e14'];
    // Data: request 500m -> shares 512 -> weight 20; limit 1000m -> quota 100000 per period 100000.
    const ST = [
      { name: 'Pod 스펙', sub: 'API 서버에 저장', y: 30, h: 52, v: ['requests: 500m', 'limits: 1000m'] },
      { name: 'cgroup 파일', sub: '/sys/fs/cgroup', y: NY + 76, h: 72, v: ['cpu.weight = 20', 'cpu.max = 100000 100000'] },
      { name: 'CFS 스케줄러', sub: '시간을 나눔', y: NY + 154, h: 52, v: ['경합 때 비율로 나눔', '100ms마다 100ms까지'] },
      { name: 'vCPU', sub: '100ms 주기', y: NY + 240, h: 56, v: ['50ms 보장', '최대 100ms'] },
    ];
    const V1 = ['v1: cpu.shares = 512, cpu.cfs_quota_us = 100000, cpu.cfs_period_us = 100000', 'v1: cpu.shares = 512, cfs_quota_us = 100000', 'v1: shares 512, quota 100000'];
    const S = [
      { pill: 'kubelet이 씀', note: 'kubelet이 Pod 스펙의 두 값을 cgroup 파일 값으로 바꿔 쓴다.' },
      { pill: 'CFS가 읽음', note: 'CFS 스케줄러가 cgroup 파일을 읽어 나눌 비율과 상한을 정한다.' },
      { pill: 'vCPU 시간', note: 'CPU가 모자라면 100ms 중 50ms를 받고, 남아돌아도 100ms어치에서 멈춘다.' },
    ];
    const MOVE = [[0.05, 0.4], [0.5, 0.85]], COL = [BLUE, ORG];
    hwa.scene(root, {
      height: NY + 304 + 2,
      still: 2 * (SEC + HOLD) + SEC + 0.6,
      scenes: hwa.loopScenes(SEC, HOLD, S.length),
      notes: S.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, SEC, HOLD, S.length), rx = w - 18, p = MOVE.map(([a, b]) => mv(k, a, b));
        const slotY = (j, c) => ST[j].y + (c ? 38 : 16);
        C.pill(ctx, 0, 0, S[i].pill, 'info');
        ctx.font = U.font(10);
        C.legend(ctx, w - 40 - ctx.measureText('requests limits').width - 16, 11, [['requests', U.blue], ['limits', ORG[2]]]);
        C.box(ctx, 0, NY, w, h - NY - 2, { fill: U.plot, r: 10 });
        C.text(ctx, '노드', 10, NY + 16, { size: 10, weight: 600, color: U.text });
        C.text(ctx, '사용자 공간', 10, NY + 32, { size: 10 });
        layer(ctx, 8, w - 8, NY + 54, '커널');
        layer(ctx, 8, w - 8, NY + 218, '하드웨어');
        const kw = Math.min(120, w * 0.34), kx = rx - kw, ky = NY + 10, kOn = i === 0 && p.some((x) => x > 0.25 && x < 0.75);
        C.card(ctx, { x: kx, y: ky, w: kw, h: KH, t: 'kubelet' }, { lit: kOn });
        ST.forEach((r, j) => {
          const x = j ? 8 : 0, bw = j ? w - 16 : w, target = j === i + 1 && p.some((v) => v > 0 && v < 1);
          C.box(ctx, x, r.y, bw, r.h, { fill: '#fff', on: target, r: 8 });
          C.text(ctx, r.name, x + 12, r.y + 21, { size: 12, weight: 600, color: U.text });
          const room = bw - 34 - Math.max(...r.v.map((v) => tw(ctx, v, 11, 600) + 18));
          if (tw(ctx, r.sub, 10) < room) C.text(ctx, r.sub, x + 12, r.y + 40, { size: 10 });
          if (j === 1) {
            const v1 = V1.find((s) => tw(ctx, s, 10) < bw - 24);
            if (v1) C.text(ctx, v1, x + 12, r.y + 62, { size: 10 });
          }
          [0, 1].forEach((c) => {
            const at = p[c] >= 1 ? i + 1 : i;
            if (j < at || (j === i && p[c] > 0)) tag(ctx, r.v[c], rx, slotY(j, c), MUTE, { right: true });
            else if (j === at) tag(ctx, r.v[c], rx, slotY(j, c), COL[c], { right: true });
          });
        });
        // vCPU clock: blue share under contention, orange ring for the cap.
        const cx = rx - Math.max(...ST[3].v.map((v) => tw(ctx, v, 11, 600) + 18)) - 34, cy = ST[3].y + ST[3].h / 2, R = 17;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
        ctx.fillStyle = '#fff';
        ctx.fill();
        if (i === 2) {
          sector(ctx, cx, cy, R, 0.5 * mv(k, 0.38, 0.5), U.blue);
          const f = mv(k, 0.83, 0.95);
          if (f > 0) { ctx.beginPath(); ctx.arc(cx, cy, R + 3, -Math.PI / 2, -Math.PI / 2 + f * TAU); ctx.strokeStyle = ORG[2]; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1; }
        }
        ring(ctx, cx, cy, R);
        // Chips in flight, one at a time; the text changes halfway down.
        [0, 1].forEach((c) => {
          if (p[c] <= 0 || p[c] >= 1) return;
          const y = slotY(i, c) + (slotY(i + 1, c) - slotY(i, c)) * p[c];
          tag(ctx, ST[p[c] < 0.5 ? i : i + 1].v[c], rx, y, COL[c], { right: true });
        });
        // Stamp sits between the vCPU label and the clock, and is dropped when that gap is too narrow.
        const sx0 = 20 + Math.max(tw(ctx, 'vCPU', 12, 600), tw(ctx, ST[3].sub, 10)) + 12, stxt = '경합 때 50ms, 최대 100ms';
        if (i === 2 && tw(ctx, stxt, 13, 700) + 40 < cx - R - sx0) C.stamp(ctx, (sx0 + cx - R) / 2, cy, stxt, 'info', mv(k, 0.9, 0.98));
        say(`${S[i].pill}. ${S[i].note}`);
      },
    });
  });

})();
