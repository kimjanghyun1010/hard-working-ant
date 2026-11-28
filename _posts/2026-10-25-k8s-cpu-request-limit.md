---
title: CPU 이해하기
description: 쿠버네티스에서 CPU가 남는데도 서버가 느려지는 이유를 스케줄러, request와 limit, Node.js의 CPU 사용 방식으로 따라간다.
date: 2026-10-25 12:00:00 +0900
series: Back to the Basic
tags: [cpu, kubernetes, cgroup, linux, nodejs]
scripts: [figures/cpu.js]
---

## CPU 시간과 기다림

CPU는 메모리에서 명령을 가져와 해석하고, 실행하고, 결과를 적는 일을 1초에 수십억 번 반복한다. 부품의 역할은 밭에서 일하는 일꾼으로 보면 잡기 쉽다.

| 부품 | 하는 일 | 비유 |
|---|---|---|
| 코어 | 명령을 실행하는 단위. CPU 하나에 여러 개 있다 | 일꾼 |
| 실행 장치 | 더하기, 비교 같은 실제 계산을 한다 | 일꾼의 몸 |
| 레지스터 | 지금 계산 중인 값을 담는 작은 칸 | 지금 손에 쥔 것 |
| L1, L2, L3 캐시 | 자주 쓰는 메모리 내용을 코어 가까이에 복사해 둔다 | 가방과 밭 옆 선반 |
| 메모리 | 실행 중인 프로그램과 데이터가 올라와 있는 곳 | 밭에 대 둔 수레 |

CPU는 계산보다 **기다리는 시간**이 길다. 레지스터에서 값을 꺼내는 데 0.2ns가 걸린다면 메모리는 약 100ns, SSD는 100µs, 다른 서버는 0.1~0.5ms가 걸린다. 레지스터를 1초로 늘려 보면 메모리는 8분, 다른 서버는 일주일에서 한 달 거리다(널리 쓰이는 대략값, 같은 데이터센터 안 기준).

쿠버네티스와 클라우드가 말하는 vCPU는 리눅스가 CPU 하나로 보는 실행 자리다. 코어 하나에 하드웨어 스레드 둘을 두는 하이퍼스레딩(hyper-threading)을 켜면 코어 16개가 vCPU 32개가 되고, 같은 코어의 두 vCPU는 실행 장치를 나눠 쓴다.

vCPU는 한 번에 OS 스레드 하나를 실행한다. OS 스레드는 커널이 CPU에 올렸다 내렸다 하는 실행 단위로, 프로세스 하나에 여럿 있을 수 있다. 그래도 vCPU 4개 서버에서 스레드 200개가 잘 도는 것은, 스레드 대부분이 DB나 디스크 응답을 기다리며 CPU에서 내려가 있기 때문이다.

<figure class="fig" data-figure="cpu-os-threads">
  <figcaption>요청 하나가 CPU를 쓰는 시간과 DB를 기다리는 시간</figcaption>
</figure>

그림의 예에서 100ms 걸린 API 요청이 CPU를 쓴 시간은 처음과 끝의 십여 ms뿐이다. API 서버가 CPU 때문에 느려지는 경우는 대개 이 십여 ms 동안 CPU를 바로 받지 못할 때다.

## 스케줄러와 쿼터

실행할 스레드가 vCPU보다 많으면 커널이 번갈아 돌린다. 스레드를 바꿀 때는 레지스터 값을 저장하고 다음 스레드 값을 불러오는데, 이 컨텍스트 스위칭(context switching)은 한 번에 수 µs가 걸린다.

바뀐 스레드는 캐시가 비어 있어 한동안 느리게 돈다. 계산하는 스레드를 vCPU보다 많이 띄우면 일보다 바꾸는 데 시간을 쓰는 이유다.

누구를 다음에 돌릴지는 커널 스케줄러가 정한다. 스케줄러는 스레드마다 가상 실행 시간을 쌓아 덜 쌓인 쪽에 먼저 차례를 준다.

가상 실행 시간은 실제로 쓴 시간을 weight(가중치)로 나눠 쌓는다. weight가 두 배인 스레드는 시간이 절반 속도로 쌓여서 차례를 두 배 자주 받는다.

한 번에 주는 시간은 8코어 이상이면 약 3ms다(커널 `sched_base_slice` 기본값에서 계산). 실행할 스레드가 vCPU보다 많으면 각 스레드는 이 간격으로 번갈아 돈다.

컨테이너의 CPU limit은 스케줄러와 별개인 대역폭 제어(CFS bandwidth control)가 맡는다.

- `cfs_period_us`: 시간을 나누는 주기. 기본 100ms
- `cfs_quota_us`: 한 주기 동안 컨테이너 전체가 쓸 수 있는 CPU 시간(쿼터). limit 500m이면 50ms

<figure class="fig" data-figure="cpu-cfs">
  <figcaption>limit 500m: 주기마다 쿼터 50ms를 쓰고 나머지는 멈춘다</figcaption>
</figure>

쿼터가 바닥나면 노드 CPU가 남아 있어도 그 컨테이너의 스레드는 주기가 끝날 때까지 실행되지 않는다. 이 대기를 쓰로틀링(throttling)이라 하고, 쿼터는 다음 주기에 다시 찬다.

커널은 쿼터를 **5ms 조각**으로 잘라, 스레드가 도는 vCPU마다 미리 나눠 준다(`sched_cfs_bandwidth_slice_us`). 매번 전체 쿼터를 잠그고 꺼내면 vCPU가 많을수록 느려지기 때문이다. 조각을 받아 둔 vCPU가 쉬게 되면 1ms만 남기고 나머지를 돌려준다.

조각이 이미 나가 있는 동안 다른 vCPU는 전체 쿼터가 비어 먼저 멈출 수 있다. 그래서 vCPU가 많은 노드에서는 사용량 합이 limit에 조금 못 미쳐도 쓰로틀이 걸린다.

## request와 limit

쿠버네티스의 CPU 1은 vCPU 하나의 시간이다. 리눅스는 cgroup(control group)으로 프로세스를 묶어 CPU와 메모리를 함께 제한하고, 컨테이너 하나가 cgroup 하나다. 노드마다 도는 kubelet(파드를 띄우고 관리하는 에이전트)이 컨테이너 런타임(runc, crun)을 거쳐 request와 limit을 그 cgroup의 파일에 적는다.

| | request 500m | limit 1000m |
|---|---|---|
| cgroup v2 | `cpu.weight = 59` (옛 식으로는 20) | `cpu.max = 100000 100000` |
| cgroup v1 | `cpu.shares = 512` | `cfs_quota_us = 100000`, `cfs_period_us = 100000` |
| 하는 일 | 경합 때 나눠 가질 비율 | 주기마다 쓸 시간의 상한 |

### request와 CPU 경합

request는 비율이다. cgroup v1의 shares는 CPU 1개를 1024로 놓는 값이라 500m은 512가 되고, v2에서는 이를 weight(1~10000)로 옮긴다. 앞에서 본 가상 실행 시간의 나눗수가 이 weight다.

weight 값은 런타임에 따라 20 또는 59로 다르다. 노드에서 `cpu.weight`를 직접 확인한다.

CPU가 남으면 weight는 아무 제한이 없다. 노드가 꽉 찼을 때만 그 비율대로 나눠 받는다.

쿠버네티스 스케줄러(kube-scheduler)는 노드에 올린 파드들의 request 합이 노드의 할당 가능 CPU(allocatable)를 넘지 않게 배치한다. 그래서 경합이 나도 각 파드는 적어도 request만큼은 받는다.

아래 두 그림은 vCPU 1개 노드에 request 500m, limit 1000m인 서버를 두고 초당 요청을 올린 시뮬레이션이다. 요청 하나가 CPU 10ms를 쓰면 초당 100에서 vCPU가 꽉 찬다.

<figure class="fig" data-figure="cpu-share-alone">
  <figcaption>서버 하나일 때 초당 요청과 못 쓴 CPU</figcaption>
</figure>

<figure class="fig" data-figure="cpu-share-contend">
  <figcaption>서버 둘이 vCPU 하나를 나눌 때 초당 요청과 못 쓴 CPU</figcaption>
</figure>

혼자면 초당 100까지 원하는 CPU를 다 받는다. 두 서버가 같은 부하를 받으면 초당 50, 즉 request 500m을 넘는 순간부터 둘 다 원하는 만큼 못 받는다. 초당 100에서는 각자 필요한 CPU의 절반만 받아 초당 50건밖에 처리하지 못하고, 남는 요청이 대기 줄에 쌓여 응답 시간이 계속 늘어난다.

이때 둘 다 limit에 닿지 않아 쓰로틀 카운터는 0이고, 늘어나는 건 CPU를 기다린 시간뿐이다. 이 시간은 뒤에서 볼 PSI로 잰다. request를 실제 사용량보다 낮게 잡으면 경합 때 그만큼 덜 받는다.

### limit과 쓰로틀링

limit은 컨테이너 안 모든 스레드가 한 주기에 쓴 시간의 합으로 잰다. 그래서 limit 1000m이라도 스레드 둘이 vCPU 두 개에서 같이 돌면 50ms 만에 100ms어치를 다 쓰고, 나머지 50ms 동안 멈춘다.

limit을 넉넉히 주면 되지 않나 싶지만, 쿼터는 평균이 아니라 100ms 단위로 잰다. 평균 사용률이 limit의 40%여도 요청이 몰리는 100ms 안에서는 쿼터가 바닥나고, 그 주기에 들어온 요청은 다음 주기까지 기다린다.

아래 데모에서 요청을 몰리게 한 뒤 limit 1000m과 limit 없음을 바꿔 가며 일이 끝나는 시각을 비교할 수 있다.

<figure class="fig" data-figure="cpu-burst">
  <figcaption>요청이 몰릴 때 limit이 자르는 구간</figcaption>
</figure>

같은 일이 limit 1000m에서는 130ms, limit 없이는 80ms에 끝난다. 50ms 차이는 쿼터를 다 쓰고 다음 주기를 기다린 시간이다.

쓰로틀은 컨테이너의 `cpu.stat`에 남는다. 아래는 vCPU 12개 노드(WSL2, 커널 6.18)에서 Docker `--cpus=1` 컨테이너에 계산만 하는 스레드 2개를 20초 돌린 뒤 읽은 값이다. `--cpus=1`은 limit 1000m과 같은 `cpu.max = 100000 100000`이다.

```text
$ cat /sys/fs/cgroup/cpu.stat
usage_usec 20103209
user_usec 20071012
system_usec 32197
nr_periods 201
nr_throttled 200
throttled_usec 22365968
```

201번의 주기 중 200번이 쿼터를 다 써서 멈췄고, 20초 동안 쓴 CPU는 정확히 1코어 × 20초다. `throttled_usec`가 22.4초로 벽시계 20초보다 큰 것은 멈춘 시간을 vCPU마다 더하기 때문이다.

사용률 그래프가 낮은데 응답이 튀면 `nr_throttled ÷ nr_periods`가 원인을 알려 준다. `cpu.max.burst`로 앞 주기에 덜 쓴 쿼터를 넘겨 짧은 몰림을 받아낼 수 있지만, 쿠버네티스 리소스 필드에는 아직 이 값이 없다.

## 사용률과 PSI

CPU 사용률은 시간으로 잰다. 커널은 vCPU마다 시간을 종류별로 나눠 쌓는다.

- user: 앱 코드를 실행한 시간
- system: 커널 일을 한 시간
- iowait: 할 일이 I/O 대기뿐이라 쉰 시간
- steal: 클라우드에서 같은 물리 서버의 다른 VM에 빼앗긴 시간
- idle: 할 일이 없어 쉰 시간

사용률은 보통 idle과 iowait를 뺀 비율이지만, idle만 빼는 대시보드도 있어 도구마다 값이 조금 다르다. 50%면 1초 중 500ms를 일했다는 뜻이다.

사용률에는 두 가지가 안 보인다. 하이퍼스레딩에서는 vCPU 둘이 100%여도 실행 장치는 메모리를 기다리며 놀 수 있다. 또 수집 간격(보통 15초 이상)의 평균이라, 100ms 단위로 생기는 쓰로틀과 순간 경합이 묻힌다.

load average(실행 중이거나 차례를 기다리는 스레드 수의 평균)도 답이 되지 못한다. 리눅스는 디스크를 기다리며 멈춘 스레드(D 상태)까지 세고, 컨테이너 안에서 봐도 노드 전체의 값이 나오기 때문이다.

"CPU를 기다린 시간"을 바로 재는 지표는 PSI(Pressure Stall Information)다. `/proc/pressure/cpu`에, cgroup v2에서는 컨테이너마다 `cpu.pressure`에 실행할 스레드가 있는데 CPU를 못 받은 시간의 비율이 나온다.

앞의 쓰로틀 컨테이너에서 같은 시각에 읽은 값이다.

```text
$ cat /sys/fs/cgroup/cpu.pressure
some avg10=41.24 avg60=13.34 avg300=3.12 total=10191781
full avg10=41.24 avg60=13.34 avg300=3.12 total=10191781
```

`some avg10=41.24`는 지난 10초 중 41%의 시간 동안 스레드 하나 이상이 CPU를 기다렸다는 뜻이고, `full`은 모든 스레드가 동시에 기다린 비율이다. 쓰로틀은 컨테이너 전체를 한꺼번에 멈추므로 두 값이 같고, 주기마다 절반을 멈추니 부하가 이어지면 50%로 올라간다.

사용률이 "얼마나 썼나"라면 PSI는 "얼마나 기다렸나"다. 이 대기에는 limit에 걸린 쓰로틀도, 다른 파드와의 경합도 들어간다. 그래서 PSI가 오르면 CPU 때문에 느려진 것이고, 둘 중 무엇인지는 앞에서 본 `nr_throttled`로 가른다.

## Node.js 서버의 CPU

"Node.js는 싱글 스레드"는 JS 코드가 메인 스레드 하나에서만 돈다는 뜻이다. 메인 스레드는 이벤트 루프(event loop), 곧 "준비된 일을 꺼내 콜백을 부르고 다시 기다리는" 반복을 돈다. 프로세스에는 다른 스레드도 있다. libuv는 Node가 OS의 I/O를 다루는 데 쓰는 C 라이브러리이고, V8은 JS를 기계어로 바꿔(JIT 컴파일) 실행하는 엔진이다.

| 스레드 | 하는 일 | 수 |
|---|---|---|
| 메인 스레드 | JS 실행과 이벤트 루프. 네트워크 I/O는 epoll로 여기서 처리 | 1 |
| libuv 스레드 풀 | 파일 읽기와 쓰기, `dns.lookup`, `crypto`, `zlib` | 기본 4 (`UV_THREADPOOL_SIZE`) |
| V8 헬퍼 스레드 | GC와 JIT 컴파일 | 기본 4 (`--v8-pool-size`) |
| `worker_threads` | CPU를 오래 쓰는 JS를 따로 돌린다 | 쓸 때만 |

<figure class="fig" data-figure="cpu-node-arch">
  <figcaption>Node.js 프로세스의 스레드 구성</figcaption>
</figure>

epoll은 소켓 여러 개를 한꺼번에 지켜보는 리눅스 기능이다. 메인 스레드는 소켓을 커널의 epoll에 등록해 두고, `epoll_wait` 한 번으로 준비된 소켓이 생길 때까지 대기한다. 이렇게 연결 1만 개를 스레드 하나로 함께 기다린다.

요청마다 스레드를 두면 스레드 1만 개가 필요하다. 스택은 8MB씩 예약되지만 실제로는 쓴 만큼만 차지한다. 비용은 스레드 1만 개를 번갈아 돌리는 스위칭과 캐시 손실에서 난다.

DB 쿼리 한 건이면 메인 스레드는 쿼리를 소켓에 쓰고(`write`) 곧바로 `epoll_wait`로 대기한다. 응답이 오면 커널이 소켓을 준비됨 목록에 올리고 메인 스레드를 깨운다. 메인 스레드는 `read`로 응답을 가져와 콜백을 부른다.

<figure class="fig" data-figure="cpu-request-flow">
  <figcaption>쿼리 한 건 동안 JS 스레드가 일하는 구간</figcaption>
</figure>

대기하는 동안 메인 스레드는 CPU를 하나도 쓰지 않고, 그 사이에 다른 요청의 콜백을 돈다. 반대로 콜백 하나가 CPU를 오래 잡으면 나머지는 전부 멈춘다. 대기 1만 건은 커널이 맡지만, 준비된 결과를 처리하는 건 메인 스레드 하나이기 때문이다.

아래 데모는 무거운 요청 A가 메인 스레드를 잡은 사이 3ms에 도착한 요청 B를 보여 준다. 모드를 바꾸면 A를 통째로 계산할 때와 5ms씩 쪼갤 때를 비교할 수 있다.

<figure class="fig" data-figure="cpu-eventloop">
  <figcaption>무거운 계산이 이벤트 루프를 막는 모습</figcaption>
</figure>

통째로 계산하면 B는 37ms를 기다리고, 5ms씩 쪼개면 2ms만 기다린다. 쪼갠 조각 사이마다 이벤트 루프가 한 바퀴 돌아 B의 콜백을 먼저 처리하기 때문이다. 일의 총량은 같아서 A가 끝나는 시각은 거의 같다.

계산이 단순하면 5ms쯤 계산한 뒤 `setImmediate`로 나머지를 예약해 이벤트 루프에 차례를 넘긴다. `Promise`나 `process.nextTick`으로 이으면 같은 차례 안에서 바로 실행돼 틈이 생기지 않는다. 계산이 복잡하면 `worker_threads`로 뺀다.

API 서버에서 이런 계산의 대부분은 JSON 변환이다. 변환 시간은 바이트 수에 비례해서 응답이 10KB에서 1MB가 되면 CPU도 약 100배 들고, 그동안 메인 스레드가 막힌다. 목록을 쪽 단위로 나눠(페이지네이션) 덜 보내고, DB가 준 JSON을 파싱했다가 다시 문자열로 바꾸지 않는 것만으로 CPU가 크게 준다.

변환은 금방 버려지는 객체도 많이 만든다. 이걸 치우는 GC(가비지 컬렉션, 안 쓰는 메모리를 찾아 비우는 일)가 V8 헬퍼 스레드에서 메인 스레드와 같은 시각에 돌아서, 부하가 걸린 Node 프로세스는 1000m을 넘겨 쓰기도 한다.

<figure class="fig" data-figure="cpu-node-limit">
  <figcaption>limit 1000m에서 JS 메인과 GC가 쿼터를 나눠 쓰는 100ms</figcaption>
</figure>

"싱글 스레드니까 1코어면 된다"며 limit을 1로 걸면 워커를 안 써도 쓰로틀이 걸리는 이유다. 메모리 쪽(힙 상한, OOMKilled)은 [메모리 이해하기]({{ site.baseurl }}{% post_url 2026-10-26-memory %})에 정리했다.

## 설정 기준

request는 "경합 때 받을 몫"이라 실제 사용량을 재서 잡는다.

- 요청이 몇 ms 안에 끝나는 API 서버: 바쁜 시간대 사용량의 상위 5% 값(p95)
- 연결을 붙잡고 계속 계산하는 스트림(영상 인코딩, 실시간 변환): 연결 하나가 꾸준히 쓰는 양 × 연결 수

연결 하나가 vCPU의 30%를 쓰면 vCPU 하나에 3개, 여유를 두면 2개다.

| 워크로드 | 설정 |
|---|---|
| I/O를 기다리는 웹 서버, API 서버 | request는 실측에 맞추고 limit은 빼는 것을 고려한다. 몰리는 순간의 쓰로틀이 곧 응답 지연이다 |
| ML 서빙, 연산 위주 작업 | request와 limit을 둘 다 정한다. 다른 파드에 주는 영향과 재현성이 중요하다 |
| 지연에 민감한 연산 | request와 limit을 같은 정수로 둔다(Guaranteed QoS). kubelet의 CPU Manager를 static 정책으로 켜면(기본은 none) 코어를 통째로 주고, 1.33부터는 이런 컨테이너에 쿼터도 걸지 않는다 |

limit을 뺄 때는 런타임이 "쓸 수 있는 CPU 수"를 어떻게 정하는지 확인한다. limit이 없으면 cgroup에 상한이 없으니 노드 전체 코어를 자기 몫으로 본다.

- Go: 1.25부터 GOMAXPROCS를 `cpu.max`에 맞춘다. limit이 없으면 노드 코어 수가 된다
- Java: CPU 수를 `cpu.max`로 정하고 request는 보지 않는다. limit이 없으면 노드 코어 수만큼 GC 스레드와 ForkJoin 풀을 만든다
- Node.js: libuv와 V8 풀은 기본 4개로 고정이다. `os.availableParallelism()`으로 워커 수를 정하는 코드는 libuv 1.49 이후 `cpu.max`를 따르므로 limit이 없으면 노드 코어 수만큼 워커를 띄운다

64코어 노드에서 request 500m인 파드가 스레드 64개를 띄우면, 경합 때 보장받는 CPU는 0.5코어인데 스레드 64개가 그 몫을 나눠 쓰니 스위칭과 GC 비용만 커진다. limit을 뺐다면 Go의 `GOMAXPROCS`, JVM의 `-XX:ActiveProcessorCount`, Node의 워커 수를 request에 맞춰 직접 정한다.

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| 스케줄러 | 덜 쓴 스레드에게 약 3ms씩 차례를 준다 | 계산 스레드가 vCPU보다 많으면 스위칭 비용이 커진다 |
| request | 경합 때 weight 비율로 나눠 받을 몫, kube-scheduler의 배치 기준 | 남는 CPU는 더 쓴다. 실측으로 꼭 정한다 |
| limit | 100ms마다 쓸 CPU 시간의 합, 5ms 조각으로 나눠 준다 | 다 쓰면 노드 CPU가 남아도 멈춘다 |
| 진단 | CPU 때문에 느린지는 `cpu.pressure`, 쓰로틀인지는 `nr_throttled ÷ nr_periods` | 사용률 그래프로는 둘 다 잘 안 보인다 |
| Node.js | JS는 메인 스레드 하나, 대기는 epoll이 맡는다 | 콜백 하나가 오래 잡으면 전부 멈춘다. GC 때문에 1000m을 넘는다 |
| limit 제거 | 쓰로틀이 없어진다 | 런타임이 노드 코어 수를 보지 않게 CPU 수를 직접 정한다 |

## 참고

- [Linux kernel — EEVDF Scheduler](https://docs.kernel.org/scheduler/sched-eevdf.html)
- [Linux kernel — kernel/sched/fair.c (sysctl_sched_base_slice)](https://github.com/torvalds/linux/blob/master/kernel/sched/fair.c)
- [Linux kernel — CFS Bandwidth Control](https://docs.kernel.org/scheduler/sched-bwc.html)
- [Linux kernel — Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [Linux kernel — PSI, Pressure Stall Information](https://docs.kernel.org/accounting/psi.html)
- [Brendan Gregg — Linux Load Averages: Solving the Mystery](https://www.brendangregg.com/blog/2017-08-08/linux-load-averages.html)
- [Kubernetes — Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Kubernetes — New Conversion from cgroup v1 CPU Shares to v2 CPU Weight](https://kubernetes.io/blog/2026/01/30/new-cgroup-v1-to-v2-cpu-conversion-formula/)
- [Kubernetes — Control CPU Management Policies on the Node](https://kubernetes.io/docs/tasks/administer-cluster/cpu-management-policies/)
- [Node.js — Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [libuv — Thread pool work scheduling](https://docs.libuv.org/en/v1.x/threadpool.html)
- [epoll(7)](https://man7.org/linux/man-pages/man7/epoll.7.html)
- [V8 — Concurrent marking](https://v8.dev/blog/concurrent-marking)
- [Go — Container-aware GOMAXPROCS](https://go.dev/blog/container-aware-gomaxprocs)
- [OpenJDK — JDK-8281181 Do not use CPU Shares to compute active processor count](https://bugs.openjdk.org/browse/JDK-8281181)
- 비유 참고: [컴알못을 위한 노예비유법 (컴퓨터 스펙 보는 법)](https://xsangraalx.tistory.com/20)
