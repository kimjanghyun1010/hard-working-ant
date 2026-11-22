// Live samples for the design system page (/design/).
(() => {
  const U = hwa.ui, C = hwa.cv;
  const TONES = [['ok', '정상'], ['warn', '주의'], ['bad', '문제'], ['info', '정보']];

  document.querySelectorAll('[data-figure="ds-tones"]').forEach((root) => {
    hwa.scene(root, {
      height: 64,
      frame: (ctx, w, h, time, say) => {
        let x = 0;
        TONES.forEach(([tone, s]) => {
          C.pill(ctx, x, 0, s, tone);
          ctx.font = hwa.ui.font(11, 600);
          x += ctx.measureText(s).width + 40;
        });
        x = 0;
        TONES.forEach(([tone]) => { x += C.chipW(ctx, tone) + 8; C.chip(ctx, tone, x - 8, 50, tone); });
        say('상태 알약 네 가지와 같은 색의 값 칩');
      },
    });
  });

  // hwa.steps: one row per step, the current row tinted, its chip sliding in.
  document.querySelectorAll('[data-figure="ds-steps"]').forEach((root) => {
    const rows = [['첫째 층', '설명 글', 'value: 1'], ['둘째 층', '좁으면 숨는다', 'value = 2'], ['셋째 층', '', '마지막 값']];
    hwa.scene(root, {
      height: rows.length * 58 - 4,
      still: rows.length * 1.1,
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, rows.length, 1.1, 2);
        rows.forEach(([name, unit, v], i) => {
          const y = i * 58;
          C.box(ctx, 0, y, w, 52, { on: i === s.active });
          C.text(ctx, name, 12, y + 22, { size: 13, weight: 600, color: U.text });
          if (unit) C.text(ctx, unit, 12, y + 40, { size: 11 });
          C.chip(ctx, v, w - 8, y + 26, 'info', s.k(i));
        });
        say('세 층이 차례로 강조되고 값 칩이 나타난다');
      },
    });
  });

  // Cards, a group and arrows that grow with numbered badges.
  document.querySelectorAll('[data-figure="ds-flow"]').forEach((root) => {
    hwa.scene(root, {
      height: 150,
      still: 2 * 1.2,
      frame: (ctx, w, h, time, say) => {
        const s = hwa.steps(time, 2, 1.2, 1.6), bw = Math.min(120, (w - 80) / 3);
        const A = { x: 12, y: 50, w: bw, h: 52, t: '카드 A', s: '부제' };
        const B = { x: 12 + bw + 40, y: 50, w: bw, h: 52, t: '카드 B' };
        const D = { x: w - bw, y: 50, w: bw, h: 52, t: '카드 C' };
        C.group(ctx, 0, 0, B.x + bw + 12, h, 'group');
        const ab = [[A.x + bw, 76], [B.x, 76]], bd = [[B.x + bw, 76], [D.x, 76]];
        [ab, bd].forEach((p, i) => {
          C.arrow(ctx, p, s.k(i), i === s.active ? U.accent : U.now);
          C.badge(ctx, p, i + 1, i === s.active);
        });
        C.card(ctx, A);
        C.card(ctx, B, { lit: s.active === 0 });
        C.card(ctx, D, { lit: s.active === 1, fill: '#eff6ff', stroke: '#93c5fd' });
        say('카드 A에서 B, B에서 C로 화살표가 차례로 자란다');
      },
    });
  });

  // hwa.loop: two phases with a status pill, a line that draws itself and an endpoint label.
  document.querySelectorAll('[data-figure="ds-chart"]').forEach((root) => {
    const phases = [{ pill: '여유 있음', tone: 'ok', amp: 0.3, color: U.blue }, { pill: '바쁨', tone: 'bad', amp: 0.85, color: U.red }];
    hwa.scene(root, {
      height: 190,
      still: 5,
      frame: (ctx, w, h, time, say) => {
        const { i, k } = hwa.loop(time, 5, 1.2, phases.length), p = phases[i];
        C.pill(ctx, 0, 0, p.pill, p.tone);
        const x0 = 36, x1 = w - 60, Y = C.panel(ctx, x0, 52, x1 - x0, 120, { title: '사용량', right: '최근 10초', max: 1, ticks: [[0, '0'], [0.5, '0.5'], [1, '1']] });
        const pts = [];
        for (let m = 0; m <= k * 100; m++) pts.push([x0 + m / 100 * (x1 - x0), Y(p.amp * (0.75 + 0.25 * Math.sin(m / 6)))]);
        C.area(ctx, pts, Y(0), p.color + '22');
        C.line(ctx, pts, p.color);
        const [ex, ey] = pts[pts.length - 1];
        C.dot(ctx, ex, ey, p.color, `${Math.round(p.amp * 100)}%`);
        say(`${p.pill}: 선이 왼쪽에서 오른쪽으로 그려진다`);
      },
    });
  });
})();
