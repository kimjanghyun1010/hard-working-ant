---
title: K8S 운영 점검표
description: 배포와 노드 교체 순간에 요청이 실패하지 않게 하는 probe, 종료 처리, PDB, 배치, 보안 설정까지 정리했다.
date: 2026-11-11 12:00:00 +0900
series: Kubernetes
tags: [kubernetes, probe, graceful-shutdown, pdb, pod-security, rbac]
scripts: [figures/k8s-best-practices.js]
---

## 파드 교체 순간

평소에는 오류가 없던 서비스가 배포할 때마다 502를 몇 건씩 낸다. 노드를 업그레이드하는 날에는 몇 초 동안 통째로 응답하지 않는다. 쿠버네티스는 파드를 수시로 새로 만들고 지우는데, 실패는 대부분 이 교체 순간에 몰린다.

- 새 파드가 시작할 때: 컨테이너는 떴지만 앱이 아직 준비되지 않았는데 요청이 들어온다.
- 옛 파드가 종료될 때: 프로세스는 내려갔는데 요청이 아직 그쪽으로 간다.
- 노드를 비울 때: 같은 노드에 있던 파드가 한꺼번에 내려간다.

세 장면에서 빨간 점(실패한 요청)이 어느 구간에 몰리는지 본다.

<figure class="fig" data-figure="k8s-best-practices-moments">
  <figcaption>파드가 바뀌는 세 순간과 요청 (시간은 모양을 보여 주는 대략값)</figcaption>
</figure>

세 경우 모두 앱 코드에는 문제가 없다. 쿠버네티스가 앱이 준비됐는지 모르고, 종료와 트래픽 차단이 따로 움직이고, 한 번에 몇 개까지 내려도 되는지 모르기 때문에 생기는 실패다.

배포 중 오류율 그래프에서 5xx가 배포 시각에 맞춰 튀는지부터 본다.

## 배포와 종료 순간

### readiness probe

새 버전을 배포하면 파드가 Running이 되자마자 몇 초 동안 connection refused가 난다. 쿠버네티스는 컨테이너 프로세스가 떴는지만 알고, 앱이 설정을 읽고 커넥션 풀을 채웠는지는 모른다.

readiness probe는 kubelet이 주기적으로 앱에 요청을 받을 수 있는지 묻는 검사다. 실패하면 EndpointSlice 컨트롤러가 파드 IP를 Service의 엔드포인트에서 빼고, 통과해야 트래픽이 들어온다.

두 장면에서 새 파드 C로 간 요청이 언제부터 성공하는지 본다.

<figure class="fig" data-figure="k8s-best-practices-readiness">
  <figcaption>새 파드 C가 엔드포인트에 들어가는 시점</figcaption>
</figure>

readiness가 없으면 C는 Running이 되자마자 엔드포인트에 들어가, 기동이 끝날 때까지 받은 요청을 모두 실패시킨다. readiness가 있으면 C는 검사를 통과한 뒤에 들어가고, 그동안 요청은 A와 B로만 간다.

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  periodSeconds: 5
  failureThreshold: 3
```

readiness는 시작할 때만이 아니라 파드가 살아 있는 내내 돈다. 그래서 무엇을 검사하느냐에 따라 결과가 크게 갈린다.

- 앱 자신이 요청을 받을 수 있는지(초기화 완료, 내부 큐 여유)를 본다.
- 모든 파드가 같이 쓰는 DB까지 readiness에 넣으면, DB가 잠깐 흔들릴 때 모든 파드가 한꺼번에 빠져 엔드포인트가 0개가 된다. 오류 응답이라도 주는 편이 나은 서비스라면 DB 확인은 빼고 앱에서 재시도한다.

새 파드가 Running인데 오류가 난다면, readiness가 있는지와 검사 경로가 실제 준비 상태를 보는지부터 본다.

### liveness probe

트래픽이 몰린 순간 파드 하나가 재시작되더니, 나머지도 줄줄이 재시작된다. liveness probe가 느린 응답을 죽은 것으로 판단한 경우다.

liveness probe는 실패가 failureThreshold번 이어지면 kubelet이 컨테이너를 재시작하는 검사다. 값을 적지 않으면 이렇게 돈다.

```text
periodSeconds 10, timeoutSeconds 1, failureThreshold 3
→ 10초마다 묻고, 1초 안에 답이 없으면 실패, 3번 연속이면 재시작
```

부하가 몰리면 health 응답도 다른 요청 뒤에서 기다리느라 1초를 넘기기 쉽다. 모드를 바꿔 가며 부하를 걸고, 서비스 중인 파드 수가 어떻게 되는지 지켜본다.

<figure class="fig" data-figure="k8s-best-practices-liveness">
  <figcaption>부하가 몰릴 때 liveness 기준에 따른 재시작</figcaption>
</figure>

느리면 재시작하는 모드에서는 응답이 1초를 넘긴 A가 먼저 재시작되고, A 몫의 요청이 B와 C로 몰려 둘도 차례로 재시작된다. 도미노처럼 번져 파드가 모두 빠진다. 멈출 때만 재시작하는 모드에서는 A가 느려지기만 하고 부하가 지나가면 돌아온다. 바뀐 것은 liveness가 실패로 보는 기준 하나다.

재시작이 반복되면 kubelet은 다시 띄우기 전 대기를 10초, 20초, 40초로 두 배씩 늘린다(최대 5분). 연쇄 재시작 뒤에는 부하가 빠져도 파드가 바로 돌아오지 않는다.

liveness는 재시작해야만 풀리는 상태(교착, 무한 루프)만 잡게 한다.

- 검사는 앱 프로세스 안에서 끝나게 한다. DB나 다른 서비스를 부르지 않는다. 재시작해도 DB는 고쳐지지 않는다.
- readiness와 경로와 값을 다르게 둔다. 같으면 트래픽에서 빠지는 순간 재시작도 같이 걸린다. liveness 쪽을 더 느슨하게 잡는다.
- 기동 중 치명적 오류(설정 누락, 캐시 로드 실패)는 오류 응답만 내며 버티지 말고 프로세스를 끝낸다. 그러면 kubelet이 재시작하고, 반복되면 CrashLoopBackOff로 드러난다.

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 6
```

재시작 횟수(RESTARTS)가 부하가 몰린 시각에 맞춰 오른다면 liveness 기준부터 본다.

### startup probe

기동에 1분이 걸리는 자바 앱이 배포 후 계속 재시작하며 CrashLoopBackOff에 빠진다. liveness 기본값으로는 기동 후 약 30초 안에 응답하지 못하면 재시작되기 때문이다.

startup probe가 있으면 kubelet은 startup probe가 한 번 성공할 때까지 liveness와 readiness를 돌리지 않는다. 기동은 최대 `failureThreshold × periodSeconds`까지 기다린다.

두 장면에서 60초 걸리는 기동이 끝나기 전에 무슨 일이 생기는지 본다.

<figure class="fig" data-figure="k8s-best-practices-startup">
  <figcaption>60초 걸리는 기동과 probe 검사</figcaption>
</figure>

startup probe가 없으면 liveness가 30초에 재시작시켜 기동이 끝나지 않는다. 있으면 60초에 startup이 성공하고, 그 뒤부터 liveness가 원래 주기로 돈다.

```yaml
startupProbe:
  httpGet:
    path: /livez
    port: 8080
  periodSeconds: 10
  failureThreshold: 30   # 최대 300초까지 기다린다
```

initialDelaySeconds를 길게 줘도 비슷해 보이지만, 기동이 빨리 끝나도 그만큼 liveness가 늦게 시작되고 기동이 그보다 길어지면 다시 재시작된다.

기동 시간을 재서 그보다 넉넉하게 `failureThreshold × periodSeconds`를 잡는다.

### graceful shutdown과 preStop

배포할 때마다 502가 몇 건씩 찍히는데, 로그를 보면 전부 종료 중인 파드로 간 요청이다. 파드를 지우면 두 일이 동시에 시작된다.

- kubelet: preStop 훅을 실행하고, 끝나면 컨테이너의 PID 1에 SIGTERM을 보낸다.
- 컨트롤 플레인: EndpointSlice에서 그 파드를 종료 중으로 표시한다. 각 노드의 kube-proxy와 인그레스, 로드밸런서가 이를 보고 규칙에서 뺀다.

둘은 서로를 기다리지 않는다. 앱이 SIGTERM을 받자마자 내려가면, 규칙에서 빠지기 전까지 들어온 요청이 실패한다.

모드를 바꿔 가며 파드 A를 지우고, A가 내려가는 시각과 규칙에서 빠지는 시각을 견줘 본다.

<figure class="fig" data-figure="k8s-best-practices-prestop">
  <figcaption>파드 A를 지울 때 규칙에서 빠지는 시점과 SIGTERM (2초는 대략값)</figcaption>
</figure>

preStop이 없으면 A는 삭제 직후 SIGTERM을 받고 내려가는데, 규칙에서는 2초 뒤에 빠져 그 사이 A로 간 요청이 실패한다. preStop에서 5초를 기다리면 규칙에서 먼저 빠지고 그다음 SIGTERM이 와서 실패가 없다. 기다리는 동안에도 A는 이미 들어온 요청을 처리한다.

규칙에서 빠지기까지 걸리는 시간은 kube-proxy, 인그레스 컨트롤러, 클라우드 로드밸런서마다 다르다. preStop 대기는 그중 가장 느린 경로에 맞춘다.

```yaml
spec:
  terminationGracePeriodSeconds: 30
  containers:
    - name: app
      lifecycle:
        preStop:
          sleep:
            seconds: 5
```

- `sleep` 액션은 1.34에서 정식 기능(GA)이 됐다. kubelet이 직접 기다리므로 이미지에 sleep 명령이 없어도 된다. 그 전 버전은 `exec`로 `sleep 5`를 실행한다.
- preStop 시간도 `terminationGracePeriodSeconds`(기본 30초) 안에 들어간다. preStop 대기와 앱의 종료 처리를 합친 시간이 이 값을 넘으면 SIGKILL로 끊긴다.

SIGTERM을 받은 앱은 새 연결을 그만 받고, 처리 중인 요청을 끝낸 뒤 종료해야 한다. Node.js라면 이렇게 쓴다.

```js
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
```

컨테이너를 `sh -c`로 띄우면 SIGTERM은 셸이 받고 앱까지 전달되지 않는다. Dockerfile의 ENTRYPOINT는 `["node", "server.js"]`처럼 exec 형식으로 쓴다.

사이드카에도 순서가 있다. 1.33에서 정식 기능이 된 사이드카 컨테이너(`initContainers`에 `restartPolicy: Always`)는 앱 컨테이너가 완전히 멈춘 뒤에 종료된다. 프록시 사이드카가 앱보다 먼저 내려가 처리 중인 요청이 끊기는 문제를 이것으로 막는다.

배포 시각의 5xx가 종료 중인 파드에서 나왔다면 preStop 대기와 SIGTERM 처리부터 본다.

### 롤링 업데이트 설정

replicas 4개인 서비스가 배포하는 동안에만 응답이 느려진다. Deployment의 롤링 업데이트는 두 값으로 속도와 여유를 정한다.

- `maxSurge`: replicas보다 더 띄울 수 있는 파드 수. 기본 25%, 올림.
- `maxUnavailable`: 준비되지 않아도 되는 파드 수. 기본 25%, 내림.

replicas 4면 둘 다 1이라, 배포하는 동안 준비된 파드가 3개까지 줄 수 있다. 두 장면에서 아래 그래프가 4 아래로 내려가는지 본다.

<figure class="fig" data-figure="k8s-best-practices-rolling">
  <figcaption>replicas 4의 롤링 업데이트와 준비된 파드 수 (한 개씩 바꾸는 모습으로 단순화했다)</figcaption>
</figure>

기본값에서는 새 파드를 띄우는 것과 동시에 옛 파드도 하나 내려서, 새 파드가 준비될 때까지 3개로 버틴다. maxUnavailable을 0으로 두면 새 파드가 준비된 뒤에야 옛 파드를 내려 4개를 유지한다. 대신 그동안 파드가 5개라 노드 자원이 하나 더 필요하다.

```yaml
spec:
  replicas: 4
  minReadySeconds: 10
  strategy:
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

`minReadySeconds`는 새 파드가 Ready가 된 뒤 이 시간 동안 멀쩡해야 사용 가능(Available)으로 센다. 기본은 0이라, 뜨자마자 죽는 버전도 롤아웃을 계속 밀고 나간다.

배포 중에만 지연이 튄다면 maxSurge 1, maxUnavailable 0부터 둔다.

### PodDisruptionBudget

노드 업그레이드 날 drain을 했더니, 그 노드에 몰려 있던 파드 두 개가 한꺼번에 내려가 남은 하나가 모든 요청을 받는다. drain은 노드의 파드를 Eviction API로 내보내는데, 막는 조건이 없으면 전부 바로 내보낸다.

PDB(PodDisruptionBudget)는 자발적 중단(drain, 클러스터 업그레이드처럼 운영자가 일으킨 중단)에서 동시에 내려갈 수 있는 파드 수를 정한다. Eviction API는 PDB를 어기는 요청을 거부하고, `kubectl drain`은 거부되면 잠시 뒤 다시 시도한다.

모드를 바꿔 가며 노드 1을 drain하고, 아래 그래프의 준비된 파드 수를 지켜본다.

<figure class="fig" data-figure="k8s-best-practices-pdb">
  <figcaption>replicas 3에서 노드 1을 drain할 때 준비된 파드 수</figcaption>
</figure>

PDB가 없으면 A1과 A2가 같이 내려가, 새 파드가 노드 3에서 준비될 때까지 1개로 버틴다. minAvailable 2를 두면 A2의 eviction이 거부되고, A1의 대체 파드가 준비된 뒤에 A2가 내려간다. 준비된 파드가 2 아래로 내려가지 않는 대신 drain이 끝나는 데는 더 걸린다.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: api
  unhealthyPodEvictionPolicy: AlwaysAllow
```

PDB가 막지 못하는 경우도 있다.

- 노드 장애 같은 비자발적 중단은 막지 못한다. 파드나 Deployment를 직접 지우는 것도 PDB를 건너뛴다.
- Deployment의 롤링 업데이트도 PDB에 막히지 않는다. 배포 중 개수는 앞의 maxUnavailable이 정한다.
- maxUnavailable 0이나 minAvailable을 replicas와 같게 두면 drain이 끝나지 않는다.

`unhealthyPodEvictionPolicy: AlwaysAllow`(1.31 GA)는 아직 Ready가 아닌 파드를 예산과 상관없이 내보내게 한다. 고장 난 파드 때문에 drain이 막히는 것을 피하는 설정이라 공식 문서도 권장한다.

replicas 2 이상인 서비스에는 PDB를 두고, drain 전에 `kubectl get pdb`로 ALLOWED DISRUPTIONS가 0이 아닌지 본다.

## 자원과 배치

### request와 limit

메모리를 많이 쓰는 배치 작업이 같은 노드에 올라온 날, 멀쩡하던 API 파드가 Evicted로 사라진다. CPU는 모자라면 느려지지만, 메모리는 모자라면 누군가 노드에서 내보내진다. CPU의 request와 limit은 [CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %})에 정리했고, 여기서는 메모리가 모자랄 때의 순서만 본다.

노드의 남은 메모리가 기준 아래로 떨어지면 kubelet이 파드를 골라 내보낸다(node-pressure eviction). 고르는 기준은 세 가지다.

1. 사용량이 request를 넘었는지
2. 파드 우선순위(PriorityClass)
3. request보다 얼마나 더 쓰는지

QoS 클래스 순서(BestEffort, Burstable, Guaranteed)대로 내보낸다고 알려져 있지만, kubelet은 QoS 클래스를 직접 보지 않는다. 세 장면에서 어느 파드가 먼저 나가는지 본다.

<figure class="fig" data-figure="k8s-best-practices-eviction">
  <figcaption>메모리가 모자란 노드에서 kubelet이 내보내는 순서 (용량은 예시 값)</figcaption>
</figure>

request 1Gi에 3.6Gi를 쓰는 Burstable 파드 B1이 BestEffort 파드보다 먼저 나간다. BestEffort는 request가 0이라 1Gi를 넘겼고, B1은 2.6Gi를 넘겨서 우선순위가 같으면 더 많이 넘긴 쪽이 먼저다. request 안에서 쓰는 파드는 Guaranteed든 Burstable이든 맨 마지막이다.

이 축출은 PDB와 terminationGracePeriodSeconds를 따르지 않는다. hard 기준에 걸리면 유예 없이 바로 끝나서, 앞에서 맞춘 preStop과 PDB가 통하지 않는다.

- 메모리 request는 실제 사용량에 맞추고 limit과 같게 둔다. request 안에서 쓰는 파드는 다른 파드의 사용량 때문에 내보내지지 않는다.
- 꼭 살아야 하는 파드는 PriorityClass로 우선순위를 올린다.

Evicted 파드가 보이면 그 노드에서 request보다 메모리를 많이 쓰는 파드부터 찾는다.

### 파드 분산 배치

replicas 3이라 안심했는데 노드 하나가 죽자 서비스 전체가 내려간다. 세 파드가 모두 같은 노드에 있었다. 스케줄러는 자원이 맞는 노드를 고를 뿐이라, 나눠 놓으라는 규칙이 약하면 한 노드에 몰 수 있다.

스케줄러의 기본 분산 규칙은 노드 기준 maxSkew 3, `ScheduleAnyway`다. 선호일 뿐이고 노드끼리 3개 차이까지 허용해서, replicas 3이 한 노드에 모두 들어가도 규칙을 어기지 않는다.

두 장면에서 노드 1이 멈출 때 남는 파드 수를 본다.

<figure class="fig" data-figure="k8s-best-practices-spread">
  <figcaption>replicas 3에서 노드 1이 멈출 때 (B는 다른 앱)</figcaption>
</figure>

몰려 있으면 하나도 남지 않고, 노드마다 하나씩 두면 둘이 남는다. 나누는 방법은 두 가지다.

- pod anti-affinity: 같은 앱 파드가 있는 노드에는 놓지 않는다. required로 두면 노드 하나에 하나만 들어가서, 노드보다 replicas가 많으면 남는 파드가 Pending이 된다.
- topology spread constraints: 노드나 존마다 개수 차이를 maxSkew 안으로 맞춘다. 노드보다 파드가 많아도 고르게 나눈다.

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: api
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: api
```

- 분산은 스케줄할 때만 맞춘다. 스케일 다운하면 다시 한쪽으로 쏠릴 수 있고, 다시 맞추려면 Descheduler 같은 도구를 쓴다.
- inter-pod affinity와 anti-affinity는 계산이 무거워서, 공식 문서는 노드가 수백 개를 넘는 클러스터에서는 권하지 않는다.

노드 장애는 PDB로 막을 수 없어서 분산 배치로 대비한다. `kubectl get pods -o wide`로 같은 앱 파드가 어느 노드에 있는지부터 본다.

## 보안과 운영

### securityContext와 Pod Security

웹 취약점 하나로 컨테이너 셸을 뺏겼는데, 컨테이너가 root에 권한 상승까지 열려 있어 노드로 넘어간다. securityContext는 컨테이너의 권한을 줄이는 설정이다. 아래 네 값이 Pod Security Standards의 restricted 단계가 요구하는 것이다.

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
```

예전에는 PodSecurityPolicy(PSP)로 이런 설정을 강제했지만 1.25에서 제거됐다. 지금은 내장된 Pod Security Admission이 네임스페이스 라벨을 보고 세 단계(privileged, baseline, restricted) 중 하나로 검사한다. 모드는 셋이다.

- `enforce`: 위반한 파드를 거부한다.
- `audit`: 감사 로그에 남기고 허용한다.
- `warn`: 사용자에게 경고하고 허용한다.

```bash
kubectl label ns api \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
```

enforce는 Deployment가 아니라 그 Deployment가 만드는 파드에만 걸린다. 세 장면에서 위반 파드가 어디서 막히는지 본다.

<figure class="fig" data-figure="k8s-best-practices-psa">
  <figcaption>Pod Security가 새 파드를 검사하는 위치</figcaption>
</figure>

warn 모드에서는 경고만 남고 파드가 뜬다. enforce 모드에서는 Deployment 적용은 성공하는데 ReplicaSet이 만드는 파드가 거부돼 새 버전이 뜨지 않는다. `kubectl apply`가 성공으로 끝나서 배포 파이프라인이 실패를 놓치기 쉽다. securityContext를 맞춘 파드는 enforce에서도 그대로 통과한다.

새 단계는 warn과 audit으로 먼저 걸어 위반을 모은 뒤 enforce로 올린다. 배포 뒤에는 `kubectl rollout status`로 롤아웃이 실제로 끝났는지 확인한다.

### ServiceAccount와 RBAC

파드 하나가 털렸는데, 공격자가 파드 안의 토큰으로 API 서버에서 Secret을 읽어 간다. 파드는 따로 정하지 않으면 네임스페이스의 default ServiceAccount 토큰을 `/var/run/secrets/kubernetes.io/serviceaccount/`에 자동으로 마운트한다. 이 계정에 넓은 권한이 묶여 있으면 털린 파드가 곧 클러스터 관리자다.

세 장면에서 같은 `GET secrets` 요청이 어디서 멈추는지 본다.

<figure class="fig" data-figure="k8s-best-practices-rbac">
  <figcaption>털린 파드의 토큰으로 Secret을 읽으려 할 때</figcaption>
</figure>

토큰이 없으면 요청은 인증에서 막히고(401), 토큰이 있어도 권한이 없으면 RBAC에서 막힌다(403). 막는 자리는 둘이다.

- API를 부르지 않는 앱은 토큰을 마운트하지 않는다(`automountServiceAccountToken: false`). ServiceAccount와 파드 둘 다에 적을 수 있고, 둘이 다르면 파드 쪽을 따른다.
- API를 부르는 앱은 전용 ServiceAccount를 만들고, 필요한 리소스와 동사만 담은 Role을 묶는다.
- 사람은 ServiceAccount 토큰을 쓰지 않는다. OIDC 같은 사용자 인증으로 들어온다.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api
automountServiceAccountToken: false
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: read-config
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
```

파드에 마운트되는 토큰은 파드가 지워지면 무효가 된다. 그래도 파드가 살아 있는 동안은 쓸 수 있어서, 권한을 좁혀 두는 것이 털린 뒤에 남는 방어다.

`kubectl auth can-i --list --as=system:serviceaccount:<네임스페이스>:<계정>`으로 파드 계정이 할 수 있는 일부터 본다.

### 네임스페이스와 ResourceQuota

평소처럼 배포했는데 새 파드가 뜨지 않고 롤아웃이 멈춘다. 이벤트에는 `exceeded quota`가 찍혀 있다. ResourceQuota는 네임스페이스 하나가 쓸 수 있는 자원 합계를 정하고, 넘는 생성 요청은 403으로 거부한다.

롤링 업데이트는 maxSurge만큼 파드를 잠시 더 띄운다. 쿼터를 평소 사용량에 꽉 맞춰 두면 바로 이 추가 파드가 거부된다. 두 장면에서 새 파드가 쿼터를 지나가는지 본다.

<figure class="fig" data-figure="k8s-best-practices-quota">
  <figcaption>requests.cpu 쿼터와 롤링 업데이트의 추가 파드 (maxSurge 1, maxUnavailable 0)</figcaption>
</figure>

쿼터 4에 1 CPU 파드 4개면 다섯 번째 파드가 거부돼 롤아웃이 시작하지 못한다. 앞에서 권장한 maxUnavailable 0과 만나면 옛 파드를 먼저 줄일 수도 없어서 그대로 멈춘다. 쿼터를 5로 두면 새 파드가 들어가고 롤아웃이 이어진다.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: api
spec:
  hard:
    requests.cpu: "5"      # 파드 4개 + maxSurge 1개
    requests.memory: 10Gi
    limits.memory: 10Gi
```

- cpu나 memory 쿼터를 걸면 그 네임스페이스의 모든 새 파드가 request나 limit을 적어야 한다. 적지 않은 파드는 거부될 수 있다.
- LimitRange로 기본 request를 넣어 두면 빠뜨린 파드도 통과한다.

네임스페이스는 팀이나 서비스 단위로 나누고, 쿼터와 RBAC, Pod Security 라벨을 같은 단위로 건다. 롤아웃이 멈추면 `kubectl describe rs`의 이벤트에서 쿼터와 Pod Security 거부부터 본다.

### 이미지 태그

노드를 교체한 뒤 일부 파드만 다르게 동작한다. 같은 `api:latest`인데 새 노드에서 뜬 파드만 새 이미지를 받았다. 태그는 다른 이미지를 가리키도록 옮길 수 있고, 새 노드는 자기에게 없는 이미지를 그 시점의 태그로 받아 온다.

두 장면에서 노드 교체 뒤 파드들이 같은 이미지를 돌리는지 본다.

<figure class="fig" data-figure="k8s-best-practices-image">
  <figcaption>노드 교체 뒤 새 노드가 받아 오는 이미지 (1a2b, 9f8e는 다이제스트 앞자리)</figcaption>
</figure>

`latest`처럼 옮겨지는 태그를 쓰면, 레지스트리에 새 이미지가 올라온 뒤 새로 뜬 파드만 다른 코드를 돌린다. 배포한 적이 없는데 버전이 섞이고, 무엇으로 되돌릴지도 알 수 없다. 다이제스트로 고정하면 언제 어느 노드에서 받아도 같은 이미지다.

```yaml
image: registry.example.com/api:1.4.2@sha256:1a2b...
```

- 태그와 다이제스트를 같이 적으면 받을 때는 다이제스트만 쓴다. 태그는 사람이 읽는 용도로 남는다.
- `1.4.2` 같은 태그도 다시 푸시하면 옮겨진다. 바뀌지 않는 것은 다이제스트뿐이다.
- 허용한 레지스트리의 이미지만 쓰게 하려면 어드미션 정책(ValidatingAdmissionPolicy, Kyverno 등)으로 막는다.

`kubectl get pods -o jsonpath='{..imageID}'`로 같은 앱 파드들의 실제 다이제스트가 같은지부터 본다.

## 정리

| 항목 | 막는 순간 | 기본 설정 |
|---|---|---|
| readiness probe | 준비 전 파드가 요청을 받음 | 앱 자신의 준비 상태만 검사 |
| liveness probe | 부하 때 연쇄 재시작 | 멈춤만 잡고 readiness보다 느슨하게 |
| startup probe | 느린 기동 중 재시작 | `failureThreshold × periodSeconds` > 기동 시간 |
| preStop, SIGTERM 처리 | 규칙에서 빠지기 전 종료 | preStop sleep 5, 처리 중 요청을 마치고 종료 |
| 롤링 업데이트 | 배포 중 파드 수 감소 | maxSurge 1, maxUnavailable 0 |
| PDB | drain 때 한꺼번에 내려감 | minAvailable, AlwaysAllow |
| 메모리 request | 메모리 부족 때 축출 | 실제 사용량에 맞추고 limit과 같게 |
| 분산 배치 | 노드 장애로 전체 중단 | topology spread maxSkew 1 |
| Pod Security | 털린 컨테이너의 권한 | warn, audit으로 모은 뒤 enforce |
| RBAC | 토큰으로 API 조작 | 토큰 자동 마운트 끔, 최소 권한 Role |
| ResourceQuota | 추가 파드 거부로 롤아웃 멈춤 | maxSurge만큼 여유 |
| 이미지 | 노드 교체 뒤 버전 섞임 | 다이제스트 고정 |

버전과 기본값은 쿠버네티스 1.37 문서(2026년 11월)로 확인했다.

## 참고

- [Kubernetes — Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes — Termination of Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-termination/)
- [Kubernetes — Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)
- [Kubernetes — Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes — Container Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/)
- [KEP-3960 — Pod lifecycle sleep action](https://www.kubernetes.dev/resources/keps/3960/)
- [Kubernetes — Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Kubernetes — Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes — Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)
- [Kubernetes — Specifying a Disruption Budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)
- [Kubernetes — Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)
- [Kubernetes — Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
- [Kubernetes — Pod Topology Spread Constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)
- [Kubernetes — Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [Kubernetes — Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/)
- [Kubernetes — Deprecated API Migration Guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/)
- [Kubernetes — Configure Service Accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/)
- [Kubernetes — Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/)
- [Kubernetes — Images](https://kubernetes.io/docs/concepts/containers/images/)
- [Kubernetes — Releases](https://kubernetes.io/releases/)
- [Docker — Dockerfile reference, ENTRYPOINT](https://docs.docker.com/reference/dockerfile/#entrypoint)
- [learnk8s — Kubernetes production best practices](https://learnk8s.io/production-best-practices)
- 원글: [K8S best practices #1](https://kimjanghyun1010.tistory.com/46), [K8S best practices #2](https://kimjanghyun1010.tistory.com/47), [K8S best practices #3](https://kimjanghyun1010.tistory.com/48)
