---
title: K8S 무중단 파드 교체
description: readiness와 EndpointSlice, liveness와 startup probe, 롤링 업데이트, 종료 순서와 preStop, drain과 PDB, 분산 배치까지 파드가 요청을 놓치지 않고 뜨고 내려가는 데 맞물리는 장치를 따라간다.
date: 2026-11-11 12:00:00 +0900
series: Kubernetes
tags: [kubernetes, probe, rolling-update, graceful-shutdown, pdb, topology-spread]
scripts: [figures/k8s-best-practices.js]
---

## 엔드포인트와 readiness

파드를 지우고 새로 띄우는 동안 요청이 하나도 실패하지 않으려면 트래픽을 보내는 쪽이 파드의 상태를 정확히 따라가야 한다. 트래픽을 보내는 쪽은 Service인데, Service는 파드 목록을 직접 들고 있지 않다.

Service는 가상 IP(ClusterIP) 하나다. 실제로 어느 파드로 보낼지는 EndpointSlice라는 객체가 정한다. EndpointSlice 컨트롤러가 Service의 셀렉터(파드를 고르는 라벨 조건)에 맞는 파드 IP를 모아 이 객체에 적고, 노드마다 도는 kube-proxy가 이 목록을 iptables 규칙(커널이 패킷의 목적지를 바꾸거나 거르는 규칙)으로 바꾼다. Service IP로 보낸 패킷은 보낸 쪽 노드의 규칙에서 파드 IP 하나로 바뀐다.

목록의 엔드포인트마다 상태 조건이 셋 붙는다.

- `serving`: 파드의 Ready 조건을 그대로 옮긴 값.
- `terminating`: 파드에 삭제 표시가 붙으면 true.
- `ready`: serving이면서 terminating이 아닐 때 true. 평소 트래픽은 이 값이 true인 엔드포인트로만 간다.

kube-proxy는 목록이 바뀔 때마다 규칙을 다시 쓰되, 너무 잦은 갱신을 묶으려고 최소 간격을 둔다(`--iptables-min-sync-period`, 기본 1초). 목록 변경이 API 서버를 거쳐 노드마다 따로 반영되므로, 파드 상태가 바뀐 순간과 모든 노드의 규칙이 바뀐 순간 사이에는 늘 시차가 있다.

파드는 안의 컨테이너가 모두 Ready일 때 Ready다. readiness probe가 없는 컨테이너는 시작하자마자 Ready로 친다. 그래서 프로세스만 뜨고 설정 로드와 커넥션 풀 준비가 덜 끝난 앱도 곧바로 목록에 들어가 connection refused를 낸다. 아래 그림처럼 readiness probe를 두면 새 파드는 검사를 통과한 뒤에야 목록에 들어간다.

<figure class="fig" data-figure="k8s-best-practices-readiness">
  <figcaption>새 파드 C가 엔드포인트에 들어가는 시점</figcaption>
</figure>

readiness probe는 kubelet(노드마다 돌며 컨테이너를 띄우고 검사하는 에이전트)이 `periodSeconds`마다 앱에 묻는 검사다. `failureThreshold`번 연속 실패하면 kubelet이 파드의 Ready를 false로 바꾸고, EndpointSlice 컨트롤러가 그 파드를 모든 Service의 목록에서 뺀다. 아직 Ready가 아닌 컨테이너는 빨리 Ready가 되도록 `periodSeconds`와 다른 때에도 검사할 수 있다.

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  periodSeconds: 5
  failureThreshold: 3
```

readiness는 컨테이너가 살아 있는 내내 돈다. 모든 파드가 같이 쓰는 DB를 readiness에 넣으면, DB가 몇 초 흔들릴 때 모든 파드가 한꺼번에 빠져 목록이 비고 오류 응답조차 줄 파드가 없어진다. readiness는 앱 자신이 요청을 받을 수 있는지(초기화 완료, 내부 큐 여유)만 본다.

readiness는 트래픽을 뺄 뿐 컨테이너를 고치지 않는다. 교착에 빠져 영영 응답하지 못하는 컨테이너도 목록에서 빠진 채 그대로 남는다.

## liveness와 startup probe

### liveness probe

liveness probe는 실패가 `failureThreshold`번 이어지면 kubelet이 컨테이너를 재시작하게 하는 검사다. 값을 적지 않으면 이렇게 돈다.

```text
initialDelaySeconds 0, periodSeconds 10, timeoutSeconds 1, failureThreshold 3
→ 10초마다 묻고, 1초 안에 답이 없으면 실패, 3번 연속이면 재시작
```

멈춘 컨테이너를 30초 안팎에 다시 띄우는 값이다. 문제는 느린 것과 멈춘 것을 구별하지 못한다는 점이다. 부하가 몰리면 health 응답도 다른 요청 뒤에서 기다리느라 1초를 넘기기 쉽다. 아래 데모에서 모드로 liveness가 실패로 보는 기준을 바꾸고, '부하 몰리게 하기'를 눌러 서비스 중인 파드 수를 비교한다.

<figure class="fig" data-figure="k8s-best-practices-liveness">
  <figcaption>부하가 몰릴 때 liveness 기준에 따른 재시작</figcaption>
</figure>

느리면 재시작하는 모드에서는 A가 먼저 재시작되고, A 몫의 요청이 B와 C로 몰려 둘도 차례로 응답이 늦어져 재시작된다. 멈출 때만 재시작하는 모드에서는 세 파드가 느려지기만 하고 부하가 지나가면 돌아온다. 재시작은 부하를 없애지 못하고 남은 파드로 옮길 뿐이라, 느림을 실패로 세면 재시작 하나가 다음 재시작을 부른다. 공식 문서도 잘못 잡은 liveness가 부하 때 연쇄 장애를 부른다고 경고한다.

연쇄 재시작은 부하가 빠진 뒤에도 회복을 늦춘다. kubelet은 다시 띄우기 전 대기를 10초, 20초, 40초로 두 배씩 늘리고 5분에서 멈춘다. 이 대기는 컨테이너가 10분 동안 문제없이 돌아야 처음으로 돌아간다.

- 검사는 앱 프로세스 안에서 끝낸다. 재시작해도 DB는 고쳐지지 않으니 DB를 부르지 않는다.
- readiness와 같은 경로를 쓰더라도 `failureThreshold`를 더 크게 둔다. 그러면 트래픽에서 먼저 빠지고, 그래도 회복하지 못할 때만 재시작된다.

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 6
```

### startup probe

liveness는 기동 시간도 모른다. 기본값이면 컨테이너가 뜬 뒤 `initialDelaySeconds + failureThreshold × periodSeconds`, 즉 30초 안에 응답하지 못하면 재시작된다. 기동에 60초가 걸리는 JVM 앱은 기동을 끝내지 못하고 재시작을 되풀이하다 CrashLoopBackOff(재시작 대기가 점점 늘어나는 상태)에 빠진다.

startup probe가 있으면 kubelet은 그것이 한 번 성공할 때까지 liveness와 readiness를 돌리지 않는다. 기동은 최대 `failureThreshold × periodSeconds`까지 기다리고, 그래도 성공하지 못하면 컨테이너를 끝낸다. 아래 그림처럼 60초 기동이 끝난 뒤에야 liveness가 원래 주기로 돈다.

<figure class="fig" data-figure="k8s-best-practices-startup">
  <figcaption>60초 걸리는 기동과 probe 검사</figcaption>
</figure>

```yaml
startupProbe:
  httpGet:
    path: /livez
    port: 8080
  periodSeconds: 10
  failureThreshold: 30   # 최대 300초
```

`initialDelaySeconds`를 길게 줘도 비슷해 보이지만, 기동이 빨리 끝나도 그만큼 liveness가 늦게 시작되고 기동이 그보다 길어지면 다시 재시작된다. startup probe는 기동이 끝나는 순간 바로 넘겨준다.

## 롤링 업데이트

probe는 파드 하나의 상태를 알린다. 배포는 여러 파드를 바꾸는 일이라, 한 번에 몇 개를 더 띄우고 몇 개를 비워 둘지 정하는 값이 따로 있다. Deployment는 버전마다 ReplicaSet(정해진 수의 파드를 유지하는 객체)을 하나씩 두고, 새 ReplicaSet을 늘리고 옛 것을 줄이며 두 값을 지킨다.

- `maxSurge`: replicas보다 더 띄울 수 있는 파드 수. 기본 25%, 올림.
- `maxUnavailable`: 사용 가능하지 않아도 되는 파드 수. 기본 25%, 내림. 둘 다 0일 수는 없다.

올림과 내림이 갈려서 replicas에 따라 기본값의 동작이 달라진다.

```text
replicas 3:  maxSurge 0.75 → 1, maxUnavailable 0.75 → 0   사용 가능 3개 유지
replicas 4:  maxSurge 1.0  → 1, maxUnavailable 1.0  → 1   3개까지 줄어듦
replicas 10: maxSurge 2.5  → 3, maxUnavailable 2.5  → 2   8개까지 줄고 최대 13개
```

replicas 3에서 아무 문제가 없던 서비스가 4로 늘린 뒤 배포 중에만 느려지는 이유가 이 내림이다. 아래 그림처럼 maxUnavailable을 0으로 두면 새 파드가 준비된 뒤에야 옛 파드를 내린다.

<figure class="fig" data-figure="k8s-best-practices-rolling">
  <figcaption>replicas 4의 롤링 업데이트와 준비된 파드 수 (한 개씩 바꾸는 모습으로 단순화했다)</figcaption>
</figure>

대가는 자원이다. 아래 설정처럼 replicas 4에 maxSurge 1이면 배포하는 동안 파드가 5개라 노드에 파드 하나 몫의 여유가 있어야 한다. ResourceQuota(네임스페이스가 쓸 CPU, 메모리, 파드 수의 상한)가 평소 사용량에 꽉 맞춰져 있으면 다섯 번째 파드가 거부돼 롤아웃이 멈춘다.

```yaml
spec:
  replicas: 4
  minReadySeconds: 10
  strategy:
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

Deployment가 세는 "사용 가능"은 파드가 Ready가 된 뒤 `minReadySeconds` 동안 멀쩡했다는 뜻이다. 그래서 readiness probe가 롤아웃의 브레이크 노릇을 한다. probe가 없으면 기동 중인 새 파드도 바로 사용 가능으로 세어, 컨트롤러가 옛 파드를 계속 내려 버린다. `minReadySeconds` 기본값 0은 뜨자마자 죽는 버전도 다음 단계로 넘어가게 한다.

새 파드가 끝내 준비되지 않으면 롤아웃은 멈춘다. `progressDeadlineSeconds`(기본 600초)가 지나면 Deployment에 `ProgressDeadlineExceeded`가 붙고 `kubectl rollout status`가 종료 코드 1을 낸다. 자동으로 되돌리지는 않으므로, 배포 파이프라인은 이 종료 코드를 보고 `kubectl rollout undo`를 부른다.

## 종료 순서와 preStop

롤링 업데이트가 내리는 옛 파드는 삭제 요청으로 끝난다. API 서버는 파드에 삭제 시각과 유예 시간(`terminationGracePeriodSeconds`, 기본 30초)을 적고, 그때부터 두 갈래가 동시에 움직인다.

- kubelet: preStop 훅(종료 직전에 실행할 명령이나 대기)을 실행하고, 끝나면 컨테이너의 첫 프로세스(PID 1)에 정상 종료를 청하는 SIGTERM을 보낸다. 유예 시간이 다 되도록 남은 프로세스는 강제 종료 신호 SIGKILL로 끝낸다.
- 컨트롤 플레인: EndpointSlice에서 그 파드를 `terminating: true`, `ready: false`로 바꾼다. 각 노드의 kube-proxy, 인그레스 컨트롤러, 클라우드 로드밸런서가 이를 보고 규칙에서 뺀다.

둘은 서로를 기다리지 않는다. 앱이 SIGTERM을 받자마자 내려가면, 첫 절에서 본 시차만큼 규칙에 남아 있는 동안 들어온 요청이 실패한다. 아래 데모에서 'preStop 없음'과 'preStop sleep 5'를 바꿔 가며 '파드 A 삭제'를 누르고 실패한 요청 수를 비교한다.

<figure class="fig" data-figure="k8s-best-practices-prestop">
  <figcaption>파드 A를 지울 때 규칙에서 빠지는 시점과 SIGTERM (2초는 대략값)</figcaption>
</figure>

preStop이 없으면 A는 삭제 직후 내려가고, 규칙에서 빠지는 2초 동안 A로 간 요청이 실패한다. preStop에서 5초를 기다리면 규칙에서 먼저 빠진 뒤에 SIGTERM이 와서 실패가 없다. preStop이 끝나야 SIGTERM이 나가기 때문이다.

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
- 대기 시간은 규칙에서 빠지는 경로 중 가장 느린 쪽에 맞춘다.
- preStop 시간도 유예 시간 안에 든다. 유예 60초에 preStop이 55초, 앱 종료가 10초 걸리면 앱은 종료를 마치기 전에 SIGKILL을 받는다. preStop이 유예 시간을 넘기면 kubelet은 한 번만 2초를 더 준다.

SIGTERM을 받은 앱은 새 연결을 그만 받고, 처리 중인 요청을 끝낸 뒤 종료해야 한다. Node.js의 `server.close()`는 새 연결을 막고 요청을 기다리지 않는 keep-alive 연결을 닫는다(v19부터). 콜백은 남은 요청이 끝난 뒤에 불린다.

```js
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
```

신호는 PID 1만 받는다. Dockerfile의 ENTRYPOINT를 셸 형식(`ENTRYPOINT node server.js`)으로 쓰면 `/bin/sh -c`가 PID 1이 되고 앱에는 SIGTERM이 전달되지 않아, 30초를 채운 뒤 SIGKILL로 끝난다. `["node", "server.js"]`처럼 exec 형식으로 쓴다.

## drain과 PodDisruptionBudget

노드를 업그레이드하거나 줄일 때는 `kubectl drain`으로 노드를 비운다. drain은 노드를 스케줄 불가로 표시(cordon)한 뒤, 그 노드의 파드마다 Eviction API(정해진 조건을 지키며 파드를 내보내 달라는 요청)를 부른다. eviction은 파드 삭제와 같은 종료 순서를 밟아서, 앞 절의 preStop과 유예 시간이 그대로 통한다.

문제는 개수다. 롤링 업데이트는 maxUnavailable로 한 번에 내리는 수를 정하지만, drain은 막는 조건이 없으면 노드의 파드를 전부 한꺼번에 내보낸다. 같은 앱 파드가 그 노드에 몰려 있으면 대체 파드가 다른 노드에서 준비될 때까지 남은 파드가 모든 요청을 받는다.

PodDisruptionBudget(PDB)은 자발적 중단에서 동시에 내려갈 수 있는 파드 수를 정한다. 자발적 중단은 drain, 클러스터 업그레이드, 오토스케일러의 노드 정리처럼 운영 작업이 일으키는 중단이다. Eviction API는 요청마다 PDB를 확인해 세 가지로 답한다.

- `200 OK`: 허용. 파드가 삭제된다.
- `429 Too Many Requests`: 지금 내보내면 PDB를 어긴다. drain은 실패한 요청을 주기적으로 다시 보낸다.
- `500 Internal Server Error`: 파드 하나에 PDB가 둘 이상 걸린 설정 오류.

아래 그림은 replicas 3 중 둘이 노드 1에 있을 때 PDB 없이, 그리고 minAvailable 2로 drain하는 모습이다. minAvailable 2를 두면 A2의 eviction이 429로 거부되고, A1의 대체 파드가 준비된 뒤에야 A2가 내려간다.

<figure class="fig" data-figure="k8s-best-practices-pdb">
  <figcaption>replicas 3에서 노드 1을 drain할 때 준비된 파드 수 (기동 시간은 대략값)</figcaption>
</figure>

대신 drain은 대체 파드의 기동 시간만큼 더 걸린다. PDB가 세는 건강한 파드는 Ready인 파드라서, 여기서도 readiness probe가 기준이 된다.

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

```text
$ kubectl get pdb api
NAME   MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
api    2               N/A               1                     12d
```

ALLOWED DISRUPTIONS가 0이면 drain이 이 앱의 파드를 내보내지 못하고 기다린다. PDB가 막지 못하는 경우도 있다.

- 파드나 Deployment를 직접 지우면 Eviction API를 거치지 않아 PDB를 건너뛴다.
- 롤링 업데이트도 PDB에 막히지 않는다. 배포 중 개수는 maxUnavailable이 정한다.
- minAvailable을 replicas와 같게 두거나 maxUnavailable을 0으로 두면 eviction이 늘 429라 drain이 끝나지 않는다.
- 비율로 적으면 올림한다. 7개에 minAvailable 50%면 4개를 남긴다.

`unhealthyPodEvictionPolicy`의 기본값 IfHealthyBudget은 건강한 파드 수가 이미 기준 아래면 Ready가 아닌 파드도 내보내지 않는다. 고장 난 파드 하나 때문에 drain이 멈추는 원인이라, 공식 문서는 AlwaysAllow(1.31 GA)를 권한다.

## 분산 배치

노드 장애나 커널 패닉은 비자발적 중단이라 PDB가 막지 못한다. 대체 파드가 뜰 때까지 버틸 파드가 다른 노드에 남아 있어야 하고, 그것은 처음에 파드를 어디에 놓았느냐로 정해진다.

스케줄러는 자원이 맞는 노드를 거른 뒤 점수를 매겨 고른다. 분산은 따로 적지 않으면 이 점수의 한 항목일 뿐이다. 클러스터 기본 분산 규칙은 둘이다.

- 노드(`kubernetes.io/hostname`) 기준 maxSkew 3, `ScheduleAnyway`
- 존(`topology.kubernetes.io/zone`) 기준 maxSkew 5, `ScheduleAnyway`

skew는 같은 앱 파드가 가장 많은 노드와 가장 적은 노드의 개수 차이다. 노드끼리 3개 차이까지 허용하고 어겨도 배치를 막지 않으므로, replicas 3이 한 노드에 모두 들어가도 규칙 안이다. 아래 그림처럼 몰려 있으면 노드 하나가 멈출 때 하나도 남지 않는다.

<figure class="fig" data-figure="k8s-best-practices-spread">
  <figcaption>replicas 3에서 노드 1이 멈출 때 (B는 다른 앱)</figcaption>
</figure>

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: api
    matchLabelKeys: [pod-template-hash]
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: api
    matchLabelKeys: [pod-template-hash]
```

- `DoNotSchedule`은 차이를 maxSkew 안으로 맞출 수 없으면 파드를 Pending으로 둔다. `ScheduleAnyway`는 점수만 깎는다. 위 예는 존은 반드시, 노드는 되도록 나눈다.
- `matchLabelKeys`에 `pod-template-hash`를 넣으면 개수를 셀 때 같은 버전 파드끼리만 센다. 없으면 롤링 업데이트 중 곧 빠질 옛 파드까지 세어, 새 파드가 한쪽으로 쏠릴 수 있다.
- pod anti-affinity를 required로 두어도 노드마다 하나씩 놓을 수 있다. 다만 노드보다 replicas가 많으면 남는 파드가 Pending이 되고, 계산이 무거워 공식 문서는 노드가 수백 개를 넘는 클러스터에서 권하지 않는다.

분산은 스케줄할 때만 맞춘다. 스케일 다운이나 노드 교체 뒤 다시 한쪽으로 쏠려도 스케줄러는 옮기지 않고, 다시 맞추려면 Descheduler 같은 도구가 파드를 내보내 재배치하게 한다.

## 정리

- Service는 EndpointSlice의 `ready` 엔드포인트로만 보낸다. readiness probe가 없으면 컨테이너는 시작하자마자 그 목록에 들어간다.
- liveness 기본값(10초, 1초, 3번)은 느림과 멈춤을 구별하지 못해 부하 때 연쇄 재시작을 부른다. 느린 기동은 startup probe로 기다린다.
- 롤링 업데이트는 maxSurge를 올림, maxUnavailable을 내림한다. replicas 4부터 기본값이 가용 파드를 줄이고, readiness가 롤아웃 속도를 정한다.
- 삭제되면 SIGTERM과 규칙 제거가 동시에 시작된다. preStop 대기로 규칙에서 먼저 빠지고, 앱은 SIGTERM에 처리 중인 요청을 끝낸다.
- drain은 Eviction API를 쓰고, PDB가 429로 동시에 내려가는 수를 막는다. 직접 삭제와 롤링 업데이트는 PDB를 거치지 않는다.
- 노드 장애는 PDB로 막지 못한다. topology spread로 노드와 존에 나눠 두고, `pod-template-hash`로 버전별로 센다.

버전과 기본값은 2026년 11월 쿠버네티스 문서로 확인했다.

## 참고

- [Kubernetes — EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
- [Kubernetes — kube-proxy](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-proxy/)
- [Kubernetes — Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Kubernetes — Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes — Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes — Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes — Termination of Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-termination/)
- [Kubernetes — Container Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/)
- [Kubernetes — Feature Gates](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/)
- [Kubernetes — Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)
- [Kubernetes — API-initiated Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/api-eviction/)
- [Kubernetes — Specifying a Disruption Budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)
- [Kubernetes — Safely Drain a Node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/)
- [Kubernetes — Pod Topology Spread Constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)
- [Kubernetes — Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
- [Node.js — http.Server close()](https://nodejs.org/api/http.html#serverclosecallback)
- [Docker — Dockerfile reference, ENTRYPOINT](https://docs.docker.com/reference/dockerfile/#entrypoint)
- 원글: [K8S best practices #1](https://kimjanghyun1010.tistory.com/46), [K8S best practices #2](https://kimjanghyun1010.tistory.com/47), [K8S best practices #3](https://kimjanghyun1010.tistory.com/48)
