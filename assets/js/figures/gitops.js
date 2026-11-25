// GitOps post: push and pull, CI, manifest repo, ArgoCD sync and drift, App of Apps, ApplicationSet, Argo Rollouts.
(() => {
  const U = hwa.ui, C = hwa.cv;
  const ease = (t, a, b) => hwa.smooth((t - a) / (b - a));
  const tw = (ctx, s, size, weight = 400) => { ctx.font = U.font(size, weight); return ctx.measureText(s).width; };
  // Chip colours: [background, text, border].
  const COL = {
    blue: ['#eff6ff', '#1d4ed8', '#93c5fd'], ok: ['#dcfce7', '#15803d', '#86efac'], warn: ['#fef3c7', '#b45309', '#fcd34d'],
    bad: ['#fee2e2', '#dc2626', '#fca5a5'], gray: [U.cell, U.muted, '#e2e8f0'], purple: ['#ede9fe', '#6d28d9', '#c4b5fd'],
  };
  const POD = { v1: '#94a3b8', v2: U.blue, new: '#f59e0b', bad: U.red };
  const MONO = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  // Scenes of unequal length, each followed by the same hold.
  const seq = (lens, hold) => {
    const L = lens.map((l) => l + hold), T = L.reduce((a, b) => a + b, 0);
    const at = (i) => L.slice(0, i).reduce((a, b) => a + b, 0);
    const of = (time) => { let x = time % T, i = 0; while (i < L.length - 1 && x >= L[i]) x -= L[i++]; return i; };
    return { n: lens.length, at, of, pos: (time) => { const i = of(time), run = (time % T) - at(i); return { i, run, t: Math.min(run, lens[i]) }; } };
  };
  const fig = (name, opts) => document.querySelectorAll(`[data-figure="${name}"]`).forEach((root) => hwa.scene(root, opts));
  // Multi-scene figure: draw(ctx, w, h, i, t, say) with t the time inside scene i. still is the end of the last scene.
  const scenes = (name, { height, lens, hold = 2, notes, draw }) => {
    const S = seq(lens, hold);
    fig(name, { height, notes, scenes: S, still: S.at(lens.length - 1) + lens[lens.length - 1], frame: (ctx, w, h, time, say) => { const { i, t } = S.pos(time); draw(ctx, w, h, i, t, say); } });
  };
  // Demo: draw(ctx, w, h, mode, t, say) with t = -1 until the run button is pressed.
  const demo = (name, { height, modes, run, notes, draw }) => fig(name, {
    height, notes, demo: { modes, run },
    frame: (ctx, w, h, time, say, ui) => draw(ctx, w, h, ui.mode, ui.runAt === null ? -1 : time - ui.runAt, say),
  });
  const hint = (ctx, s, x, y) => C.text(ctx, `${s} 버튼을 눌러 보자`, x, y, { size: 12, align: 'center', base: 'middle' });

  // Column i of n across width w; cards are capped at max wide and centred in their column.
  const col = (w, i, n = 3, gap = 16, max = 150) => {
    const cw = (w - gap * (n - 1)) / n, bw = Math.min(cw, max);
    return { x: i * (cw + gap) + (cw - bw) / 2, w: bw, cx: i * (cw + gap) + cw / 2, X: i * (cw + gap), cw };
  };
  const box = (b) => ({ ...b, l: [b.x, b.y + b.h / 2], r: [b.x + b.w, b.y + b.h / 2], t: [b.x + b.w / 2, b.y], b: [b.x + b.w / 2, b.y + b.h], cx: b.x + b.w / 2, cy: b.y + b.h / 2 });
  const elbow = (p, q) => { const mx = (p[0] + q[0]) / 2; return [p, [mx, p[1]], [mx, q[1]], q]; };
  const link = (ctx, pts, color = '#cbd5e1', dash) => C.arrow(ctx, pts, 1, color, { width: 1, dash });

  // Card whose second line takes a tone colour; dim fades it, a fades it in.
  const node = (ctx, b, { s = b.s, tone, lit = false, dim = false, a = 1 } = {}) => {
    if (a <= 0) return;
    const c = tone ? COL[tone] : null;
    ctx.globalAlpha = a * (dim ? 0.55 : 1);
    C.card(ctx, { x: b.x, y: b.y, w: b.w, h: b.h, t: b.label, s: s ? ' ' : '', size: b.size }, { lit, fill: c ? c[0] : '#fff', stroke: c ? c[2] : U.grid, dim });
    if (s) C.text(ctx, s, b.cx, b.cy + 9, { size: 10, weight: tone ? 600 : 400, color: c ? c[1] : U.muted, align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  const tag = (ctx, s, x, y, c = COL.blue, a = 1) => {
    if (a <= 0) return;
    const cw = tw(ctx, s, 10, 600) + 14;
    ctx.globalAlpha = Math.min(1, a);
    ctx.beginPath();
    ctx.roundRect(x - cw / 2 + 0.5, y - 9, cw - 1, 18, 6);
    ctx.fillStyle = c[0];
    ctx.fill();
    ctx.strokeStyle = c[2];
    ctx.lineWidth = 1;
    ctx.stroke();
    C.text(ctx, s, x, y + 0.5, { size: 10, weight: 600, color: c[1], align: 'center', base: 'middle' });
    ctx.globalAlpha = 1;
  };
  // Chip travelling along pts between times a and b; gone outside that window.
  const ride = (ctx, pts, t, a, b, s, c) => { if (t > a && t < b) tag(ctx, s, ...C.pathAt(pts, ease(t, a, b)).pop(), c); };
  const pods = (ctx, x, y, colors, size = 12, gap = 4) => colors.forEach((c, i) => {
    if (!c) return;
    ctx.beginPath();
    ctx.roundRect(x + i * (size + gap), y, size, size, 3);
    ctx.fillStyle = c;
    ctx.fill();
  });
  const groupBox = (ctx, x, y, w, h, label) => C.group(ctx, x, y, w, h, label, y + 16);

  // Push vs pull: who holds the cluster credentials, and what happens to a hand edit.
  scenes('gitops-push-pull', {
    height: 262, lens: [7, 8],
    notes: ['push 방식: CI가 kubeconfig로 직접 적용한다. 손으로 바꾼 5는 Git과 다른 채 남는다.', 'pull 방식: 클러스터 안의 ArgoCD가 Git을 읽어 맞춘다. 손으로 바꾼 5를 찾아 3으로 되돌린다.'],
    draw: (ctx, w, h, i, t, say) => {
      const pull = i === 1, c0 = col(w, 0), c1 = col(w, 1), c2 = col(w, 2);
      C.pill(ctx, 0, 0, pull ? 'pull 방식' : 'push 방식', pull ? 'ok' : 'warn');
      const git = box({ x: c0.x, y: 56, w: c0.w, h: 50, label: 'Git 저장소', s: 'replicas: 3' });
      const ci = box({ x: c1.x, y: 56, w: c1.w, h: 50, label: 'CI', s: 'kubectl apply' });
      const op = box({ x: c1.x, y: 150, w: c1.w, h: 46, label: '운영자', s: 'kubectl scale' });
      const G = { x: c2.X, y: 34, w: c2.cw, h: 182 };
      const argo = box({ x: G.x + 8, y: 56, w: G.w - 16, h: 46, label: 'ArgoCD' });
      const dep = box({ x: G.x + 8, y: 128, w: G.w - 16, h: 46, label: 'Deployment' });
      const edited = pull ? t >= 3.8 && t < 5.6 : t >= 4.2, n = edited ? 5 : 3;
      groupBox(ctx, G.x, G.y, G.w, G.h, '클러스터');
      node(ctx, git);
      node(ctx, op);
      link(ctx, [[op.r[0], 162], [dep.x, 162]]);
      if (pull) {
        link(ctx, [git.r, argo.l]);
        C.text(ctx, '읽어 감', (git.r[0] + argo.l[0]) / 2, git.cy - 8, { size: 10, align: 'center' });
        link(ctx, [argo.b, dep.t]);
        const st = t >= 5.6 || t < 3.9 ? ['Synced', 'ok'] : ['OutOfSync', 'warn'];
        node(ctx, argo, { s: st[0], tone: st[1], lit: t >= 3.9 && t < 5.6 });
      } else {
        link(ctx, [git.r, ci.l]);
        link(ctx, [ci.r, [dep.cx, ci.cy], dep.t]);
        node(ctx, ci, { lit: t > 1.4 && t < 2.8 });
        tag(ctx, 'kubeconfig', ci.cx, ci.y + ci.h + 16, COL.warn);
      }
      node(ctx, dep, { s: `replicas: ${n}`, tone: edited ? 'warn' : undefined });
      const pw = Math.min(12, (dep.w - 16) / 5);
      pods(ctx, dep.cx - (5 * pw + 16) / 2, dep.y + dep.h + 8, [0, 1, 2, 3, 4].map((k) => (k < 3 ? POD.v2 : k < n ? POD.new : null)), pw);
      if (pull) {
        ride(ctx, [git.r, argo.l], t, 0.3, 1.3, 'replicas: 3', COL.blue);
        ride(ctx, [argo.b, dep.t], t, 1.5, 2.3, 'apply', COL.blue);
        ride(ctx, [[op.r[0], 162], [dep.x, 162]], t, 2.8, 3.8, 'scale 5', COL.warn);
        ride(ctx, [argo.b, dep.t], t, 4.6, 5.6, '3으로', COL.ok);
        C.stamp(ctx, w / 2, 242, '다시 3', 'ok', (t - 6) / 0.4);
      } else {
        ride(ctx, [git.r, ci.l], t, 0.3, 1.3, 'v2', COL.blue);
        ride(ctx, [ci.r, [dep.cx, ci.cy], dep.t], t, 1.5, 2.7, 'apply', COL.blue);
        ride(ctx, [[op.r[0], 162], [dep.x, 162]], t, 3.2, 4.2, 'scale 5', COL.warn);
        C.stamp(ctx, w / 2, 242, 'Git 3, 클러스터 5', 'bad', (t - 4.8) / 0.4);
      }
      say(pull ? 'pull 방식: ArgoCD가 클러스터 안에서 Git을 읽는다. 운영자가 replicas를 5로 바꾸자 OutOfSync를 찾아 3으로 되돌린다.' : 'push 방식: CI가 kubeconfig로 클러스터에 적용한다. 운영자가 replicas를 5로 바꾸면 Git의 3과 다른 채 남는다.');
    },
  });

  // Required checks: a PR reaches main only when every check passes.
  const tick = (ctx, x, y, state, time) => {
    ctx.beginPath();
    if (state === 'run') {
      ctx.arc(x, y, 6, time * 6, time * 6 + 4.2);
      ctx.strokeStyle = U.blue; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      return;
    }
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    if (state === 'wait') { ctx.strokeStyle = '#cbd5e1'; ctx.stroke(); return; }
    ctx.fillStyle = state === 'ok' ? '#22c55e' : U.red;
    ctx.fill();
    const m = state === 'ok' ? [[x - 3.5, y], [x - 1, y + 2.5], [x + 3.5, y - 2.5]] : [[x - 3, y - 3], [x + 3, y + 3]];
    C.line(ctx, m, '#fff', 1.6);
    if (state === 'bad') C.line(ctx, [[x + 3, y - 3], [x - 3, y + 3]], '#fff', 1.6);
  };
  scenes('gitops-ci-gate', {
    height: 236, lens: [6.5, 6],
    notes: ['검사 셋이 모두 통과하면 merge 버튼이 열리고 PR이 main에 들어간다.', 'test 하나가 실패하면 merge 버튼이 잠겨 PR이 main에 닿지 않는다.'],
    draw: (ctx, w, h, i, t, say) => {
      const fail = i === 1, c0 = col(w, 0), c1 = col(w, 1), c2 = col(w, 2);
      C.pill(ctx, 0, 0, fail ? 'test 실패' : '검사 통과', fail ? 'bad' : 'ok');
      const pr = box({ x: c0.x, y: 88, w: c0.w, h: 46, label: 'PR #42', s: 'feature' });
      const G = box({ x: c1.X, y: 34, w: c1.cw, h: 154 });
      const merge = box({ x: c2.x, y: 50, w: c2.w, h: 46, label: 'merge' });
      const main = box({ x: c2.x, y: 140, w: c2.w, h: 46, label: 'main' });
      groupBox(ctx, G.x, G.y, G.w, G.h, '필수 검사');
      link(ctx, [pr.r, [G.x, pr.cy]]);
      link(ctx, elbow([G.x + G.w, G.cy], merge.l));
      link(ctx, [merge.b, main.t]);
      node(ctx, pr);
      const DONE = [2.0, 2.7, 3.4];
      ['lint', 'test', 'build'].forEach((name, k) => {
        const ry = 64 + k * 38, rx = G.x + 8, rw = G.w - 16;
        const st = t < 1.1 ? 'wait' : t < DONE[k] ? 'run' : fail && k === 1 ? 'bad' : 'ok';
        C.box(ctx, rx, ry, rw, 28, { fill: '#fff', stroke: st === 'bad' ? COL.bad[2] : U.grid, r: 6 });
        tick(ctx, rx + 15, ry + 14, st, t);
        C.text(ctx, name, rx + 29, ry + 14.5, { size: 11, weight: 600, color: U.text, base: 'middle' });
        if (rw >= 150) C.text(ctx, { wait: '대기', run: '실행 중', ok: '통과', bad: '실패' }[st], rx + rw - 10, ry + 14.5, { size: 10, align: 'right', base: 'middle', color: st === 'bad' ? COL.bad[1] : U.muted });
      });
      const open = t >= 3.6;
      node(ctx, merge, { s: open ? (fail ? '잠김' : '가능') : '검사 대기', tone: open ? (fail ? 'bad' : 'ok') : undefined, lit: open && !fail });
      node(ctx, main, { s: !fail && t >= 5 ? 'PR #42 반영' : '', tone: !fail && t >= 5 ? 'ok' : undefined });
      ride(ctx, [pr.r, [G.x, pr.cy]], t, 0.3, 1.1, 'PR', COL.blue);
      ride(ctx, elbow([G.x + G.w, G.cy], merge.l), t, 3.5, 4.3, 'PR', fail ? COL.bad : COL.ok);
      if (!fail) ride(ctx, [merge.b, main.t], t, 4.4, 5.0, 'PR', COL.ok);
      C.stamp(ctx, w / 2, 214, fail ? 'merge 막힘' : 'main에 들어감', fail ? 'bad' : 'ok', (t - (fail ? 4.4 : 5.2)) / 0.4);
      say(fail ? 'lint와 build는 통과했지만 test가 실패해 merge 버튼이 잠긴다.' : 'lint, test, build가 모두 통과해 merge 버튼이 열리고 PR이 main에 들어간다.');
    },
  });

  // Image tags: latest changes the image but not Git; a SHA tag changes one manifest line and rolls every pod.
  scenes('gitops-image-tag', {
    height: 252, lens: [7, 7],
    notes: ['latest: 이미지만 바뀌고 매니페스트는 그대로라 ArgoCD는 할 일이 없다. 다시 뜬 파드만 v2를 받아 버전이 섞인다.', 'SHA 태그: 매니페스트 한 줄이 바뀌어 ArgoCD가 동기화하고, 파드가 전부 v2로 바뀐다.'],
    draw: (ctx, w, h, i, t, say) => {
      const sha = i === 1, c0 = col(w, 0), c1 = col(w, 1), c2 = col(w, 2);
      C.pill(ctx, 0, 0, sha ? 'app:3f2a91c' : 'app:latest', sha ? 'ok' : 'warn');
      const ci = box({ x: c0.x, y: 92, w: c0.w, h: 46, label: 'CI', s: '새 버전 v2' });
      const reg = box({ x: c1.x, y: 40, w: c1.w, h: 46, label: '레지스트리' });
      const git = box({ x: c1.x, y: 140, w: c1.w, h: 46, label: '매니페스트' });
      const G = { x: c2.X, y: 34, w: c2.cw, h: 176 };
      const argo = box({ x: G.x + 8, y: 56, w: G.w - 16, h: 46, label: 'ArgoCD' });
      const ps = Math.min(30, (G.w - 26) / 3), px = G.x + (G.w - (3 * ps + 10)) / 2, py = 150;
      groupBox(ctx, G.x, G.y, G.w, G.h, '클러스터');
      link(ctx, elbow(ci.r, reg.l));
      if (sha) link(ctx, elbow(ci.r, git.l));
      link(ctx, elbow(git.r, argo.l));
      link(ctx, [argo.b, [argo.cx, py - 4]]);
      node(ctx, ci);
      const pushed = t >= 1.3, committed = sha && t >= 2.3;
      node(ctx, reg, { s: sha ? (pushed ? '3f2a91c' : 'a41d07e') : `latest = ${pushed ? 'v2' : 'v1'}`, tone: pushed ? 'blue' : undefined });
      node(ctx, git, { s: sha ? (committed ? 'app:3f2a91c' : 'app:a41d07e') : 'app:latest', tone: committed ? 'blue' : undefined, lit: committed && t < 3.4 });
      if (!sha && t >= 1.6) C.text(ctx, '변경 없음', git.cx, git.y + git.h + 14, { size: 10, weight: 600, color: COL.warn[1], align: 'center' });
      const st = !sha ? ['Synced', 'ok'] : t < 3.3 ? ['Synced', 'ok'] : t < 5.6 ? ['동기화 중', 'warn'] : ['Synced', 'ok'];
      node(ctx, argo, { s: st[0], tone: st[1] });
      const ver = [0, 1, 2].map((k) => (sha ? (t >= 3.8 + k * 0.6 ? 'v2' : 'v1') : k === 2 && t >= 4.8 ? 'v2' : 'v1'));
      ver.forEach((v, k) => {
        const x = px + k * (ps + 5), gone = !sha && k === 2 && t >= 3.4 && t < 4.8;
        ctx.globalAlpha = gone ? 0.25 : 1;
        ctx.beginPath(); ctx.roundRect(x, py, ps, 26, 5); ctx.fillStyle = POD[v]; ctx.fill();
        C.text(ctx, v, x + ps / 2, py + 13.5, { size: 10, weight: 700, color: '#fff', align: 'center', base: 'middle' });
        ctx.globalAlpha = 1;
      });
      C.text(ctx, '파드', G.x + G.w / 2, py + 44, { size: 10, align: 'center' });
      const p3 = px + 2 * (ps + 5) + ps / 2;
      ride(ctx, elbow(ci.r, reg.l), t, 0.3, 1.3, sha ? '3f2a91c' : 'latest', COL.blue);
      if (sha) {
        ride(ctx, elbow(ci.r, git.l), t, 1.3, 2.3, '태그 커밋', COL.blue);
        ride(ctx, elbow(git.r, argo.l), t, 2.5, 3.3, '3f2a91c', COL.blue);
        C.stamp(ctx, w / 2, 232, '전부 v2', 'ok', (t - 5.8) / 0.4);
      } else {
        ride(ctx, elbow(git.r, argo.l), t, 1.6, 2.4, '그대로', COL.gray);
        ride(ctx, [reg.b, [reg.cx, 124], [p3, 124], [p3, py]], t, 3.8, 4.8, 'v2', COL.blue);
        C.stamp(ctx, w / 2, 232, 'v1, v2 섞임', 'bad', (t - 5.4) / 0.4);
      }
      say(sha ? '커밋 SHA 태그: 매니페스트가 app:3f2a91c로 바뀌고 ArgoCD가 동기화해 파드 셋이 모두 v2가 된다.' : 'latest 태그: 레지스트리의 latest만 v2로 바뀌고 매니페스트는 그대로다. 다시 뜬 파드 하나만 v2라 v1과 섞인다.');
    },
  });

  // Two repos: the commit's path from app repo to cluster in five steps; CI stops at the manifest repo.
  fig('gitops-two-repos', {
    height: 300, still: 7.2,
    frame: (ctx, w, h, time, say) => {
      const s = hwa.steps(time, 5, 1.3, 2.4), c0 = col(w, 0), c1 = col(w, 1), c2 = col(w, 2);
      C.pill(ctx, 0, 0, '커밋 하나의 길', 'info');
      const app = box({ x: c0.x, y: 40, w: c0.w, h: 46, label: '앱 저장소', s: '코드' });
      const ci = box({ x: c1.x, y: 40, w: c1.w, h: 46, label: 'CI', s: '테스트, 빌드' });
      const reg = box({ x: c2.x, y: 40, w: c2.w, h: 46, label: '레지스트리', s: 'ghcr.io' });
      const man = box({ x: c1.x, y: 150, w: c1.w, h: 46, label: '매니페스트', s: '저장소' });
      const G = { x: c2.X, y: 120, w: c2.cw, h: 116 };
      const argo = box({ x: G.x + 8, y: 146, w: G.w - 16, h: 40, label: 'ArgoCD' });
      const STEP = [
        [[app.r, ci.l], 'main에 merge하면 CI가 돈다', 'push'],
        [[ci.r, reg.l], 'CI가 이미지를 SHA 태그로 올린다', 'image'],
        [[ci.b, man.t], 'CI가 매니페스트에 태그 한 줄을 커밋한다', 'tag'],
        [[man.r, argo.l], 'ArgoCD가 매니페스트를 읽어 간다', 'pull'],
        [[argo.b, [argo.cx, 206]], '적용하면 노드가 레지스트리에서 이미지를 받는다', 'apply'],
      ];
      groupBox(ctx, G.x, G.y, G.w, G.h, '클러스터');
      const lit = new Set();
      STEP.forEach(([p], k) => { if (k === s.active) lit.add(p[1].join()); });
      [app, ci, reg, man, argo].forEach((b) => node(ctx, b, { lit: lit.has(b.l.join()) || lit.has(b.t.join()) }));
      const done = s.done || s.active === 4;
      pods(ctx, G.x + G.w / 2 - 22, 210, [0, 1, 2].map(() => (done && s.k(4) > 0.9 ? POD.v2 : POD.v1)));
      STEP.forEach(([pts], k) => {
        if (k > s.active && !s.done) return;
        const on = k === s.active;
        C.arrow(ctx, pts, on ? s.k(k) : 1, on ? U.accent : '#cbd5e1', { width: on ? 2 : 1.5 });
        C.badge(ctx, pts, k + 1, on, k === 2 ? 'left' : k === 4 ? 'right' : 'up');
      });
      if (!s.done) {
        const [pts, text] = STEP[s.active];
        C.text(ctx, `${s.active + 1}. ${text}`, 0, 266, { size: 12, weight: 600, color: U.text, base: 'middle' });
        if (s.k(s.active) < 1) tag(ctx, STEP[s.active][2], ...C.pathAt(pts, s.k(s.active)).pop(), COL.blue);
      } else C.stamp(ctx, w / 2, 266, 'CI는 클러스터에 닿지 않음', 'ok', 1);
      say('앱 저장소에서 CI, 레지스트리, 매니페스트 저장소를 거쳐 ArgoCD가 클러스터에 적용한다. CI는 클러스터에 접속하지 않는다.');
    },
  });

  // kustomize: the result is the base with the overlay's two lines written over it.
  const OV = [
    { env: 'dev', rep: 1, tag: '9b7c2e1' },
    { env: 'prod', rep: 5, tag: '3f2a91c' },
  ];
  const code = (ctx, b, title, lines, { lit = -1, hl = [], a = [] } = {}) => {
    C.box(ctx, b.x, b.y, b.w, b.h, { fill: '#fff', stroke: lit >= 0 ? U.accentLine : U.grid });
    C.text(ctx, title, b.x + 10, b.y + 16, { size: 10, weight: 600, color: U.text });
    lines.forEach((s, k) => {
      const y = b.y + 30 + k * 18, al = a[k] === undefined ? 1 : a[k];
      if (al <= 0) return;
      ctx.globalAlpha = al;
      if (hl[k]) { ctx.fillStyle = COL.blue[0]; ctx.fillRect(b.x + 4, y, b.w - 8, 16); }
      ctx.font = MONO;
      ctx.fillStyle = hl[k] ? COL.blue[1] : U.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(s, b.x + 10, y + 8.5);
      ctx.globalAlpha = 1;
    });
  };
  scenes('gitops-kustomize', {
    height: 286, lens: [6, 6],
    notes: ['dev: base의 replicas와 이미지 태그 두 줄만 overlay 값으로 바뀐다.', 'prod: 같은 base에서 replicas 5와 다른 태그가 들어간다. base는 한 벌이다.'],
    draw: (ctx, w, h, i, t, say) => {
      const o = OV[i], wide = w >= 560, BH = 108;
      C.pill(ctx, 0, 0, `overlays/${o.env}`, 'info');
      if (wide) C.text(ctx, 'kubectl kustomize 결과', w, 11, { size: 10, align: 'right', base: 'middle' });
      let base, ov, out;
      if (wide) {
        const c0 = col(w, 0, 3, 24, 240), c1 = col(w, 1, 3, 24, 240), c2 = col(w, 2, 3, 24, 240);
        base = box({ x: c0.x, y: 60, w: c0.w, h: BH }); ov = box({ x: c1.x, y: 60, w: c1.w, h: BH }); out = box({ x: c2.x, y: 60, w: c2.w, h: BH });
        link(ctx, [base.r, ov.l]);
        link(ctx, [ov.r, out.l]);
      } else {
        const hw = (w - 12) / 2;
        base = box({ x: 0, y: 36, w: hw, h: BH }); ov = box({ x: hw + 12, y: 36, w: hw, h: BH }); out = box({ x: 0, y: 172, w, h: BH });
        link(ctx, [base.b, [base.cx, out.y]]);
        link(ctx, [ov.b, [ov.cx, out.y]]);
      }
      const rep = t >= 2.8, img = t >= 4.0;
      code(ctx, base, 'base', ['kind: Deployment', 'replicas: 2', 'image: app', 'port: 8080'], { lit: t < 1.4 ? 0 : -1 });
      code(ctx, ov, `overlays/${o.env}`, [`replicas: ${o.rep}`, `newTag: ${o.tag}`], { lit: t >= 1.6 && t < 4.2 ? 0 : -1, hl: [t >= 1.6 && t < 2.8, t >= 3.0 && t < 4.0] });
      const lines = ['kind: Deployment', `replicas: ${rep ? o.rep : 2}`, `image: app${img ? `:${o.tag}` : ''}`, 'port: 8080'];
      code(ctx, out, '결과', lines, { hl: [false, rep, img, false], a: [0, 1, 2, 3].map((k) => ease(t, 0.2 + k * 0.3, 0.5 + k * 0.3)) });
      const line = (b, k) => [b.x + Math.min(b.w / 2, 80), b.y + 38 + k * 18];
      ride(ctx, [line(ov, 0), line(out, 1)], t, 1.8, 2.8, `replicas: ${o.rep}`, COL.blue);
      ride(ctx, [line(ov, 1), line(out, 2)], t, 3.0, 4.0, o.tag, COL.blue);
      C.stamp(ctx, w / 2, wide ? 210 : 155, '바뀐 줄 2개', 'ok', (t - 4.4) / 0.4);
      say(`overlays/${o.env}: base를 그대로 가져와 replicas를 ${o.rep}, 이미지 태그를 ${o.tag}로 바꾼 결과가 나온다.`);
    },
  });

  // Sync timing: a commit waits for the next poll (120s + up to 60s jitter), or a webhook refreshes at once.
  {
    const SPAN = 200, SEC = 6, LH = 44;
    const FILL = { commit: '#8b5cf6', poll: '#94a3b8', hook: '#c4b5fd', sync: '#22c55e', v1: '#cbd5e1', v2: U.blue };
    const M = [
      { pill: '폴링만', tone: 'warn', sync: 153, done: 161, hook: null, stamp: ['140초 대기', 'bad'] },
      { pill: '웹훅', tone: 'ok', sync: 11, done: 17, hook: 11, stamp: ['7초 만에 반영', 'ok'] },
    ];
    demo('gitops-sync', {
      height: 236, modes: ['폴링만', '웹훅'], run: '커밋 푸시',
      notes: ['폴링만: 커밋은 다음 폴링까지 기다렸다가 반영된다.', '웹훅: Git 서버가 푸시를 알려 바로 동기화한다. 폴링은 그대로 돈다.'],
      draw: (ctx, w, h, mode, run, say) => {
        const m = M[mode], k = Math.max(0, Math.min(1, run / SEC)), t = k * SPAN;
        C.pill(ctx, 0, 0, m.pill, m.tone);
        let lx = w;
        [['sync', '동기화'], ['poll', '폴링']].forEach(([kind, label]) => {
          lx -= tw(ctx, label, 10) + 4;
          C.text(ctx, label, lx, 11.5, { size: 10, base: 'middle' });
          lx -= 14;
          ctx.fillStyle = FILL[kind];
          ctx.beginPath(); ctx.roundRect(lx, 6, 10, 10, 2); ctx.fill();
          lx -= 10;
        });
        const lw = Math.min(64, w * 0.2), x0 = lw, x1 = w - 6, top = 40, base = top + 3 * LH + 4;
        const X = (v) => x0 + (Math.max(0, Math.min(v, SPAN)) / SPAN) * (x1 - x0), ly = (j) => top + j * LH;
        ['Git', 'ArgoCD', '클러스터'].forEach((s, j) => C.text(ctx, s, 0, ly(j) + LH / 2, { size: 10, weight: 600, color: U.text, base: 'middle' }));
        C.line(ctx, [[x0, top - 4], [x0, base], [x1, base]], U.text, 1.2);
        [[60, '60초'], [120, '120초'], [180, '180초']].forEach(([v, s]) => {
          C.line(ctx, [[X(v), base - 3], [X(v), base + 3]], U.muted, 1);
          C.text(ctx, s, X(v), base + 14, { size: 9, align: 'center' });
        });
        if (run < 0) { hint(ctx, '커밋 푸시', (x0 + x1) / 2, top + (base - top) / 2); say(`${m.pill}. 커밋을 푸시하면 클러스터에 반영되는 시각을 본다.`); return; }
        const segs = [[1, 0, 3, 'poll'], [1, 150, 153, 'poll'], [0, 10, 13, 'commit'], [1, m.sync, m.done, 'sync'], [2, 0, m.done, 'v1', 'v1'], [2, m.done, SPAN, 'v2', 'v2']];
        if (m.hook) segs.push([1, 10, 11, 'hook']);
        if (!m.hook) {
          const y = ly(1) + LH / 2, xe = X(Math.min(t, 150));
          if (t > 14) {
            C.line(ctx, [[X(14), y], [xe - 2, y]], U.red, 1.4);
            if (t >= 150) C.text(ctx, '다음 폴링까지 대기', (X(14) + X(150)) / 2, y - 6, { size: 9, weight: 600, color: U.red, align: 'center' });
          }
        }
        segs.forEach(([j, a, b, kind, label]) => {
          if (t <= a) return;
          const y = ly(j) + 9, bx = X(a), bw = Math.max(2, X(Math.min(t, b)) - bx - 1);
          ctx.beginPath(); ctx.roundRect(bx, y, bw, LH - 18, Math.min(6, bw / 2)); ctx.fillStyle = FILL[kind]; ctx.fill();
          if (label && t >= b && tw(ctx, label, 10, 700) + 8 < bw) C.text(ctx, label, bx + bw / 2, y + (LH - 18) / 2 + 0.5, { size: 10, weight: 700, color: kind === 'v1' ? U.text : '#fff', align: 'center', base: 'middle' });
        });
        if (t >= 10) C.event(ctx, X(10), top + 4, base, '커밋', FILL.commit, 'left');
        if (k < 1) C.dashed(ctx, X(t), top - 4, X(t), base, U.now);
        C.stamp(ctx, (x0 + x1) / 2, base + 38, m.stamp[0], m.stamp[1], (run - SEC) / 0.4);
        say(mode ? '웹훅: 10초에 커밋하자 바로 동기화해 17초에 클러스터가 v2가 된다.' : '폴링만: 10초에 커밋했지만 150초의 다음 폴링까지 140초를 기다린 뒤 v2가 된다.');
      },
    });
  }

  // Drift: a hand edit makes the app OutOfSync; selfHeal puts Git's value back.
  demo('gitops-drift', {
    height: 252, modes: ['selfHeal 끔', 'selfHeal 켬'], run: 'kubectl로 수정',
    notes: ['selfHeal 끔: 차이를 OutOfSync로 표시만 하고, 파드는 5개로 남는다.', 'selfHeal 켬: 몇 초 안에 Git의 replicas 3으로 되돌린다.'],
    draw: (ctx, w, h, mode, t, say) => {
      const heal = mode === 1, c0 = col(w, 0), c1 = col(w, 1), c2 = col(w, 2);
      C.pill(ctx, 0, 0, heal ? 'selfHeal 켬' : 'selfHeal 끔', heal ? 'ok' : 'warn');
      const git = box({ x: c0.x, y: 62, w: c0.w, h: 50, label: 'Git', s: 'replicas: 3' });
      const argo = box({ x: c1.x, y: 62, w: c1.w, h: 50, label: 'ArgoCD' });
      const op = box({ x: c1.x, y: 154, w: c1.w, h: 46, label: '운영자', s: 'kubectl scale' });
      const G = { x: c2.X, y: 40, w: c2.cw, h: 176 };
      const dep = box({ x: G.x + 8, y: 64, w: G.w - 16, h: 46, label: 'Deployment' });
      const edited = t >= 1.3 && !(heal && t >= 3.6), seen = t >= 1.8 && !(heal && t >= 3.6), n = edited ? 5 : 3;
      const pw = Math.min(12, (dep.w - 16) / 5), pdx = dep.cx - (5 * pw + 16) / 2, py = 140;
      groupBox(ctx, G.x, G.y, G.w, G.h, '클러스터');
      link(ctx, [git.r, argo.l]);
      link(ctx, elbow(argo.r, dep.l));
      const opPath = [op.r, [G.x - 6, op.cy], [G.x - 6, py + 6], [pdx - 2, py + 6]];
      link(ctx, opPath);
      node(ctx, git);
      node(ctx, op);
      node(ctx, argo, { s: seen ? 'OutOfSync' : 'Synced', tone: seen ? 'warn' : 'ok', lit: seen });
      node(ctx, dep, { s: `replicas: ${n}`, tone: edited ? 'warn' : undefined });
      pods(ctx, pdx, py, [0, 1, 2, 3, 4].map((k) => (k < 3 ? POD.v2 : k < n ? POD.new : null)), pw);
      C.text(ctx, `파드 ${n}개`, G.x + G.w / 2, py + 34, { size: 11, weight: 700, color: edited ? COL.warn[1] : U.text, align: 'center' });
      if (t < 0) { hint(ctx, 'kubectl로 수정', w / 2, 236); say(`${heal ? 'selfHeal 켬' : 'selfHeal 끔'}. kubectl로 replicas를 바꾼 뒤 파드 수를 본다.`); return; }
      ride(ctx, opPath, t, 0.3, 1.3, 'scale 5', COL.warn);
      if (heal) {
        ride(ctx, elbow(argo.r, dep.l), t, 2.6, 3.6, 'replicas: 3', COL.ok);
        C.stamp(ctx, w / 2, 234, 'Git 값 3으로 되돌림', 'ok', (t - 4) / 0.4);
      } else C.stamp(ctx, w / 2, 234, 'OutOfSync로 남음', 'warn', (t - 3) / 0.4);
      say(heal ? 'selfHeal 켬: 운영자가 5로 바꾸자 ArgoCD가 OutOfSync를 찾아 Git의 3으로 되돌린다.' : 'selfHeal 끔: 운영자가 5로 바꾸면 ArgoCD는 OutOfSync로 표시만 하고 파드는 5개로 남는다.');
    },
  });

  // App of Apps: the root Application reads apps/ and creates one child Application per file.
  {
    const NAMES = ['bookinfo', 'istio-base', 'istiod', 'todo-api'];
    scenes('gitops-app-of-apps', {
      height: 262, lens: [6.5, 6],
      notes: ['루트가 apps 폴더를 읽어 파일마다 자식 Application을 만든다.', 'todo-api.yaml을 커밋하면 루트가 읽어 Application이 하나 늘어난다.'],
      draw: (ctx, w, h, i, t, say) => {
        const c0 = col(w, 0), c1 = col(w, 1), c2 = col(w, 2), add = i === 1;
        C.pill(ctx, 0, 0, add ? '파일 추가' : '처음 동기화', add ? 'ok' : 'info');
        const G = { x: c0.X, y: 34, w: c0.cw, h: 186 };
        const root = box({ x: c1.x, y: 102, w: c1.w, h: 50, label: 'root', s: 'Application' });
        const kids = NAMES.map((s, k) => box({ x: c2.x, y: 40 + k * 46, w: c2.w, h: 36, label: s }));
        ctx.font = MONO;
        const ext = ctx.measureText('istio-base.yaml').width <= G.w - 28;
        groupBox(ctx, G.x, G.y, G.w, G.h, ext ? 'apps/' : 'apps/*.yaml');
        NAMES.forEach((s, k) => {
          if (k === 3 && !add) return;
          const a = k === 3 ? ease(t, 0.4, 1.0) : 1, y = 54 + k * 34;
          ctx.globalAlpha = a;
          C.box(ctx, G.x + 8 + (1 - a) * 10, y, G.w - 16, 26, { fill: k === 3 && t < 2.4 ? COL.blue[0] : '#fff', stroke: k === 3 && t < 2.4 ? COL.blue[2] : U.grid, r: 6 });
          ctx.font = MONO;
          ctx.fillStyle = U.text;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(ext ? `${s}.yaml` : s, G.x + 16 + (1 - a) * 10, y + 13.5);
          ctx.globalAlpha = 1;
        });
        const from = [G.x + G.w, root.cy];
        link(ctx, [from, root.l]);
        node(ctx, root, { lit: add ? t > 1.4 && t < 3.4 : t > 0.3 && t < 4.2 });
        kids.forEach((b, k) => {
          const born = add ? (k < 3 ? -1 : 3.2) : 2.0 + k * 0.8;
          if (k === 3 && !add) return;
          if (t >= born) link(ctx, elbow(root.r, b.l));
          const synced = t >= born + 0.6;
          node(ctx, b, { s: synced ? 'Synced' : '동기화 중', tone: synced ? 'ok' : 'warn', a: ease(t, born, born + 0.3) });
          if (born > 0) ride(ctx, elbow(root.r, b.l), t, born - 0.6, born, 'App', COL.blue);
        });
        ride(ctx, [from, root.l], t, add ? 1.4 : 0.3, add ? 2.2 : 1.2, add ? 'todo-api' : '3개', COL.blue);
        C.stamp(ctx, w / 2, 242, add ? '파일 하나 = 앱 하나' : 'Application 3개', 'ok', (t - (add ? 4.4 : 4.6)) / 0.4);
        say(add ? 'apps 폴더에 todo-api.yaml을 커밋하자 루트가 읽어 todo-api Application을 만든다.' : '루트 Application이 apps 폴더의 파일 셋을 읽어 자식 Application 셋을 만든다.');
      },
    });
  }

  // ApplicationSet: the cluster generator stamps one Application per cluster whose label matches.
  {
    const CL = [['prod-1', 'prod'], ['prod-2', 'prod'], ['dev-1', 'dev'], ['prod-3', 'prod']];
    scenes('gitops-appset', {
      height: 262, lens: [6.5, 6],
      notes: ['env: prod 라벨이 붙은 클러스터마다 Application이 생긴다. dev-1에는 생기지 않는다.', 'prod 라벨을 단 클러스터를 등록하면 Application이 저절로 하나 더 생긴다.'],
      draw: (ctx, w, h, i, t, say) => {
        const add = i === 1, c0 = col(w, 0), c1 = col(w, 1), c2 = col(w, 2);
        C.pill(ctx, 0, 0, add ? '클러스터 추가' : 'cluster generator', add ? 'ok' : 'info');
        const set = box({ x: c0.x, y: 92, w: c0.w, h: 56, label: 'ApplicationSet', s: 'env: prod', size: 11 });
        node(ctx, set, { tone: 'blue', lit: add ? t > 1.4 && t < 2.6 : t > 0.3 && t < 3.6 });
        CL.forEach(([name, env], k) => {
          if (k === 3 && !add) return;
          const y = 40 + k * 46, cl = box({ x: c2.x, y, w: c2.w, h: 38, label: name }), ap = box({ x: c1.x, y, w: c1.w, h: 38, label: `app-${name}` });
          const match = env === 'prod', picked = add ? (k < 3 || t >= 1.4) : t >= 0.5 + k * 0.3;
          const pi = [0, 1, -1, 2][k], born = add ? (k < 3 ? -1 : 2.6) : 2.4 + pi * 0.8;
          node(ctx, cl, { s: `env: ${env}`, tone: picked ? (match ? 'ok' : undefined) : undefined, dim: picked && !match, a: k === 3 ? ease(t, 0.4, 1.0) : 1 });
          if (!match) { if (t >= 3.4 || add) C.text(ctx, '라벨 다름', ap.cx, ap.cy + 0.5, { size: 10, align: 'center', base: 'middle' }); return; }
          if (t >= born) { link(ctx, elbow(set.r, ap.l)); link(ctx, [ap.r, cl.l]); }
          node(ctx, ap, { a: ease(t, born, born + 0.3), size: 11 });
          if (born > 0) ride(ctx, elbow(set.r, ap.l), t, born - 0.8, born, 'app', COL.blue);
        });
        C.stamp(ctx, w / 2, 242, add ? 'app-prod-3 자동 생성' : 'prod 클러스터만', 'ok', (t - (add ? 3.6 : 4.4)) / 0.4);
        say(add ? 'env: prod 라벨을 단 prod-3 클러스터를 등록하자 app-prod-3 Application이 저절로 생긴다.' : 'cluster generator가 env: prod 라벨이 붙은 prod-1, prod-2에만 Application을 만들고 dev-1은 건너뛴다.');
      },
    });
  }

  // Canary vs rolling: share of requests hitting a buggy version over 10 minutes. Times are illustrative.
  demo('gitops-canary', {
    height: 250, modes: ['롤링 업데이트', '카나리'], run: '버그 있는 버전 배포',
    notes: ['롤링 업데이트: 파드가 바뀌는 만큼 에러 비율이 올라 2분 뒤 100%가 된다.', '카나리: 10%에서 기다리는 동안 분석이 실패를 찾아 중단하고 되돌린다.'],
    draw: (ctx, w, h, mode, run, say) => {
      const canary = mode === 1, SEC = 6, m = Math.max(0, Math.min(1, run / SEC)) * 10;
      const f = (x) => (x < 0.5 ? 0 : canary ? (x < 3 ? Math.min(10, (x - 0.5) * 50) : Math.max(0, 10 - (x - 3) * 50)) : Math.min(100, (x - 0.5) * 50));
      C.pill(ctx, 0, 0, canary ? '카나리' : '롤링 업데이트', canary ? 'ok' : 'warn');
      let peak = 0;
      for (let x = 0; run >= 0 && x <= m; x += 0.05) peak = Math.max(peak, f(x));
      C.text(ctx, `에러 받은 요청 최대 ${Math.round(peak)}%`, w, 11, { size: 11, weight: 700, color: peak > 0 ? U.red : U.text, align: 'right', base: 'middle' });
      const x0 = 36, y0 = 44, pw = w - x0 - 8, ph = 156, X = (v) => x0 + (v / 10) * pw;
      const Y = C.panel(ctx, x0, y0, pw, ph, { max: 100, ticks: [[0, '0%'], [50, '50%'], [100, '100%']] });
      [0, 5, 10].forEach((v) => C.text(ctx, `${v}분`, X(v), y0 + ph + 14, { size: 10, align: v ? (v === 10 ? 'right' : 'center') : 'left' }));
      if (canary) { C.dashed(ctx, x0, Y(10), x0 + pw, Y(10), '#cbd5e1'); C.text(ctx, 'setWeight 10', x0 + pw - 4, Y(10) - 5, { size: 9, align: 'right' }); }
      if (run < 0) { hint(ctx, '버그 있는 버전 배포', x0 + pw / 2, y0 + ph / 2); say('버그 있는 버전을 배포하면 에러를 받는 요청 비율이 어떻게 오르는지 본다.'); return; }
      const pts = [];
      for (let x = 0; x <= m + 1e-9; x += 0.05) pts.push([X(x), Y(f(x))]);
      pts.push([X(m), Y(f(m))]);
      C.area(ctx, pts, Y(0), 'rgba(239,68,68,0.12)');
      C.line(ctx, pts, U.red, 2);
      C.dot(ctx, X(m), Y(f(m)), U.red);
      if (m >= 0.5) C.event(ctx, X(0.5), y0 + 14, y0 + ph, '배포', U.slate, 'left');
      if (canary && m >= 3) C.event(ctx, X(3), y0 + 14, y0 + ph, '분석 실패, 중단', U.red, 'left');
      C.stamp(ctx, x0 + pw * 0.62, y0 + ph * 0.42, canary ? '10%에서 중단' : '2분 만에 100%', canary ? 'ok' : 'bad', (run - SEC) / 0.4);
      say(canary ? '카나리: 새 버전에 10%만 보내고 기다리다 3분에 분석이 실패해 중단한다. 에러는 10% 안에서 끝난다.' : '롤링 업데이트: 배포 2분 뒤 모든 파드가 새 버전이 되어 요청 100%가 에러를 받는다.');
    },
  });

  // Blue-green: preview first, then the active Service flips to v2, and flips back while v1 is still up.
  {
    const SW = [null, 1.6, 2.4];
    scenes('gitops-bluegreen', {
      height: 256, lens: [5.5, 6, 6.5],
      notes: ['preview 서비스로 v2를 먼저 확인한다. 운영 트래픽은 아직 v1로 간다.', '승격하면 active 서비스가 v2를 가리켜 트래픽이 한 번에 넘어간다.', 'v2에 문제가 보이면 아직 떠 있는 v1로 active를 되돌린다.'],
      draw: (ctx, w, h, i, t, say) => {
        const c0 = col(w, 0), c1 = col(w, 1), c2 = col(w, 2);
        const P = [['미리보기', 'info'], ['승격', 'ok'], ['되돌리기', 'warn']][i];
        C.pill(ctx, 0, 0, P[0], P[1]);
        const user = box({ x: c0.x, y: 52, w: c0.w, h: 44, label: '사용자' });
        const qa = box({ x: c0.x, y: 152, w: c0.w, h: 44, label: '확인용', s: 'QA' });
        const act = box({ x: c1.x, y: 52, w: c1.w, h: 44, label: 'active', s: 'Service' });
        const pre = box({ x: c1.x, y: 152, w: c1.w, h: 44, label: 'preview', s: 'Service' });
        const v1 = box({ x: c2.x, y: 42, w: c2.w, h: 64 }), v2 = box({ x: c2.x, y: 142, w: c2.w, h: 64 });
        const target = (x) => (i === 0 ? v1 : i === 1 ? (x < SW[1] ? v1 : v2) : x < SW[2] ? v2 : v1);
        const tgt = target(t), bad = i === 2 && t >= 1.0;
        link(ctx, [user.r, act.l]);
        link(ctx, [qa.r, pre.l]);
        link(ctx, elbow(act.r, tgt.l), U.blue);
        link(ctx, [pre.r, v2.l], U.purple);
        // Request dots: each picks its target from the selector at the moment it reaches the active Service.
        const dots = (gap, life, path, color) => {
          for (let b = Math.floor((t - life) / gap) * gap; b <= t; b += gap) {
            const k = (t - b) / life;
            if (k < 0 || k > 1) continue;
            const [pts, c] = path(b);
            const [x, y] = C.pathAt(pts, k).pop();
            ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
          }
        };
        dots(0.35, 1.4, (b) => { const g = target(b + 0.7); return [[user.r, act.l, ...elbow(act.r, g.l)], g === v2 && i === 2 && b + 1.4 >= 1.0 ? U.red : U.blue]; }, U.blue);
        dots(0.8, 1.4, () => [[qa.r, pre.l, pre.r, v2.l], U.purple]);
        [user, qa, act, pre].forEach((b) => node(ctx, b, { lit: b === act && SW[i] !== null && Math.abs(t - SW[i]) < 0.5 }));
        [[v1, 'v1', POD.v1], [v2, 'v2', bad ? POD.bad : POD.v2]].forEach(([b, name, c]) => {
          C.box(ctx, b.x, b.y, b.w, b.h, { fill: '#fff', stroke: b === tgt ? COL.blue[2] : U.grid });
          C.text(ctx, `ReplicaSet ${name}`, b.x + 8, b.y + 16, { size: b.w < 110 ? 10 : 11, weight: 600, color: U.text });
          pods(ctx, b.x + 8, b.y + 30, [c, c, c], 14);
        });
        const s1 = i === 1 && t >= SW[1] ? '30초 뒤 정리' : i === 2 ? (t >= SW[2] ? 'active' : '아직 떠 있음') : 'active';
        C.text(ctx, s1, v1.x + v1.w - 8, v1.y + v1.h - 10, { size: 10, weight: 600, color: s1 === 'active' ? COL.blue[1] : COL.warn[1], align: 'right' });
        if (bad) C.text(ctx, '에러', v2.x + v2.w - 8, v2.y + v2.h - 10, { size: 10, weight: 600, color: U.red, align: 'right' });
        const st = [['v2는 preview로만', 'info', 3.4], ['한 번에 넘김', 'ok', 2.6], ['바로 v1로', 'warn', 3.4]][i];
        C.stamp(ctx, w / 2, 234, st[0], st[1], (t - st[2]) / 0.4);
        say(['미리보기: 사용자 요청은 active를 거쳐 v1로, 확인용 요청은 preview를 거쳐 v2로 간다.', '승격: active가 v2를 가리키자 사용자 요청이 한 번에 v2로 넘어간다. v1은 30초 뒤 정리된다.', '되돌리기: v2에서 에러가 나자 아직 떠 있는 v1로 active를 되돌린다.'][i]);
      },
    });
  }
})();
