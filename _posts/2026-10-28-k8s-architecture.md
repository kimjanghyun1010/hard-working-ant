---
title: 쿠버네티스 구조
description: kubectl apply 한 줄이 API 서버와 etcd에 적히고, 컨트롤러와 스케줄러와 kubelet이 그 기록을 보고 움직여 다른 서버의 컨테이너가 되기까지, 그리고 그 상태를 지키는 조정 루프를 따라간다.
date: 2026-10-28 12:00:00 +0900
series: Kubernetes
tags: [kubernetes, scheduler, etcd, controller, operator]
scripts: [figures/k8s-architecture.js]
---

## API 서버와 etcd

`kubectl apply -f deploy.yaml`을 친 서버와 컨테이너가 뜨는 서버는 다르다. 명령 한 줄이 어떻게 다른 서버의 컨테이너가 되고, 뜬 뒤에는 누가 그 수를 지키나.

쿠버네티스는 여러 서버를 묶은 클러스터(cluster)이고, 그 안의 서버 한 대를 노드라고 한다. 노드는 하는 일에 따라 둘로 나뉜다.

- 컨트롤 플레인(control plane): API 서버, etcd, 스케줄러, 컨트롤러 매니저가 돈다. 무엇을 어디에 띄울지 정한다.
- 워커 노드: kubelet과 컨테이너 런타임(containerd 등)이 돈다. 컨테이너를 실제로 실행한다.

쿠버네티스가 띄우는 최소 단위는 파드(pod)로, 컨테이너 하나 이상을 묶은 것이다. Deployment는 같은 파드를 몇 개(replicas) 띄울지 적은 객체다.

etcd에 읽고 쓰는 것은 API 서버 하나뿐이다. 스케줄러, 컨트롤러, kubelet은 서로를 부르지 않고 **한곳에 적힌 상태를 각자 보고 움직인다.** API 서버에서 바뀐 것을 받아 보고, 할 일을 하면 결과를 다시 API 서버에 적는다.

아래 그림처럼 replicas 1인 Deployment가 파드로 뜨기까지 API 서버를 일곱 번 오가는 동안 컨테이너를 실제로 띄우는 단계는 6번 하나다.

<figure class="fig" data-figure="k8s-architecture-flow">
  <figcaption>kubectl apply 한 번이 파드 Running이 되기까지</figcaption>
</figure>

API 서버는 받은 요청을 정해진 순서로 검사한다.

- 인증(authentication): 인증서나 토큰으로 누구인지 확인한다. 실패하면 401이다.
- 인가(authorization): 그 사용자가 이 동작을 해도 되는지 RBAC(역할 기반 접근 제어, 역할마다 허용할 동작을 적은 규칙)으로 확인한다. 실패하면 403이다.
- 어드미션(admission): 만들기, 고치기, 지우기 요청만 거친다. 변경(mutating) 단계가 기본값을 채우고, 검증(validating) 단계가 정책에 어긋난 요청을 막는다.
- 저장: 스키마(필드 이름과 형식 규칙)를 검사한 뒤 etcd의 `/registry/<리소스>/<네임스페이스>/<이름>` 키에 쓴다. 접두사 `/registry`는 `--etcd-prefix`의 기본값이다.

<figure class="fig" data-figure="k8s-architecture-api">
  <figcaption>API 서버가 요청을 검사하는 순서</figcaption>
</figure>

`kubectl get pods`도 이 순서를 지나는 HTTP 요청 한 번이다. kubectl은 kubeconfig에서 주소와 인증 정보를 읽어 아래 요청을 보내고, NAME, READY, STATUS 같은 출력 열은 API 서버가 표로 만들어 보낸다.

```text
GET /api/v1/namespaces/default/pods?limit=500
Accept: application/json;as=Table;v=v1;g=meta.k8s.io, application/json
```

`limit=500`은 목록을 500개씩 나눠 받는 `--chunk-size`의 기본값이다. 읽기는 어드미션을 건너뛴다.

API 서버는 etcd 내용을 메모리에 복사해 둔 감시 캐시(watch cache)를 갖고 있다. 1.31부터 나누지 않는 목록을, 1.34부터는 이렇게 나눠 받는 목록까지 etcd에 가지 않고 이 캐시에서 답한다. 캐시가 최신인지만 etcd에 확인한다.

etcd에 저장된 객체에는 `resourceVersion`이 붙는다. etcd가 쓰기마다 하나씩 올리는 리비전 번호다. 두 클라이언트가 같은 객체를 동시에 고치면 먼저 쓴 쪽만 성공하고, 낡은 resourceVersion을 들고 온 쪽은 409 Conflict를 받아 다시 읽고 고친다. 잠금 없이 충돌을 막는 이 방식을 낙관적 동시성(optimistic concurrency)이라고 한다.

API 서버와 etcd가 멈춰도 이미 돌던 컨테이너는 그대로 돈다. 새로 띄우거나 고치는 일만 전부 멈춘다. 상태를 한곳에 모은 대가로 그 한곳은 멈추면 안 된다.

## etcd 쿼럼

etcd는 여러 대로 복제하되 Raft로 한 목소리를 낸다. Raft는 여러 서버가 같은 기록을 같은 순서로 갖게 하는 합의 알고리즘이다.

멤버 중 하나가 리더가 되어 쓰기를 받고, 다른 멤버에게 복제해 과반(쿼럼, quorum)이 받았다고 답해야 그 쓰기를 확정한다. 리더는 기본 100ms마다 살아 있다는 신호(하트비트)를 보내고, 다른 멤버는 1000ms(선거 타임아웃) 동안 소식이 없으면 새 리더를 뽑는다.

```text
과반 = 멤버 수 ÷ 2의 몫 + 1
3대 → 과반 2 → 1대 고장까지 견딤
4대 → 과반 3 → 1대 고장까지 견딤
5대 → 과반 3 → 2대 고장까지 견딤
```

아래 데모에서 멤버 수를 고르고 한 대씩 꺼서, 3대와 4대가 몇 번째 고장에서 쓰기를 멈추는지 비교한다.

<figure class="fig" data-figure="k8s-architecture-etcd">
  <figcaption>etcd 멤버가 하나씩 죽을 때 쓰기가 멈추는 시점</figcaption>
</figure>

3대는 1대가 죽어도 남은 2대가 과반이라 쓰기가 이어지고, 두 번째 고장에서 멈춘다. 4대는 과반이 3으로 오르면서 똑같이 두 번째 고장에서 멈춘다. 4대째는 쓰기마다 복제할 곳만 늘리고 견디는 고장 수를 늘리지 못해서, etcd 문서는 홀수를 권한다. 네트워크가 둘로 갈라질 때도 홀수면 한쪽이 반드시 과반을 갖는다.

- 멤버가 늘면 쓰기마다 복제할 곳이 늘어 느려진다. etcd 문서는 7대를 넘기지 말라고 하고, 대부분은 2대 고장을 견디는 5대면 된다.
- 저장 용량에는 기본 2GB 쿼터가 걸려 있다. 넘으면 NOSPACE 경보가 켜지고 읽기와 지우기만 받는다. 권장 상한은 8GB다.

etcd는 고칠 때마다 이전 리비전을 남긴다. 이 기록이 끝없이 쌓이지 않게 API 서버는 5분마다(`--etcd-compaction-interval` 기본값) etcd에 압축(compaction)을 요청해, 직전 요청 때의 리비전보다 오래된 것을 지운다. 그래서 etcd에 남는 변경 기록은 5~10분 길이다.

## 감시와 조정 루프

스케줄러, 컨트롤러, kubelet은 API 서버에 감시(watch)를 걸어 둔다. 감시는 `?watch=1&resourceVersion=10245`처럼 마지막으로 본 버전을 붙인 GET 요청이다. API 서버는 연결을 끊지 않고 그 뒤에 일어난 변경을 ADDED, MODIFIED, DELETED 이벤트로 흘려보낸다. 일정 간격으로 목록을 통째로 다시 받는 폴링(polling)보다 훨씬 가볍다.

클라이언트 라이브러리(client-go)의 인포머(informer)가 이 감시를 감싼다.

1. list: 목록을 한 번 받아 메모리 캐시를 채우고 그 resourceVersion을 기억한다.
2. watch: 그 버전부터 감시하며 캐시를 고친다.
3. 다시 list: 요청한 버전의 기록이 이미 없으면 API 서버가 410 Gone을 돌려준다. 캐시를 비우고 1번부터 다시 한다.

감시는 etcd가 아니라 API 서버의 감시 캐시에서 받는다. 이 캐시는 종류마다 정해진 크기(`--watch-cache-sizes`)의 버퍼에 최근 이벤트만 담아서, 변경이 잦으면 etcd에 남은 기록보다 먼저 옛 이벤트가 밀려나고 410 Gone이 온다. 공식 문서는 기록 창이 짧은 데 대비해 `allowWatchBookmarks=true`로 BOOKMARK 이벤트를 받아 resourceVersion을 앞당겨 두라고 한다.

컨트롤러는 인포머의 캐시를 읽고 판단해서 API 서버에 매번 묻지 않는다. 컨트롤러 매니저(kube-controller-manager)는 Deployment, ReplicaSet, Node, Job 같은 여러 컨트롤러를 한 프로세스에 묶어 돌린다.

컨트롤러 하나는 원하는 상태(spec)와 실제 상태를 견주고, 다르면 실제를 원하는 쪽으로 옮기는 일을 반복한다. 이 반복을 조정 루프(reconcile loop)라고 한다. Deployment 컨트롤러는 ReplicaSet을 만들고, ReplicaSet 컨트롤러는 replicas 수에 맞게 파드를 만들거나 지운다.

아래 그림처럼 파드 하나를 지우면 지키는 컨트롤러가 없는 파드는 2개로 남고, Deployment의 파드는 새 이름으로 다시 3개가 된다.

<figure class="fig" data-figure="k8s-architecture-reconcile">
  <figcaption>파드 하나를 지웠을 때</figcaption>
</figure>

컨트롤러는 "파드가 지워졌다"는 이벤트 하나에 반응하지 않는다. 볼 때마다 "원하는 3, 실제 2" 같은 차이를 메울 뿐이라, 이벤트를 놓쳐도 다음 비교에서 따라잡고 같은 일을 두 번 해도 결과가 같다. 공식 문서가 파드 하나만 띄울 때조차 Deployment나 Job으로 만들라고 권하는 이유다.

컨트롤러 매니저를 여러 대 띄워도 루프를 도는 것은 한 대다. 둘이 함께 돌면 같은 차이를 두 번 메워 파드가 넘칠 수 있다. 인스턴스마다 `kube-system`의 Lease 객체(지금 리더가 누구인지 적어 두는 작은 객체)를 잡으려 하고, 리더가 10초 안에 갱신하지 못하면 15초 뒤 다른 인스턴스가 이어받는다. 스케줄러도 같다.

```text
--leader-elect-renew-deadline=10s   리더가 갱신을 포기하는 시한
--leader-elect-lease-duration=15s   다른 인스턴스가 기다리는 시간
```

파드를 조금씩 새 버전으로 바꾸는 롤링 업데이트도 이 루프로 돈다. 이미지를 바꾸면 Deployment 컨트롤러가 새 ReplicaSet을 만들고, 기본값 maxSurge 25%와 maxUnavailable 25%를 넘지 않게 새 쪽의 replicas를 늘리고 옛 쪽을 줄인다. replicas 4면 최대 5개까지 띄우고 최소 3개를 유지한다.

## 스케줄링

컨트롤러가 만든 파드는 `spec.nodeName`이 비어 있다. 스케줄러(kube-scheduler)는 이런 파드를 감시해 스케줄링 큐에 넣고, 하나씩 꺼내 세 단계로 노드를 고른다.

- 거르기(filtering): 올릴 수 없는 노드를 뺀다. request만큼 자리가 남았는지(NodeResourcesFit), 노드에 붙은 taint(아무 파드나 올리지 말라는 표시)를 파드가 toleration(그 표시를 견딘다는 선언)으로 견디는지(TaintToleration), 파드가 요구한 노드 라벨 조건(nodeSelector, 어피니티)에 맞는지(NodeAffinity)를 본다.
- 점수(scoring): 남은 노드마다 플러그인이 0~100점을 매기고, 가중치를 곱해 더한 점수가 가장 높은 노드를 고른다. 기본값은 덜 할당된 노드(LeastAllocated)와 이미지를 이미 받아 둔 노드(ImageLocality)를 우대한다.
- 바인딩(binding): 고른 노드 이름을 파드의 `nodeName`에 적는다. 스케줄러는 컨테이너를 띄우지 않는다.

<figure class="fig" data-figure="k8s-architecture-filter">
  <figcaption>거르기, 점수, 바인딩 순서로 노드를 고르는 과정</figcaption>
</figure>

노드가 수천 대면 스케줄러는 조건에 맞는 노드를 일정 비율만큼 찾으면 거르기를 멈추고 그 안에서 점수를 매긴다. 이 비율(`percentageOfNodesToScore`)은 따로 정하지 않으면 100대에서 50%, 5000대에서 10%로 줄고 5% 아래로는 내려가지 않는다. 조건에 맞는 노드가 100대가 안 되면 전부 본다.

거르기에서 재는 자리는 실제 사용량이 아니라 **request 합계**다. 노드의 남은 자리는 할당 가능량(allocatable)에서 이미 올라간 파드들의 request 합을 뺀 값이다. 아래 데모에서 새 파드의 request를 500m(밀리코어, 0.5코어)과 2000m(2코어)으로 바꿔 가며 파드 만들기를 눌러 결과를 비교한다.

<figure class="fig" data-figure="k8s-architecture-pending">
  <figcaption>request 합계로 자리를 재는 스케줄러 (노드마다 CPU 4개)</figcaption>
</figure>

500m은 여유가 1.5코어인 node-2에 들어간다. 2000m은 세 노드의 실사용이 모두 1.5코어도 안 되는데, request 합으로 남은 자리가 가장 큰 node-2도 1.5코어뿐이라 들어갈 곳이 없다. 이유는 Events에 남는다.

```text
$ kubectl describe pod api-7d4b9c-x2k9
Events:
  Type     Reason            From               Message
  ----     ------            ----               -------
  Warning  FailedScheduling  default-scheduler  0/3 nodes are available: 3 Insufficient cpu.
```

남는 노드가 없으면 우선순위가 낮은 파드를 내보내는 선점(preemption)을 시도하고, 그래도 없으면 파드는 Pending으로 대기한다. Pending이 잦으면 노드를 늘리기 전에 request가 실사용보다 크게 잡혀 있지 않은지 본다. 기준은 [CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %})에 정리했다.

파드 수백 개를 한꺼번에 만들어도 두 파드가 같은 마지막 자리를 차지하지 않는다. 노드를 고르는 스케줄링 주기는 파드 하나씩 차례로 돌고, 고른 자리는 바인딩 전에 스케줄러 메모리에서 먼저 잡아 둔다(Reserve). API 서버에 적는 바인딩 주기만 여러 파드가 겹쳐 돌아서, 볼륨 준비처럼 오래 걸리는 반영이 다음 파드의 고르기를 막지 않는다.

## kubelet과 컨테이너 런타임

노드마다 도는 kubelet은 모든 파드가 아니라 `spec.nodeName`이 자기 노드인 파드만 감시한다. kubelet 소스에서 이 감시는 필드 셀렉터 `spec.nodeName=<노드 이름>`을 붙인 list와 watch다. 스케줄러가 바인딩을 적는 순간 그 노드의 kubelet에 파드가 도착한다.

kubelet은 컨테이너를 직접 만들지 않고 CRI(Container Runtime Interface)로 containerd 같은 런타임에 시킨다. CRI는 kubelet과 런타임 사이의 gRPC(다른 프로세스의 함수를 부르듯 요청하는 통신 방식) 규약이고, 파드 하나를 띄울 때 이 순서로 부른다.

1. `RunPodSandbox`: 파드의 껍데기(샌드박스)를 만든다. 런타임이 작은 pause 컨테이너로 네트워크 네임스페이스를 잡고, CNI(Container Network Interface) 플러그인이 여기에 파드 IP를 붙인다. CNI 플러그인은 Calico, Cilium처럼 파드 네트워크를 만드는 프로그램이다.
2. `PullImage`: 이미지가 노드에 없으면 받는다.
3. `CreateContainer`, `StartContainer`: 컨테이너마다 만들어 샌드박스 안에서 시작한다.

STATUS가 ContainerCreating인 동안이 이 세 단계다. 이미지를 받지 못하면 ErrImagePull을 거쳐 ImagePullBackOff가 되고, 파드는 노드가 정해진 채로 멈춰 있다.

같은 파드의 컨테이너가 IP 하나를 나눠 쓰는 것은 모두 한 샌드박스의 네트워크 네임스페이스에 들어가기 때문이다. 아래 그림처럼 서로를 `localhost`로 부르고 포트로 구별하며, 볼륨도 함께 마운트한다.

<figure class="fig" data-figure="k8s-architecture-pod">
  <figcaption>컨테이너 둘이 IP와 볼륨을 나눠 쓰는 파드</figcaption>
</figure>

kubelet은 컨테이너 상태를 파드의 status에 적고, 노드가 살아 있다는 것은 10초마다 `kube-node-lease` 네임스페이스의 Lease 객체를 갱신해 알린다. 노드가 끊기면 기본값으로 이렇게 흘러간다.

```text
0초     마지막 Lease 갱신
50초    node-monitor-grace-period 경과 → Ready=Unknown, unreachable taint
350초   파드의 기본 toleration 300초 만료 → 축출, 컨트롤러가 다른 노드에 새로 만든다
```

노드가 죽어도 파드가 바로 옮겨 가지 않는 이유가 이 기다림이다. 잠깐 끊긴 네트워크 때문에 파드를 모두 옮기는 일은 막지만, 진짜 장애에서는 6분 가까이 그 파드 몫이 빈다. 빨리 옮겨야 하는 서비스는 파드의 `tolerationSeconds`를 짧게 준다.

## Operator와 CRD

기본 컨트롤러는 파드 수, 노드 배치처럼 쿠버네티스가 아는 종류만 맞춘다. DB의 primary가 죽었을 때 replica 하나를 승격하고 나머지가 새 primary를 따르게 하는 일은 DB마다 순서가 달라서, 어느 기본 컨트롤러도 하지 않는다. 그 운영 지식을 조정 루프로 만든 것이 오퍼레이터(Operator)다.

- CRD(CustomResourceDefinition): 새 종류(kind)의 이름과 스키마. 등록하면 API 서버가 그 종류의 경로를 열고 객체를 기본 리소스처럼 etcd에 저장한다.
- CR(custom resource): 그 종류의 객체. 사용자가 원하는 상태를 적는다.
- 오퍼레이터: CR을 감시하며 실제 리소스를 CR에 맞추는 커스텀 컨트롤러.

Prometheus Operator는 `Prometheus`라는 종류를 등록하고, 사용자는 아래 CR만 적는다. 오퍼레이터가 이를 보고 replicas 2인 StatefulSet과 설정을 만든다.

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

아래 그림처럼 누군가 그 StatefulSet을 직접 1로 줄여도 다음 조정에서 CR대로 2로 돌아간다. 오퍼레이터가 원하는 상태로 삼는 것은 리소스가 아니라 CR이라서, 바꿀 것은 CR에 적는다.

<figure class="fig" data-figure="k8s-architecture-operator">
  <figcaption>CRD, CR, 오퍼레이터가 맞물려 도는 모습</figcaption>
</figure>

## 정리

- API 서버는 모든 요청을 인증, 인가, 어드미션 순으로 검사하고 상태를 etcd 한곳에 적는다. 구성 요소는 서로 부르지 않고 이 기록을 본다.
- etcd는 과반이 살아야 쓰기를 받는다. 4대는 3대처럼 1대 고장만 견디므로 3, 5처럼 홀수로 둔다.
- 컨트롤러는 list와 watch로 바뀐 것을 받고, 원하는 상태와 실제를 볼 때마다 맞춘다. 이벤트를 놓쳐도 다음 비교에서 따라잡는다.
- 스케줄러는 노드가 빈 파드에 거르기, 점수, 바인딩으로 노드를 적는다. 자리는 실사용이 아니라 request 합으로 잰다.
- kubelet은 자기 노드에 적힌 파드를 CRI로 샌드박스, 이미지, 컨테이너 순으로 띄운다. 노드가 끊기면 기본값으로 6분 가까이 지나야 파드가 옮겨 간다.
- 오퍼레이터는 기본 컨트롤러가 모르는 운영 지식을 CRD로 만든 새 종류의 조정 루프로 돌린다. 바꿀 것은 CR에 적는다.

## 참고

- [Kubernetes — Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/)
- [Kubernetes — Controlling Access to the Kubernetes API](https://kubernetes.io/docs/concepts/security/controlling-access/)
- [Kubernetes — kube-apiserver 명령줄 옵션](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/)
- [Kubernetes — Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)
- [Kubernetes — Consistent Reads from Cache Beta](https://kubernetes.io/blog/2024/08/15/consistent-read-from-cache-beta/)
- [Kubernetes v1.34 — Snapshottable API server cache](https://kubernetes.io/blog/2025/09/09/kubernetes-v1-34-snapshottable-api-server-cache/)
- [Kubernetes — kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/)
- [etcd — Frequently Asked Questions](https://etcd.io/docs/v3.6/faq/)
- [etcd — Tuning](https://etcd.io/docs/v3.6/tuning/)
- [etcd — Maintenance](https://etcd.io/docs/v3.6/op-guide/maintenance/)
- [Kubernetes — Controllers](https://kubernetes.io/docs/concepts/architecture/controller/)
- [Kubernetes — Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes — kube-scheduler 명령줄 옵션](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/)
- [Kubernetes — Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
- [Kubernetes — Scheduling Framework](https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/)
- [Kubernetes — Scheduler Performance Tuning](https://kubernetes.io/docs/concepts/scheduling-eviction/scheduler-perf-tuning/)
- [Kubernetes — Pod Priority and Preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/)
- [Kubernetes — Container Runtime Interface](https://kubernetes.io/docs/concepts/architecture/cri/)
- [cri-api — api.proto](https://github.com/kubernetes/cri-api/blob/master/pkg/apis/runtime/v1/api.proto)
- [kubernetes — pkg/kubelet/config/apiserver.go](https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/config/apiserver.go)
- [Kubernetes — Pods](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Kubernetes — Node Status](https://kubernetes.io/docs/reference/node/node-status/)
- [Kubernetes — Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)
- [Kubernetes — Custom Resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/)
- [Kubernetes — Operator pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/)
- [Prometheus Operator — Design](https://prometheus-operator.dev/docs/getting-started/design/)
- 원글: [K8S 소개](https://kimjanghyun1010.tistory.com/26), [K8S scheduler](https://kimjanghyun1010.tistory.com/27), [K8S Pod](https://kimjanghyun1010.tistory.com/28), [(DeepDive) kubectl get pod 를 했을때?](https://kimjanghyun1010.tistory.com/99), [k8s Operator](https://kimjanghyun1010.tistory.com/24)
