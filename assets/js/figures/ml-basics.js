// ML basics post: one training step, batches and epochs, tabular pitfalls, GPU resources, MLOps loop.
(() => {
  const U = hwa.ui, C = hwa.cv, TAU = Math.PI * 2;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const mix = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  const BLUE = ['#dbeafe', '#1d4ed8', '#93c5fd'], RED = ['#fee2e2', '#dc2626', '#fca5a5'], GREEN = ['#dcfce7', '#15803d', '#86efac'];
  const AMBER = ['#fef3c7', '#b45309', '#fcd34d'], GRAY = [U.cell, U.muted, '#e2e8f0'];
  const fig = (name, fn) => document.querySelectorAll(`[data-figure="${name}"]`).forEach(fn);
  // Chip centred at (x, y). col = [bg, fg, line].
  const tag = (ctx, s, x, y, col, a = 1, size = 11) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, size, 600) + 16;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x - cw / 2 + 0.5, y - 9.5, cw - 1, 19, 6);
    ctx.fillStyle = col[0];
    ctx.fill();
    ctx.strokeStyle = col[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x, y + 0.5, { size, weight: 600, color: col[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  // Big number with a small label above it, for the metric row of a figure.
  const stat = (ctx, x, y, label, value, color = U.text, align = 'left') => {
    C.text(ctx, label, x, y, { size: 10, align });
    C.text(ctx, value, x, y + 20, { size: 17, weight: 700, color, align });
  };
  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };

  // Thoracic: Adam lr 1e-4, batch 16, ID dropped, stratified 80/20, scaler fit on train. MNIST memory and losses: PyTorch 2.15,
  // official example on CPU, seed 1. firstSteps every 5th of the first 200 steps, batch-64 every 15th step, batch-1024 every step.
  const M = {
    over: { best: 21, max: 0.9, ticks: [[0, '0'], [0.4, '0.4'], [0.8, '0.8']], train: [0.626,0.608,0.591,0.574,0.556,0.539,0.521,0.505,0.489,0.474,0.46,0.448,0.439,0.429,0.422,0.416,0.409,0.404,0.399,0.395,0.391,0.388,0.385,0.382,0.38,0.377,0.375,0.373,0.371,0.369,0.367,0.365,0.363,0.361,0.36,0.358,0.356,0.355,0.353,0.352,0.351,0.35,0.348,0.347,0.346,0.345,0.344,0.343,0.342,0.341,0.34,0.339,0.338,0.337,0.336,0.335,0.335,0.334,0.333,0.332,0.331,0.331,0.33,0.329,0.328,0.328,0.327,0.326,0.325,0.325,0.324,0.323,0.322,0.322,0.321,0.32,0.32,0.319,0.318,0.318,0.317,0.316,0.316,0.315,0.314,0.314,0.313,0.312,0.312,0.311,0.311,0.31,0.309,0.309,0.308,0.307,0.307,0.306,0.306,0.305,0.304,0.304,0.303,0.303,0.302,0.301,0.301,0.3,0.3,0.299,0.298,0.298,0.297,0.297,0.296,0.296,0.295,0.295,0.294,0.293,0.293,0.292,0.292,0.291,0.291,0.29,0.289,0.289,0.288,0.288,0.287,0.286,0.286,0.285,0.285,0.284,0.283,0.283,0.282,0.282,0.281,0.28,0.28,0.279,0.279,0.278,0.278,0.277,0.276,0.276,0.275,0.275,0.274,0.273,0.273,0.272,0.272,0.271,0.271,0.27,0.269,0.269,0.268,0.268,0.267,0.266,0.266,0.265,0.265,0.264,0.264,0.263,0.262,0.262,0.261,0.261,0.26,0.26,0.259,0.258,0.258,0.257,0.257,0.256,0.256,0.255,0.255,0.254,0.253,0.253,0.252,0.252,0.251,0.251,0.25,0.249,0.249,0.248,0.248,0.247,0.247,0.246,0.246,0.245,0.245,0.244,0.243,0.243,0.242,0.242,0.241,0.241,0.24,0.24,0.239,0.239,0.238,0.238,0.237,0.237,0.236,0.236,0.235,0.235,0.234,0.234,0.233,0.233,0.232,0.231,0.231,0.23,0.23,0.229,0.229,0.228,0.228,0.227,0.227,0.226,0.226,0.225,0.225,0.224,0.224,0.223,0.223,0.222,0.222,0.221,0.221,0.22,0.22,0.219,0.219,0.218,0.218,0.217,0.217,0.216,0.216,0.215,0.215,0.215,0.214,0.214,0.213,0.213,0.212,0.212,0.211,0.211,0.21,0.21,0.209,0.209,0.208,0.208,0.208,0.207,0.207,0.206,0.206,0.205,0.205,0.204,0.204,0.204,0.203,0.203,0.202,0.202,0.201,0.201,0.2,0.2,0.199,0.199,0.199,0.198], val: [0.629,0.613,0.598,0.583,0.568,0.553,0.539,0.526,0.513,0.501,0.491,0.483,0.477,0.472,0.468,0.465,0.463,0.461,0.46,0.459,0.459,0.459,0.459,0.459,0.46,0.46,0.461,0.462,0.463,0.463,0.464,0.464,0.465,0.467,0.467,0.468,0.469,0.47,0.47,0.472,0.473,0.475,0.476,0.477,0.479,0.479,0.481,0.482,0.484,0.485,0.486,0.488,0.489,0.49,0.491,0.493,0.494,0.495,0.496,0.497,0.498,0.5,0.501,0.503,0.504,0.506,0.507,0.508,0.51,0.51,0.512,0.514,0.514,0.516,0.516,0.518,0.519,0.52,0.521,0.523,0.524,0.525,0.527,0.528,0.529,0.531,0.532,0.534,0.535,0.536,0.537,0.538,0.539,0.54,0.541,0.543,0.543,0.545,0.546,0.547,0.548,0.549,0.55,0.551,0.553,0.554,0.556,0.557,0.558,0.56,0.56,0.562,0.563,0.565,0.565,0.566,0.568,0.57,0.57,0.572,0.573,0.574,0.574,0.576,0.576,0.577,0.579,0.579,0.58,0.582,0.582,0.584,0.586,0.587,0.588,0.59,0.592,0.592,0.592,0.594,0.596,0.596,0.599,0.599,0.601,0.602,0.602,0.604,0.606,0.607,0.609,0.609,0.611,0.611,0.613,0.614,0.614,0.616,0.617,0.62,0.621,0.622,0.621,0.624,0.625,0.627,0.629,0.629,0.631,0.631,0.632,0.634,0.635,0.636,0.638,0.639,0.64,0.641,0.643,0.645,0.645,0.646,0.648,0.649,0.651,0.652,0.653,0.654,0.656,0.656,0.659,0.658,0.66,0.662,0.664,0.664,0.666,0.667,0.669,0.67,0.671,0.673,0.674,0.676,0.677,0.678,0.678,0.68,0.682,0.683,0.684,0.685,0.687,0.688,0.69,0.69,0.692,0.693,0.695,0.697,0.699,0.701,0.701,0.702,0.703,0.706,0.707,0.707,0.708,0.711,0.711,0.713,0.715,0.716,0.718,0.719,0.719,0.721,0.722,0.724,0.725,0.727,0.729,0.73,0.732,0.734,0.737,0.736,0.738,0.739,0.742,0.743,0.744,0.745,0.748,0.749,0.751,0.752,0.752,0.755,0.755,0.757,0.76,0.763,0.762,0.765,0.767,0.768,0.769,0.77,0.772,0.773,0.775,0.776,0.778,0.78,0.781,0.783,0.784,0.786,0.787,0.79,0.79,0.792,0.793,0.796,0.798,0.799,0.801,0.803,0.804,0.805,0.806,0.807,0.809,0.81,0.813,0.814,0.815,0.818] },
    test: { died: [7,15,17,21,25,33,34,42,44,45,60,62,85,87], prob: [0.166,0.158,0.245,0.098,0.233,0.144,0.085,0.129,0.119,0.248,0.18,0.194,0.199,0.24,0.162,0.21,0.261,0.12,0.23,0.265,0.195,0.11,0.216,0.129,0.141,0.134,0.066,0.134,0.133,0.159,0.104,0.12,0.295,0.176,0.258,0.25,0.2,0.285,0.072,0.186,0.067,0.147,0.11,0.153,0.125,0.04,0.163,0.088,0.162,0.275,0.205,0.136,0.111,0.144,0.19,0.226,0.141,0.164,0.147,0.27,0.152,0.211,0.212,0.153,0.132,0.267,0.182,0.226,0.295,0.188,0.169,0.124,0.277,0.31,0.142,0.28,0.121,0.137,0.259,0.153,0.128,0.186,0.121,0.111,0.143,0.213,0.133,0.171,0.172,0.135,0.145,0.089,0.252,0.254] },
    age: { raw: 68, z: 0.62, scaled: 17, raw_pred: 0 },
    mem: { parts: [4.6, 4.6, 9.2, 42.4] },
    firstSteps: [2.287, 1.954, 1.378, 0.934, 0.898, 0.583, 0.549, 0.671, 0.455, 0.271, 0.33, 0.521, 0.31, 0.257, 0.527, 0.22, 0.167, 0.364, 0.256, 0.351, 0.315, 0.292, 0.245, 0.255, 0.394, 0.192, 0.11, 0.48, 0.464, 0.22, 0.164, 0.139, 0.293, 0.168, 0.234, 0.278, 0.113, 0.203, 0.12, 0.085],
    epochs: [{"train": 0.1943, "test": 0.0487}, {"train": 0.0727, "test": 0.0349}, {"train": 0.0534, "test": 0.0337}, {"train": 0.0431, "test": 0.0296}, {"train": 0.0355, "test": 0.031}, {"train": 0.032, "test": 0.0298}, {"train": 0.0309, "test": 0.0262}, {"train": 0.0306, "test": 0.0264}, {"train": 0.0276, "test": 0.0286}, {"train": 0.0268, "test": 0.0285}, {"train": 0.0262, "test": 0.0271}, {"train": 0.0267, "test": 0.0275}, {"train": 0.0251, "test": 0.0276}, {"train": 0.0251, "test": 0.0271}],
    batch: [{"bs": 64, "steps": 938, "mem": 61, "act": 42, "loss": [2.287, 0.934, 0.549, 0.271, 0.31, 0.22, 0.256, 0.292, 0.394, 0.48, 0.164, 0.168, 0.113, 0.085, 0.175, 0.118, 0.291, 0.158, 0.131, 0.143, 0.224, 0.395, 0.093, 0.068, 0.373, 0.154, 0.056, 0.066, 0.297, 0.062, 0.014, 0.201, 0.172, 0.079, 0.094, 0.179, 0.052, 0.262, 0.33, 0.208, 0.094, 0.169, 0.071, 0.188, 0.137, 0.117, 0.092, 0.092, 0.104, 0.045, 0.049, 0.107, 0.143, 0.021, 0.247, 0.111, 0.052, 0.117, 0.104, 0.188]}, {"bs": 1024, "steps": 59, "mem": 629, "act": 610, "loss": [2.313, 2.311, 2.224, 1.941, 1.616, 2.096, 1.758, 1.19, 1.016, 1.386, 1.298, 0.797, 0.928, 1.044, 0.963, 0.77, 0.633, 0.555, 0.567, 0.509, 0.453, 0.545, 0.614, 0.514, 0.342, 0.385, 0.326, 0.29, 0.358, 0.345, 0.409, 0.416, 0.456, 0.415, 0.315, 0.31, 0.256, 0.237, 0.295, 0.27, 0.256, 0.22, 0.226, 0.301, 0.309, 0.223, 0.26, 0.338, 0.332, 0.24, 0.215, 0.198, 0.172, 0.193, 0.239, 0.248, 0.181, 0.172, 0.197]}],
  };
  M.over.bestIdx = M.over.best - 1;

  // One training step on the machine: disk, CPU memory, GPU memory. A batch chip travels and the weights change.
  fig('ml-basics-parts', (root) => {
    const STEP = 1.5, HOLD = 2.4, N = 4;
    const S = [
      ['배치 읽기', 'DataLoader가 디스크에서 이미지 64장을 읽어 묶는다.'],
      ['GPU로 복사', '묶음을 PCIe 너머 GPU 메모리로 옮긴다.'],
      ['순전파와 손실', '모델이 답을 내고, 정답과 비교해 손실을 구한다.'],
      ['역전파와 갱신', '손실을 줄이는 쪽으로 옵티마이저가 가중치를 고친다.'],
    ];
    hwa.scene(root, {
      height: 270, still: N * STEP + 0.6,
      frame: (ctx, w, h, time, say) => {
        const run = time % (N * STEP + HOLD), done = run >= N * STEP, cur = done ? N - 1 : Math.floor(run / STEP), f = done ? 1 : (run - cur * STEP) / STEP;
        C.pill(ctx, 0, 0, `학습 스텝 한 번: ${S[cur][0]}`, 'info');
        const g = 12, cw = (w - 2 * g) / 3, X = (i) => i * (cw + g), y0 = 34, gh = 170, narrow = cw < 110, sz = narrow ? 11 : 12;
        ['디스크', 'CPU 메모리', 'GPU 메모리'].forEach((s, i) => C.group(ctx, X(i), y0, cw, gh, s));
        const card = (i, y, t, s) => ({ x: X(i) + 8, y: y ?? y0 + 114, w: cw - 16, h: 46, t, s, size: sz });
        const disk = card(0, y0 + 30, 'MNIST', '6만 장'), cpu = card(1, y0 + 30, 'DataLoader', '워커 1개');
        const model = card(2, y0 + 30, '모델', narrow ? '가중치 120만' : '가중치 120만 개'), opt = card(2, y0 + 114, '옵티마이저', 'Adadelta');
        C.card(ctx, disk, { lit: cur === 0 && f < 0.3 });
        C.card(ctx, cpu, { lit: cur === 0 && f > 0.8 });
        C.card(ctx, card(0, undefined, '정답', narrow ? '숫자 0~9' : '이미지마다 0~9'), { lit: cur === 2, fill: U.plot });
        C.card(ctx, card(1, undefined, '변환', narrow ? '정규화' : 'ToTensor, Normalize'), { fill: U.plot });
        const upd = cur === 3 ? ease(f, 0.45, 0.9) : 0;
        C.card(ctx, model, { lit: cur === 2 || upd > 0.5, fill: upd > 0 ? `rgba(220,252,231,${upd})` : '#fff' });
        C.card(ctx, opt, { lit: cur === 3 });
        C.line(ctx, [[X(1) + cw - 20, y0 + gh + 6], [X(2) + 20, y0 + gh + 6]], '#cbd5e1', 1.2);
        C.text(ctx, 'PCIe', X(2) - g / 2, y0 + gh + 18, { size: 9, align: 'center' });
        [X(1) + cw - 20, X(2) + 20].forEach((x) => C.line(ctx, [[x, y0 + gh], [x, y0 + gh + 6]], '#cbd5e1', 1.2));
        const at = (b) => [b.x + b.w / 2, b.y + b.h + 14];
        // The batch chip sits under the card it is in.
        const p = cur === 0 ? mix(at(disk), at(cpu), ease(f, 0.15, 0.8)) : cur === 1 ? mix(at(cpu), at(model), ease(f, 0.1, 0.8)) : at(model);
        tag(ctx, '64장', p[0], p[1], BLUE, cur === 3 ? 1 - ease(f, 0, 0.3) : 1, 10);
        const lossY = y0 + 92;
        if (cur >= 2) tag(ctx, cur === 3 && upd > 0.5 ? '손실 0.29' : '손실 0.31', X(2) + cw / 2, lossY, cur === 3 && upd > 0.5 ? GREEN : AMBER, cur === 2 ? ease(f, 0.3, 0.7) : 1, 10);
        if (cur === 3) C.arrow(ctx, [[X(2) + cw - 12, opt.y], [X(2) + cw - 12, model.y + model.h]], ease(f, 0.05, 0.45), U.accent, { width: 1.8 });
        C.wrap(ctx, `${cur + 1}. ${S[cur][1]}`, w / 2, y0 + gh + 40, w - 8, { color: U.text, weight: 600 });
        say(`학습 스텝 한 번, ${cur + 1}단계 ${S[cur][0]}: ${S[cur][1]}`);
      },
    });
  });

  // Forward pass and loss for one image of a 7: before training the ten outputs are flat, after training 7 stands out.
  fig('ml-basics-forward', (root) => {
    const SEC = 5.5, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 2);
    const SEVEN = ['..........', '.########.', '........#.', '.......#..', '......#...', '......#...', '.....#....', '....#.....', '....#.....', '..........'];
    const P = [
      [0.09, 0.11, 0.1, 0.08, 0.12, 0.1, 0.09, 0.1, 0.11, 0.1],
      [0.001, 0.003, 0.006, 0.002, 0.001, 0.001, 0.0, 0.98, 0.002, 0.004],
    ];
    const notes = ['학습 전에는 열 칸이 고르게 10% 안팎이라, 정답 7의 확률도 10%이고 손실은 2.30이다.', '학습 뒤에는 7에 98%가 몰리고 손실은 0.02로 줄어든다.'];
    hwa.scene(root, {
      height: 236, still: S.at(1) + SEC + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), p = P[i], loss = -Math.log(p[7]);
        C.pill(ctx, 0, 0, i ? '학습 뒤' : '학습 전', i ? 'ok' : 'warn');
        const y0 = 44, cell = Math.min(8, Math.floor((w * 0.26) / 10)), iw = cell * 10, bw = Math.min(16, Math.floor((w * 0.4 - 27) / 10)), bx = w - (bw + 3) * 10 + 3;
        // Input image
        C.text(ctx, '입력 이미지', 0, y0 - 6, { size: 10 });
        SEVEN.forEach((row, r) => [...row].forEach((c, k) => { ctx.fillStyle = c === '#' ? U.text : U.cell; ctx.fillRect(k * cell, y0 + r * cell, cell - 1, cell - 1); }));
        C.text(ctx, '28×28 픽셀', iw / 2, y0 + iw + 14, { size: 9, align: 'center' });
        // Model: four layers, a pulse passes through them.
        const mx0 = iw + 14, mx1 = bx - 14, mh = 100, my = y0;
        C.box(ctx, mx0, my - 4, mx1 - mx0, mh + 8, { fill: U.plot });
        C.text(ctx, '모델', (mx0 + mx1) / 2, my + mh + 18, { size: 10, weight: 600, align: 'center' });
        const LAY = ['conv', 'conv', 'fc', 'fc'], lx = (j) => mx0 + ((j + 1) * (mx1 - mx0)) / 5;
        const pulse = ease(t, 0.2, 1.8);
        LAY.forEach((s, j) => {
          const lit = pulse > (j + 0.5) / 5 && pulse < 1;
          ctx.fillStyle = lit ? U.blue : '#cbd5e1';
          ctx.fillRect(lx(j) - 2, my + 8 + (j > 1 ? 18 : 0), 4, mh - 16 - (j > 1 ? 36 : 0));
          if (mx1 - mx0 > 90) C.text(ctx, s, lx(j), my + mh - 2, { size: 8, align: 'center' });
        });
        if (pulse > 0 && pulse < 1) {
          const px = mix([0, 0], [mx1 - mx0, 0], pulse)[0] + mx0;
          ctx.beginPath(); ctx.arc(px, my + mh / 2, 4, 0, TAU); ctx.fillStyle = U.blue; ctx.fill();
        }
        C.arrow(ctx, [[iw + 2, my + mh / 2], [mx0 - 2, my + mh / 2]], 1, '#cbd5e1', { width: 1.2 });
        C.arrow(ctx, [[mx1 + 2, my + mh / 2], [bx - 4, my + mh / 2]], 1, '#cbd5e1', { width: 1.2 });
        // Ten output probabilities.
        const grow = ease(t, 1.8, 3.0), base = y0 + mh;
        C.text(ctx, '숫자별 확률', bx, y0 - 6, { size: 10 });
        p.forEach((v, d) => {
          const x = bx + d * (bw + 3), bh = Math.max(1, v * mh * grow);
          ctx.fillStyle = d === 7 ? U.blue : '#cbd5e1';
          ctx.fillRect(x, base - bh, bw, bh);
          C.text(ctx, String(d), x + bw / 2, base + 12, { size: 9, weight: d === 7 ? 700 : 400, color: d === 7 ? U.blue : U.muted, align: 'center' });
        });
        if (grow > 0.9) C.text(ctx, `${Math.round(p[7] * 100)}%`, bx + 7 * (bw + 3) + bw / 2, base - p[7] * mh - 5, { size: 10, weight: 700, color: U.blue, align: 'center' });
        C.text(ctx, '정답 7', bx + 7 * (bw + 3) + bw / 2, base + 26, { size: 9, weight: 600, color: U.blue, align: 'center' });
        // Loss line.
        const la = ease(t, 3.2, 4.0), ly = 206;
        ctx.globalAlpha = la;
        C.text(ctx, '손실 = −log(정답 확률)', 0, ly, { size: 11, weight: 600, color: U.text });
        C.text(ctx, loss.toFixed(2), w, ly, { size: 18, weight: 700, color: i ? GREEN[1] : RED[1], align: 'right' });
        ctx.globalAlpha = 1;
        say(`${i ? '학습 뒤' : '학습 전'}: 정답 7의 확률 ${Math.round(p[7] * 100)}%, 손실 ${loss.toFixed(2)}.`);
      },
    });
  });

  // Demo: gradient descent on loss = w^2 with a small and a too-large learning rate, ten steps each.
  fig('ml-basics-lr', (root) => {
    const W0 = -1.6, LR = [0.02, 1.02], N = 10, DT = 0.55, notes = [
      '학습률 0.02: 한 번에 조금씩만 움직여 10번 갱신해도 바닥에 한참 못 미친다.',
      '학습률 1.02: 한 번에 너무 멀리 뛰어 골짜기를 넘나들며 손실이 오히려 커진다.',
    ];
    hwa.scene(root, {
      height: 250, still: N * DT + 1, notes,
      demo: { modes: ['학습률 0.02', '학습률 1.02'], run: '10번 갱신하기' },
      frame: (ctx, w, h, time, say, ui) => {
        const lr = LR[ui.mode], run = ui.runAt === null ? -1 : time - ui.runAt, n = run < 0 ? 0 : Math.min(N, Math.floor(run / DT));
        const ws = [W0]; for (let k = 0; k < N; k++) ws.push(ws[k] - lr * 2 * ws[k]);
        const loss = ws[n] ** 2;
        C.pill(ctx, 0, 0, `학습률 ${lr}`, ui.mode ? 'bad' : 'warn');
        C.text(ctx, `갱신 ${n}번  손실 ${loss.toFixed(2)}`, w, 11, { size: 11, weight: 700, color: loss > W0 ** 2 ? U.red : U.text, align: 'right', base: 'middle' });
        const px = 30, py = 40, pw = w - px - 8, ph = 168, R = 2.4, MAXL = 6;
        const Y = C.panel(ctx, px, py, pw, ph, { max: MAXL, ticks: [[0, '0'], [2, '2'], [4, '4'], [6, '6']] });
        const X = (v) => px + ((v + R) / (2 * R)) * pw;
        C.line(ctx, Array.from({ length: 61 }, (_, k) => { const v = -R + (k / 60) * 2 * R; return [X(v), Y(v * v)]; }), '#94a3b8', 1.5);
        C.text(ctx, '가중치 w', px + pw, py + ph + 14, { size: 10, align: 'right' });
        C.text(ctx, '손실', px, py - 7, { size: 10 });
        C.text(ctx, '바닥', X(0), Y(0) - 6, { size: 9, align: 'center' });
        // Trail: each update is a hop along w; the hop in progress eases.
        const pts = ws.slice(0, n + 1).map((v) => [X(v), Y(v * v)]);
        const k = run < 0 || n >= N ? 0 : hwa.smooth((run - n * DT) / DT);
        const col = ui.mode ? U.red : U.blue;
        pts.forEach((p, j) => { if (j) C.dashed(ctx, pts[j - 1][0], pts[j - 1][1], p[0], p[1], col); ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, TAU); ctx.fillStyle = col; ctx.fill(); });
        let ball = pts[n];
        if (k > 0 && n < N) { const nx = ws[n + 1], cx = ws[n] + (nx - ws[n]) * k; ball = [X(cx), Y(Math.min(MAXL, cx * cx)) - Math.sin(k * Math.PI) * 18]; }
        ctx.beginPath(); ctx.arc(ball[0], ball[1], 6, 0, TAU); ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        if (run < 0) C.text(ctx, '10번 갱신하기 버튼을 눌러 보자', px + pw / 2, py + 30, { size: 12, align: 'center' });
        if (run >= N * DT) C.stamp(ctx, px + pw / 2, py + 34, ui.mode ? `손실 2.56 → ${loss.toFixed(2)}, 커짐` : `손실 2.56 → ${loss.toFixed(2)}`, ui.mode ? 'bad' : 'warn', (run - N * DT) / 0.4);
        say(`학습률 ${lr}, 갱신 ${n}번, 손실 ${loss.toFixed(2)}. ${notes[ui.mode]}`);
      },
    });
  });

  // Demo: one epoch of MNIST with batch 64 or 1024. Same 60,000 images, different number of updates and memory.
  fig('ml-basics-batch', (root) => {
    const B = M.batch, SEC = 6, notes = B.map((b) => `배치 ${b.bs}: 6만 장을 ${b.steps}번에 나눠 보고 가중치를 ${b.steps}번 고친다. 활성값은 ${b.act}MB다.`);
    hwa.scene(root, {
      height: 262, still: SEC + 1, notes,
      demo: { modes: B.map((b) => `배치 ${b.bs}`), run: '1 에폭 돌리기' },
      frame: (ctx, w, h, time, say, ui) => {
        const b = B[ui.mode], run = ui.runAt === null ? -1 : time - ui.runAt, k = run < 0 ? 0 : Math.min(1, run / SEC), n = Math.round(b.steps * k);
        C.pill(ctx, 0, 0, `배치 ${b.bs}`, 'info');
        const narrow = w < 420, cols = narrow ? [0, w * 0.36, w * 0.7] : [0, 150, 300];
        stat(ctx, cols[0], 34, '본 이미지', `${Math.round(60000 * k).toLocaleString('en-US')}장`);
        stat(ctx, cols[1], 34, '가중치 갱신', `${n}번`, U.blue);
        stat(ctx, cols[2], 34, 'GPU 메모리', `${b.mem}MB`, ui.mode ? AMBER[1] : U.text);
        // Loss per step against images seen.
        const px = 30, py = 94, pw = w - px - 8, ph = 120;
        const Y = C.panel(ctx, px, py, pw, ph, { max: 2.4, ticks: [[0, '0'], [1, '1'], [2, '2']] });
        C.text(ctx, '손실', px, py - 7, { size: 10 });
        const last = Math.floor((b.loss.length - 1) * k);
        const pts = b.loss.slice(0, last + 1).map((v, j) => [px + (j / (b.loss.length - 1)) * pw, Y(v)]);
        if (run >= 0) C.line(ctx, pts, U.blue, 1.4);
        if (run >= 0 && pts.length) C.dot(ctx, ...pts[pts.length - 1], U.blue);
        // Data bar: 60,000 images, filled as batches go by.
        const dy = py + ph + 12;
        C.box(ctx, px, dy, pw, 12, { fill: U.cell, r: 3 });
        if (k > 0) C.box(ctx, px, dy, Math.max(6, pw * k), 12, { fill: BLUE[2], stroke: BLUE[2], r: 3 });
        C.text(ctx, '학습 데이터 6만 장', px, dy + 26, { size: 10 });
        C.text(ctx, `한 칸 = ${b.bs}장`, px + pw, dy + 26, { size: 10, align: 'right' });
        if (run < 0) C.text(ctx, '1 에폭 돌리기 버튼을 눌러 보자', px + pw / 2, py + ph / 2, { size: 12, align: 'center', base: 'middle' });
        if (run >= SEC) C.stamp(ctx, px + pw / 2, py + 30, `${b.steps}번 갱신, 메모리 ${b.mem}MB`, ui.mode ? 'warn' : 'ok', (run - SEC) / 0.4);
        say(notes[ui.mode]);
      },
    });
  });

  // Line graphs over measured series: x is a step or an epoch index, lines are [label, color, values].
  const chart = (name, { height = 270, notes, scenes, still }) => fig(name, (root) => {
    const S = seq(scenes.map((s) => s.sec), 2);
    hwa.scene(root, {
      height, still: still ?? S.at(scenes.length - 1) + scenes.at(-1).sec + 1, scenes: scenes.length > 1 ? S : undefined, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t, run } = S.pos(time), sc = scenes[i], k = t / sc.sec, n = sc.lines[0][2].length;
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        ctx.font = U.font(10);
        const lg = sc.lines.map(([s, c]) => [s, c]), lgw = lg.reduce((a, [s]) => a + 24 + ctx.measureText(s).width, 0);
        C.legend(ctx, w - lgw + 12, 11, lg);
        const px = 30, py = 44, pw = w - px - 40, ph = height - py - 40;
        const Y = C.panel(ctx, px, py, pw, ph, { max: sc.max, ticks: sc.ticks });
        const X = (j) => px + (j / (n - 1)) * pw, last = Math.max(1, Math.floor((n - 1) * k));
        (sc.xlabels || []).forEach(([j, s]) => C.text(ctx, s, X(j), py + ph + 14, { size: 10, align: j === 0 ? 'left' : j === n - 1 ? 'right' : 'center' }));
        if (sc.xname) C.text(ctx, sc.xname, px + pw, py + ph + 28, { size: 10, align: 'right' });
        if (sc.event && last >= sc.event[0]) {
          ctx.fillStyle = 'rgba(239,68,68,0.06)';
          ctx.fillRect(X(sc.event[0]), py, X(last) - X(sc.event[0]), ph);
          C.event(ctx, X(sc.event[0]), py + 14, py + ph, sc.event[1], U.red, X(sc.event[0]) - px < 60 ? 'left' : 'center');
        }
        const ends = sc.lines.map(([s, c, v], li) => {
          C.line(ctx, v.slice(0, last + 1).map((y, j) => [X(j), Y(y)]), c, li ? 1.6 : 2);
          return { y: Y(v[last]), v: v[last], c };
        });
        ends.slice().sort((a, b) => a.y - b.y).forEach((e, j, arr) => { e.ly = j && e.y - arr[j - 1].ly < 13 ? arr[j - 1].ly + 13 : e.y; });
        ends.forEach((e) => C.dot(ctx, X(last), e.y, e.c, e.v.toFixed(2), e.ly));
        if (t < sc.sec) C.dashed(ctx, X(last), py, X(last), py + ph, U.now);
        if (sc.stamp) C.stamp(ctx, px + pw / 2, py + ph * 0.3, sc.stamp[0], sc.stamp[1], (run - sc.sec) / 0.4);
        say(`${sc.pill}. ${notes[i]}`);
      },
    });
  });

  chart('ml-basics-epochs', {
    notes: [
      '첫 에폭 앞부분: 처음 몇십 번의 갱신에서 손실이 2.3 근처에서 빠르게 떨어지고, 배치마다 들쭉날쭉하다.',
      '14 에폭: 학습 손실은 계속 내려가지만 테스트 손실은 몇 에폭 만에 평평해진다.',
    ],
    scenes: [
      { sec: 5, pill: '1 에폭, 처음 200번 갱신', tone: 'info', max: 2.5, ticks: [[0, '0'], [1, '1'], [2, '2']], lines: [['배치 손실', U.blue, M.firstSteps]], xlabels: [[0, '0'], [M.firstSteps.length - 1, '200번']], xname: '갱신 횟수' },
      { sec: 6, pill: '14 에폭', tone: 'ok', max: 0.25, ticks: [[0, '0'], [0.1, '0.1'], [0.2, '0.2']],
        lines: [['학습 손실', U.blue, M.epochs.map((e) => e.train)], ['테스트 손실', U.purple, M.epochs.map((e) => e.test)]],
        xlabels: [[0, '1'], [6, '7'], [13, '14']], xname: '에폭', stamp: ['테스트 손실이 먼저 평평해짐', 'info'] },
    ],
  });

  chart('ml-basics-overfit', {
    height: 280,
    notes: [`학습 손실은 끝까지 내려가지만, 검증 손실은 ${M.over.best}에폭에서 가장 낮고 그 뒤로 올라간다.`],
    scenes: [{ sec: 8, pill: '폐암 데이터 300 에폭', tone: 'warn', max: M.over.max, ticks: M.over.ticks,
      lines: [['학습 손실', U.blue, M.over.train], ['검증 손실', U.red, M.over.val]],
      xlabels: [[0, '1'], [M.over.train.length - 1, '300']], xname: '에폭', event: [M.over.bestIdx, `${M.over.best}에폭`], stamp: ['검증 손실이 다시 오름', 'bad'] }],
  });

  // Training and serving paths around a scaler: fitted at training time, dropped at serving, then shipped with the model.
  fig('ml-basics-scaler', (root) => {
    const SEC = 5, HOLD = 1.8, S = hwa.loopScenes(SEC, HOLD, 3), A = M.age;
    const SC = [
      { pill: '학습 때', tone: 'info', drop: false, out: `사망 ${A.scaled}%`, good: true, note: `학습 때는 나이 ${A.raw}를 스케일러가 ${A.z}로 바꿔 모델에 넣는다.` },
      { pill: '서빙 때, 스케일러 빠짐', tone: 'bad', drop: true, out: `사망 ${A.raw_pred}%`, good: false, note: `서빙에서 스케일러를 빼면 모델은 ${A.raw}라는 처음 보는 크기의 값을 받아 엉뚱하게 답한다.` },
      { pill: '서빙 때, 함께 배포', tone: 'ok', drop: false, bundle: true, out: `사망 ${A.scaled}%`, good: true, note: '스케일러를 모델과 같은 묶음으로 저장하고 배포하면 학습 때와 같은 값이 들어간다.' },
    ];
    hwa.scene(root, {
      height: 222, still: S.at(1) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3), sc = SC[i];
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        const g = 12, bw = (w - 3 * g) / 4, X = (j) => j * (bw + g), y = 70, bh = 54, cy = y + bh / 2, narrow = bw < 80;
        if (sc.bundle) {
          const k = ease(t, 0, 0.8);
          ctx.globalAlpha = k;
          C.box(ctx, X(1) - 6, y - 24, 2 * bw + g + 12, bh + 36, { fill: GREEN[0], stroke: GREEN[2], r: 10 });
          C.text(ctx, narrow ? '한 묶음' : '한 묶음으로 저장', X(1), y - 10, { size: 10, weight: 600, color: GREEN[1] });
          ctx.globalAlpha = 1;
        }
        const card = (j, t2, s) => ({ x: X(j), y, w: bw, h: bh, t: t2, s, size: narrow ? 11 : 12 });
        C.card(ctx, card(0, '환자 기록', '나이 등 16개'));
        C.card(ctx, card(1, '스케일러', narrow ? '평균, 편차' : '평균과 표준편차'), sc.drop ? { dim: true, dash: [4, 3], fill: U.plot } : {});
        C.card(ctx, card(2, '모델', 'MLP'));
        C.card(ctx, card(3, '예측', ' '), { lit: t > 3.6, stroke: U.grid });
        if (sc.drop) C.text(ctx, '빠짐', X(1) + bw / 2, y + bh + 14, { size: 10, weight: 700, color: U.red, align: 'center' });
        [0, 1, 2].forEach((j) => C.arrow(ctx, [[X(j) + bw + 1, cy], [X(j + 1) - 2, cy]], 1, '#cbd5e1', { width: 1.2 }));
        // The value chip rides along the row and changes at the scaler unless it was dropped.
        const ty = y + bh + 34, k1 = ease(t, 0.4, 1.6), k2 = ease(t, 1.8, 2.8), k3 = ease(t, 3.0, 3.6);
        const scaled = !sc.drop && k1 >= 1;
        const pos = k2 > 0 ? mix([X(1) + bw / 2, ty], [X(2) + bw / 2, ty], k2) : mix([X(0) + bw / 2, ty], [X(1) + bw / 2, ty], k1);
        tag(ctx, scaled ? `${A.z}` : `${A.raw}`, pos[0], pos[1], sc.drop && k2 > 0.5 ? RED : BLUE);
        if (k3 > 0) {
          C.text(ctx, sc.out, X(3) + bw / 2, cy + 10, { size: narrow ? 11 : 13, weight: 700, color: sc.good ? GREEN[1] : RED[1], align: 'center', base: 'middle' });
        }
        if (!sc.good) C.stamp(ctx, w / 2, 200, '처음 보는 크기의 입력', 'bad', (t - 3.8) / 0.4);
        say(`${sc.pill}: ${sc.note}`);
      },
    });
  });

  // 94 test patients as dots. Truth: red ring for died within a year. Prediction: filled red for "died".
  const PATIENTS = (() => {
    const died = new Set(M.test.died), pred = (th) => new Set(M.test.prob.map((p, j) => (p >= th ? j : -1)).filter((j) => j >= 0));
    return { n: M.test.prob.length, died, pred };
  })();
  const dots = (ctx, w, y0, { show = 1, truth = true, pred = null, miss = false } = {}) => {
    const n = PATIENTS.n, cols = w < 420 ? 14 : 24, sp = Math.min(18, Math.floor(w / cols)), r = sp * 0.32, gx = (w - cols * sp) / 2 + sp / 2;
    for (let j = 0; j < n; j++) {
      const x = gx + (j % cols) * sp, y = y0 + Math.floor(j / cols) * sp, died = PATIENTS.died.has(j), on = j < show * n;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = pred && on ? (pred.has(j) ? U.red : '#e2e8f0') : U.cell;
      ctx.fill();
      if (truth && died) { ctx.strokeStyle = U.red; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, TAU); ctx.stroke(); }
      if (miss && on && died && pred && !pred.has(j)) C.text(ctx, '×', x, y + 0.5, { size: 11, weight: 700, color: U.red, align: 'center', base: 'middle' });
    }
    return y0 + Math.ceil(n / cols) * sp;
  };

  fig('ml-basics-imbalance', (root) => {
    const SEC = 4.5, HOLD = 2, S = hwa.loopScenes(SEC, HOLD, 3), all = new Set(), nd = PATIENTS.died.size, n = PATIENTS.n;
    const acc = Math.round(((n - nd) / n) * 100);
    const notes = [`테스트 환자 ${n}명 중 1년 안에 사망한 환자는 ${nd}명(빨간 테두리)이다.`, `모두 생존이라고 답하는 모델도 정확도는 ${acc}%다.`, `그 모델은 사망 환자 ${nd}명을 한 명도 찾지 못한다.`];
    hwa.scene(root, {
      height: 236, still: S.at(2) + SEC + 1, scenes: S, notes,
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 3);
        C.pill(ctx, 0, 0, ['정답', '모두 생존이라고 예측', '놓친 사망'][i], ['info', 'ok', 'bad'][i]);
        C.legend(ctx, w - 150, 11, [['사망(정답)', U.red]]);
        const end = dots(ctx, w, 46, { pred: i ? all : null, show: i === 1 ? ease(t, 0, 2.5) : 1, miss: i === 2 });
        if (i === 1) C.stamp(ctx, w / 2, end + 22, `정확도 ${acc}%`, 'ok', (t - 2.6) / 0.4);
        if (i === 2) C.stamp(ctx, w / 2, end + 22, `사망 ${nd}명 중 0명 찾음`, 'bad', (t - 0.8) / 0.4);
        say(notes[i]);
      },
    });
  });

  // Demo: the same model's death probabilities cut at 50% or 20%.
  fig('ml-basics-threshold', (root) => {
    const TH = [0.5, 0.15], SEC = 4, nd = PATIENTS.died.size;
    const res = TH.map((th) => { const p = PATIENTS.pred(th), tp = [...PATIENTS.died].filter((j) => p.has(j)).length; return { p, tp, fp: p.size - tp }; });
    const notes = res.map((r, m) => `기준 ${TH[m] * 100}%: 사망 ${nd}명 중 ${r.tp}명을 찾고, 생존 환자 ${r.fp}명을 잘못 짚는다.`);
    hwa.scene(root, {
      height: 210, still: SEC + 1, notes,
      demo: { modes: TH.map((th) => `기준 ${th * 100}%`), run: `${PATIENTS.n}명 판정하기` },
      frame: (ctx, w, h, time, say, ui) => {
        const r = res[ui.mode], run = ui.runAt === null ? -1 : time - ui.runAt, k = run < 0 ? 0 : Math.min(1, run / SEC);
        C.pill(ctx, 0, 0, `사망 확률 ${TH[ui.mode] * 100}% 이상이면 사망`, 'info');
        const end = dots(ctx, w, 46, { pred: run < 0 ? null : r.p, show: k, miss: k >= 1 });
        const sy = end + 4, narrow = w < 420;
        const done = k >= 1, cols = narrow ? [0, w * 0.36, w * 0.7] : [0, 150, 300];
        if (run >= 0) stat(ctx, cols[0], sy, '찾은 사망', done ? `${r.tp} / ${nd}` : '-', done ? (r.tp / nd >= 0.5 ? GREEN[1] : RED[1]) : U.muted);
        if (run >= 0) stat(ctx, cols[1], sy, '놓친 사망', done ? `${nd - r.tp}` : '-', done && nd - r.tp ? RED[1] : U.text);
        if (run >= 0) stat(ctx, cols[2], sy, '잘못 짚은 생존', done ? `${r.fp}` : '-', done && r.fp ? AMBER[1] : U.text);
        if (run < 0) C.text(ctx, '판정하기 버튼을 눌러 보자', w / 2, sy + 14, { size: 12, align: 'center', base: 'middle', color: U.text });
        if (done) C.stamp(ctx, w / 2, 84, `재현율 ${Math.round((r.tp / nd) * 100)}%`, r.tp / nd >= 0.5 ? 'ok' : 'bad', (run - SEC) / 0.4);
        say(notes[ui.mode]);
      },
    });
  });

  // GPU memory during training: weights, gradients, optimizer state, activations, against the card.
  fig('ml-basics-memory', (root) => {
    const SEC = 5, HOLD = 2.2, S = hwa.loopScenes(SEC, HOLD, 2);
    const PART = [['가중치', U.blue], ['기울기', U.purple], ['옵티마이저 상태', '#f59e0b'], ['활성값', '#14b8a6']];
    const SC = [
      { pill: 'MNIST 예제, 배치 64', tone: 'ok', unit: 'MB', parts: M.mem.parts, max: 80, stamp: ['합계 61MB', 'ok'],
        note: 'MNIST 모델은 가중치가 120만 개라 활성값까지 합쳐도 61MB다. 8GB 카드의 1%도 안 된다.' },
      { pill: '70억 파라미터 모델, Adam', tone: 'bad', unit: 'GB', parts: [14, 14, 84, 20], cap: 80, max: 140, capLabel: 'GPU 80GB', stamp: ['80GB 카드 하나에 안 들어감', 'bad'],
        note: '70억 개 모델을 혼합 정밀도와 Adam으로 학습하면 활성값을 빼고도 112GB가 든다. 활성값은 배치에 비례한다(대략값).' },
    ];
    hwa.scene(root, {
      height: 222, still: S.at(1) + SEC + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = hwa.loop(time, SEC, HOLD, 2), sc = SC[i];
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        const x0 = 0, x1 = w, y = 64, bh = 34, X = (v) => x0 + (v / sc.max) * (x1 - x0);
        C.box(ctx, x0, y, x1 - x0, bh, { fill: U.plot, r: 6 });
        let acc = 0;
        sc.parts.forEach((v, j) => {
          const k = ease(t, 0.3 + j * 0.8, 1.0 + j * 0.8);
          if (k <= 0) return;
          const a = X(acc), b = X(acc + v * k);
          ctx.fillStyle = PART[j][1];
          ctx.fillRect(a, y + 1, Math.max(1, b - a - 1), bh - 2);
          acc += v * k;
        });
        if (sc.cap) {
          C.event(ctx, X(sc.cap), y - 8, y + bh + 8, sc.capLabel || '', U.red, 'center');
        }
        C.text(ctx, `0`, 0, y + bh + 16, { size: 10 });
        C.text(ctx, `${sc.max}${sc.unit}`, w, y + bh + 16, { size: 10, align: 'right' });
        // Legend with values, two per row when narrow.
        const narrow = w < 440, lw = narrow ? w / 2 : w / 4;
        PART.forEach(([s, c], j) => {
          const lx = (j % (narrow ? 2 : 4)) * lw, ly = y + bh + 40 + (narrow ? Math.floor(j / 2) * 34 : 0);
          ctx.fillStyle = c; ctx.fillRect(lx, ly - 8, 8, 8);
          C.text(ctx, s, lx + 12, ly, { size: 10 });
          C.text(ctx, `${sc.parts[j]}${sc.unit}`, lx + 12, ly + 16, { size: 12, weight: 700, color: U.text });
        });
        C.stamp(ctx, w / 2, y + bh / 2, sc.stamp[0], sc.stamp[1], (t - 3.8) / 0.4);
        say(`${sc.pill}: ${sc.note}`);
      },
    });
  });

  // Timeline lanes: blocks for work, double arrows for waits. Same shape as the CPU post's timelines.
  const FILL = { load: '#64748b', gpu: U.blue, py: U.purple, save: '#16a34a', lost: '#fca5a5', ep: U.blue, re: '#f59e0b' };
  const ARC = { idle: '#cbd5e1', wait: '#94a3b8', lost: U.red };
  const dbl = (ctx, x0, x1, y, color) => {
    if (x1 - x0 < 6) return;
    C.line(ctx, [[x0, y], [x1, y]], color, 1.4);
    [[x0, 1], [x1, -1]].forEach(([x, d]) => {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 * d, y - 4); ctx.lineTo(x + 6 * d, y + 4); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    });
  };
  const LH = 50;
  const tl = (name, scenes, { SEC = 6.5, HOLD = 1.8 } = {}) => fig(name, (root) => {
    const maxL = Math.max(...scenes.map((s) => s.lanes.length)), n = scenes.length, height = 44 + maxL * LH + 30;
    hwa.scene(root, {
      height, still: (n - 1) * (SEC + HOLD) + SEC + 0.6, scenes: n > 1 ? hwa.loopScenes(SEC, HOLD, n) : undefined, notes: scenes.map((x) => x.say),
      frame: (ctx, w, h, time, say) => {
        const auto = hwa.loop(time, SEC, HOLD, n), s = scenes[auto.i];
        const run = (time % ((SEC + HOLD) * n)) - auto.i * (SEC + HOLD), k = Math.max(0, Math.min(1, run / SEC)), t = k * s.span;
        C.pill(ctx, 0, 0, s.pill, s.tone);
        if (s.legend && w >= 360) {
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
        const lw = Math.min(64, w * 0.2), x0 = lw, x1 = w - 8, top = 40, base = top + s.lanes.length * LH + 4;
        const X = (v) => x0 + (Math.max(0, Math.min(v, s.span)) / s.span) * (x1 - x0), ly = (j) => top + j * LH;
        s.lanes.forEach((nm, j) => C.text(ctx, nm, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
        C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
        C.text(ctx, s.unit || '시간', x1, base - 6, { size: 9, align: 'right' });
        (s.ticks || []).forEach(([v, label]) => {
          if (t < v) return;
          C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
          C.text(ctx, label, X(v), base + 14, { size: 9, align: v >= s.span ? 'right' : 'center' });
        });
        (s.arcs || []).forEach(([j, a, b, kind, label]) => {
          if (t <= a) return;
          const y = ly(j) + LH / 2;
          dbl(ctx, X(a) + 2, X(Math.min(t, b)) - 2, y, ARC[kind]);
          if (t >= b && label && tw(ctx, label, 9, 600) < X(b) - X(a)) C.text(ctx, label, (X(a) + X(b)) / 2, y + 13, { size: 9, weight: 600, color: ARC[kind] === ARC.lost ? U.red : U.muted, align: 'center' });
        });
        (s.segs || []).forEach(([j, a, b, kind, label]) => {
          if (t <= a) return;
          const y = ly(j) + 8, bx = X(a) + 1, bw = X(Math.min(t, b)) - bx - 1;
          if (bw <= 0) return;
          ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 16, Math.min(6, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
          if (t >= b && label && tw(ctx, label, 10, 700) + 6 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 16) / 2 + 0.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
        });
        if (s.event && t >= s.event[0]) C.event(ctx, X(s.event[0]), top + 4, base, s.event[1], U.red, X(s.event[0]) - x0 < 40 ? 'left' : 'center');
        if (k > 0 && k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
        if (s.stamp && run >= SEC) C.stamp(ctx, (x0 + x1) / 2, top + (base - top) / 2, s.stamp[0], s.stamp[1], (run - SEC) / 0.4);
        say(`${s.pill}. ${s.say}`);
      },
    });
  });

  // Data loading: with no workers the GPU waits while the main process builds each batch; two workers build ahead.
  {
    const ld = 3, gp = 2, span = 20, serial = [], idle = [], w2 = [], gpu2 = [];
    for (let x = 0; x < span; x += ld + gp) { serial.push([0, x, x + ld, 'load', '배치'], [2, x + ld, x + ld + gp, 'gpu', '스텝']); idle.push([2, x, x + ld, 'idle', '대기']); }
    for (let x = 0, k = 0; x < span; x += ld / 2, k++) w2.push([k % 2, x, x + ld - 0.15, 'load', '배치']);
    for (let x = ld; x < span; x += gp) gpu2.push([2, x, x + gp - 0.1, 'gpu', '스텝']);
    const lanes = ['메인', '', 'GPU'], lanes2 = ['워커 1', '워커 2', 'GPU'];
    tl('ml-basics-loader', [
      { pill: 'num_workers=0', tone: 'bad', span, lanes, segs: serial, arcs: idle, stamp: ['GPU 시간의 60% 대기', 'bad'],
        say: '메인 프로세스가 배치를 만드는 동안 GPU는 논다. 시간은 모양을 보여 주는 대략값이다.' },
      { pill: 'num_workers=2', tone: 'ok', span, lanes: lanes2, segs: [...w2, ...gpu2], arcs: [[2, 0, ld, 'idle', '대기']], stamp: ['첫 배치 뒤로 쉬지 않음', 'ok'],
        say: '워커 둘이 번갈아 다음 배치를 미리 만들어, GPU는 스텝이 끝나면 바로 다음 배치를 받는다.' },
    ]);
  }

  // Checkpoints: a node is reclaimed at epoch 9 of 14; without a checkpoint the job starts over.
  {
    const eps = (from, to, lane, x0, kind = 'ep') => Array.from({ length: to - from + 1 }, (_, j) => [lane, x0 + j, x0 + j + 1, kind, `${from + j}`]);
    const ticks = [[7, '7'], [14, '14'], [21, '21']];
    tl('ml-basics-ckpt', [
      { pill: '체크포인트 없음', tone: 'bad', span: 24, unit: '에폭 시간', ticks, lanes: ['학습'], segs: [...eps(1, 8, 0, 0), [0, 8, 8.5, 'lost', ''], ...eps(1, 14, 0, 9.5, 're')], arcs: [], event: [8.5, '노드 회수'],
        stamp: ['14 에폭에 23.5 에폭 시간', 'bad'], say: '9 에폭 도중 노드가 회수되면 처음부터 다시 돌아 8.5 에폭어치 GPU 시간을 버린다.' },
      { pill: '에폭마다 저장', tone: 'ok', span: 24, unit: '에폭 시간', ticks, lanes: ['학습'], segs: [...eps(1, 8, 0, 0), [0, 8, 8.5, 'lost', ''], ...eps(9, 14, 0, 9.5, 're')], arcs: [], event: [8.5, '노드 회수'],
        stamp: ['9 에폭부터 이어서', 'ok'], say: '에폭마다 저장해 두면 새 노드에서 8 에폭 끝 상태를 읽어 9 에폭부터 이어 간다.' },
    ]);
  }

  // Eager vs compiled: Python launches each op as its own GPU kernel; compiled code fuses them. Times are for shape.
  {
    const eager = [], comp = [];
    for (let j = 0; j < 8; j++) { eager.push([0, j * 10, j * 10 + 4, 'py', ''], [1, j * 10 + 4, j * 10 + 9, 'gpu', '']); }
    comp.push([0, 0, 4, 'py', ''], [1, 4, 22, 'gpu', '합친 커널'], [0, 22, 26, 'py', ''], [1, 26, 44, 'gpu', '합친 커널']);
    tl('ml-basics-compile', [
      { pill: '즉시 실행 (eager)', tone: 'warn', span: 80, lanes: ['Python', 'GPU'], legend: [['py', '연산 호출'], ['gpu', '커널']], segs: eager, arcs: [[1, 0, 4, 'idle', '']], stamp: ['연산마다 커널 하나', 'warn'], say: '한 줄씩 실행하면 연산마다 GPU 커널을 따로 띄워, 커널 사이마다 GPU가 빈다.' },
      { pill: '컴파일 (torch.compile)', tone: 'ok', span: 80, lanes: ['Python', 'GPU'], legend: [['py', '연산 호출'], ['gpu', '커널']], segs: comp, stamp: ['같은 일을 절반 시간에', 'ok'], say: '컴파일하면 여러 연산을 커널 하나로 합쳐 띄우는 횟수와 빈틈이 줄어든다. 시간은 모양을 보여 주는 대략값이다.' },
    ]);
  }

  // MLOps loop: data, training pipeline, registry on top; serving and monitoring below; drift sends it round again.
  fig('ml-basics-loop', (root) => {
    const S = seq([5, 5, 5.5], 1.8);
    const SC = [
      { pill: '배포', tone: 'info', note: '학습 파이프라인이 만든 모델 v1을 레지스트리에 올리고, 서빙이 그 버전을 받아 요청에 답한다.' },
      { pill: '입력 분포 변화', tone: 'warn', note: '들어오는 데이터가 학습 때와 달라지면 코드는 그대로인데 모니터링의 정확도 선이 내려간다.' },
      { pill: '재학습 (CT)', tone: 'ok', note: '모니터링이 재학습을 걸면 새 데이터로 v2를 학습해 같은 길로 다시 배포한다.' },
    ];
    hwa.scene(root, {
      height: 262, still: S.at(2) + 5.5 + 1, scenes: S, notes: SC.map((s) => s.note),
      frame: (ctx, w, h, time, say) => {
        const { i, t } = S.pos(time), sc = SC[i], narrow = w < 420;
        C.pill(ctx, 0, 0, sc.pill, sc.tone);
        const g = 14, bw = (w - 2 * g) / 3, X = (j) => j * (bw + g), y1 = 48, y2 = 170, bh = 58;
        const B = {
          data: { x: X(0), y: y1, w: bw, h: bh, t: '데이터', s: i === 2 && t > 1 ? '새 데이터 추가' : '학습용 스냅샷' },
          train: { x: X(1), y: y1, w: bw, h: bh, t: '학습', s: '파이프라인' },
          reg: { x: X(2), y: y1, w: bw, h: bh, t: '레지스트리', s: narrow ? '모델 버전' : '모델 버전 보관' },
          mon: { x: X(0), y: y2, w: bw * 1.5 + g / 2, h: bh + 20, t: '', s: '' },
          serve: { x: X(1) + bw / 2 + g / 2, y: y2, w: bw * 1.5 + g / 2, h: bh, t: '서빙', s: ' ' },
        };
        const sz = narrow ? 11 : 12;
        ['data', 'train', 'reg', 'serve'].forEach((k) => C.card(ctx, { ...B[k], size: sz }, { lit: (k === 'train' && ((i === 0 && t < 2) || (i === 2 && t > 1.5 && t < 3))) || (k === 'serve' && i !== 1) }));
        // Monitoring panel: accuracy line, dropping during the drift scene.
        const m = B.mon;
        C.box(ctx, m.x, m.y, m.w, m.h, { fill: '#fff', stroke: i === 1 ? AMBER[2] : U.grid });
        C.text(ctx, '모니터링', m.x + 8, m.y + 14, { size: 10, weight: 600, color: U.text });
        const px = m.x + 8, pw = m.w - 16, py = m.y + 22, ph = m.h - 30;
        const drop = i === 0 ? 0 : i === 1 ? ease(t, 0.8, 4) : 1 - ease(t, 3.2, 4.6);
        const pts = Array.from({ length: 30 }, (_, j) => { const f = j / 29, d = f > 0.4 ? drop * Math.min(1, (f - 0.4) / 0.4) : 0; return [px + f * pw, py + ph * (0.2 + 0.6 * d) + Math.sin(j * 1.7) * 1.5]; });
        C.line(ctx, pts, drop > 0.3 ? AMBER[1] : U.blue, 1.5);
        C.text(ctx, '정확도', m.x + m.w - 8, m.y + 14, { size: 9, align: 'right' });
        // Arrows: top row left to right, registry down to serving, serving to monitoring, monitoring back up to data.
        const cy1 = y1 + bh / 2;
        C.arrow(ctx, [[X(0) + bw + 1, cy1], [X(1) - 2, cy1]], 1, '#cbd5e1', { width: 1.2 });
        C.arrow(ctx, [[X(1) + bw + 1, cy1], [X(2) - 2, cy1]], 1, '#cbd5e1', { width: 1.2 });
        const rx = X(2) + bw / 2;
        C.arrow(ctx, [[rx, y1 + bh + 1], [rx, y2 - 2]], 1, '#cbd5e1', { width: 1.2 });
        C.arrow(ctx, [[B.serve.x - 1, y2 + bh / 2], [m.x + m.w + 2, y2 + bh / 2]], 1, '#cbd5e1', { width: 1.2 });
        const back = [[X(0) + bw / 2, y2 - 2], [X(0) + bw / 2, y1 + bh + 2]];
        C.arrow(ctx, back, i === 2 ? Math.min(1, ease(t, 0, 1.2) + 0.001) : 1, i === 2 ? U.accent : '#cbd5e1', { width: i === 2 ? 2 : 1.2, dash: i === 2 ? null : [4, 4] });
        C.text(ctx, '재학습', X(0) + bw / 2 + 6, (y1 + bh + y2) / 2 + 4, { size: 10, weight: 600, color: i === 2 ? U.accent : U.muted });
        // Model version chip travels train, registry, serving.
        const v = i === 2 ? 'v2' : 'v1', path = [[X(1) + bw / 2, cy1 + 22], [X(2) + bw / 2, cy1 + 22], [X(2) + bw / 2, y2 + bh / 2 + 10], [B.serve.x + B.serve.w / 2, y2 + bh / 2 + 10]];
        const k = i === 0 ? ease(t, 0.5, 3.5) : i === 2 ? ease(t, 2.0, 4.8) : 1;
        if (i !== 2 || t > 2.0) tag(ctx, `모델 ${v}`, ...C.pathAt(path, k).pop(), i === 2 ? GREEN : BLUE, 1, 10);
        if (i === 2 && t <= 2.0) tag(ctx, '모델 v1', path[3][0], path[3][1], GRAY, 1, 10);
        if (i === 1) C.stamp(ctx, w / 2, (y1 + bh + y2) / 2, '코드는 그대로, 정확도 하락', 'warn', (t - 3.6) / 0.4);
        say(`${sc.pill}: ${sc.note}`);
      },
    });
  });
})();
