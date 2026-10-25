---
title: 쿠버네티스 CPU request와 limit 정리
description: CPU를 어떻게 나눠 쓰는지부터 request, limit, 쓰로틀링까지 정리했다.
date: 2026-10-25 12:00:00 +0900
series: Back to the Basic
tags: [cpu, kubernetes, cgroup, linux]
scripts: [figures/cpu.js]
---

쿠버네티스에서 CPU limit은 안 거는 게 낫다는 얘기가 종종 나온다. 빼든 걸든 request와 limit이 실제로 어떻게 동작하는지 알고 정하는 게 맞아서, CPU를 나눠 쓰는 방식부터 정리했다.

## CPU를 보는 층

"CPU 1개"는 어느 층에서 말하느냐에 따라 뜻이 다르다. 하드웨어에서는 코어, 리눅스에서는 스레드를 올리는 자리(논리 CPU), 쿠버네티스에서는 그 자리를 쓰는 시간이다.

<figure class="fig" data-figure="cpu-layers">
  <figcaption>그림 1. 쿠버네티스에 적은 cpu: 500m이 아래로 내려가며 숫자로 바뀐다. 클라우드 VM 층은 노드가 VM일 때만 있다.</figcaption>
</figure>

## lscpu로 보는 CPU 개수

```text
$ lscpu
CPU(s):                   24
  Model name:             12th Gen Intel(R) Core(TM) i9-12900K
    Thread(s) per core:   2
    Core(s) per socket:   16
    Socket(s):            1
```

| 항목 | 값 | 뜻 |
|---|---|---|
| Socket(s) | 1 | 메인보드에 꽂힌 물리 CPU |
| Core(s) per socket | 16 | 소켓 하나의 물리 코어 |
| Thread(s) per core | 2 | 코어 하나가 동시에 받는 하드웨어 스레드 |
| CPU(s) | 24 | 리눅스가 보는 논리 CPU |

i9-12900K는 하이퍼스레딩되는 P코어 8개와 그렇지 않은 E코어 8개로 되어 있어서 CPU(s)가 32가 아니라 24다. 리눅스는 이 24개 논리 CPU에 스레드를 올린다.

논리 CPU 하나는 한 번에 스레드 하나만 돌린다. 실행 중인 스레드는 보통 수백에서 수천 개라(`ps -eLf | wc -l`), 스케줄러가 CPU를 덜 쓴 스레드부터 아주 짧게 번갈아 돌린다.

### 컨텍스트 스위칭

CPU가 돌리던 스레드를 내리고 다른 스레드를 올리는 걸 컨텍스트 스위칭이라고 한다. 바꿀 때마다 비용이 조금씩 들어서, 너무 자주 바뀌면 그만큼 느려진다.

- 자발적 스위칭: 디스크, 네트워크, 락을 기다리느라 스스로 CPU를 내려놓는 경우
- 강제 스위칭: 더 돌고 싶은데 차례가 끝나 CPU를 뺏기는 경우

<figure class="fig" data-figure="cpu-switch">
  <figcaption>그림 2. 회색이 스레드를 바꾸는 구간이다. 실제로는 아주 짧지만 보기 쉽게 키웠다.</figcaption>
</figure>

## 클라우드의 vCPU

클라우드 VM 안에서 보이는 CPU는 vCPU다. vCPU는 실제 서버의 CPU를 빌려 쓰는 것이고, 클라우드는 서버 하나에 VM을 여러 대 올리기 때문에 인스턴스 종류에 따라 실제 CPU를 옆 VM과 나눠 쓰기도 한다. 옆 VM이 바쁘면 내 VM은 차례를 기다리게 되는데, 이렇게 기다린 시간을 `steal`이라고 부른다.

<figure class="fig" data-figure="cpu-steal">
  <figcaption>그림 3. 실제 CPU 하나를 VM 두 대가 나눠 쓴다. 옆 VM도 바빠지면 내 VM이 기다리는 시간(steal)이 생긴다.</figcaption>
</figure>

쿠버네티스는 이 아래 사정은 모른다. vCPU를 그냥 CPU로 보고 그 위에서 시간을 나눈다.

## 쿠버네티스의 CPU 단위

`cpu: "1"`은 논리 CPU 하나를 통째로 쓰는 시간이다. 노드가 VM이면 vCPU 하나, 물리 서버면 하드웨어 스레드 하나다. `500m`은 CPU 하나를 100ms 중 50ms 쓰는 양이다. 특정 CPU를 떼어 주는 게 아니고, 커널이 컨테이너(cgroup) 단위로 시간을 나눈다.

| | request | limit |
|---|---|---|
| 하는 일 | 경합할 때 나눠 가질 비율 | 주기마다 쓸 수 있는 시간의 상한 |
| CPU가 남을 때 | 더 가져다 쓴다 | 남아도 상한에서 멈춘다 |
| cgroup v1 | `cpu.shares` | `cpu.cfs_quota_us`, `cpu.cfs_period_us` |
| cgroup v2 | `cpu.weight` | `cpu.max` |

설정값은 kubelet과 컨테이너 런타임을 거쳐 위 파일에 숫자로 들어간다.

```yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "500m"
```

### request

request는 CPU를 원하는 파드끼리 부딪힐 때 나눠 갖는 비율이다. 둘 다 바빠서 CPU가 모자라면 비율대로 나누고 나머지는 기다린다. 한쪽이 쉬면 다른 쪽이 남는 CPU를 다 쓴다.

<figure class="fig" data-figure="cpu-shares">
  <figcaption>그림 4. 점선이 원하는 양, 색이 실제로 쓴 양이다. 빨간 빗금은 원했지만 CPU가 모자라 못 쓴 양이다.</figcaption>
</figure>

kubelet은 request를 `shares = milliCPU × 1024 ÷ 1000`으로 바꿔 커널에 넣는다. 500m은 512, 1 CPU는 1024다. 절대량이 아니라 비율이라 경합할 때만 의미가 있다. 스케줄러도 request를 보고 노드를 고르니, limit은 빼더라도 request는 꼭 정해야 한다.

### limit과 쓰로틀링

limit은 상한이다. 커널은 시간을 100ms 주기로 자르고 주기마다 `limit × 100ms`만큼 쓰게 해 준다. 500m이면 주기당 50ms다. 컨테이너 안의 스레드들이 이 시간을 같이 쓰고, 다 쓰면 다음 주기까지 컨테이너 전체가 멈춘다. 이걸 쓰로틀링이라고 한다.

<figure class="fig" data-figure="cpu-quota">
  <figcaption>그림 5. CPU 하나, limit 0.5에서 할 일이 적을 때와 계속 바쁠 때, 그리고 limit을 1로 올렸을 때.</figcaption>
</figure>

CPU가 놀고 있어도 멈춘다는 점이 중요하다. 순간적으로 CPU를 몰아 쓰는 서비스는 1분 평균 사용량이 limit보다 한참 낮아도 응답이 튈 수 있다.

Docker의 `--cpus`도 같은 방식이라 쉽게 재현된다.

```bash
docker run --rm -it --cpus="0.5" ubuntu \
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

`nr_periods`는 지나간 주기 수, `nr_throttled`는 그중 할당량을 다 써서 멈춘 주기 수다. 343번 중 292번, 85%가 멈췄다. `throttled_usec`은 멈춰 있던 시간의 합이다.

### 쓰로틀링 확인하기

CPU 사용량 그래프만 보면 쓰로틀링은 잘 안 보인다. 수집 간격 평균으로 뭉개지면 limit보다 한참 아래처럼 보이기도 해서, 쓰로틀 비율을 따로 본다.

<figure class="fig" data-figure="cpu-throttle-dash">
  <figcaption>그림 6. 트래픽이 늘어 limit에 막히고(14:08), limit을 올려 풀리는(14:20) 30분.</figcaption>
</figure>

쓰로틀 비율이 오르는데 노드 CPU가 남아 있으면 limit 문제다. 노드 CPU까지 꽉 찼으면 CPU 자체가 모자란 것이라 노드를 늘려야 한다.

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
cat /sys/fs/cgroup/cpu.max      # 50000 100000
cat /sys/fs/cgroup/cpu.weight   # 20
cat /sys/fs/cgroup/cpu.stat

# cgroup v1
cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us   # 50000
cat /sys/fs/cgroup/cpu/cpu.shares         # 512
```
{: data-label="컨테이너 안"}

</div>

## 짧은 요청과 스트림

웹 서버처럼 요청이 몇 ms 안에 끝나는 시스템은 스레드를 CPU보다 훨씬 많이 둬도 잘 돈다. 스레드 대부분이 DB나 네트워크 응답을 기다리면서 CPU를 내려놓기 때문이다.

영상 인코딩, 실시간 데이터 변환처럼 연결을 붙잡고 계속 계산하는 스트림은 다르다. 스레드가 CPU를 놓지 않으니 스레드가 늘수록 서로 기다리는 시간만 늘어난다. CPU 하나에 스트림 8개면 하나당 12.5%밖에 못 쓴다.

<figure class="fig" data-figure="cpu-threads">
  <figcaption>그림 7. 같은 CPU 1개, 스레드 8개라도 작업 종류에 따라 기다리는 시간이 크게 다르다.</figcaption>
</figure>

그래서 스트림은 스레드 수가 아니라 연결 하나가 CPU를 얼마나 꾸준히 쓰는지로 계산한다. 연결 하나가 CPU의 30%를 쓰면 CPU 하나로 3개, 여유를 두면 2개 정도다. vCPU 수만 보고 잡으면 놓치기 쉬운 것도 두 가지 있다.

- vCPU 하나가 물리 코어 하나가 아닐 수 있다. vCPU는 보통 하이퍼스레드 하나라서, 같은 코어의 다른 vCPU가 바쁘면 계산 성능이 기대보다 덜 나온다.
- AWS T 계열 같은 버스트형 인스턴스는 기준 성능이 낮다. 계속 쓰면 성능이 떨어지거나 추가 요금이 붙는다.

쿠버네티스에서는 이게 request 값이다. 스트림 파드의 request를 짧은 요청 서버처럼 낮게 잡으면 한 노드에 너무 많이 몰리고, limit까지 있으면 쓰로틀링도 겹친다.

## limit을 걸어야 할까

워크로드마다 다르다.

- 웹 서버처럼 I/O를 주로 기다리는 서비스: CPU를 순간적으로 몰아 쓰는데, limit이 그 순간을 잘라 지연으로 만든다(그림 8). request를 실제 사용량에 맞게 잡고 limit은 빼는 것도 고려할 만하다.
- ML 서버, 연산 위주 작업, 벤치마크: CPU를 꾸준히 쓰고 다른 파드에 주는 영향과 재현성이 중요하다. request와 limit을 둘 다 정한다.

<figure class="fig" data-figure="cpu-burst">
  <figcaption>그림 8. 요청이 몰리는 웹 서버. 평균 사용량은 같아도 limit이 있으면 몰리는 순간이 잘린다.</figcaption>
</figure>

어느 쪽이든 실제 사용량을 먼저 재고 request는 꼭 정한다.

> **memory는 다르다.** memory request는 스케줄링과, 메모리가 부족할 때 어떤 파드를 먼저 내보낼지 정하는 데 쓰이고 cgroup에는 limit만 들어간다. CPU는 넘치면 느려지지만 memory는 넘치면 OOM으로 죽기 때문에, request와 limit을 같게 두는 편이 안전하다.
{: .warn}

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| request | 경합할 때 나눌 비율, 스케줄링 기준 | 남는 CPU는 더 쓴다. 꼭 정한다 |
| limit | 100ms마다 쓸 수 있는 시간 상한 | 다 쓰면 CPU가 놀아도 멈춘다 |
| 쓰로틀링 확인 | `nr_throttled / nr_periods` | 사용량 그래프로는 잘 안 보인다 |
| 스트림 서버 | 연결당 CPU 사용량으로 계산 | 하이퍼스레딩, 버스트형 인스턴스 주의 |

## 참고

- [Kubernetes — Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Linux kernel — CFS Bandwidth Control](https://docs.kernel.org/scheduler/sched-bwc.html)
- [Linux kernel — Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- 원글: [CPU](https://kimjanghyun1010.tistory.com/89), [cpu limit](https://kimjanghyun1010.tistory.com/101)
