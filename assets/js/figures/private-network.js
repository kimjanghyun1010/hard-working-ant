// Private network post: subnets, route tables, VNet peering, IPsec site-to-site VPN and the common traps.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const at = (pts, k) => C.pathAt(pts, clamp(k)).pop();
  const GREEN = ['#dcfce7', '#15803d', '#22c55e'], RED = ['#fee2e2', '#dc2626', '#ef4444'], ORANGE = ['#fef3c7', '#b45309', '#f59e0b'];
  const fig = (id, make) => document.querySelectorAll(`[data-figure="private-network-${id}"]`).forEach((root) => hwa.scene(root, make(root)));

  const dot = (ctx, [x, y], color = U.blue, r = 5) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
  };
  const cross = (ctx, x, y, a = 1, s = 6) => {
    if (a <= 0) return;
    ctx.globalAlpha = clamp(a);
    C.line(ctx, [[x - s, y - s], [x + s, y + s]], U.red, 2.4);
    C.line(ctx, [[x - s, y + s], [x + s, y - s]], U.red, 2.4);
    ctx.globalAlpha = 1;
  };
  // Path drawn as a faint rail so the packet's route stays readable after it passes.
  const rail = (ctx, pts, color = '#cbd5e1', dash) => { ctx.save(); if (dash) ctx.setLineDash(dash); C.line(ctx, pts, color, 1.2); ctx.restore(); };
  const tunnel = (ctx, pts, k = 1, color = ORANGE[2]) => { ctx.save(); ctx.setLineDash([5, 4]); C.line(ctx, C.pathAt(pts, clamp(k)), color, 2); ctx.restore(); };
  // Table of rows [left, right] or [id, left, right]. st(j): on, ok, bad, dead, gone, skip. a(j) fades a row in.
  const ROWST = {
    on: [U.accentSoft, U.accentLine, U.text, U.accent], ok: [GREEN[0], '#86efac', U.text, GREEN[1]], bad: [RED[0], '#fca5a5', U.text, RED[1]],
    dead: ['#fff', U.grid, '#cbd5e1', '#cbd5e1'], skip: ['#fff', U.grid, U.muted, U.muted], '': ['#fff', U.grid, U.text, U.muted],
  };
  const table = (ctx, x, y, w, title, rows, st = () => '', a = () => 1, rh = 20) => {
    if (title) C.text(ctx, title, x, y + 9, { size: 10, weight: 600, color: U.text, base: 'middle' });
    const idw = rows.some((r) => r.length > 2) ? Math.max(...rows.map((r) => (r.length > 2 ? tw(ctx, r[0], 10, 700) : 0))) + 10 : 0;
    rows.forEach((r, j) => {
      const al = a(j), s = st(j), yy = y + 20 + j * rh, cy = yy + (rh - 2) / 2 + 0.5;
      if (al <= 0 || s === 'gone') { C.box(ctx, x, yy, w, rh - 2, { fill: U.plot, dash: [3, 3], r: 4 }); if (s === 'gone') C.text(ctx, r.gone || '', x + w / 2, cy, { size: 10, align: 'center', base: 'middle' }); return; }
      const [bg, line, fg, side] = ROWST[s];
      ctx.globalAlpha = clamp(al);
      C.box(ctx, x, yy, w, rh - 2, { fill: bg, stroke: line, r: 4 });
      if (idw) C.text(ctx, r[0], x + 7, cy, { size: 10, weight: 700, color: side, base: 'middle' });
      const L = r[r.length - 2], R = r[r.length - 1];
      C.text(ctx, L, x + 7 + idw, cy, { size: 10, weight: 600, color: fg, base: 'middle' });
      C.text(ctx, R, x + w - 7, cy, { size: 10, weight: s === 'on' || s === 'ok' || s === 'bad' ? 600 : 400, color: side, align: 'right', base: 'middle' });
      if (s === 'dead') C.line(ctx, [[x + 6, cy], [x + 12 + idw + tw(ctx, L, 10, 600), cy]], '#cbd5e1', 1);
      ctx.globalAlpha = 1;
    });
  };
  const notesOf = (list) => list.map((s) => s.note);

  // One VM's route table: same VNet, an unconnected private range, the internet.
  fig('route', (root) => {
    const narrow = root.clientWidth < 560, SEC = 5.6, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3);
    // Data: Azure default system routes (learn.microsoft.com virtual-networks-udr-overview).
    const ROWS = [['10.1.0.0/16', '가상 네트워크'], ['10.0.0.0/8', '없음'], ['192.168.0.0/16', '없음'], ['0.0.0.0/0', '인터넷']];
    const SC = [
      { dst: '10.1.2.5', row: 0, stamp: ['VNet 안에서 전달', 'ok'], note: '같은 VNet 주소는 다음 홉이 가상 네트워크라 바로 전달된다.' },
      { dst: '10.9.0.5', row: 1, stamp: ['버림', 'bad'], note: 'VNet 밖의 사설 대역은 기본 경로의 다음 홉이 없음이라 버려진다.' },
      { dst: '8.8.8.8', row: 3, stamp: ['인터넷으로', 'info'], note: '그 밖의 주소는 0.0.0.0/0을 따라 인터넷으로 나간다.' },
    ];
    return {
      height: narrow ? 318 : 232, still: 2 * (SEC + HOLD) + SEC, scenes: S, notes: notesOf(SC),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), sc = SC[i];
        C.pill(ctx, 0, 0, `목적지 ${sc.dst}`, 'info');
        C.text(ctx, 'web 서브넷 VM이 보냄', w, 11, { size: 10, align: 'right', base: 'middle' });
        const mw = narrow ? w : Math.round(w * 0.58), my = 32, mh = narrow ? 168 : 190, vw = Math.round(mw * 0.62), rx = vw + 12;
        C.group(ctx, 0, my, vw, mh, 'VNet 10.1.0.0/16', my + 16);
        const vm1 = { x: 10, y: my + 28, w: vw - 20, h: 46, t: 'VM', s: '10.1.1.4, web' }, vm2 = { x: 10, y: my + mh - 56, w: vw - 20, h: 46, t: 'VM', s: '10.1.2.5, app' };
        const b1 = { x: rx, y: vm1.y, w: mw - rx, h: 46, t: '10.9.0.5', s: '연결 안 된 사설망', size: 11 }, b2 = { x: rx, y: vm2.y, w: mw - rx, h: 46, t: '인터넷', s: '8.8.8.8', size: 11 };
        const c1 = vm1.y + 23, c2 = vm2.y + 23, mx = vm1.x + vm1.w / 2;
        const P = [[[mx, vm1.y + vm1.h], [mx, vm2.y]], [[vm1.x + vm1.w, c1], [vw - 2, c1]], [[vm1.x + vm1.w, c1], [vw + 6, c1], [vw + 6, c2], [rx, c2]]];
        const k = ease(t, 1.6, 3.4), arrived = k >= 1;
        C.card(ctx, vm1, { lit: k > 0 && k < 1 });
        C.card(ctx, vm2, { lit: i === 0 && arrived });
        C.card(ctx, b1, { fill: U.plot, dash: [4, 3], dim: true });
        C.card(ctx, b2, { lit: i === 2 && arrived });
        if (t > 1.0) rail(ctx, P[i]);
        if (i === 1) rail(ctx, [[vw + 2, c1], [rx, c1]], '#fca5a5', [3, 3]);
        if (t > 1.6 && !(i === 1 && arrived) && !(arrived && t > 3.8)) dot(ctx, at(P[i], k));
        if (i === 1 && arrived) cross(ctx, vw, c1, ease(t, 3.4, 3.6));
        const tx = narrow ? 0 : mw + 16, ty = narrow ? my + mh + 12 : 40;
        table(ctx, tx, ty, w - tx, '라우팅 테이블 (web 서브넷)', ROWS, (j) => (t > 0.9 && j === sc.row ? (i === 1 ? 'bad' : 'on') : ''));
        C.stamp(ctx, vw / 2, my + mh / 2, sc.stamp[0], sc.stamp[1], (t - 3.8) / 0.4);
        say(`목적지 ${sc.dst}. ${sc.note}`);
      },
    };
  });

  // VNet peering between A and B: dropped before, two links, then traffic over the backbone.
  fig('peering', (root) => {
    const narrow = root.clientWidth < 560, VN = narrow ? 'VNetLocal' : '가상 네트워크', SEC = 5.6, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3);
    const SC = [
      { pill: '피어링 전', tone: 'warn', note: '피어링 전에는 B 대역이 A의 없음 경로에 걸려 버려진다.' },
      { pill: '링크 두 개 만들기', tone: 'info', note: '양쪽에 링크를 하나씩 만들어 둘 다 Connected가 되면 서로의 대역이 경로에 추가된다.' },
      { pill: '피어링 후', tone: 'ok', note: '패킷은 게이트웨이 없이 Microsoft 백본으로 바로 오간다.' },
    ];
    const NET = [
      { name: 'VNet A', cidr: '10.1.0.0/16', ip: '10.1.1.4', rows: [['10.1.0.0/16', VN], ['10.0.0.0/8', '없음'], ['10.2.0.0/16', 'VNet 피어링']] },
      { name: 'VNet B', cidr: '10.2.0.0/16', ip: '10.2.1.4', rows: [['10.2.0.0/16', VN], ['10.0.0.0/8', '없음'], ['10.1.0.0/16', 'VNet 피어링']] },
    ];
    return {
      height: 240, still: 2 * (SEC + HOLD) + SEC, scenes: S, notes: notesOf(SC),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), sc = SC[i];
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        const state = i === 0 ? null : i === 1 && t < 2.8 ? (t < 1.6 ? null : ['Initiated', 'warn']) : ['Connected', 'ok'];
        if (state) { const s = `피어링 ${state[0]}`; ctx.font = U.font(11, 600); C.pill(ctx, w - ctx.measureText(s).width - 30, 0, s, state[1]); }
        const gap = narrow ? 22 : 80, gw = (w - gap) / 2, gx = (j) => j * (gw + gap), cy = 79;
        const vm = (j) => ({ x: gx(j) + 8, y: 58, w: gw - 16, h: 42, t: 'VM', s: NET[j].ip });
        const k0 = i === 0 ? ease(t, 1.2, 2.4) : 0, kGo = i === 2 ? ease(t, 0.8, 2.4) : 0, kBack = i === 2 ? ease(t, 2.8, 4.4) : 0;
        NET.forEach((n, j) => {
          C.group(ctx, gx(j), 32, gw, 172, narrow ? n.name : `${n.name} ${n.cidr}`, 48);
          if (narrow) C.text(ctx, n.cidr, gx(j) + gw - 10, 48, { size: 10, align: 'right' });
          C.card(ctx, vm(j), { lit: (j === 0 && (k0 > 0 || (kGo > 0 && kGo < 1))) || (j === 1 && kGo >= 1 && kBack <= 0) || (j === 0 && kBack >= 1) });
          const add = i === 0 ? 0 : i === 1 ? ease(t, j ? 3.0 : 2.0, j ? 3.6 : 2.6) : 1;
          const lit = (r) => (i === 0 && j === 0 && t > 0.8 && r === 1 ? 'bad' : i === 2 && ((j === 0 && kGo > 0 && kBack <= 0) || (j === 1 && kBack > 0)) && r === 2 ? 'on' : i === 1 && r === 2 && add > 0 && add < 1 ? 'ok' : '');
          table(ctx, gx(j) + 6, 112, gw - 12, '라우팅 테이블', n.rows, lit, (r) => (r === 2 ? add : 1));
        });
        const ax = gx(0) + gw - 8, bx = gx(1) + 8;
        const l1 = i === 0 ? 0 : i === 1 ? ease(t, 0.4, 1.4) : 1, l2 = i === 0 ? 0 : i === 1 ? ease(t, 1.8, 2.8) : 1, lc = l2 >= 1 ? U.accentLine : '#94a3b8';
        C.arrow(ctx, [[ax, cy - 9], [bx, cy - 9]], l1, lc, { width: 1.4 });
        C.arrow(ctx, [[bx, cy + 9], [ax, cy + 9]], l2, lc, { width: 1.4 });
        if (!narrow && l2 >= 1) C.text(ctx, 'Microsoft 백본', (ax + bx) / 2, cy + 30, { size: 9, align: 'center' });
        if (i === 0 && k0 > 0) { if (k0 < 1) dot(ctx, at([[ax, cy], [gx(0) + gw - 2, cy]], k0)); else cross(ctx, gx(0) + gw, cy, ease(t, 2.4, 2.6)); }
        if (kGo > 0 && kGo < 1) dot(ctx, at([[ax, cy], [bx, cy]], kGo));
        if (kBack > 0 && kBack < 1) dot(ctx, at([[bx, cy], [ax, cy]], kBack), ORANGE[2]);
        if (i === 2) C.stamp(ctx, w / 2, h - 18, '인터넷을 거치지 않음', 'ok', (t - 4.6) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    };
  });

  // Demo: A-B and B-C peerings do not carry A to C; a hub NVA with UDRs on both sides does.
  fig('transit', (root) => {
    const narrow = root.clientWidth < 560, END = 6.2;
    const MODES = [
      { pill: '피어링만', note: 'A-B, B-C 피어링만 있으면 A의 라우팅 테이블에 C 대역이 없어 패킷이 버려진다.' },
      { pill: '허브 NVA 경유', note: '양쪽 서브넷에 허브 NVA로 가는 UDR을 두면 NVA가 A와 C 사이를 대신 전달한다.' },
    ];
    const NET = [['VNet A', '10.1.0.0/16', 'VM A', '10.1.1.4'], ['VNet B (허브)', '10.2.0.0/16', 'NVA', '10.2.0.4'], ['VNet C', '10.3.0.0/16', 'VM C', '10.3.1.4']];
    return {
      height: 294, notes: notesOf(MODES), demo: { modes: MODES.map((m) => m.pill), run: 'A에서 C로 보내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const mode = ui.mode, run = ui.runAt === null ? -1 : time - ui.runAt, done = run >= END;
        C.pill(ctx, 0, 0, MODES[mode].pill, run < 0 ? 'info' : mode ? 'ok' : 'bad');
        if (run < 0) C.text(ctx, '버튼을 눌러 보자', w, 11, { size: 10, align: 'right', base: 'middle' });
        const gap = narrow ? 12 : 40, gw = (w - 2 * gap) / 3, gx = (j) => j * (gw + gap), gy = 32, cy = gy + 74;
        const card = (j) => ({ x: gx(j) + 8, y: cy - 22, w: gw - 16, h: 44, t: NET[j][2], s: NET[j][3] });
        const go = mode ? ease(run, 0.8, 3.0) : ease(run, 0.8, 2.0), back = mode ? ease(run, 3.4, 5.6) : 0;
        const pos = (k, rev) => (rev ? 1 - k : k), xA = gx(0) + gw - 8, xC = gx(2) + 8;
        NET.forEach((n, j) => {
          C.group(ctx, gx(j), gy, gw, 118, n[0], gy + 16);
          C.text(ctx, n[1], gx(j) + 10, gy + 31, { size: 10 });
          const nva = j === 1, hot = nva && mode && ((go > 0.3 && go < 0.7) || (back > 0.3 && back < 0.7));
          C.card(ctx, card(j), nva && !mode ? { dim: true, dash: [4, 3], fill: U.plot } : { lit: hot || (mode && j === 2 && go >= 1 && back <= 0) || (j === 0 && back >= 1) });
        });
        [0, 1].forEach((j) => {
          C.line(ctx, [[gx(j) + gw, cy], [gx(j + 1), cy]], '#94a3b8', 2);
          if (gap >= 40) C.text(ctx, '피어링', gx(j) + gw + gap / 2, cy - 8, { size: 9, align: 'center' });
        });
        const tW = (w - 12) / 2, A = [['10.2.0.0/16', 'VNet 피어링'], ['10.0.0.0/8', '없음']], Cr = [['10.2.0.0/16', 'VNet 피어링'], ['10.0.0.0/8', '없음']];
        if (mode) { A.push(['10.3.0.0/16', 'NVA 10.2.0.4']); Cr.push(['10.1.0.0/16', 'NVA 10.2.0.4']); }
        table(ctx, 0, 164, tW, 'A 서브넷 경로', A, (r) => (run > 0.4 && back <= 0 ? (mode ? (r === 2 ? 'on' : '') : r === 1 ? 'bad' : '') : ''));
        table(ctx, w - tW, 164, tW, 'C 서브넷 경로', Cr, (r) => (back > 0 && r === 2 ? 'on' : ''));
        if (!mode && go > 0) { if (go < 1) dot(ctx, at([[xA, cy], [gx(0) + gw - 2, cy]], go)); else cross(ctx, gx(0) + gw, cy, ease(run, 2.0, 2.2)); }
        if (mode && go > 0 && go < 1) dot(ctx, at([[xA, cy], [xC, cy]], pos(go)));
        if (mode && back > 0 && back < 1) dot(ctx, at([[xA, cy], [xC, cy]], pos(back, true)), ORANGE[2]);
        if (done) C.stamp(ctx, w / 2, h - 18, mode ? 'NVA 거쳐 왕복' : 'C로 가는 경로 없음', mode ? 'ok' : 'bad', (run - END) / 0.4);
        say(`${MODES[mode].pill}. ${MODES[mode].note}`);
      },
    };
  });

  // Hub and spoke: without gateway transit the office never learns the spoke range.
  fig('hub', (root) => {
    const narrow = root.clientWidth < 560, SEC = 6.4, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2);
    const SC = [
      { pill: '게이트웨이 전송 끔', tone: 'warn', stamp: ['스포크 경로 모름', 'bad'], note: '게이트웨이 전송을 켜지 않으면 허브 게이트웨이가 스포크 대역을 광고하지 않아 사무실은 길을 모른다.' },
      { pill: '게이트웨이 전송 켬', tone: 'ok', stamp: ['스포크 1까지 도착', 'ok'], note: '허브에 게이트웨이 전송, 스포크에 원격 게이트웨이 사용을 켜면 스포크 대역이 사무실까지 광고된다.' },
    ];
    return {
      height: 300, still: SEC + HOLD + SEC, scenes: S, notes: notesOf(SC),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), sc = SC[i], cy = 101;
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        const ow = narrow ? 70 : 110, hx = ow + (narrow ? 18 : 50), hw = narrow ? 112 : 170, sx = hx + hw + (narrow ? 18 : 50), sw = w - sx;
        const office = { x: 0, y: cy - 28, w: ow, h: 56, t: '사무실', s: '10.0.0.0/16' }, gw = { x: hx + 8, y: cy - 24, w: hw - 16, h: 48, t: 'VPN 게이트웨이', size: 11 };
        const sp = [{ x: sx, y: 40, w: sw, h: 50, t: '스포크 1', s: '10.2.0.0/16' }, { x: sx, y: 112, w: sw, h: 50, t: '스포크 2', s: '10.3.0.0/16' }];
        C.group(ctx, hx, 32, hw, 138, narrow ? '허브' : '허브 10.1.0.0/16', 48);
        tunnel(ctx, [[ow, cy], [gw.x, cy]]);
        if (!narrow) C.text(ctx, 'IPsec 터널', (ow + gw.x) / 2, cy - 8, { size: 9, align: 'center' });
        sp.forEach((s) => C.line(ctx, [[hx + hw, cy], [sx - 8, cy], [sx - 8, s.y + 25], [sx, s.y + 25]], '#94a3b8', 1.4));
        const path = [[ow, cy], [gw.x + gw.w, cy], [sx - 8, cy], [sx - 8, sp[0].y + 25], [sx, sp[0].y + 25]];
        const k = i ? ease(t, 2.8, 4.8) : ease(t, 1.4, 2.2);
        C.card(ctx, office, { lit: k > 0 && k < 0.3 });
        C.card(ctx, gw, { lit: i === 1 && k > 0.2 && k < 0.6 });
        sp.forEach((s, j) => C.card(ctx, s, { lit: i === 1 && j === 0 && k >= 1 }));
        if (i === 0 && k > 0) { if (k < 1) dot(ctx, at([[ow - 30, cy], [ow - 2, cy]], k)); else cross(ctx, ow + 4, cy, ease(t, 2.2, 2.4)); }
        if (i === 1 && k > 0 && k < 1) dot(ctx, at(path, k));
        const by = 186, cw = (w - 12) / 2;
        C.text(ctx, '피어링 설정', 0, by + 9, { size: 10, weight: 600, color: U.text, base: 'middle' });
        (narrow ? [['허브', 'GW 전송 허용'], ['스포크', '원격 GW 사용']] : [['허브', '게이트웨이 전송 허용'], ['스포크', '원격 게이트웨이 사용']]).forEach(([who, s], j) => {
          const y = by + 20 + j * 24, on = i === 1 && t > 0.6 + j * 0.6;
          C.box(ctx, 0, y, cw, 20, { fill: '#fff', on, r: 4 });
          ctx.beginPath(); ctx.roundRect(7, y + 5, 10, 10, 2); ctx.fillStyle = on ? U.accent : '#fff'; ctx.fill(); ctx.strokeStyle = on ? U.accent : '#cbd5e1'; ctx.stroke();
          if (on) C.line(ctx, [[9, y + 10], [11.5, y + 12.5], [15, y + 7.5]], '#fff', 1.6);
          C.text(ctx, `${who}: ${s}`, 23, y + 10.5, { size: 10, weight: 600, color: on ? U.text : U.muted, base: 'middle' });
        });
        const add = (j) => (i === 0 ? 0 : ease(t, 1.8 + j * 0.4, 2.3 + j * 0.4));
        table(ctx, w - cw, by, cw, '사무실 장비의 경로', [['10.1.0.0/16', '터널'], ['10.2.0.0/16', '터널'], ['10.3.0.0/16', '터널']],
          (r) => (r === 1 && i === 1 && k > 0 && k < 1 ? 'on' : r && add(r - 1) > 0 && add(r - 1) < 1 ? 'ok' : ''), (r) => (r ? add(r - 1) : 1));
        C.stamp(ctx, w / 2, h - 18, sc.stamp[0], sc.stamp[1], (t - (i ? 5.0 : 2.8)) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    };
  });

  // IPsec site-to-site: the original packet gets encrypted and wrapped in a public-IP header for the trip.
  fig('ipsec', () => {
    const SEC = 5.2, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3);
    // Data: 203.0.113.0/24 and 198.51.100.0/24 are documentation ranges (RFC 5737).
    const SC = [
      { pill: '사무실 안', note: '사무실 PC는 VNet의 사설 IP로 평소처럼 패킷을 보낸다.' },
      { pill: '인터넷 구간', note: 'FortiGate가 원래 패킷을 암호화하고 공인 IP 헤더를 씌워 보낸다. 인터넷에서는 바깥 헤더만 보인다.' },
      { pill: 'Azure 안', note: 'Azure VPN 게이트웨이가 바깥 헤더를 벗기고 복호화해 원래 패킷을 VNet에 넘긴다.' },
    ];
    const NODES = [{ t: 'PC', s: '10.0.1.10' }, { t: 'FortiGate', s: 'wan1' }, { t: '인터넷' }, { t: 'VPN GW', s: 'Azure' }, { t: 'VM', s: '10.1.1.4' }];
    return {
      height: 270, still: 2 * (SEC + HOLD) + SEC, scenes: S, notes: notesOf(SC),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3);
        C.pill(ctx, 0, 0, SC[i].pill, i === 1 ? 'warn' : 'info');
        const g = 8, nw = (w - 8 - 4 * g) / 5, nx = (j) => 4 + j * (nw + g), ny = 44, cy = ny + 56;
        [[0, 1, '사무실 10.0.0.0/16'], [3, 4, 'VNet 10.1.0.0/16']].forEach(([a, b, s]) => {
          C.box(ctx, nx(a) - 3, 28, nx(b) + nw - nx(a) + 6, 84, { fill: U.plot, r: 8 });
          C.text(ctx, w < 480 ? s.split(' ')[0] : s, nx(a) + 4, 39, { size: 9, weight: 600 });
        });
        const k = i === 0 ? ease(t, 0.8, 2.4) : i === 1 ? ease(t, 1.4, 3.6) : ease(t, 1.4, 3.0), seg = [[0, 1], [1, 3], [3, 4]][i];
        rail(ctx, [[nx(0) + nw / 2, cy], [nx(4) + nw / 2, cy]], '#e2e8f0');
        tunnel(ctx, [[nx(1) + nw / 2, cy], [nx(3) + nw / 2, cy]], 1, i === 1 ? ORANGE[2] : '#fcd34d');
        NODES.forEach((n, j) => C.card(ctx, { x: nx(j), y: ny, w: nw, h: 46, t: n.t, s: n.s, size: 11 }, j === 2 ? { fill: U.plot, dash: [4, 3] } : { lit: (j === seg[0] && k > 0 && k < 0.15) || (j === seg[1] && k >= 1) }));
        if (k > 0 && k < 1) {
          const [x, y] = at([[nx(seg[0]) + nw / 2, cy], [nx(seg[1]) + nw / 2, cy]], k);
          if (i === 1) { ctx.beginPath(); ctx.roundRect(x - 9, y - 7, 18, 14, 3); ctx.fillStyle = ORANGE[2]; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1; } else dot(ctx, [x, y]);
        }
        C.text(ctx, '패킷 모양', 0, 132, { size: 10, weight: 600, color: U.text, base: 'middle' });
        if (i === 1) C.text(ctx, '인터넷에서는 바깥 헤더만 읽힌다', w, 132, { size: 10, weight: 600, color: ORANGE[1], align: 'right', base: 'middle' });
        const wrap = i === 1 ? ease(t, 0.3, 1.1) : i === 2 ? 1 - ease(t, 0.3, 1.1) : 0, lock = i === 1 ? ease(t, 0.2, 0.8) : 0;
        const B = [
          { s: '바깥 IP  203.0.113.10 → 198.51.100.20', c: ORANGE, a: wrap, outer: true },
          { s: 'ESP 헤더', c: ORANGE, a: wrap, outer: true },
          { s: 'IP  10.0.1.10 → 10.1.1.4', c: [U.accentSoft, U.blue, U.accentLine], a: 1 },
          { s: 'TCP 데이터', c: [U.cell, U.muted, '#e2e8f0'], a: 1 },
        ];
        let y = 146;
        B.forEach((b) => {
          if (b.a <= 0) return;
          const bh = 26 * b.a;
          ctx.globalAlpha = b.a;
          C.box(ctx, 0, y, w, bh - 4, { fill: b.c[0], stroke: b.c[2], r: 5 });
          if (!b.outer && lock > 0) { ctx.globalAlpha = lock; ctx.fillStyle = C.hatch(ctx, '#cbd5e1'); ctx.beginPath(); ctx.roundRect(0.5, y + 0.5, w - 1, bh - 5, 5); ctx.fill(); ctx.globalAlpha = b.a; }
          if (bh > 14) {
            C.text(ctx, b.s, 10, y + bh / 2 - 1.5, { size: 10, weight: 600, color: b.c[1], base: 'middle' });
            if (!b.outer && lock > 0.5) C.text(ctx, '암호화됨', w - 10, y + bh / 2 - 1.5, { size: 10, weight: 700, color: ORANGE[1], align: 'right', base: 'middle' });
          }
          ctx.globalAlpha = 1;
          y += bh;
        });
        say(`${SC[i].pill}. ${SC[i].note}`);
      },
    };
  });

  // IKEv2 setup as two lanes: four messages then ESP; a proposal mismatch stops at the first reply.
  fig('ike', (root) => {
    const narrow = root.clientWidth < 560, SEC = 6.6, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2);
    const SC = [
      { pill: '제안 일치', tone: 'ok', stamp: ['터널 연결', 'ok'], note: '첫 왕복에서 알고리즘과 DH 키를 맞추고, 두 번째 왕복에서 PSK로 서로를 확인하며 IPsec SA를 만든다.', msgs: [
        ['A', 'IKE_SA_INIT 요청: 제안, DH 공개값'], ['B', 'IKE_SA_INIT 응답: 고른 제안, DH 공개값'], ['A', 'IKE_AUTH 요청: PSK 인증, IPsec SA 제안'], ['B', 'IKE_AUTH 응답: 인증, IPsec SA 확정'],
      ] },
      { pill: '제안 불일치', tone: 'bad', stamp: ['첫 응답에서 멈춤', 'bad'], note: '한쪽은 DH 2만, 다른 쪽은 DH 14만 받으면 첫 응답이 NO_PROPOSAL_CHOSEN으로 끝난다.', msgs: [
        ['A', 'IKE_SA_INIT 요청: DH 2만 제안'], ['B', '응답: NO_PROPOSAL_CHOSEN', 'bad'],
      ] },
    ];
    const XS = [0.04, 0.18, 0.36, 0.5];
    return {
      height: 286, still: SEC + HOLD + SEC, scenes: S, notes: notesOf(SC),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), sc = SC[i];
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        const lw = narrow ? 66 : 110, x0 = lw, x1 = w - 6, yA = 54, yB = 136, X = (f) => x0 + f * (x1 - x0), dx = (x1 - x0) * 0.09;
        [[yA, 'FortiGate', '사무실'], [yB, 'Azure GW', 'VPN 게이트웨이']].forEach(([y, a, b]) => {
          C.text(ctx, a, 0, y - 6, { size: 11, weight: 600, color: U.text, base: 'middle' });
          C.text(ctx, b, 0, y + 9, { size: 9, base: 'middle' });
          C.line(ctx, [[x0, y], [x1, y]], '#cbd5e1', 1.2);
        });
        if (i === 0) [[0, 0.27, '키 교환'], [0.32, 0.59, '인증, SA'], [0.64, 1, 'ESP 데이터']].forEach(([a, b, s], j) => {
          if (t < 0.4 + j * 1.8) return;
          C.line(ctx, [[X(a), yA - 20], [X(a), yA - 26], [X(b), yA - 26], [X(b), yA - 20]], U.muted, 1);
          C.text(ctx, s, (X(a) + X(b)) / 2, yA - 31, { size: 9, weight: 600, align: 'center' });
        });
        const cur = Math.min(sc.msgs.length - 1, Math.floor((t - 0.4) / 0.9));
        sc.msgs.forEach(([from, , bad], j) => {
          const k = ease(t, 0.4 + j * 0.9, 1.1 + j * 0.9);
          if (k <= 0) return;
          const xa = X(XS[j]), pts = from === 'A' ? [[xa, yA + 3], [xa + dx, yB - 3]] : [[xa, yB - 3], [xa + dx, yA + 3]];
          C.arrow(ctx, pts, k, bad ? U.red : j === cur && t < 4.2 ? U.accent : '#94a3b8', { width: 1.6 });
          C.badge(ctx, pts, j + 1, j === cur && t < 4.2, 'left', 0.5);
        });
        if (i === 0 && t > 4.0) for (let j = 0; j < 7; j++) {
          const f = 0.66 + j * 0.05, k = ease(t, 4.0 + j * 0.2, 4.4 + j * 0.2), pts = j % 2 ? [[X(f), yB - 3], [X(f) + dx * 0.4, yA + 3]] : [[X(f), yA + 3], [X(f) + dx * 0.4, yB - 3]];
          C.arrow(ctx, pts, k, U.blue, { width: 1.4 });
        }
        if (i === 1 && t > 2.2) cross(ctx, X(0.34), (yA + yB) / 2, ease(t, 2.2, 2.4));
        sc.msgs.forEach(([, s, bad], j) => {
          const y = 168 + j * 22, on = t > 0.4 + j * 0.9;
          if (!on) return;
          C.text(ctx, `${j + 1}. ${s}`, 0, y, { size: 10, weight: j === cur ? 700 : 400, color: bad ? U.red : j === cur ? U.text : U.muted, base: 'middle' });
        });
        C.stamp(ctx, w / 2, h - 18, sc.stamp[0], sc.stamp[1], (t - (i ? 2.8 : 5.6)) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    };
  });

  // Demo: the same 10.0.0.0/16 on both sides keeps the packet inside the VNet.
  fig('overlap', (root) => {
    const narrow = root.clientWidth < 560, END = 3.6;
    const MODES = [
      { pill: '대역 겹침', vnet: '10.0.0.0/16', ip: '10.0.1.4', rows: [['10.0.0.0/16', '가상 네트워크 (VNet 대역)'], ['10.0.0.0/16', 'VPN 게이트웨이 (사무실)']], st: ['bad', 'dead'], note: 'VNet과 사무실이 둘 다 10.0.0.0/16이면 VNet 대역 경로가 우선이라 패킷이 터널로 가지 않는다.' },
      { pill: '대역 분리', vnet: '10.1.0.0/16', ip: '10.1.1.4', rows: [['10.1.0.0/16', '가상 네트워크 (VNet 대역)'], ['10.0.0.0/16', 'VPN 게이트웨이 (사무실)']], st: ['', 'on'], note: 'VNet을 10.1.0.0/16으로 잡으면 사무실 대역이 게이트웨이 경로를 따라 터널로 간다.' },
    ];
    return {
      height: 262, notes: notesOf(MODES), demo: { modes: MODES.map((m) => m.pill), run: '사무실 서버로 보내기' },
      frame: (ctx, w, h, time, say, ui) => {
        const mode = ui.mode, m = MODES[mode], run = ui.runAt === null ? -1 : time - ui.runAt;
        C.pill(ctx, 0, 0, `${m.pill}, 목적지 10.0.1.10`, run < 0 ? 'info' : mode ? 'ok' : 'bad');
        const vw = Math.round(w * (narrow ? 0.56 : 0.5)), cw = (vw - 30) / 2, ox = vw + (narrow ? 24 : 60), ow = w - ox, cy = 80;
        C.group(ctx, 0, 32, vw, 112, narrow ? `VNet ${m.vnet}` : `VNet ${m.vnet}`, 48);
        C.group(ctx, ox, 32, ow, 112, narrow ? '사무실' : '사무실 10.0.0.0/16', 48);
        if (narrow) C.text(ctx, '10.0.0.0/16', ox + 10, 136, { size: 10 });
        const vm = { x: 10, y: cy - 22, w: cw, h: 44, t: 'VM', s: m.ip }, gw = { x: 20 + cw, y: cy - 22, w: cw, h: 44, t: 'VPN GW', size: 11 };
        const srv = { x: ox + 10, y: cy - 22, w: ow - 20, h: 44, t: '서버', s: '10.0.1.10' }, ghost = { x: 10, y: 110, w: cw, h: 26 };
        tunnel(ctx, [[gw.x + gw.w, cy], [srv.x, cy]]);
        const k = mode ? ease(run, 0.9, 3.0) : ease(run, 0.9, 2.0), done = run >= END;
        C.card(ctx, vm, { lit: k > 0 && k < 0.2 });
        C.card(ctx, gw, { lit: mode && k > 0.3 && k < 0.5 });
        C.card(ctx, srv, { lit: mode && k >= 1 });
        if (!mode && k > 0.6) {
          C.box(ctx, ghost.x, ghost.y, ghost.w, ghost.h, { fill: RED[0], stroke: '#fca5a5', dash: [3, 3], r: 6 });
          C.text(ctx, '10.0.1.10 없음', ghost.x + ghost.w / 2, ghost.y + 13.5, { size: 10, weight: 600, color: RED[1], align: 'center', base: 'middle' });
        }
        const path = mode ? [[vm.x + vm.w, cy], [srv.x, cy]] : [[vm.x + vm.w / 2, cy + 22], [vm.x + vm.w / 2, ghost.y]];
        if (k > 0 && k < 1) dot(ctx, at(path, k));
        if (!mode && k >= 1) cross(ctx, ghost.x + ghost.w + 12, ghost.y + 13, ease(run, 2.0, 2.2));
        table(ctx, 0, 156, w, 'VM 서브넷의 경로', m.rows, (j) => (run > 0.5 ? m.st[j] : m.st[j] === 'dead' ? 'dead' : ''));
        if (run < 0) C.text(ctx, '버튼을 눌러 보자', w / 2, h - 18, { size: 12, align: 'center', base: 'middle' });
        if (done) C.stamp(ctx, w / 2, h - 20, mode ? '사무실 서버 도착' : '터널로 가지 않음', mode ? 'ok' : 'bad', (run - END) / 0.4);
        say(`${m.pill}. ${m.note}`);
      },
    };
  });

  // Asymmetric path: the request skips the firewall, the reply hits it with no session.
  fig('asym', (root) => {
    const narrow = root.clientWidth < 560, SEC = 6, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 2);
    const SC = [
      { pill: '비대칭 경로', tone: 'bad', gwr: ['10.2.0.0/16', 'VNet 피어링'], stamp: ['세션 없음, 응답 버림', 'bad'], note: '갈 때는 게이트웨이에서 VM으로 바로 가고, 올 때만 방화벽을 지나서 방화벽이 처음 보는 응답을 버린다.' },
      { pill: '대칭 경로', tone: 'ok', gwr: ['10.2.0.0/16', '방화벽 10.1.9.4'], stamp: ['왕복이 같은 방화벽', 'ok'], note: 'GatewaySubnet에도 스포크 대역을 방화벽으로 보내는 UDR을 두면 왕복이 같은 방화벽을 지난다.' },
    ];
    return {
      height: 262, still: SEC + HOLD + SEC, scenes: S, notes: notesOf(SC),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), sc = SC[i];
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        ctx.font = U.font(10);
        C.legend(ctx, w - tw(ctx, '요청응답', 10) - 36, 11, [['요청', U.blue], ['응답', ORANGE[2]]]);
        const ow = narrow ? 64 : 100, hx = ow + 16, hw = narrow ? 120 : 200, sx = hx + hw + 16, sw = w - sx, gy = 128, fy = 75, vy = 102;
        const office = { x: 0, y: gy - 26, w: ow, h: 52, t: '사무실', s: '10.0.0.0/16' };
        const fw = { x: hx + 10, y: fy - 20, w: hw - 20, h: 40, t: '방화벽', s: '10.1.9.4' }, gw = { x: hx + 10, y: gy - 20, w: hw - 20, h: 40, t: 'VPN GW' };
        const vm = { x: sx + 10, y: vy - 22, w: sw - 20, h: 44, t: 'VM', s: '10.2.1.4' };
        C.group(ctx, hx, 32, hw, 136, '', 48);
        C.text(ctx, narrow ? '허브' : '허브 10.1.0.0/16', hx + 10, 46, { size: 10, weight: 600 });
        C.group(ctx, sx, 32, sw, 136, '', 48);
        C.text(ctx, narrow ? '스포크' : '스포크 10.2.0.0/16', sx + 10, 46, { size: 10, weight: 600 });
        const ex = sx - 8, REQ = i ? [[ow, gy], [hx + hw / 2, gy], [hx + hw / 2, fy], [hx + hw - 10, fy], [ex, fy], [ex, vy], [vm.x, vy]] : [[ow, gy], [hx + hw - 10, gy], [ex, gy], [ex, vy], [vm.x, vy]];
        const REP = i ? REQ.slice().reverse() : [[vm.x, vy], [ex, vy], [ex, fy], [hx + hw - 10, fy]];
        rail(ctx, REQ, '#bfdbfe');
        rail(ctx, REP.map(([x, y]) => [x, y + 4]), '#fde68a');
        const kq = ease(t, 0.5, 2.4), kr = ease(t, 2.8, 4.4), atFw = (k, pts) => { const [x, y] = at(pts, k); return x > fw.x && x < fw.x + fw.w && Math.abs(y - fy) < 4; };
        C.card(ctx, office, { lit: kr >= 1 && i === 1 });
        C.card(ctx, fw, { lit: (kq > 0 && kq < 1 && atFw(kq, REQ)) || (kr > 0 && kr < 1 && atFw(kr, REP)), stroke: i === 0 && kr >= 1 ? RED[2] : U.grid });
        C.card(ctx, gw);
        C.card(ctx, vm, { lit: kq >= 1 && kr <= 0 });
        if (kq > 0 && kq < 1) dot(ctx, at(REQ, kq));
        if (kr > 0 && kr < 1) dot(ctx, at(REP, kr).map((v, j) => v + (j ? 4 : 0)), ORANGE[2]);
        if (i === 0 && kr >= 1) cross(ctx, hx + hw - 10, fy + 4, ease(t, 4.4, 4.6), 5);
        const tW = (w - 12) / 2, ty = 180;
        table(ctx, 0, ty, tW, 'GatewaySubnet 경로', [sc.gwr], () => (i === 1 ? 'on' : ''));
        table(ctx, w - tW, ty, tW, '스포크 서브넷 경로', [['0.0.0.0/0', '방화벽 10.1.9.4']], () => 'on');
        C.stamp(ctx, w / 2, h - 22, sc.stamp[0], sc.stamp[1], (t - 4.7) / 0.4);
        say(`${sc.pill}. ${sc.note}`);
      },
    };
  });

})();
