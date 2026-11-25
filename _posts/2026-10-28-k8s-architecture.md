---
title: 쿠버네티스 구조
description: kubectl 요청 하나가 API 서버, etcd, 스케줄러, kubelet을 거쳐 파드로 뜨기까지와 워크로드, 컨트롤러, Operator까지 정리했다.
date: 2026-10-28 12:00:00 +0900
series: Kubernetes
tags: [kubernetes, scheduler, etcd, controller, operator]
scripts: [figures/k8s-architecture.js]
---

## 클러스터 구성

`kubectl apply -f deploy.yaml`을 치면 몇 초 뒤 어느 서버에서 컨테이너가 뜬다. 명령을 받은 서버와 컨테이너를 돌리는 서버는 다른 서버다.

쿠버네티스는 여러 서버를 묶은 클러스터(cluster)이고, 그 안의 서버 한 대를 노드라고 한다. 노드는 하는 일에 따라 둘로 나뉜다.

- 컨트롤 플레인(control plane): 무엇을 어디에 띄울지 정하고, 정한 상태를 지킨다.
- 워커 노드: 컨테이너를 실제로 돌린다.

| 위치 | 구성 요소 | 하는 일 |
|---|---|---|
| 컨트롤 플레인 | API 서버 (kube-apiserver) | 쿠버네티스 API를 여는 정문. 모든 읽기와 쓰기가 여기를 지난다 |
| 컨트롤 플레인 | etcd | 클러스터의 모든 상태를 담는 키 값 저장소 |
| 컨트롤 플레인 | 스케줄러 (kube-scheduler) | 노드가 정해지지 않은 파드에 노드를 골라 준다 |
| 컨트롤 플레인 | 컨트롤러 매니저 | Deployment, ReplicaSet 같은 컨트롤러를 돌린다 |
| 워커 노드 | kubelet | 자기 노드에 배정된 파드의 컨테이너가 돌게 한다 |
| 워커 노드 | kube-proxy | 서비스 주소를 파드로 보내는 네트워크 규칙을 관리한다. 선택 사항이다 |
| 워커 노드 | 컨테이너 런타임 | containerd처럼 컨테이너를 실제로 실행하는 프로그램 |

kube-proxy는 공식 문서에도 선택 사항으로 적혀 있다. Cilium처럼 네트워크 플러그인이 서비스 처리를 대신하면 띄우지 않는다.

두 장면에서 구성 요소가 어디에 있고 서로 어떤 선으로 이어지는지 본다. 두 번째 장면에서 선이 전부 API 서버로 모이는지 지켜보자.

<figure class="fig" data-figure="k8s-architecture-cluster">
  <figcaption>컨트롤 플레인과 워커 노드의 구성 요소</figcaption>
</figure>

스케줄러, 컨트롤러 매니저, kubelet은 서로 직접 부르지 않는다. 각자 API 서버에 걸어 둔 감시(watch)로 바뀐 것을 받아 보고, 할 일을 하면 결과를 다시 API 서버에 적는다. etcd에 접근하는 것도 API 서버 하나뿐이다.

그래서 클러스터가 이상하면 **API 서버와 etcd**부터 본다. 둘이 멈추면 이미 돌던 컨테이너는 그대로 돌지만, 새로 띄우거나 고치는 일은 전부 멈춘다.

## 요청 하나의 흐름

Deployment를 apply하고 `kubectl get pods -o wide`를 연달아 치면 STATUS가 Pending, ContainerCreating, Running 순으로 바뀌고, NODE 칸이 `<none>`에서 노드 이름으로 채워진다. 상태가 바뀌는 자리마다 구성 요소 하나가 일을 마쳤다.

아래 그림은 replicas 1인 Deployment가 파드로 뜨기까지 일곱 단계를 차례로 보여 준다. 왼쪽 위의 STATUS와 오른쪽 위의 NODE가 몇 번 단계에서 바뀌는지 본다.

<figure class="fig" data-figure="k8s-architecture-flow">
  <figcaption>kubectl apply 한 번이 파드 Running이 되기까지</figcaption>
</figure>

1. kubectl이 Deployment를 API 서버에 보낸다.
2. API 서버가 인증, 인가, 검사를 거쳐 etcd에 저장한다.
3. 컨트롤러 매니저의 Deployment 컨트롤러가 ReplicaSet을 만들고, ReplicaSet 컨트롤러가 파드를 만든다. 이 파드에는 아직 노드가 없다.
4. 스케줄러가 노드 없는 파드를 보고 노드를 골라 파드에 적는다. 이걸 바인딩(binding)이라고 한다.
5. 그 노드의 kubelet이 자기 노드에 배정된 파드를 받는다.
6. kubelet이 컨테이너 런타임에 이미지를 받고 컨테이너를 띄우게 한다.
7. kubelet이 파드 상태를 API 서버에 보고한다.

일곱 단계 중 컨테이너를 실제로 띄우는 건 6번 하나다. 나머지는 API 서버에 무언가를 적고, 다른 구성 요소가 그걸 보고 움직이는 일이다. 누가 누구에게 명령하는 구조가 아니라 **etcd에 적힌 상태를 각자 따라가는** 구조다.

파드가 오래 멈춰 있으면 상태로 어느 단계에서 막혔는지 먼저 가른다.

- 파드가 아예 없다: 3번 컨트롤러 단계다. `kubectl describe replicaset`의 Events를 본다.
- Pending이고 NODE가 `<none>`이다: 4번 스케줄러가 자리를 못 찾았다. `kubectl describe pod`의 Events에서 FailedScheduling 이유를 본다.
- ContainerCreating이나 ImagePullBackOff다: 노드는 정해졌고 6번 kubelet과 런타임 쪽이다. 이미지 이름, 레지스트리 인증, 볼륨 연결을 본다.

## API 서버와 etcd

모든 구성 요소가 API 서버를 거치고, API 서버는 상태를 etcd에 둔다. 클러스터가 기억하는 것은 etcd 한곳에 있다.

### API 서버 요청 처리

`kubectl get pod`는 kubectl이 무언가를 계산하는 명령처럼 보이지만 실제로는 HTTP GET 한 번이다. kubectl 코드(v1.33)를 디버거로 따라가면 이렇게 흘러간다.

1. `~/.kube/config`(또는 `KUBECONFIG`)를 읽어 API 서버 주소와 인증 정보를 정한다.
2. 명령줄을 명령 트리(cobra)에서 찾아 `get`의 실행 함수를 부른다.
3. 아래 요청을 보낸다. 로그에 찍힐 때 토큰은 가려진다.

```text
GET https://<API 서버>/api/v1/namespaces/default/pods?limit=500
Accept: application/json;as=Table;v=v1;g=meta.k8s.io, application/json
Authorization: Bearer <토큰>
```

- `limit=500`: 목록을 500개씩 나눠 받는다. `--chunk-size`의 기본값이다.
- `as=Table`: NAME, READY, STATUS 같은 열을 서버가 만들어 보낸다. 출력 열은 kubectl이 아니라 API 서버가 정한다.

API 서버는 요청을 받으면 정해진 순서로 검사한다.

- 인증(authentication): 누구인지 확인한다. 실패하면 401이다.
- 인가(authorization): 그 사용자가 이 동작을 해도 되는지 RBAC 규칙 등으로 확인한다. 실패하면 403이다.
- 어드미션(admission): 만들기, 고치기, 지우기 요청만 거친다. 기본값을 채우거나 정책에 어긋나는 요청을 막는다.
- 검증과 저장: 객체 형식을 검사하고 etcd에 쓴다.

세 장면에서 요청이 어느 칸을 지나고, 어디서 멈추거나 건너뛰는지 본다.

<figure class="fig" data-figure="k8s-architecture-api">
  <figcaption>API 서버가 요청을 검사하는 순서</figcaption>
</figure>

읽기는 어드미션을 건너뛰고, 목록 조회는 etcd까지 가지 않을 때가 많다. API 서버는 etcd 내용을 메모리의 감시 캐시(watch cache)에 들고 있다가, 캐시가 최신인지 etcd에 확인한 뒤 캐시에서 답한다. 1.31부터 기본으로 켜진 동작이다.

권한 문제는 요청을 보내기 전에 `kubectl auth can-i`로 확인한다.

```text
$ kubectl auth can-i delete pods -n prod
no
```

401이 뜨면 kubeconfig의 인증 정보를, 403이 뜨면 그 사용자의 RBAC 규칙을 먼저 본다.

### etcd 쿼럼

컨트롤 플레인을 3대에서 4대로 늘렸는데, 2대가 죽자 클러스터가 멈췄다. etcd는 멤버의 과반이 살아 있어야 쓰기를 받는다.

etcd는 Raft 합의로 움직인다. 쓰기 하나는 리더가 받아 다른 멤버에게 복제하고, 과반(쿼럼, quorum)이 받았다고 답해야 확정된다.

```text
과반 = 멤버 수 ÷ 2의 몫 + 1
3대 → 과반 2 → 1대 고장까지 견딤
4대 → 과반 3 → 1대 고장까지 견딤
5대 → 과반 3 → 2대 고장까지 견딤
```

아래 데모에서 멤버 수를 고르고 한 대씩 꺼 보자. 모드를 바꿔 가며 몇 번째 고장에서 쓰기가 멈추는지 본다.

<figure class="fig" data-figure="k8s-architecture-etcd">
  <figcaption>etcd 멤버가 하나씩 죽을 때 쓰기가 멈추는 시점</figcaption>
</figure>

3대는 1대가 죽어도 2대가 과반이라 쓰기가 이어지고, 2대가 죽으면 멈춘다. 4대는 과반이 3으로 올라서 2대가 죽으면 똑같이 멈춘다. 장비만 한 대 늘고 **견디는 고장 수는 그대로**다.

그래서 etcd는 3, 5처럼 홀수로 둔다. 네트워크가 둘로 갈라질 때도 홀수면 한쪽이 반드시 과반을 갖는다. 멤버가 늘면 쓰기마다 복제할 곳도 늘어나서, etcd 문서는 7대를 넘기지 말라고 권한다. 대부분은 2대 고장을 견디는 5대면 충분하다.

## 스케줄링

API 서버에 막 저장된 파드는 노드 칸이 비어 있다. 이 빈칸을 채우는 것이 스케줄러(kube-scheduler)다. 기본 스케줄러 대신 직접 만든 스케줄러를 쓸 수도 있게 설계되어 있다.

### 거르기와 점수

노드가 넷인데 새 파드가 늘 같은 노드에만 몰린다. 스케줄러는 노드를 무작위로 고르지 않고 두 단계로 고른다.

- 거르기(filtering): 이 파드를 올릴 수 없는 노드를 뺀다. 남은 노드를 feasible 노드라고 한다.
- 점수(scoring): 남은 노드에 점수를 매기고 가장 높은 노드를 고른다.

고른 결과는 바인딩으로 API 서버에 적는다. 스케줄러는 컨테이너를 띄우지 않고, 파드의 `nodeName` 칸을 채우는 데서 일이 끝난다.

세 장면에서 노드가 어떤 이유로 빠지고, 남은 노드 중 어디가 뽑히는지 본다.

<figure class="fig" data-figure="k8s-architecture-filter">
  <figcaption>거르기, 점수, 바인딩 순서로 노드를 고르는 과정</figcaption>
</figure>

거르기와 점수의 규칙은 스케줄러에 박혀 있지 않고 플러그인으로 들어 있다. 기본으로 켜진 것 중 자주 만나는 것은 이렇다.

| 플러그인 | 거르기 | 점수 |
|---|---|---|
| NodeResourcesFit | 요청한 CPU, 메모리가 남았는지 | 덜 할당된 노드 우대 (LeastAllocated, 기본값) |
| NodeResourcesBalancedAllocation | | CPU와 메모리가 고르게 남는 노드 우대 |
| TaintToleration | 노드의 taint를 파드가 견디는지 | 견디지 못하는 PreferNoSchedule taint가 적은 노드 우대 |
| NodeAffinity | nodeSelector, 필수 어피니티에 맞는지 | 선호 어피니티에 맞는 노드 우대 |
| PodTopologySpread | 퍼짐 제약을 어기지 않는지 | 존과 노드에 고루 퍼지게 |
| ImageLocality | | 이미지를 이미 받아 둔 노드 우대 |
| NodePorts, VolumeBinding, VolumeZone | 포트, 볼륨 조건이 맞는지 | |

플러그인 하나가 두 단계에 다 들어가기도 한다. NodeResourcesFit은 자리가 있는지 거르는 데도, 얼마나 여유로운지 점수를 매기는 데도 쓰인다.

파드가 한 노드에 몰린다면 그 노드의 request 여유가 유난히 크지 않은지, 이미지를 그 노드만 갖고 있지 않은지부터 본다. 고루 퍼뜨려야 하는 서비스는 PodTopologySpread 제약을 직접 건다.

### Pending 파드

클러스터 CPU 사용률은 30%인데 새 파드가 Pending에서 움직이지 않는다. 스케줄러가 재는 것은 실제 사용량이 아니라 **request 합계**다.

노드에 남은 자리는 노드의 할당 가능량(allocatable)에서 이미 올라간 파드들의 request 합을 뺀 값이다. 파드가 실제로 CPU를 얼마나 쓰는지는 거르기에 들어가지 않는다.

데모에서 request를 바꿔 가며 파드를 만들어 보자. 회색 막대(request 합)와 주황 점선(실사용)을 견주며 파드가 어디로 가는지 본다.

<figure class="fig" data-figure="k8s-architecture-pending">
  <figcaption>request 합계로 자리를 재는 스케줄러 (노드마다 CPU 4개)</figcaption>
</figure>

500m은 여유가 1.5코어인 node-2에 바로 들어가고, 2000m은 어느 노드에도 들어가지 못한다. 세 노드 모두 실사용은 절반도 안 되지만 request로는 거의 차 있다. 두 모드에서 바뀐 것은 새 파드의 request 하나뿐이다.

Pending 파드는 Events에 이유가 남는다.

```text
$ kubectl describe pod api-7d4b9c-x2k9
Events:
  Type     Reason            From               Message
  ----     ------            ----               -------
  Warning  FailedScheduling  default-scheduler  0/3 nodes are available: 3 Insufficient cpu.
```

거르기에서 하나도 남지 않으면 스케줄러는 선점(preemption)을 시도한다. 우선순위(PriorityClass)가 낮은 파드를 내보내면 자리가 나는지 본다. 그래도 자리가 없으면 파드는 대기하고, 클러스터 오토스케일러가 있으면 이 Pending 파드를 보고 노드를 늘린다.

Pending이 잦다면 노드를 늘리기 전에 request가 실사용보다 크게 잡혀 있지 않은지부터 본다. request를 정하는 기준은 [CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %})에 정리했다.

### 스케줄링 주기

파드 수백 개를 한꺼번에 만들어도 두 파드가 같은 마지막 자리를 함께 차지하지 않는다. 스케줄러는 파드 하나를 다루는 시도를 두 주기로 나눠 돌린다.

- 스케줄링 주기: 노드를 고른다. 한 번에 파드 하나씩 차례로 돈다.
- 바인딩 주기: 고른 결과를 API 서버에 반영한다. 여러 파드가 겹쳐서 돈다.

그림에서 위 줄의 블록은 겹치지 않고, 아래 줄의 블록은 겹치는 것을 본다.

<figure class="fig" data-figure="k8s-architecture-cycles">
  <figcaption>스케줄링 주기와 바인딩 주기의 시간축</figcaption>
</figure>

고르는 도중에 다른 파드가 끼어들면 둘이 같은 자리를 고를 수 있다. 그래서 고르기는 하나씩 하고, 고른 자리는 바인딩이 끝나기 전에 스케줄러 안에서 미리 잡아 둔다(Reserve). 볼륨이 준비되기를 기다리는 것처럼 오래 걸리는 반영은 겹쳐 돌려서 다음 파드의 고르기를 막지 않는다.

대량 배포 때 파드가 Pending에 오래 머물다 한꺼번에 뜬다면, 고르기보다 바인딩 쪽의 볼륨 준비가 오래 걸리지 않는지 본다.

## 워크로드

파드는 하나하나 손으로 만들지 않는다. 몇 개를 어떻게 유지할지 적은 워크로드 리소스를 만들고, 컨트롤러가 그 내용대로 파드를 만든다.

### 파드

컨테이너는 쿠버네티스에 그대로 올라가지 않는다. 파드(Pod)로 한 겹 싸서 올리고, 파드가 쿠버네티스가 만들고 다루는 가장 작은 단위다.

파드 하나에는 컨테이너가 여럿 들어갈 수 있다. 같은 파드의 컨테이너는 같은 노드에서 함께 뜨고, 두 가지를 나눠 쓴다.

- 네트워크: IP 하나를 같이 쓴다. 서로를 `localhost`로 부르고, 포트로 구별한다.
- 볼륨: 같은 볼륨을 함께 마운트한다.

두 장면에서 요청과 로그가 파드 안 어디를 지나는지 본다.

<figure class="fig" data-figure="k8s-architecture-pod">
  <figcaption>컨테이너 둘이 IP와 볼륨을 나눠 쓰는 파드</figcaption>
</figure>

로그 수집기나 프록시 같은 보조 컨테이너(사이드카)를 앱과 같은 파드에 붙이는 이유가 이것이다. 반대로 따로 늘리고 줄여야 하는 것(웹 서버와 DB)은 한 파드에 넣지 않는다. 늘리고 줄이는 단위가 파드라서, 한 파드에 넣으면 둘을 같은 수로만 늘릴 수 있다.

### 조정 루프

테스트하려고 `kubectl run`으로 띄운 파드는 실수로 지우거나 노드가 빠지면 그대로 사라진다. Deployment로 띄운 파드는 곧 다시 생긴다. 차이는 그 파드를 지켜보는 컨트롤러가 있느냐다.

컨트롤러는 원하는 상태(spec)와 실제 상태를 견주고, 다르면 실제를 원하는 쪽으로 옮기는 일을 계속 반복한다. 이 반복을 조정 루프(reconcile loop)라고 한다.

1. 감시: API 서버에서 자기가 맡은 객체의 변화를 받는다.
2. 비교: replicas는 3인데 파드는 2개다.
3. 조치: 파드 하나를 만들어 API 서버에 적는다.

데모에서 파드 하나를 지워 보자. 모드를 바꿔 가며 지운 뒤 파드 수가 어떻게 되는지 본다.

<figure class="fig" data-figure="k8s-architecture-reconcile">
  <figcaption>파드 하나를 지웠을 때</figcaption>
</figure>

직접 만든 파드는 지우면 2개로 남고, Deployment의 파드는 지워도 새 이름의 파드가 떠서 3개가 된다. 지운 동작은 같고 차이를 메우는 컨트롤러가 있느냐만 다르다. 그래서 공식 문서도 파드 하나만 띄울 때조차 Deployment나 Job으로 만들라고 권한다.

컨트롤러는 "파드를 만들어라"라는 명령을 받아 움직이지 않는다. 볼 때마다 원하는 상태로 맞추기만 해서, 중간에 이벤트를 놓쳐도 다음 비교에서 따라잡는다.

파드를 `kubectl edit`로 직접 고치면 다음 교체 때 사라진다. 바꿀 것은 파드가 아니라 그 위의 Deployment에 적는다.

### Deployment 롤링 업데이트

Deployment는 개수만 맞으면 되는, 서로 구별되지 않는 파드를 다룬다. Deployment가 ReplicaSet을 만들고 ReplicaSet이 파드를 만든다. 이미지를 바꾸면 새 ReplicaSet을 만들어 새 파드를 조금씩 늘리고 옛 파드를 줄인다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 4
  selector:
    matchLabels:
      app: api
  strategy:
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 25%
  template:
    metadata:
      labels:
        app: api           # selector와 같아야 한다
    spec:
      containers:
      - name: api
        image: registry.example.com/api:1.4.2
        resources:
          requests: { cpu: 500m, memory: 512Mi }
```

`selector`와 template의 레이블이 다르면 API 서버가 Deployment를 받지 않는다. selector는 만든 뒤에 바꿀 수 없어서, 바꾸려면 Deployment를 새로 만든다.

교체 폭은 두 값으로 정한다. 기본값은 둘 다 25%이고, replicas 4면 이렇게 계산된다.

```text
maxSurge 25%        → 4 × 0.25 = 1 (올림)  →  최대 5개까지 띄운다
maxUnavailable 25%  → 4 × 0.25 = 1 (내림)  →  최소 3개는 사용 가능하게 둔다
```

두 장면에서 아래 그래프의 사용 가능한 파드 수가 어디까지 내려가는지 본다.

<figure class="fig" data-figure="k8s-architecture-rolling">
  <figcaption>replicas 4에서 v1을 v2로 바꾸는 롤링 업데이트</figcaption>
</figure>

기본값은 빨리 끝나지만 교체 중에 4분의 1이 빠진다. 평소 트래픽을 파드 3개로 버티기 빠듯하면 그 순간 응답이 느려진다. 그런 서비스는 maxUnavailable을 0으로 두고 maxSurge만큼 먼저 띄운다.

- maxUnavailable 0이면 노드에 파드 하나가 더 들어갈 request 여유가 있어야 한다. 여유가 없으면 새 파드가 Pending에 걸려 업데이트가 멈춘다.
- 새 파드가 준비됐는지는 readinessProbe로 판단한다. probe가 없으면 프로세스가 뜨자마자 준비된 것으로 보고 옛 파드를 내린다.

### StatefulSet

DB 복제본을 Deployment로 띄웠더니, 파드가 다시 뜰 때마다 이름이 바뀌고 데이터가 사라졌다. 몇 번째인지가 중요한 파드는 StatefulSet으로 띄운다.

StatefulSet의 파드 이름은 `<StatefulSet 이름>-<번호>`로 고정된다. `volumeClaimTemplates`를 주면 번호마다 PVC가 따로 생기고, 파드가 다시 떠도 같은 번호의 PVC가 다시 붙는다.

- 이름: db-0, db-1, db-2. 다시 떠도 같은 이름이다.
- 순서: 기본 설정이면 0번부터 하나씩 띄우고, 줄일 때는 큰 번호부터 내린다.
- 볼륨: data-db-0, data-db-1처럼 번호마다 따로 붙고, 파드나 StatefulSet을 지워도 PVC는 남는다.

두 장면에서 가운데 파드를 지웠을 때 새로 뜬 파드의 이름과 데이터를 본다.

<figure class="fig" data-figure="k8s-architecture-statefulset">
  <figcaption>가운데 파드를 지웠을 때 Deployment와 StatefulSet</figcaption>
</figure>

Deployment는 새 이름으로 빈 파드를 띄우고, StatefulSet은 db-1을 같은 이름으로 다시 띄워 data-db-1을 붙인다. 이름이 고정되니 db-0을 primary로 두는 식의 설정을 할 수 있다. 헤드리스 서비스와 함께 쓰면 파드마다 `db-0.db.default.svc.cluster.local` 같은 고정 DNS 이름도 생긴다.

StatefulSet은 이름과 볼륨만 지켜 준다. 복제 설정과 장애 조치는 하지 않아서, 그 일은 DB 자신이나 뒤에 나올 Operator가 맡는다.

### DaemonSet

노드마다 로그 수집기를 하나씩 둬야 하는데, replicas로 띄우면 노드가 늘 때마다 숫자를 고쳐야 한다. DaemonSet은 개수 대신 "노드마다 하나"를 지킨다.

노드가 클러스터에 들어오면 그 노드에 파드가 생기고, 노드가 빠지면 그 파드도 정리된다. nodeSelector나 어피니티로 일부 노드에만 띄울 수도 있다.

두 장면에서 노드가 들어오고 빠질 때 파드 수가 노드 수를 따라가는지 본다.

<figure class="fig" data-figure="k8s-architecture-daemonset">
  <figcaption>노드 수를 따라가는 DaemonSet 파드</figcaption>
</figure>

로그 수집기, 노드 모니터링(node-exporter), 네트워크 플러그인처럼 노드 자체를 다루는 것을 DaemonSet으로 띄운다. 컨트롤 플레인 노드에도 띄워야 하면 그 노드의 taint를 견디는 toleration을 넣는다.

## Operator와 CRD

Prometheus를 클러스터에 직접 올리면 StatefulSet, 서비스, 설정 파일, 스크랩 대상 관리까지 사람이 챙겨야 한다. Operator는 이런 운영 지식을 컨트롤러로 만들어, 앞의 조정 루프를 내가 정한 리소스에도 돌린다.

재료는 두 가지다.

- CRD(CustomResourceDefinition): API 서버에 새 종류(kind)를 등록한다. 등록하면 `kubectl get prometheuses`처럼 기본 리소스와 똑같이 다룬다.
- 커스텀 컨트롤러(오퍼레이터): 그 종류의 객체인 CR(custom resource)을 감시하고, 적힌 대로 StatefulSet, 서비스, 설정을 만든다.

Prometheus Operator를 설치하면 CRD가 함께 등록되고, 사용자는 CR만 적는다.

```yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: main
spec:
  replicas: 2
  serviceMonitorSelector:
    matchLabels:
      team: api
```

세 장면에서 CRD 등록, CR 생성, 직접 수정이 각각 무엇을 바꾸는지 본다. 세 번째 장면에서 누군가 줄인 파드 수가 어디로 돌아가는지 지켜보자.

<figure class="fig" data-figure="k8s-architecture-operator">
  <figcaption>CRD, CR, 오퍼레이터가 맞물려 도는 모습</figcaption>
</figure>

오퍼레이터가 만든 리소스를 직접 고쳐도 다음 조정에서 CR 내용으로 돌아간다. 바꿀 것은 CR에 적는다. CR을 고치면 오퍼레이터가 리소스를 그에 맞게 바꾸므로, CR을 지우고 다시 만들 필요는 없다.

Prometheus Operator에서는 스크랩 대상도 CR(ServiceMonitor)이다. `serviceMonitorSelector`에 맞는 ServiceMonitor를 추가하면 오퍼레이터가 스크랩 설정을 다시 만들어 Prometheus에 반영한다.

오퍼레이터는 Operator SDK나 Kubebuilder로 만든다. Helm 차트를 감싸는 방식도 있어서, CR의 spec이 차트의 values로 들어간다.

```text
operator-sdk init --plugins helm --domain example.com --helm-chart <차트>
```

오퍼레이터를 들일 때는 RBAC 권한 범위와 CR을 지울 때의 동작(finalizer)부터 본다. 오퍼레이터는 사람 대신 클러스터에 리소스를 만드는 프로그램이라, 권한을 `'*'`로 넓게 주면 그만큼 위험하다.

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| API 서버 | 모든 읽기와 쓰기의 정문 | 인증 실패 401, 인가 실패 403. 어드미션은 쓰기만 거친다 |
| etcd | 클러스터 상태 저장 | 과반이 살아야 쓴다. 3, 5처럼 홀수로 둔다 |
| 스케줄러 | 거르기, 점수, 바인딩 | request 합으로 잰다. 실사용이 아니다 |
| kubelet | 배정된 파드를 런타임으로 띄운다 | ContainerCreating부터는 노드 쪽 문제다 |
| 컨트롤러 | 원하는 상태와 실제를 맞춘다 | 파드는 직접 만들지 않는다 |
| Deployment | 구별 없는 파드 개수 유지, 롤링 업데이트 | 기본 25%씩 교체. 끊기면 안 되면 maxUnavailable 0 |
| StatefulSet | 번호로 고정된 이름과 볼륨 | 복제와 장애 조치는 따로 챙긴다 |
| DaemonSet | 노드마다 하나 | 노드 수를 따라간다 |
| Operator | CRD와 커스텀 컨트롤러 | 바꿀 것은 CR에 적는다 |

## 참고

- [Kubernetes — Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/)
- [Kubernetes — Controlling Access to the Kubernetes API](https://kubernetes.io/docs/concepts/security/controlling-access/)
- [Kubernetes — Consistent Reads from Cache Beta](https://kubernetes.io/blog/2024/08/15/consistent-read-from-cache-beta/)
- [Kubernetes — kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/)
- [etcd — Frequently Asked Questions](https://etcd.io/docs/v3.6/faq/)
- [Kubernetes — Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
- [Kubernetes — Scheduling Framework](https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/)
- [Kubernetes — Scheduler Configuration](https://kubernetes.io/docs/reference/scheduling/config/)
- [Kubernetes — Pod Priority and Preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/)
- [Kubernetes — Pods](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Kubernetes — Controllers](https://kubernetes.io/docs/concepts/architecture/controller/)
- [Kubernetes — Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes — StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- [Kubernetes — DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/)
- [Kubernetes — Custom Resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/)
- [Kubernetes — Operator pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/)
- [Prometheus Operator — Design](https://prometheus-operator.dev/docs/getting-started/design/)
- [Operator SDK — Helm Operator Tutorial](https://sdk.operatorframework.io/docs/building-operators/helm/tutorial/)
- 원글: [K8S 소개](https://kimjanghyun1010.tistory.com/26), [K8S scheduler](https://kimjanghyun1010.tistory.com/27), [K8S Pod](https://kimjanghyun1010.tistory.com/28), [(DeepDive) kubectl get pod 를 했을때?](https://kimjanghyun1010.tistory.com/99), [k8s Operator](https://kimjanghyun1010.tistory.com/24)
