---
layout: default
title: 그림 디자인 시스템
description: 글 속 캔버스 그림이 같이 쓰는 규칙과 부품
permalink: /design/
scripts: [figures/design.js]
---
<div class="page prose" markdown="1">

<h1 class="post-title">그림 디자인 시스템</h1>

글 속 캔버스 그림이 같이 쓰는 규칙과 부품이다. 부품은 `assets/js/figure.js` 하나에 있고, 글마다 `assets/js/figures/<글>.js`에서 이 부품으로 그림을 그린다. 아래 예시는 전부 실제 부품으로 그렸다.

## 원칙

- 비전공자가 한눈에 보게 그린다. 실생활 비유 대신 내용을 쉬운 말과 화면으로 보여 준다.
- 그림 하나에 하나만 보여 준다. 기술 수치는 칩이나 본문 표로 내린다.
- 화면에 보이면 자동 재생하고, 클릭하면 멈춘다. 오른쪽 위 아이콘이 상태다. ▶는 재생 중, 두 줄은 멈춤이다.
- 동작 줄이기 설정이면 `still` 시점 한 장면만 보여 주고 멈춤 상태로 시작한다.
- 상태는 왼쪽 위 알약으로, 색 설명은 그림 아래 캡션으로 적는다.
- 장면이 여럿인 그림은 아래에 "1 2 3" 번호만 둔다. 지금 장면이 강조되고, 번호를 누르면 그 장면으로 바로 간다. `hwa.scene`의 `scenes` 옵션을 쓴다. 같은 길이 장면이면 `hwa.loopScenes(sec, hold, n)`으로 만든다.
- 한 번에 하나만 움직인다. 같은 순간에 옮겨 갈 칩이 여럿이면 차례로 움직이고, 줄이 한 칸씩 당겨지는 것은 한 번으로 친다.
- 흐름은 왼쪽에서 오른쪽으로 읽힌다. 들어오는 쪽을 왼쪽, 처리하는 쪽을 오른쪽에 둔다.
- 본문의 표는 기본으로 접혀 있고, 누르면 열린다. 접힌 줄에 열 이름과 행 수가 나온다.
- 구조 밑그림을 먼저 그린다. 서버, 사용자 공간과 커널, CPU와 vCPU, 메모리, 네트워크나 디스크 같은 실제 구조를 맞는 계층으로 깔고, 그 위에서 요청과 데이터가 오가고 기다리는 자리(대기 줄, 소켓 버퍼, 레지스터 등)를 표시한 뒤 칩이 그 사이를 움직이게 한다. 상자 몇 개와 화살표만 있는 추상 그림은 쓰지 않는다. 밑그림은 자세하되 가볍게(얇은 선, 옅은 글자, 적은 색), 움직이는 것만 진한 색으로 한다.
- 그림은 실행할 작업 단위로 단순하게 그린다. 레지스터와 L1, L2, L3 캐시는 그림 1(이론)에만 두고, OS 스레드 이름(T1 등)이나 캐시를 그림에 넣어 주객이 바뀌지 않게 한다. 칩은 작업, 요청처럼 그 그림의 주제만 나타낸다.
- 막대 그래프는 쓰지 않는다. 가로 막대, 시간 막대, 게이지 막대 모두 해당한다. 시간은 시계나 상자의 상태 변화로, 양은 토큰이나 칸의 개수로, 흐름은 상자 사이를 오가는 칩으로 보여 준다. 추이를 보여 줘야 할 때만 선 그래프를 쓴다.
- 폰 폭(약 370px)에서 겹치지 않게 한다. 자리가 모자라면 보조 글부터 숨긴다.
- 글에도 그림에도 가운뎃점은 쓰지 않는다.

## 그림 넣기

글 front matter에 스크립트를 적고, 본문에 빈 `figure`를 둔다.

```markdown
---
scripts: [figures/cpu.js]
---

<figure class="fig" data-figure="cpu-layers">
  <figcaption>그림 1. 무엇을 보여 주는지 한두 문장</figcaption>
</figure>
```

스크립트는 `data-figure`로 자리를 찾아 `hwa.scene`을 부른다. `frame`은 매 프레임 처음부터 다시 그린다. 상태를 쌓지 말고 `time`만 보고 그린다.

```js
document.querySelectorAll('[data-figure="cpu-layers"]').forEach((root) => {
  hwa.scene(root, {
    height: 280,          // 캔버스 높이, 폭은 글 폭을 따른다
    still: 5.2,           // 동작 줄이기일 때 보여 줄 시점(초)
    frame: (ctx, w, h, time, say) => {
      const s = hwa.steps(time, 4, 1.3, 2.4);
      // ... 부품으로 그리기
      say('화면 읽기 프로그램이 읽을 한 문장');
    },
  });
});
```

## 색

| 이름 | 값 | 쓰임 |
|---|---|---|
| `text` | <span style="color:#374151">■</span> `#374151` | 제목, 이름 |
| `muted` | <span style="color:#6b7280">■</span> `#6b7280` | 설명, 눈금 |
| `grid` | <span style="color:#e5e7eb">■</span> `#e5e7eb` | 테두리, 격자 |
| `plot` | <span style="color:#f8fafc">■</span> `#f8fafc` | 그래프 바탕, 묶음 상자 |
| `accent` | <span style="color:#4f46e5">■</span> `#4f46e5` | 지금 단계, 강조 테두리 |
| `accentSoft`, `accentLine` | <span style="color:#a5b4fc">■</span> `#eef2ff`, `#a5b4fc` | 지금 단계 상자의 바탕과 테두리 |
| `blue`, `red` | <span style="color:#3b82f6">■</span><span style="color:#ef4444">■</span> `#3b82f6`, `#ef4444` | 그래프 선, 정상과 문제 |

상태 색은 `tones`에 바탕과 글자 색 한 쌍으로 있다. 알약(`cv.pill`)과 값 칩(`cv.chip`)이 같은 쌍을 쓴다.

<figure class="fig" data-figure="ds-tones">
  <figcaption>ok, warn, bad, info. 위는 상태 알약, 아래는 값 칩이다.</figcaption>
</figure>

## 시간

| 함수 | 돌려주는 값 | 쓰는 곳 |
|---|---|---|
| `hwa.steps(time, n, step, hold)` | `active` 지금 단계, `k(i)` i단계의 등장 정도(0~1), `done` | 층이나 순서를 하나씩 보여 줄 때 |
| `hwa.loop(time, sec, hold, n)` | `i` 몇 번째 장면, `t` 장면 안의 초, `k` 장면 진행도(0~1) | 그래프가 그려지는 장면, 여러 장면을 번갈아 보여 줄 때 |
| `hwa.smooth(x)` | 0~1을 부드럽게 바꾼 값 | 등장, 이동 |

- 단계 하나는 0.9~1.3초, 다 보여 준 뒤 1.6~2.4초 멈춘다.
- 장면 하나는 4.5~7초, 끝나고 1.2~2초 멈춘 뒤 다음 장면으로 간다.
- 모든 그림은 `hwa.speed`(지금 0.6) 비율로 느리게 재생한다. 한 단계를 읽고 이해할 시간을 준다.
- 새로 나타나는 것은 단계 길이의 0.35만큼 걸려 들어온다. 값 칩은 오른쪽에서 12px 미끄러지며 나타난다.

<figure class="fig" data-figure="ds-steps">
  <figcaption>hwa.steps와 cv.box, cv.chip. 지금 단계 상자가 옅은 보라로 바뀌고 값 칩이 나타난다.</figcaption>
</figure>

<figure class="fig" data-figure="ds-chart">
  <figcaption>hwa.loop와 cv.pill, cv.panel, cv.line, cv.area, cv.dot. 장면마다 알약이 바뀌고 선이 그려진다.</figcaption>
</figure>

## 부품

모두 `hwa.cv`에 있다. 글 스크립트에서는 `const C = hwa.cv`로 줄여 쓴다.

| 부품 | 쓰임 |
|---|---|
| `text`, `wrap` | 글자. `wrap`은 폭에 맞춰 줄을 나눈다 |
| `pill` | 왼쪽 위 상태 알약 |
| `legend` | 색 네모와 이름 |
| `panel` | 그래프 상자와 눈금. 값을 y로 바꾸는 함수를 돌려준다 |
| `line`, `area`, `dashed`, `dot`, `hatch` | 그래프 선, 면, 점선, 끝점 라벨, 빗금 |
| `box` | 층이나 영역. `on`이면 지금 단계로 칠한다 |
| `chip`, `chipW` | 오른쪽 정렬 값 칩. 마지막 인자로 등장 정도를 받는다 |
| `card` | 이름이 있는 상자. `lit`이면 보라 테두리 |
| `group` | 카드를 묶는 회색 상자 |
| `arrow`, `pathAt` | 진행도만큼 자라는 화살표 |
| `badge` | 화살표 옆 단계 번호 |

<figure class="fig" data-figure="ds-flow">
  <figcaption>cv.group, cv.card, cv.arrow, cv.badge. 화살표가 단계마다 자라고, 받는 카드가 보라 테두리로 바뀐다.</figcaption>
</figure>

</div>
