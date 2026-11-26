---
title: GPU 클러스터와 Kubeflow
description: 쿠버네티스가 GPU를 알아보게 하는 층부터 GPU를 나눠 쓰는 방법, 그 위에 Kubeflow가 얹는 것까지 정리했다.
date: 2026-11-07 12:00:00 +0900
series: Kubernetes
tags: [gpu, kubernetes, nvidia, kubeflow, k3s]
scripts: [figures/gpu-kubeflow.js]
---

## GPU 요청 경로

GPU가 꽂힌 서버에 쿠버네티스를 올리고 파드에 GPU 하나를 적었다. 파드는 Pending에서 움직이지 않고, `kubectl describe`에는 `Insufficient nvidia.com/gpu`가 찍힌다.

```yaml
resources:
  limits:
    nvidia.com/gpu: 1
```

쿠버네티스가 처음부터 아는 자원은 CPU와 메모리뿐이다. `nvidia.com/gpu`는 누군가 노드에 GPU가 몇 개 있는지 알려 줘야 생기는 이름이고, 알려 주려면 그 아래 층이 먼저 서 있어야 한다.

- 드라이버: 리눅스 커널이 GPU를 장치로 다루게 한다.
- container toolkit: 컨테이너가 시작될 때 GPU 장치 파일과 드라이버 라이브러리를 넣어 준다.
- device plugin: kubelet에 GPU 개수를 알리고, 파드에 어느 GPU를 줄지 고른다.

아래 그림은 이 세 층을 아래에서부터 쌓는다. 층이 하나씩 올라올 때 파드가 어디까지 내려가는지 본다.

<figure class="fig" data-figure="gpu-kubeflow-layers">
  <figcaption>파드의 GPU 요청이 실제 GPU에 닿기까지 거치는 층</figcaption>
</figure>

device plugin이 올라오기 전까지 파드는 스케줄러에서 멈춘다. 스케줄러는 노드 정보에 적힌 숫자만 보기 때문에, 드라이버와 toolkit이 멀쩡해도 plugin이 개수를 알리지 않으면 GPU 노드를 찾지 못한다.

층은 아래가 위를 받친다. 막히면 아래 층부터 하나씩 확인한다.

```bash
nvidia-smi                                   # 노드에서: 드라이버
kubectl get nodes -o custom-columns=NAME:.metadata.name,GPU:.status.allocatable.nvidia\\.com/gpu   # device plugin
kubectl exec gpu-test -- nvidia-smi          # 파드 안에서: toolkit
```

## 노드 준비

### 드라이버

`lspci`에는 GPU가 보이는데 `nvidia-smi`는 명령을 찾지 못한다. 커널이 GPU를 PCIe 장치로 알아보기만 하고 다룰 줄은 모르는 상태다.

NVIDIA 드라이버는 두 부분으로 되어 있다.

- 커널 모듈(`nvidia.ko` 등): GPU를 `/dev/nvidia0` 같은 장치 파일로 열고, GPU 메모리와 작업 제출을 맡는다.
- 사용자 공간 라이브러리(`libcuda.so`, `libnvidia-ml.so`): CUDA 앱과 `nvidia-smi`가 부르는 라이브러리다. 커널 모듈과 버전이 같아야 한다.

CUDA 앱이 GPU에 계산을 맡기면 요청은 라이브러리, 장치 파일, 커널 모듈을 차례로 지나 GPU에 닿는다. 드라이버가 없을 때와 있을 때 요청이 어디서 멈추는지 견줘 보자.

<figure class="fig" data-figure="gpu-kubeflow-driver">
  <figcaption>CUDA 앱의 요청이 GPU까지 가는 길</figcaption>
</figure>

드라이버는 호스트 커널에 붙는다. 컨테이너 이미지에는 CUDA 런타임 라이브러리가 들어 있어도 드라이버는 들어 있지 않아서, 드라이버는 노드에 한 번 설치한다.

```bash
ubuntu-drivers devices                          # 이 GPU에 권장되는 드라이버 확인
sudo apt-get install -y nvidia-driver-<버전>
sudo reboot
```

드라이버를 바꾼 뒤 재부팅하지 않으면, 메모리에 남은 옛 커널 모듈과 새 라이브러리의 버전이 어긋나 `nvidia-smi`가 `Driver/library version mismatch`를 낸다. 설치와 업데이트 뒤에는 재부팅하고 `nvidia-smi`부터 확인한다.

### container toolkit

노드에서는 `nvidia-smi`가 잘 도는데, 같은 노드에서 띄운 컨테이너 안에서는 GPU가 없다고 나온다. 컨테이너는 따로 떨어진 파일시스템과 장치 목록으로 시작하고, 기본 런타임 runc는 GPU 장치 파일을 넣어 주지 않는다.

NVIDIA Container Toolkit은 컨테이너가 시작될 때 두 가지를 넣는다.

- 장치 파일: `/dev/nvidia0`, `/dev/nvidiactl`, `/dev/nvidia-uvm`
- 호스트의 드라이버 라이브러리: `libcuda.so`, `nvidia-smi` 등. 이미지에 넣지 않고 호스트 것을 마운트하므로 커널 모듈과 버전이 늘 맞는다.

모드를 바꿔 가며 컨테이너를 시작해 보자. 같은 CUDA 이미지인데 컨테이너 안에 무엇이 들어가는지 본다.

<figure class="fig" data-figure="gpu-kubeflow-toolkit">
  <figcaption>같은 이미지를 runc와 nvidia 런타임으로 시작할 때</figcaption>
</figure>

runc로 시작하면 이미지에 CUDA가 있어도 장치 파일이 없어 GPU를 찾지 못한다. nvidia 런타임은 같은 이미지에 장치 파일과 호스트 라이브러리만 더한다. 이미지는 그대로이고, 바뀌는 건 시작할 때 넣어 주는 파일뿐이다.

넣는 방식은 두 가지다.

- nvidia 런타임: containerd에 `nvidia`라는 런타임을 등록한다. 파드는 `runtimeClassName: nvidia`로 고르거나, 기본 런타임으로 둔다.
- CDI(Container Device Interface): 장치 파일과 마운트 목록을 명세 파일로 만들어 두고 containerd가 직접 읽는다. GPU Operator는 v25.10부터 CDI를 기본으로 켠다.

containerd에 직접 붙일 때는 `nvidia-ctk`가 설정을 써 준다.

```bash
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=containerd   # /etc/containerd/conf.d/99-nvidia.toml 생성
sudo systemctl restart containerd
```

containerd 설정 파일의 위치는 배포판마다 다르다. k3s와 rke2는 설정 파일을 스스로 다시 만들어서 이 명령만으로는 남지 않는다.

### device plugin

컨테이너 안에서 GPU가 보여도 스케줄러는 아직 그 노드에 GPU가 있는지 모른다. 노드 정보의 `allocatable`에 `nvidia.com/gpu`가 없으면 GPU를 요청한 파드는 어느 노드에도 배치되지 못한다.

device plugin은 노드마다 하나씩 도는 DaemonSet이고, kubelet과 gRPC로 주고받는다.

1. 등록: kubelet의 소켓에 `nvidia.com/gpu`라는 자원 이름으로 자신을 등록한다.
2. 보고: 노드의 GPU 목록과 상태를 kubelet에 계속 보낸다. kubelet은 개수를 노드의 `allocatable`에 올린다.
3. 할당: 파드가 이 노드에 배치되면 kubelet이 GPU를 달라고 하고, plugin이 어느 GPU를 줄지 골라 컨테이너에 넣을 장치 정보를 돌려준다.

두 장면에서 스케줄러가 받는 정보와 plugin이 고르는 GPU를 나눠 보자.

<figure class="fig" data-figure="gpu-kubeflow-plugin">
  <figcaption>device plugin의 등록, 보고, 할당</figcaption>
</figure>

스케줄러가 아는 건 노드마다 남은 GPU 개수뿐이다. 몇 번 GPU를 줄지는 노드에 배치된 뒤 plugin이 정한다.

GPU 같은 확장 자원(extended resource)은 CPU와 적는 규칙이 다르다.

- `limits`에만 적어도 된다. request는 limit과 같은 값으로 채워진다.
- request와 limit을 둘 다 적으면 두 값이 같아야 한다. 넘쳐 쓰기(overcommit)가 없다.
- 정수만 된다. `0.5`나 `500m`은 API 서버가 받지 않는다.

GPU를 요청하지 않은 컨테이너에서도 GPU가 보일 때가 있다. device plugin 문서는 GPU를 요청하지 않으면 노드의 GPU가 전부 컨테이너에 보일 수 있다고 경고한다. 스케줄러가 세지 않는 사용이라 다른 파드와 GPU를 겹쳐 쓰게 되므로, GPU를 쓰는 파드는 확인용 파드라도 `nvidia.com/gpu`를 적는다.

## GPU Operator

GPU 노드가 열 대로 늘면 드라이버, toolkit, device plugin을 노드마다 깔고 버전을 맞추는 일이 따로 생긴다. GPU Operator는 이 층들을 쿠버네티스 안의 파드로 올려 관리한다.

- Node Feature Discovery: 노드의 PCI 장치를 보고 NVIDIA GPU가 있는 노드에 라벨을 단다.
- 드라이버 컨테이너: 호스트에 패키지를 깔지 않고 컨테이너에서 커널 모듈을 올린다.
- container toolkit: containerd 설정에 nvidia 런타임이나 CDI를 넣는다.
- device plugin: 앞 절의 그 plugin이다.
- GPU Feature Discovery: GPU 모델과 메모리 크기를 노드 라벨로 단다.
- DCGM exporter: GPU 사용률과 메모리를 Prometheus 지표로 낸다.
- MIG manager: MIG 분할 설정을 노드에 적용한다.

GPU 노드 하나가 클러스터에 들어온 순간부터 지켜보자. 라벨이 붙은 뒤 층이 어떤 순서로 올라오는지 본다.

<figure class="fig" data-figure="gpu-kubeflow-operator">
  <figcaption>새 GPU 노드에 GPU Operator가 층을 올리는 순서</figcaption>
</figure>

Operator는 앞 층이 준비됐는지 검사한 뒤 다음 층을 띄운다. 드라이버가 올라오기 전에 device plugin이 뜨면 셀 GPU가 없기 때문이다. 노드를 추가하면 라벨부터 device plugin까지 사람이 손대지 않고 채워진다.

```bash
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia && helm repo update
helm install --wait gpu-operator nvidia/gpu-operator -n gpu-operator --create-namespace
```

드라이버나 toolkit을 노드에 직접 깔았다면 그 층만 끈다.

- `driver.enabled=false`: 드라이버를 호스트에 설치한 경우
- `toolkit.enabled=false`: toolkit과 containerd 설정을 직접 한 경우

2026년 11월 기준 최신은 v26.7 계열이고, v26.7부터 containerd 2.0 이상을 요구한다. 노드에 직접 깐 층과 Operator가 깐 층이 겹치면 버전이 둘이 되니, 층마다 누가 맡을지 하나로 정한다.

## GPU 나눠 쓰기

### 통째로 할당

CPU는 `500m`처럼 잘게 나눠 줄 수 있다. CFS가 100ms 주기마다 시간을 잘라 컨테이너들에 나눠 주기 때문이다([CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %}) 참고). GPU에는 이런 기본 장치가 없다. device plugin은 GPU를 개수로만 세고, GPU 하나는 컨테이너 하나에 통째로 간다.

두 장면에서 같은 파드 둘이 CPU와 GPU를 받는 모습을 견줘 보자.

<figure class="fig" data-figure="gpu-kubeflow-whole">
  <figcaption>CPU는 시간을 나눠 주고, GPU는 장치를 통째로 준다</figcaption>
</figure>

노트북 파드는 사람이 코드를 고치는 동안 GPU를 거의 쓰지 않는다. 그래도 GPU는 그 파드 몫이라, GPU가 85% 놀고 있어도 다른 파드는 Pending으로 기다린다.

GPU 서버에서는 GPU가 가장 비싼 부품이라 노는 시간이 곧 비용이다. DCGM exporter의 `DCGM_FI_DEV_GPU_UTIL`로 파드별 사용률을 보고, 오래 노는 GPU를 쥔 파드부터 찾는다.

### time-slicing

연구원 넷이 GPU 하나로 작은 실험을 돌리려 한다. time-slicing은 GPU 하나를 여러 개인 것처럼 알린다. device plugin 설정에 `replicas: 4`를 주면 GPU 1개 노드가 `nvidia.com/gpu: 4`로 보인다.

```yaml
sharing:
  timeSlicing:
    resources:
      - name: nvidia.com/gpu
        replicas: 4
```

GPU는 받은 프로세스들에게 시간을 번갈아 똑같이 준다. CPU의 request처럼 몫을 정하는 값은 없다.

모드를 바꿔 가며 실험 넷을 한꺼번에 제출해 보자. 각 실험이 언제 시작하고 언제 끝나는지 본다.

<figure class="fig" data-figure="gpu-kubeflow-timeslice">
  <figcaption>실험 넷을 통째로 할당과 time-slicing으로 돌릴 때 (시간은 모양을 보여 주는 대략값)</figcaption>
</figure>

- 통째로 할당: 실험 1은 10분에 끝나고, 실험 4는 30분을 Pending으로 기다린 뒤 40분에 끝난다.
- time-slicing: 넷 다 바로 시작하지만 각자 4분의 1 속도로 돌아, 전환 비용까지 더해 42분쯤 함께 끝난다.

GPU가 하는 일의 총량은 같다. 기다리는 자리가 Pending 줄에서 GPU 안으로 옮겨질 뿐이라, 첫 결과는 오히려 늦게 나온다.

replicas를 둘 요청한다고 두 배 빨라지지도 않는다. NVIDIA 문서도 GPU 2개를 요청한 파드가 1개 요청한 파드보다 계산 시간을 두 배 받지 않는다고 적어 두었다. 그래서 `failRequestsGreaterThanOne: true`로 1개 넘는 요청을 막아 두는 편이 낫다.

time-slicing에는 메모리와 장애 격리가 없다. 한 실험이 GPU 메모리를 다 쓰면 옆 실험이 메모리 부족으로 죽는다. time-slicing은 노트북이나 추론 테스트처럼 GPU를 띄엄띄엄 쓰는 일에 쓰고, 오래 도는 학습에는 GPU를 통째로 준다.

### MIG

time-slicing으로 나눈 GPU에서 한 팀의 추론 서버가 메모리를 늘리자 다른 팀의 서버가 함께 죽었다. MIG(Multi-Instance GPU)는 GPU를 하드웨어에서 잘라 이런 번짐을 막는다.

A100, H100 같은 Ampere 이후 데이터센터 GPU는 GPU 하나를 최대 7개 인스턴스로 자른다. 인스턴스마다 연산 유닛(SM), L2 캐시, 메모리 경로를 따로 받는다. 조각 크기는 정해진 프로필에서 고른다.

```text
A100 40GB 프로필    1g.5gb (최대 7개), 2g.10gb (3개), 3g.20gb (2개), 4g.20gb (1개), 7g.40gb (1개)
3g.20gb            연산 7칸 중 3칸, 메모리 20GB
```

time-slicing과 MIG에서 한 파드가 메모리를 늘릴 때 옆 파드가 어떻게 되는지 견줘 보자.

<figure class="fig" data-figure="gpu-kubeflow-mig">
  <figcaption>한 파드가 메모리를 늘릴 때 time-slicing과 MIG</figcaption>
</figure>

time-slicing에서는 메모리를 다 같이 써서 한 파드가 넘치면 옆 파드가 실패한다. MIG에서는 벽이 하드웨어에 있어 넘친 파드만 자기 인스턴스 안에서 실패한다.

대신 MIG 조각은 정해진 크기로만 자르고, 다시 자르려면 그 GPU를 쓰는 파드를 모두 비워야 한다. GPU Operator에서는 노드 라벨로 분할을 고르고, 파드는 조각 이름을 자원으로 요청한다.

```bash
kubectl label node gpu-node-1 nvidia.com/mig.config=all-balanced --overwrite
```

```yaml
resources:
  limits:
    nvidia.com/mig-3g.20gb: 1     # mixed 전략일 때의 자원 이름
```

여러 팀이 같이 쓰는 GPU나 서로 영향이 없어야 하는 추론 서버는 MIG로 나누고, 격리가 필요 없는 가벼운 실험은 time-slicing으로 나눈다. device plugin은 MPS(Multi-Process Service)로 나누는 방법도 지원하지만 아직 실험 단계다.

## DRA 장치 할당

GPU 노드에 T4(16GB)와 A100(80GB)이 섞여 있다. `nvidia.com/gpu: 1`은 개수만 말해서, GPU 메모리 40GB가 필요한 학습이 T4 노드에 배치될 수 있다. 지금까지는 GPU Feature Discovery 라벨과 nodeSelector로 피해 왔다.

DRA(Dynamic Resource Allocation)는 장치를 개수가 아니라 속성으로 요청한다. 쿠버네티스 1.34에서 정식 기능(GA, `resource.k8s.io/v1`)이 됐다.

- 장치 드라이버가 노드의 장치와 속성(모델, 메모리)을 ResourceSlice로 올린다.
- 파드는 ResourceClaim에 원하는 조건을 CEL 식으로 적는다.
- 스케줄러가 조건에 맞는 장치가 있는 노드를 고른다.

두 장면에서 같은 학습 파드가 어느 노드로 가는지 견줘 보자.

<figure class="fig" data-figure="gpu-kubeflow-dra">
  <figcaption>개수로 요청할 때와 속성으로 요청할 때 스케줄러의 선택</figcaption>
</figure>

개수로만 요청하면 스케줄러 눈에는 T4도 A100도 똑같이 GPU 1개다. 속성으로 요청하면 스케줄러가 메모리 조건을 보고 A100 노드만 고른다.

```yaml
apiVersion: resource.k8s.io/v1
kind: ResourceClaimTemplate
metadata:
  name: big-gpu
spec:
  spec:
    devices:
      requests:
      - name: gpu
        exactly:
          deviceClassName: gpu.nvidia.com
          selectors:
          - cel:
              expression: device.capacity['gpu.nvidia.com'].memory.isGreaterThan(quantity("40Gi"))
```

파드는 `resources.claims`로 이 템플릿을 가리킨다. 같은 claim을 여러 컨테이너가 가리키면 장치 하나를 같이 쓸 수도 있다.

NVIDIA는 GPU용 DRA 드라이버를 쿠버네티스 SIG로 넘겼고, GPU Operator v26.7은 이 드라이버를 띄우는 `GPUCluster` 리소스를 새로 냈다. 지금 시점의 조건은 이렇다.

- 쿠버네티스 1.34.2 이상, NVIDIA 드라이버 580 이상, CDI를 쓰는 런타임
- GPU 통째로 할당과 기존 MIG 할당은 정식, GPU 나눠 쓰기(`ConsumableShares`, `DynamicMIG`, MPS)는 알파
- 기존 device plugin 방식(`ClusterPolicy`)과 한 클러스터에 같이 쓰지 못하고, 제자리 전환도 안 된다

새로 짓는 클러스터는 DRA부터 검토하고, 지금 도는 device plugin 클러스터는 라벨과 nodeSelector로 버티다 새 클러스터로 옮긴다.

## 경량 배포판의 containerd 설정

k3s에서 containerd 설정 파일에 nvidia 런타임을 적고 재시작했더니, 적은 내용이 사라져 있다. k3s와 rke2는 containerd를 직접 띄우고, 시작할 때마다 `config.toml`을 새로 만든다. 파일 맨 위에도 그렇게 적혀 있다.

```toml
# File generated by k3s. DO NOT EDIT. Use config.toml.tmpl instead.
```

고친 내용을 남기려면 같은 폴더에 템플릿을 둔다. k3s는 템플릿이 있으면 그것으로 `config.toml`을 만든다.

- containerd 2.0 (k3s v1.31.6, v1.32.2 이후 2025년 2월 릴리스부터): `config-v3.toml.tmpl`
- containerd 1.7 이하: `config.toml.tmpl`
- 폴더: k3s는 `/var/lib/rancher/k3s/agent/etc/containerd/`, rke2는 `/var/lib/rancher/rke2/agent/etc/containerd/`

모드를 바꿔 가며 k3s를 재시작해 보자. 재시작 뒤 `config.toml`에 무엇이 남는지 본다.

<figure class="fig" data-figure="gpu-kubeflow-k3s">
  <figcaption>config.toml을 직접 고칠 때와 템플릿을 둘 때 k3s 재시작</figcaption>
</figure>

직접 고친 줄은 재시작하면 지워진다. 그런데 nvidia 런타임 항목은 두 모드 모두에서 다시 생긴다. k3s는 시작할 때 `nvidia-container-runtime`이 설치돼 있으면 nvidia 런타임을 스스로 containerd 설정에 넣고, `nvidia` RuntimeClass도 함께 둔다.

그래서 k3s에서는 nvidia 런타임을 직접 적을 필요가 없다. 노드에 toolkit을 깔고 k3s를 재시작한 뒤 파드에서 고르면 된다.

```bash
sudo systemctl restart k3s
grep nvidia /var/lib/rancher/k3s/agent/etc/containerd/config.toml   # 자동으로 들어간 항목 확인
```

```yaml
spec:
  runtimeClassName: nvidia          # 또는 k3s를 --default-runtime nvidia로 띄운다
```

rke2도 PATH에서 대체 런타임을 찾아 넣는다. GPU Operator를 쓰면 toolkit이 containerd를 다시 읽게 하는데, 두 배포판의 containerd 소켓이 표준 위치가 아니라서 그 값을 알려 줘야 한다. rke2 문서의 값은 이렇다.

```yaml
toolkit:
  env:
    - name: CONTAINERD_SOCKET
      value: /run/k3s/containerd/containerd.sock
```

Operator의 toolkit이 containerd를 다시 읽게 할 때 rke2 프로세스도 함께 재시작된다. 운영 중인 노드에 처음 설치할 때는 그 노드의 파드가 잠깐 흔들릴 수 있다는 것을 먼저 알고 들어간다.

## Kubeflow

### Kubeflow 구성

연구원 열 명이 GPU 노드를 같이 쓴다. 사람마다 YAML을 손으로 써서 파드를 띄우게 할 수는 없어서, Kubeflow는 머신러닝 작업을 쿠버네티스 리소스로 만드는 도구를 묶어 둔다.

- Notebooks: 브라우저에서 GPU 붙은 Jupyter 환경을 띄운다. 26.10부터 Notebooks v2(Workspaces)가 기본이다.
- Pipelines: 데이터 준비, 학습, 평가를 단계로 묶어 단계마다 파드로 돌린다. 실행은 Argo Workflows가 맡는다.
- Trainer: 분산 학습 작업(TrainJob)을 받아 학습 파드 여러 개를 함께 띄운다.
- Katib, KServe, Kubeflow Hub: 하이퍼파라미터 탐색, 모델 서빙, 모델 레지스트리

Kubeflow는 앞의 층 위에 얹힌다. 세 장면에서 각 기능이 마지막에 무엇을 만드는지 따라가 보자.

<figure class="fig" data-figure="gpu-kubeflow-kubeflow">
  <figcaption>Kubeflow의 세 기능이 GPU 파드를 만드는 길</figcaption>
</figure>

노트북, 파이프라인 단계, 학습 작업은 모두 끝에 가서 `nvidia.com/gpu`를 요청하는 평범한 파드가 된다. Kubeflow가 GPU를 직접 다루지는 않아서, 노트북에서 GPU가 안 보이면 Kubeflow가 아니라 앞의 층부터 본다.

### 노트북과 파이프라인

같은 GPU를 노트북으로 쓸 때와 파이프라인으로 쓸 때 GPU를 쥐는 시간이 다르다. 노트북은 사람이 열어 둔 동안 GPU를 계속 쥐고, 파이프라인은 GPU가 필요한 단계에서만 쥔다.

두 장면에서 GPU 레인이 차는 모양을 견줘 보자.

<figure class="fig" data-figure="gpu-kubeflow-pipeline">
  <figcaption>하루 동안 노트북과 파이프라인이 GPU를 쥐는 시간 (시간은 대략값)</figcaption>
</figure>

노트북은 학습을 돌리는 두어 시간 말고는 GPU를 쥔 채 놀린다. 파이프라인은 데이터 준비와 평가를 CPU 파드로 돌리고 학습 단계에서만 GPU 파드를 띄워서, 나머지 시간에는 다른 사람이 그 GPU를 받는다.

```python
from kfp import dsl

@dsl.pipeline
def train_pipeline():
    data = prepare()                      # CPU 단계
    model = train(data=data.output)
    model.set_accelerator_type("nvidia.com/gpu").set_accelerator_limit(1)
    evaluate(model=model.output)          # CPU 단계
```

`kfp` 2.x에서는 단계마다 `set_accelerator_type`과 `set_accelerator_limit`으로 GPU를 붙인다. 원글에서 쓴 kfp 1.x의 `dsl-compile`은 지금 쓰지 않고, KFP v1 지원은 27.03에서 빠질 예정이다.

원글에서는 파이프라인 단계가 docker 컨테이너를 찾지 못해 Argo executor를 `pns`로 바꿔야 했다. 지금 Argo Workflows의 executor는 docker 소켓에 기대지 않는 `emissary` 하나만 남아서 이 설정은 필요 없다.

실험은 노트북에서 작게 확인하고, 오래 걸리는 학습은 파이프라인이나 TrainJob으로 넘긴다. 노트북은 time-slicing GPU에 두고 학습은 통째로 받는 식으로 나누면 GPU가 덜 논다.

### Kubeflow 설치

`kustomize build | kubectl apply`를 처음 돌리면 같은 오류가 몇 번 찍히다가 어느 순간 끝난다. 원글에서도 "중간에 5번 정도 같은 에러가 나는데 무시해도 된다"고 적었던 현상이다.

Kubeflow는 CRD(사용자 정의 리소스 정의)와 그 CRD로 만든 리소스를 한 번에 적용한다. CRD가 API 서버에 등록되기 전에 그 종류의 리소스가 먼저 도착하면 `no matches for kind`로 실패하고, 다시 적용하면 그사이 등록된 CRD 덕분에 넘어간다.

<figure class="fig" data-figure="gpu-kubeflow-install">
  <figcaption>재시도 세 번 만에 끝나는 Kubeflow 설치 (시간은 대략값)</figcaption>
</figure>

공식 저장소도 이 재시도를 설치 명령에 넣어 두었다. 원글은 CentOS 7에서 kfctl로 설치했지만, CentOS 7은 2024년 6월 30일에 지원이 끝났고 지금 설치 방식에는 kfctl이 없다.

```bash
git clone -b 26.10.0 https://github.com/kubeflow/community-distribution.git && cd community-distribution
while ! kustomize build example | kubectl apply --server-side --force-conflicts -f -; do
  echo "Retrying to apply resources"; sleep 20
done
```

- 저장소: 예전 `kubeflow/manifests`가 `kubeflow/community-distribution`으로 바뀌었다. 2026년 11월 기준 최신은 26.10.0이다.
- 버전 이름: 1.11까지는 1.x였고, 26.03부터 연도.월로 1년에 두 번 낸다. 커뮤니티 지원은 약 6개월이다.
- 자원: 권장 메모리 16GB, CPU 8코어. `example/kustomization.yaml`에서 안 쓰는 구성 요소를 빼면 4~8GB에서도 돈다.
- 기본 로그인: `user@example.com`, `12341234`. 외부에 열기 전에 바꾼다.

파드가 많이 뜨는 만큼 inotify 한도에 걸려 파드가 `too many open files`로 죽기도 한다. 공식 README가 권하는 값은 이렇다.

```bash
sudo sysctl fs.inotify.max_user_instances=2280
sudo sysctl fs.inotify.max_user_watches=1255360
```

설치가 끝나면 `kubectl get pods -A`에서 Running이 아닌 파드부터 보고, 화면은 `istio-ingressgateway`를 port-forward로 열어 확인한다.

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| 드라이버 | 커널이 GPU를 장치로 다루게 한다 | 호스트에 설치한다. 바꾼 뒤엔 재부팅 |
| container toolkit | 컨테이너에 장치 파일과 호스트 라이브러리를 넣는다 | nvidia 런타임 또는 CDI. 이미지는 그대로 |
| device plugin | GPU 개수를 kubelet에 알리고 할당한다 | 스케줄러는 개수만 본다. 정수, limit에 적는다 |
| GPU Operator | 위 층들을 파드로 올려 관리한다 | 직접 깐 층은 끈다. v26.7은 containerd 2.0 이상 |
| 통째로 할당 | GPU 하나를 컨테이너 하나에 준다 | 노는 GPU도 남이 못 쓴다. 사용률을 본다 |
| time-slicing | GPU 하나를 여러 개로 알리고 시간을 번갈아 준다 | 총량은 같다. 메모리 격리 없음 |
| MIG | GPU를 하드웨어에서 최대 7조각으로 자른다 | 격리된다. 프로필 크기로만 자른다 |
| DRA | 장치를 속성으로 요청한다 | 1.34 GA. GPU Operator에서는 ClusterPolicy와 택일 |
| k3s, rke2 | containerd 설정을 매번 새로 만든다 | 템플릿을 쓴다. nvidia 런타임은 자동 감지 |
| Kubeflow | 노트북, 파이프라인, 학습 작업을 파드로 만든다 | GPU 문제는 아래 층부터. 설치는 재시도로 |

## 참고

- [Kubernetes — Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [Kubernetes — Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [Kubernetes — Resource Management for Pods and Containers, Extended resources](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#extended-resources)
- [Kubernetes — Dynamic Resource Allocation](https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/)
- [Kubernetes v1.34: DRA has graduated to GA](https://kubernetes.io/blog/2025/09/01/kubernetes-v1-34-dra-updates/)
- [NVIDIA Container Toolkit — Installing the NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- [NVIDIA k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)
- [NVIDIA GPU Operator — Getting Started](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/getting-started.html)
- [NVIDIA GPU Operator — Release Notes](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/release-notes.html)
- [NVIDIA GPU Operator — Time-Slicing GPUs in Kubernetes](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-sharing.html)
- [NVIDIA GPU Operator — DRA Driver for NVIDIA GPUs](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/dra-intro-install.html)
- [NVIDIA MIG User Guide — Supported MIG Profiles](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/supported-mig-profiles.html)
- [DRA Driver for NVIDIA GPUs — Allocating GPUs](https://dra-driver-nvidia-gpu.sigs.k8s.io/docs/guides/gpu-allocation/allocating-gpus/)
- [K3s — Advanced Options, Alternative Container Runtime Support](https://docs.k3s.io/advanced#alternative-container-runtime-support)
- [RKE2 — NVIDIA GPU Operator](https://docs.rke2.io/add-ons/gpu_operators)
- [Kubeflow Community Distribution 26.10.0](https://github.com/kubeflow/community-distribution/releases/tag/26.10.0)
- [Kubeflow Community Distribution README](https://github.com/kubeflow/community-distribution)
- [Kubeflow — Releases](https://www.kubeflow.org/docs/releases/)
- [Argo Workflows — Workflow Executors](https://argo-workflows.readthedocs.io/en/latest/workflow-executors/)
- [Red Hat — CentOS Linux EOL](https://www.redhat.com/en/topics/linux/centos-linux-eol)
- 원글: [Kubeflow(v1.1, v1.2) install (CentOS 7)](https://kimjanghyun1010.tistory.com/20), [k3s gpu containerd 설정 kubeflow 구축](https://kimjanghyun1010.tistory.com/75), [k3s Install](https://kimjanghyun1010.tistory.com/25)
