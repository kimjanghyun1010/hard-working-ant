---
title: CPU 이해하기
description: CPU를 나눠 쓰는 방식부터 쿠버네티스 request와 limit, Node.js가 CPU를 쓰는 방식까지 정리했다.
date: 2026-10-25 12:00:00 +0900
series: Back to the Basic
tags: [cpu, kubernetes, cgroup, linux, nodejs]
scripts: [figures/cpu.js]
---

## CPU 기본 구조

CPU는 프로그램의 명령을 하나씩 실행하는 장치다. 1초에 수십억 번 아래 네 단계를 반복한다.

1. 메모리에서 명령을 가져온다.
2. 무슨 명령인지 해석한다.
3. 실행한다.
4. 결과를 적는다.

CPU를 밭에서 일하는 일꾼으로 보면 부품의 역할을 잡기 쉽다.

| 부품 | 하는 일 | 비유 |
|---|---|---|
| 코어 | 명령을 실행하는 단위. CPU 하나에 여러 개 있다 | 일꾼 |
| 실행 장치 | 더하기, 비교 같은 실제 계산을 한다 | 일꾼의 몸 |
| 레지스터 | 지금 계산 중인 값과 다음에 실행할 명령의 위치를 담는 작은 칸 | 지금 손에 쥔 것 |
| L1, L2 캐시 | 자주 쓰는 메모리 내용을 코어 가까이에 복사해 둔다 | 일꾼이 멘 가방 |
| L3 캐시 | 코어들이 같이 쓰는 캐시 | 일꾼들이 같이 쓰는 밭 옆 선반 |

CPU는 메모리에 올라온 명령과 데이터만 바로 다룬다. 디스크나 네트워크의 데이터는 먼저 메모리로 가져와야 하고, 멀리 있을수록 오래 걸린다.

<figure class="fig" data-figure="cpu-memory">
  <figcaption>그림 1. 데이터가 있는 곳과 레지스터에서 다녀오는 시간</figcaption>
</figure>

| 이름 | 위치 | 크기 (보통) | 왕복 시간 (대략) | 비유 |
|---|---|---|---|---|
| 레지스터 | 코어 안 | 아주 작다 | 0.2ns 정도 | 손에 쥔 것 |
| L1 캐시 | 코어마다 하나 | 수십 KB | 약 1ns | 가방 앞주머니 |
| L2 캐시 | 코어마다 하나 | 수백 KB에서 몇 MB | 약 4ns | 가방 안 |
| L3 캐시 | 칩 안, 코어들이 같이 씀 | 수 MB에서 수십 MB | 약 15ns | 밭 옆 선반 |
| 메모리 | 메인보드 슬롯 (DDR) | 수십 GB | 약 100ns | 밭에 대 둔 수레 |
| SSD | PCIe 슬롯 (NVMe) | 수 TB | 수십에서 100µs | 창고 |
| 다른 서버 | 랜카드와 스위치 너머 | | 0.1에서 0.5ms | 다른 마을의 창고 |

크기와 시간은 흔히 쓰는 대략값이라 CPU와 장비마다 다르다.

그래서 CPU는 계산하는 시간보다 데이터를 기다리는 시간이 더 길 때가 많다.

## CPU 정보 확인

`lscpu`로 서버의 CPU 구성을 볼 수 있다.

<div class="language-text highlighter-rouge"><div class="highlight"><pre class="highlight"><code>$ lscpu
Architecture:             x86_64
<strong>CPU(s):                   32</strong>
  On-line CPU(s) list:    0-31
Vendor ID:                GenuineIntel
  Model name:             Intel(R) Xeon(R) Silver 4314 CPU @ 2.40GHz
    <strong>Thread(s) per core:   2</strong>
    <strong>Core(s) per socket:   16</strong>
    <strong>Socket(s):            1</strong>
</code></pre></div></div>

| 항목 | 값 | 뜻 | 흔히 부르는 말 |
|---|---|---|---|
| CPU(s) | 32 | 리눅스 스케줄러가 보는 논리 CPU 수 | 논리 프로세서, 논리 스레드, vCPU |
| Thread(s) per core | 2 | 코어 하나가 받는 하드웨어 스레드 수 (하이퍼스레딩) | |
| Core(s) per socket | 16 | 소켓 하나에 든 물리 코어 수 | 코어 수, 물리 프로세서 |
| Socket(s) | 1 | 메인보드에 꽂힌 물리 CPU 수 | |

코어 16개가 하드웨어 스레드를 2개씩 가져서 CPU(s)는 32다.

<figure class="fig" data-figure="cpu-count">
  <figcaption>그림 2. lscpu 숫자가 만들어지는 순서</figcaption>
</figure>

## 하이퍼스레딩

CPU는 명령 하나를 1ns보다 짧게 처리하지만, 메모리에서 데이터를 가져오는 데는 약 100ns가 걸린다. 그동안 실행 장치는 멈춰서 기다린다(stall).

하이퍼스레딩은 코어 하나에 vCPU를 두 개 두고, 한쪽이 기다리는 동안 다른 쪽이 계산하게 한다.

<figure class="fig" data-figure="cpu-ht">
  <figcaption>그림 3. 하이퍼스레딩 끔, 켬, 계산만 하는 일에서 코어 하나의 실행 장치</figcaption>
</figure>

실행 장치는 하나라서 코어 두 개만큼 일하지는 못한다. 앞의 lscpu 서버도 vCPU는 32개지만 완전한 병렬은 코어 수인 16까지다.

- 이득이 큰 시스템: 연산은 적고 요청이 많은 웹 서버, API 서버, DB. 메모리를 기다리는 시간이 많다.
- 손해일 수 있는 시스템: 연산이 큰 압축, 인코딩, 수치 계산. 메모리를 기다리는 시간이 거의 없어서, 내부적으로는 자원 경합으로 stall이 늘어난다.

## 논리 스레드와 OS 스레드

둘 다 스레드라고 부르지만 다른 것이다.

| 구분 | 뜻 | 수 |
|---|---|---|
| 논리 스레드 (vCPU) | OS가 CPU 하나로 보는 단위. 한 번에 스레드 하나를 실행한다 | 하드웨어가 정한다 (예: 32) |
| OS 스레드 | 커널이 스케줄링하는 실행 단위. 요청을 처리한 뒤에도 남아 다음 요청을 받는다 | 수백에서 수만 |
| 요청 | 클라이언트가 보낸 작업 한 건 | 계속 들어온다 |

OS 스레드는 요청 하나를 끝내도 사라지지 않고 다음 요청을 기다린다. 요청을 처리하는 도중에도 DB 응답 같은 것을 기다릴 때는 대기 상태가 된다.

그래서 스레드는 대부분의 시간을 대기로 보내고, vCPU 32개로 OS 스레드 수천 개를 돌릴 수 있다.

<figure class="fig" data-figure="cpu-os-threads">
  <figcaption>그림 4. 서버 안에서 요청 하나가 처리되는 흐름</figcaption>
</figure>

동기 방식은 스레드 하나가 한 가지를, 비동기 방식은 여러 가지를 한꺼번에 기다린다.

## 스레드 스케줄링

### 컨텍스트 스위칭

CPU가 돌리던 스레드를 내리고 다른 스레드를 올리는 걸 컨텍스트 스위칭이라고 한다.

- 내릴 때: 그 스레드가 어디까지 했는지(레지스터 값)를 메모리에 저장한다.
- 올릴 때: 다음 스레드가 저장해 둔 값을 꺼내 CPU에 싣는다.

저장하고 꺼내는 동안 CPU는 실제 일을 못 한다. 그래서 너무 자주 바뀌면 그만큼 느려진다.

스위칭은 두 가지 경우에 일어난다.

- 자발적 스위칭: 디스크, 네트워크, 락을 기다리느라 스스로 CPU를 내려놓는 경우
- 강제 스위칭: 실행할 일이 남았는데 할당 시간이 끝나 CPU를 내주는 경우

<figure class="fig" data-figure="cpu-switch">
  <figcaption>그림 5. 작업을 자주 바꿀수록 늘어나는 전환 비용 (전환 비용은 크게 그림)</figcaption>
</figure>

둘 다 한 코어에서 여러 스레드를 번갈아 돌리는 방법이다.

- 컨텍스트 스위칭: 커널이 소프트웨어로 스레드를 바꾼다.
- 하이퍼스레딩: CPU가 하드웨어로 바꾼다.

| | 컨텍스트 스위칭 | 하이퍼스레딩 |
|---|---|---|
| 누가 바꾸나 | 커널 | CPU 하드웨어 |
| 바꾸는 때 | 차례가 끝나거나 I/O를 기다릴 때 | 메모리를 기다릴 때마다 |
| 레지스터 | 저장했다가 다시 불러온다 | vCPU마다 한 벌씩 따로 있다 |
| 바꾸는 비용 | 수 µs | 거의 없다 |

### CFS

리눅스는 CFS(Completely Fair Scheduler)라는 스케줄러로 스레드에 vCPU를 나눠 준다. 이름처럼 스레드끼리 공평하게 나누는 게 목표다.

vCPU 하나는 한 번에 스레드 하나만 돌린다. 스레드가 여럿이면 CFS가 시간을 잘게 나눠 번갈아 돌린다.

- 동시성: 아주 빨리 바꿔서 동시에 도는 것처럼 보인다.
- 병렬: 실제로 동시에 돈다. vCPU가 여러 개일 때만 된다.

- CFS는 스레드마다 CPU를 쓴 시간을 나노초 단위로 기록하고, 가장 덜 쓴 스레드를 다음에 올린다.
- 한 번에 주는 시간은 몇 ms 정도이고, 기다리는 스레드가 많을수록 짧아진다.
- 차례가 끝난 스레드는 대기 줄 뒤로 가고, I/O를 기다리게 된 스레드는 대기 상태가 된다.

뒤에 나올 쿠버네티스의 request와 limit도 CFS가 시간을 나눌 때 쓰는 값이다.

<figure class="fig" data-figure="cpu-hierarchy">
  <figcaption>그림 6. CFS 대기 줄에서 덜 쓴 작업부터 vCPU에 올라가는 모습</figcaption>
</figure>

## CPU 사용량 지표

### CPU 사용률

메모리는 얼마나 차 있는지(용량)로 재지만, CPU는 얼마 동안 일했는지(시간)로 잰다. CFS가 스레드마다 쓴 시간을 기록하기 때문이다.

<figure class="fig" data-figure="cpu-usage">
  <figcaption>그림 7. 1초를 50ms 칸 20개로 센 CPU 사용률</figcaption>
</figure>

Prometheus Node Exporter의 `node_cpu_seconds_total`은 CPU 하나가 상태별로 보낸 시간을 초 단위로 쌓은 값이다.

| mode | 뜻 |
|---|---|
| idle | 아무 일도 안 한 시간 |
| user | 애플리케이션 코드를 실행한 시간 |
| system | 시스템 콜 같은 커널 일을 한 시간 |
| iowait | 디스크나 네트워크 I/O를 기다린 시간 |
| irq | 하드웨어 인터럽트를 처리한 시간 |
| softirq | 소프트웨어 인터럽트를 처리한 시간 |
| nice | 우선순위를 낮춘 프로세스를 실행한 시간 |

CPU 하나(10번)가 쉰 비율은 아래처럼 본다. 0에 가까울수록 CPU가 계속 바빴다는 뜻이다.

```promql
rate(node_cpu_seconds_total{mode="idle", instance="x.x.x.x:9100", cpu="10"}[5m])
```

노드 전체 사용률은 쉰 비율의 평균을 100에서 뺀다.

```promql
100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle", instance="x.x.x.x:9100"}[5m])) * 100)
```

하이퍼스레딩 환경에서 CPU 사용률 %는 실제 코어 포화도를 제대로 보여 주지 못한다.
코어 포화도는 하드웨어 성능 카운터의 Top-down 지표(Retiring, Bad Speculation, Frontend Bound, Backend Bound)와 SMT 활용률로 본다. 리눅스에서는 `perf stat`으로 확인할 수 있다.

### load average

load average는 CPU에서 돌고 있거나 차례를 기다리는 OS 스레드 수의 평균이다.

기준은 vCPU 수다. vCPU 32개 서버에서 32면 꽉 찬 상태이고, 이를 넘으면 차례를 기다리는 스레드가 생겨 응답이 느려진다.

```text
$ uptime
 14:02:11 up 30 days,  load average: 12.40, 10.85, 9.12
```

세 숫자는 1분, 5분, 15분 평균이다. 1분 평균은 빨리 반응하고 15분 평균은 천천히 따라온다. 셋을 같이 보면 부하가 오르는 중인지 내리는 중인지 알 수 있다.

<figure class="fig" data-figure="cpu-load">
  <figcaption>그림 8. 부하 테스트 동안의 1분, 5분, 15분 load average</figcaption>
</figure>

load는 높은데 CPU 사용률이 낮으면 CPU보다 디스크 I/O를 기다리는 스레드가 많은 것이다.

## 쿠버네티스의 CPU 단위

쿠버네티스의 CPU 1개는 vCPU 하나다.

- `cpu: "1"`: vCPU 하나를 통째로 쓰는 시간
- `500m`: 100ms 중 50ms를 쓰는 양

특정 vCPU를 떼어 주지 않고, 커널이 컨테이너(cgroup) 단위로 시간을 나눈다.

컨테이너에는 CPU 값을 두 개 적는다.

```yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "1000m"
```

kubelet이 두 값을 호스트 커널의 cgroup 파일로 바꿔 적고, CFS가 그 파일을 보고 시간을 나눈다.

cgroup에는 v1과 v2가 있다. 파일 이름과 값의 범위만 다르고 동작은 같다.

- v2는 커널 4.5(2016)에 정식으로 들어왔고, 쿠버네티스는 1.25(2022)부터 정식 지원한다.
- 1.35부터 kubelet은 기본값으로 cgroup v1 노드에서 시작하지 않는다(`failCgroupV1: true`). v1 노드를 계속 쓰려면 kubelet 설정에서 이 값을 false로 바꿔야 한다.
- Ubuntu 22.04, RHEL 9 같은 요즘 배포판은 v2가 기본이다. 오래된 노드는 아직 v1인 경우가 많다.

<figure class="fig" data-figure="cpu-layers">
  <figcaption>그림 9. requests(파랑)와 limits(주황)가 커널까지 가는 과정</figcaption>
</figure>

| | request | limit |
|---|---|---|
| 하는 일 | CPU가 모자랄 때 나눠 가질 비율 | 100ms마다 쓸 수 있는 시간의 상한 |
| CPU가 남을 때 | 더 가져다 쓴다 | 남아도 상한에서 멈춘다 |
| cgroup v1 파일 (500m, 1000m) | `cpu.shares = 512` | `cpu.cfs_quota_us = 100000`, `cpu.cfs_period_us = 100000` |
| cgroup v2 파일 (500m, 1000m) | `cpu.weight = 20` | `cpu.max = 100000 100000` |

### request

request는 CPU가 모자랄 때 나눠 갖는 비율이다. 500m은 이렇게 바뀐다.

```text
cgroup v1  cpu.shares = 500 × 1024 ÷ 1000 = 512
cgroup v2  cpu.weight = 20   (shares 512를 v2 범위 1~10000으로 옮긴 값)
```

비율이라 CPU가 모자랄 때만 쓰인다. CPU가 남으면 아무 제한이 없다.

스케줄러는 노드에 올린 파드들의 request 합이 노드 CPU를 넘지 않게 배치한다. 그래서 바빠도 각자 request만큼은 받는다.

그림은 vCPU 1개 노드에 request 500m인 파드 A와 B가 같이 있는 경우다.

- 둘 다 바쁘면 500m씩 나눠 쓰고 나머지는 기다린다.
- 한쪽이 쉬면 다른 쪽이 남는 CPU를 다 쓴다.

<figure class="fig" data-figure="cpu-shares">
  <figcaption>그림 10. 점선은 원하는 양, 색은 쓴 양, 노란 빗금은 CPU가 모자라 기다린 양</figcaption>
</figure>

스케줄러가 request를 보고 노드를 고르니, limit은 빼더라도 request는 꼭 정한다.

### limit과 쓰로틀링

limit 1000m은 100ms 주기마다 100ms까지 쓸 수 있다는 뜻이다.

```text
cgroup v1  cpu.cfs_quota_us = 100000, cpu.cfs_period_us = 100000
cgroup v2  cpu.max = 100000 100000   (쿼터와 주기, 단위 µs)
```

커널은 주기마다 컨테이너 안 모든 스레드가 쓴 시간을 합쳐 잰다. 다 쓰면 노드 CPU가 남아 있어도 다음 주기까지 컨테이너 전체를 멈춘다. 이걸 쓰로틀링이라고 한다.

- 스레드 하나: vCPU 하나만 쓸 수 있어 1000m을 넘지 못한다.
- 스레드 둘: vCPU 두 개에서 같이 돌면 50ms 만에 100ms어치를 다 쓰고 남은 50ms를 멈춘다.

<figure class="fig" data-figure="cpu-quota">
  <figcaption>그림 11. limit 1000m에서 쿼터를 나눠 쓰는 작업</figcaption>
</figure>

그래서 순간적으로 CPU를 몰아 쓰는 서비스는 평균 사용량이 limit보다 한참 낮아도 응답 시간이 갑자기 길어질 수 있다.

Docker의 `--cpus`도 같은 방식이다. limit 1에 스레드 2개를 돌리면 바로 재현된다.

```bash
docker run --rm -it --cpus="1" ubuntu \
  bash -c "apt update && apt install -y stress && stress --cpu 2 --timeout 60"
```

컨테이너 안의 `cpu.stat`에 쓰로틀 횟수가 남는다.

```text
$ cat /sys/fs/cgroup/cpu.stat
usage_usec 15643791
user_usec 15009440
system_usec 634351
nr_periods 343
nr_throttled 292
throttled_usec 39604126
```

- `nr_periods`: 지나간 주기 수
- `nr_throttled`: 그중 할당량을 다 써서 멈춘 주기 수
- `throttled_usec`: 멈춰 있던 시간의 합

이 예시는 343번 중 292번, 85%가 멈췄다.

### 쓰로틀링 확인

쓰로틀링은 사용량 그래프에서 잘 안 보인다. 그래프는 수집 간격 동안의 평균이라 짧은 멈춤이 묻힌다. 그래서 쓰로틀 비율을 따로 본다.

<figure class="fig" data-figure="cpu-throttle-dash">
  <figcaption>그림 12. 쓰로틀 원인 구분, limit 문제와 CPU 부족</figcaption>
</figure>

- 쓰로틀 비율이 오르는데 노드 CPU가 남아 있으면 limit 문제다.
- 노드 CPU까지 꽉 찼으면 CPU 자체가 모자란 것이라 노드를 늘린다.

<div class="code-tabs" markdown="1">

```promql
# 쓰로틀 비율: 멈춘 주기 / 전체 주기
sum by (namespace, pod, container) (rate(container_cpu_cfs_throttled_periods_total[5m]))
  / sum by (namespace, pod, container) (rate(container_cpu_cfs_periods_total[5m]))
```
{: data-label="쓰로틀 비율"}

```promql
# limit 대비 사용량
sum by (namespace, pod, container) (rate(container_cpu_usage_seconds_total[5m]))
  / sum by (namespace, pod, container) (kube_pod_container_resource_limits{resource="cpu"})
```
{: data-label="limit 대비 사용량"}

```bash
# cgroup v2
cat /sys/fs/cgroup/cpu.max      # 100000 100000
cat /sys/fs/cgroup/cpu.weight   # 20

# cgroup v1
cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us   # 100000
cat /sys/fs/cgroup/cpu/cpu.shares         # 512
```
{: data-label="컨테이너 안"}

</div>

## Node.js의 스레드와 이벤트 루프

JS 언어 자체에는 스레드 개념이 없다. 스레드를 몇 개 쓸지는 런타임(V8과 Node)이 정한다.

그래서 Node.js 프로세스는 멀티스레드다. "JS는 싱글"이라는 말은 JS 코드가 스레드 하나에서만 실행된다는 뜻이다.

### Node.js의 스레드 구성

| 스레드 | 하는 일 | JS 실행 |
|---|---|---|
| 메인 스레드 1개 | V8로 JS 실행, libuv 이벤트 루프. 네트워크 I/O는 전부 여기서 epoll로 처리 | O |
| libuv 스레드 풀 (기본 4개) | 파일 읽기와 쓰기, `dns.lookup`, `crypto`(`pbkdf2`, `scrypt`, `randomBytes`), `zlib`처럼 epoll로 기다릴 수 없는 블로킹 작업 대행 | X |
| V8 헬퍼 스레드 | GC, JIT 컴파일 | X |
| `worker_threads` (쓸 때만) | 별도 V8 isolate와 별도 이벤트 루프. 메모리를 공유하지 않는다 | O |

<figure class="fig" data-figure="cpu-node-arch">
  <figcaption>그림 13. Node.js 프로세스의 스레드 구성</figcaption>
</figure>

스레드 풀 크기는 `UV_THREADPOOL_SIZE`로 바꿀 수 있고 최대는 1024다. 모든 이벤트 루프가 이 풀 하나를 같이 쓴다.

워커 스레드는 CPU를 오래 쓰는 JS를 위한 것이다. 공식 문서도 I/O에는 별 도움이 안 된다고 적어 놓았다. 내장 비동기 I/O가 더 효율적이기 때문이다.

### 동시 요청 처리 방식

API 서버의 요청 하나를 나눠 보면 CPU를 쓰는 시간은 몇백 µs다. 나머지 수십에서 수백 ms는 전부 DB 응답을 기다리는 시간이다.

그래서 "동시에 1만 건"은 1만 건을 동시에 기다린다는 뜻이다. 기다리는 일을 스레드가 하는지 커널이 하는지에 따라 방식이 둘로 나뉜다.

- A. 요청마다 스레드 하나
  - 스레드가 `read(fd 21)`을 부르면 커널은 데이터가 올 때까지 그 스레드를 대기시킨다.
  - 1만 건을 동시에 기다리려면 스레드 1만 개가 필요하다.
  - 스택 1만 개에 컨텍스트 스위칭 비용(그림 5)까지 붙는다.
- B. epoll에 등록하고 스레드 하나로 받기
  - 소켓 1만 개를 커널의 epoll에 등록해 둔다.
  - 스레드는 `epoll_wait` 한 번으로 "그중 아무거나 준비되면 알려 달라" 하고 대기한다.
  - 1만 건의 대기가 `epoll_wait` 호출 하나로 줄어서 스레드 하나로 된다. Node가 이 방식이다.

<figure class="fig" data-figure="cpu-wait-model">
  <figcaption>그림 14. 동시 요청이 늘 때 스레드 수 비교</figcaption>
</figure>

### epoll

epoll은 시스템 콜 세 개를 쓴다. epoll이 알려 주는 것은 읽을 준비가 된 소켓 목록이고, 실제로 읽는 일은 그다음에 메인 스레드가 한다.

| 시스템 콜 | 하는 일 | Node에서 부르는 때 |
|---|---|---|
| `epoll_create1()` | 커널에 감시 목록, 준비됨 목록, 대기 중인 스레드 목록을 만든다 | 프로세스 시작 때 한 번 |
| `epoll_ctl(ADD, fd, EPOLLIN)` | "이 fd에 읽을 게 생기면 알려 달라"고 등록한다 | listen 소켓, accept한 소켓, DB 커넥션이 만들어질 때 한 번씩 (쿼리마다가 아님) |
| `epoll_wait()` | 준비됨 목록을 받아 온다. 비어 있으면 스레드를 대기시킨다 | 이벤트 루프가 한 바퀴 돌 때마다 poll 단계에서 |

<figure class="fig" data-figure="cpu-epoll">
  <figcaption>그림 15. epoll 시스템 콜 세 개가 하는 일</figcaption>
</figure>

### 요청 처리 흐름

서버가 켜지면 커넥션 풀이 MySQL 연결 하나(fd 21)를 맺는다. libuv는 `epoll_ctl`로 "읽을 데이터가 생기면 알려 달라"고 등록해 둔다.

그다음 요청 한 건은 이렇게 흘러간다.

1. 핸들러가 `pool.query`를 부르면 드라이버는 콜백을 보관하고 쿼리를 `write(21)`로 소켓에 쓴다. 커널은 송신 큐에 복사만 하고 바로 돌아오므로 핸들러는 기다리지 않고 끝난다.
2. 이벤트 루프는 한 바퀴 돌 때마다 `epoll_wait`를 부른다. 준비된 소켓이 없으면 메인 스레드는 CPU에서 내려간다. 그림 5의 자발적 스위칭이다.
3. 응답 패킷이 오면 커널이 fd 21의 수신 큐에 바이트를 넣고 준비됨 목록에 21을 올린다. Node 코드는 아직 한 줄도 돌지 않는다.
4. 메인 스레드가 대기 중이면 커널이 깨운다. 스케줄러가 CPU를 다시 주면 멈춰 있던 `epoll_wait`가 "21번 소켓에 읽을 게 있다"를 들고 돌아온다.
5. libuv가 `read(21)`로 바이트를 가져오고, 드라이버가 보관해 둔 콜백을 부른다. 콜백은 응답을 쓰고 fd 21을 풀에 돌려준다.

<figure class="fig" data-figure="cpu-request-flow">
  <figcaption>그림 16. 쿼리 한 건 동안 JS 스레드가 일하는 구간</figcaption>
</figure>

메인 스레드가 한 요청에 쓰는 건 시스템 콜 네 번과 JS 몇 줄뿐이다. DB 응답을 기다리는 일은 커널이 맡는다.

커넥션은 한 번에 쿼리 하나만 처리해서, 다른 요청이 오면 풀이 연결을 하나 더 열거나 반납을 기다리게 한다.

### 이벤트 루프 블로킹

이벤트 루프는 스레드 하나라서, 콜백 하나가 CPU를 오래 잡고 있으면 그동안 다른 콜백은 돌지 못한다.

대기 1만 건은 커널이 맡지만, 준비된 결과를 읽고 처리하는 건 메인 스레드 하나다.

<figure class="fig" data-figure="cpu-eventloop">
  <figcaption>그림 17. 무거운 계산이 이벤트 루프를 막는 모습</figcaption>
</figure>

흔한 예는 한 요청에서 많은 행을 한꺼번에 객체로 만들고 통째로 문자열로 바꾸는 경우다.

```js
app.get('/report', async (req, res) => {
  const rows = await db.query('SELECT * FROM orders');  // 기다리는 동안은 괜찮다
  res.send(JSON.stringify(rows));                       // 수십만 행이면 이 동안 다른 요청이 전부 멈춘다
});
```

Node.js 문서가 권하는 방법은 두 가지다.

| 방법 | 언제 | 하는 일 |
|---|---|---|
| 쪼개기 | 계산이 단순할 때 | 이벤트 루프에서 돌되 중간중간 다른 이벤트에 차례를 넘긴다 |
| 워커로 넘기기 | 계산이 복잡할 때 | 루프 밖(`worker_threads`)으로 뺀다. 루프는 조율만 한다 |

문서는 이벤트 루프가 요청을 조율만 하고, 무거운 처리는 직접 하지 말라고 권한다.

스레드 풀도 막힌다. 풀 4개를 모두가 나눠 쓰기 때문에, `pbkdf2`를 4개 돌리면 그동안 파일 읽기가 뒤에서 기다린다.

루프가 막히는지는 이벤트 루프 지연으로 본다. 콜백이 실행되기로 한 시각보다 얼마나 늦게 실행됐는지다.

```js
const { monitorEventLoopDelay } = require('node:perf_hooks');

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
setInterval(() => {
  console.log(`loop delay p99 ${(h.percentile(99) / 1e6).toFixed(1)}ms`);  // 값은 ns 단위
  h.reset();
}, 10000);
```

## Node.js의 CPU 사용량

### 쿠버네티스에서의 사용량

JS는 메인 스레드 하나에서 돌지만, 프로세스 전체는 vCPU를 하나보다 더 쓴다. 워커 스레드를 쓰지 않아도 아래 둘이 같이 돈다.

- libuv 스레드 풀
- V8 헬퍼 스레드. 수는 온라인 프로세서 수를 보고 정한다(`--v8-pool-size`).

V8의 concurrent marking이 대표적이다. 메인 스레드가 JS를 돌리는 동안 다른 스레드들이 힙에서 살아 있는 객체를 표시한다. 둘이 같은 시각에 도니 vCPU를 둘 쓴다.

그래서 부하가 걸리면 한 프로세스가 1000m을 넘겨 쓰고, 2000m 가까이 가기도 한다.

<figure class="fig" data-figure="cpu-node-limit">
  <figcaption>그림 18. limit 1000m에서 Node.js 프로세스의 100ms</figcaption>
</figure>

limit은 컨테이너 안 모든 스레드가 쓴 시간을 합쳐서 잰다(그림 11). "싱글 스레드니까 1코어면 되겠지" 하고 cpu limit을 1로 걸면, 워커 스레드를 안 써도 쓰로틀이 걸린다.

- request는 실제 사용량을 재서 잡는다.
- limit을 건다면 여유 있게 두고 쓰로틀 비율(그림 12)을 같이 본다.

메모리 쪽(힙 상한, OOMKilled)은 [원글](https://kimjanghyun1010.tistory.com/118)에 따로 정리해 뒀다.

### 직렬화와 CPU

API 서버가 요청 하나에 쓰는 CPU는 대부분 데이터 변환이다.

- 요청 본문 JSON 파싱
- DB 결과 행을 객체로 바꾸기
- 응답 객체를 JSON 문자열로 바꾸기
- 응답 압축(gzip)과 TLS 암호화
- 로그 문자열 만들기

앞에서 본 요청당 몇백 µs의 CPU 시간도 대부분 여기에 쓰인다.

변환 시간은 바이트 수에 비례한다. 같은 API라도 응답이 10KB에서 1MB가 되면 변환에 드는 CPU 시간도 대략 그만큼 는다. 그래서 CPU 사용량은 초당 요청 수보다 응답 크기를 따라간다.

<figure class="fig" data-figure="cpu-serialize">
  <figcaption>그림 19. 응답 크기에 따라 vCPU를 쓰는 시간</figcaption>
</figure>

Node.js에서는 이 변환이 메인 스레드에서 돈다. 큰 응답 하나를 변환하는 동안 다른 요청은 차례를 기다린다(그림 17).

변환은 금방 버려지는 임시 객체를 많이 만든다. 이 객체를 치우는 GC가 V8 헬퍼 스레드에서 돌아서, 프로세스가 1000m을 넘겨 쓰는 원인이 된다(그림 18).

줄이는 방법은 대개 아래 넷이다.

- 덜 보낸다: 페이지네이션, 필요한 필드만 고르기
- 두 번 변환하지 않는다: DB가 JSON으로 준 값을 파싱했다가 다시 문자열로 바꾸지 않는다
- 빠르게 변환한다: 스키마를 미리 아는 직렬화(fast-json-stringify 등)나 바이너리 포맷(Protobuf, MessagePack)
- 압축 수준을 조절한다: 압축도 CPU를 쓴다. 작은 응답은 압축하지 않는다

어디에 CPU를 쓰는지는 CPU 프로파일로 확인한다.

```bash
node --cpu-prof app.js   # 종료할 때 CPU.*.cpuprofile 파일이 생긴다
```

이 파일을 Chrome DevTools의 Performance 탭에서 열면, `JSON.parse`와 `JSON.stringify`가 차지하는 폭이 플레임 그래프로 보인다.

## request와 limit 설정 기준

### 짧은 요청과 스트림

웹 서버처럼 요청이 몇 ms 안에 끝나는 시스템은 스레드 대부분이 응답을 기다리고 있어서, 스레드를 vCPU보다 훨씬 많이 둬도 잘 돈다.

영상 인코딩, 실시간 데이터 변환처럼 연결을 붙잡고 계속 계산하는 스트림은 다르다. 스레드가 기다리지 않고 계속 CPU를 쓰니 스레드가 늘수록 서로 기다리는 시간만 늘어난다.

CPU 하나에 스트림 8개면 하나당 12.5%밖에 못 쓴다.

<figure class="fig" data-figure="cpu-threads">
  <figcaption>그림 20. 짧은 요청과 스트림이 vCPU를 쓰는 모습</figcaption>
</figure>

그래서 스트림은 연결 하나가 CPU를 얼마나 꾸준히 쓰는지로 계산한다. 연결 하나가 CPU의 30%를 쓰면 CPU 하나로 3개, 여유를 두면 2개 정도다.

vCPU 수만 보고 잡으면 놓치기 쉬운 것도 두 가지 있다.

- vCPU 하나가 물리 코어 하나가 아닐 수 있다. 하이퍼스레딩으로 만든 vCPU면 같은 코어의 다른 vCPU가 바쁠 때 계산 성능이 덜 나온다(그림 3).
- AWS T 계열 같은 버스트형 인스턴스는 기준 성능이 낮다. 계속 쓰면 성능이 떨어지거나 추가 요금이 붙는다.

쿠버네티스에서는 이 계산 결과를 request 값으로 쓴다. 스트림 파드의 request를 짧은 요청 서버처럼 낮게 잡으면 한 노드에 너무 많이 몰리고, limit까지 있으면 쓰로틀링도 겹친다.

### limit 설정 기준

워크로드마다 다르다.

- 웹 서버처럼 I/O를 주로 기다리는 서비스: 요청이 몰리는 순간 CPU를 많이 쓴다. 이때 limit에 걸리면 쓰로틀링되어 응답이 늦어진다(그림 21). request를 실제 사용량에 맞게 잡고 limit은 빼는 것도 고려할 만하다.
- ML 서버, 연산 위주 작업, 벤치마크: CPU를 꾸준히 쓰고 다른 파드에 주는 영향과 재현성이 중요하다. request와 limit을 둘 다 정한다.

<figure class="fig" data-figure="cpu-burst">
  <figcaption>그림 21. 요청이 몰릴 때 limit이 자르는 구간</figcaption>
</figure>

> **memory의 request와 limit.** memory request는 스케줄링과, 메모리가 부족할 때 어떤 파드를 먼저 내보낼지 정하는 데만 쓰이고 cgroup에는 limit만 들어간다. CPU는 넘치면 느려지지만 memory는 넘치면 OOM으로 죽는다. 그래서 request와 limit을 같게 두는 편이 안전하다.
{: .warn}

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| request | 경합할 때 나눌 비율, 스케줄링 기준 | 남는 CPU는 더 쓴다. 꼭 정한다 |
| limit | 100ms마다 쓸 수 있는 시간 상한 | 다 쓰면 노드 CPU가 남아도 멈춘다 |
| 쓰로틀링 확인 | `nr_throttled / nr_periods` | 사용량 그래프로는 잘 안 보인다 |
| Node.js 싱글 스레드 | JS 코드가 메인 스레드 하나에서 돈다 | 프로세스는 멀티스레드다 |
| Node.js 동시 처리 | 여러 요청의 응답을 동시에 기다린다. 대기는 epoll이 맡는다 | 콜백 하나가 오래 잡으면 전부 멈춘다. 쪼개거나 워커로 |
| Node.js와 limit | libuv 풀과 V8 풀도 CPU를 쓴다 | 싱글 스레드라고 limit 1이면 쓰로틀이 걸린다 |
| 직렬화 | API 서버 CPU의 대부분 | 응답 크기에 비례한다. 덜 보내고 두 번 변환하지 않는다 |
| 스트림 서버 | 연결당 CPU 사용량으로 계산 | 하이퍼스레딩, 버스트형 인스턴스 주의 |

## 참고

- [Kubernetes — Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Linux kernel — CFS Bandwidth Control](https://docs.kernel.org/scheduler/sched-bwc.html)
- [Linux kernel — Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [Kubernetes — The Shift to cgroup v2 in Kubernetes](https://kubernetes.io/blog/2026/10/06/kubernetes-cgroups-v2-shift/)
- [perf-stat(1)](https://man7.org/linux/man-pages/man1/perf-stat.1.html)
- [Node.js — Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [libuv — Thread pool work scheduling](https://docs.libuv.org/en/v1.x/threadpool.html)
- [Node.js — worker_threads](https://nodejs.org/api/worker_threads.html)
- [epoll(7)](https://man7.org/linux/man-pages/man7/epoll.7.html)
- [V8 — Concurrent marking](https://v8.dev/blog/concurrent-marking)
- [Node.js CLI — --v8-pool-size](https://nodejs.org/api/cli.html#--v8-pool-sizenum)
- [Node.js CLI — --cpu-prof](https://nodejs.org/api/cli.html#--cpu-prof)
- [fast-json-stringify](https://github.com/fastify/fast-json-stringify)
- 비유 참고: [컴알못을 위한 노예비유법 (컴퓨터 스펙 보는 법)](https://xsangraalx.tistory.com/20)
- 원글: [CPU](https://kimjanghyun1010.tistory.com/89), [cpu limit](https://kimjanghyun1010.tistory.com/101), [node.js 이해하기](https://kimjanghyun1010.tistory.com/118)
