---
title: GPU 클러스터와 Kubeflow
description: 쿠버네티스 파드가 GPU를 받아 쓰기까지 container toolkit, device plugin, GPU 나눠 쓰기, DRA, GPU Operator, Kubeflow Pipelines로 이어지는 층을 따라간다.
date: 2026-11-07 12:00:00 +0900
series: Kubernetes
tags: [gpu, kubernetes, nvidia, kubeflow]
scripts: [figures/gpu-kubeflow.js]
---

## 컨테이너 안의 GPU

쿠버네티스 파드가 GPU를 쓰려면 두 가지가 맞아야 한다. 컨테이너 안에서 GPU가 보여야 하고, 스케줄러가 어느 노드에 GPU가 몇 개 남았는지 알아야 한다. 쿠버네티스는 둘 다 스스로 하지 못해서 컨테이너 런타임과 device plugin이 나눠 맡는다.

리눅스에서 GPU는 드라이버가 만든 장치 파일로 보인다. NVIDIA 드라이버의 커널 모듈은 GPU마다 `/dev/nvidia0`, `/dev/nvidia1`을 만들고, 모든 GPU가 함께 쓰는 제어용 `/dev/nvidiactl`과 메모리 관리용 `/dev/nvidia-uvm`을 둔다. 프로그램은 이 파일을 열어 GPU에 명령을 보낸다.

명령을 만드는 쪽은 사용자 공간의 드라이버 라이브러리(`libcuda.so`, `nvidia-smi`가 쓰는 `libnvidia-ml.so`)이고, 커널 모듈과 버전이 같아야 한다. 드라이버를 올리고 재부팅하지 않으면 메모리에 남은 옛 모듈과 새 라이브러리가 어긋나 `nvidia-smi`가 `Failed to initialize NVML: Driver/library version mismatch`를 낸다.

CUDA 컨테이너 이미지에는 CUDA 런타임(`libcudart`)까지만 있고 `libcuda.so`는 없다. 드라이버는 호스트 커널에 붙어 있어 이미지에 넣으면 노드마다 버전이 어긋나기 때문이다. 그래서 컨테이너는 시작할 때 호스트의 장치 파일과 드라이버 라이브러리를 받아야 하는데, 기본 런타임 runc는 이미지에 있는 것만 넣는다.

`nvidia-container-runtime`(NVIDIA Container Toolkit)은 runc를 감싼 얇은 래퍼로, 컨테이너 명세(OCI spec, `config.json`)에 GPU 장치와 마운트를 더한 뒤 runc를 부른다. 아래 데모에서 런타임을 runc와 nvidia 런타임으로 바꿔 컨테이너를 시작하면 같은 이미지 안에 무엇이 더해지는지 비교할 수 있다.

<figure class="fig" data-figure="gpu-kubeflow-toolkit">
  <figcaption>같은 CUDA 이미지를 runc와 nvidia 런타임으로 시작할 때</figcaption>
</figure>

runc는 이미지에 장치 파일이 없어 GPU를 찾지 못한다. nvidia 런타임은 이미지를 고치지 않고 시작 시점에 파일만 더하고, 라이브러리는 복사하지 않고 호스트 것을 마운트해서 커널 모듈과 버전이 늘 맞는다.

넣을 GPU는 환경 변수 `NVIDIA_VISIBLE_DEVICES`로 고른다.

- `all`: 노드의 GPU 전부. CUDA 기본 이미지에 들어 있는 기본값이다.
- `0,1`이나 GPU UUID: 적은 GPU만.
- 비었거나 없음: runc와 똑같이 동작해 GPU를 넣지 않는다.

넣는 방식은 두 가지다.

- legacy: 명세에 prestart 훅(컨테이너 프로세스가 뜨기 직전에 런타임이 부르는 프로그램)을 넣어, `nvidia-container-cli`가 장치와 라이브러리를 마운트한다.
- CDI(Container Device Interface): GPU마다 필요한 장치 파일과 마운트를 YAML 명세로 적어 두고 런타임이 그대로 반영한다. 장치 이름은 `nvidia.com/gpu=0`, `nvidia.com/gpu=all` 꼴이다.

지금 Toolkit의 기본 모드는 CDI다. 명세 파일이 없으면 컨테이너를 시작할 때 즉석(JIT)으로 만들고, 파일로 둘 때는 `/etc/cdi`나 `/var/run/cdi`에서 읽는다.

```bash
nvidia-ctk cdi generate --output=/var/run/cdi/nvidia.yaml
nvidia-ctk cdi list            # nvidia.com/gpu=0, nvidia.com/gpu=all ...
```

명세 파일은 `nvidia-cdi-refresh` 서비스가 드라이버 업그레이드와 재부팅 때 다시 만들지만, MIG 분할을 바꾼 뒤에는 직접 다시 만든다.

런타임은 `NVIDIA_VISIBLE_DEVICES`에 적힌 GPU를 넣을 뿐, 어느 파드에 어느 GPU를 줄지는 모른다. 스케줄러도 노드에 GPU가 몇 개 있는지 모른다. 이 둘을 잇는 것이 device plugin이다.

## device plugin

쿠버네티스가 처음부터 아는 자원은 CPU와 메모리뿐이다. GPU는 확장 자원(extended resource)으로 들어오고, 이름은 `vendor-domain/resourcetype` 꼴인 `nvidia.com/gpu`다. 노드 정보에 이 이름이 없으면 GPU를 요청한 파드는 `Insufficient nvidia.com/gpu`를 남기고 Pending에 머문다.

device plugin은 노드마다 파드를 하나씩 띄우는 DaemonSet으로 돌고, kubelet과 gRPC(소켓 너머의 함수를 부르는 원격 호출 방식)로 주고받는다.

1. 등록(`Register`): plugin은 `/var/lib/kubelet/device-plugins/` 아래 자기 소켓에서 gRPC 서버를 먼저 띄운 뒤, 같은 폴더의 `kubelet.sock`에 소켓 이름, API 버전, 자원 이름을 보낸다.
2. 보고(`ListAndWatch`): GPU 목록과 GPU마다의 상태를 스트림으로 보내고, 바뀔 때마다 새 목록을 보낸다. kubelet은 개수를 노드의 `capacity`와 `allocatable`에 올린다.
3. 할당(`Allocate`): 파드가 배치되어 컨테이너를 만들 때 kubelet이 고른 GPU ID를 넘긴다. plugin은 컨테이너에 넣을 환경 변수, 마운트, 장치 파일, CDI 장치 이름을 돌려준다.

아래 그림처럼 스케줄러가 아는 것은 노드마다 남은 GPU 개수뿐이고, 몇 번 GPU를 줄지는 노드에 배치된 뒤 정해진다.

<figure class="fig" data-figure="gpu-kubeflow-plugin">
  <figcaption>device plugin의 등록과 보고, 할당</figcaption>
</figure>

NVIDIA plugin은 기본 전략(`DEVICE_LIST_STRATEGY=envvar`)에서 `Allocate`의 답으로 `NVIDIA_VISIBLE_DEVICES=<GPU UUID>`를 돌려준다. 컨테이너가 만들어질 때 앞 절의 nvidia 런타임이 이 값을 읽고 그 GPU만 넣는다. 다른 전략(`volume-mounts`, `cdi-cri` 등)은 같은 GPU 목록을 환경 변수 대신 마운트나 CDI 장치 이름에 실어 보낸다.

kubelet은 재시작할 때 `device-plugins` 폴더의 소켓을 모두 지우고, plugin은 이를 보고 다시 등록한다. GPU가 고장 나 `ListAndWatch`가 Unhealthy로 보고하면 kubelet은 `allocatable`만 줄이고 `capacity`는 그대로 둔다. 이미 그 GPU를 받은 파드는 다른 GPU로 옮겨지지 않고 실패하거나 재시작을 되풀이한다.

확장 자원은 CPU와 적는 규칙이 다르다.

- 정수만 된다. `0.5`나 `500m`은 받지 않는다.
- 넘쳐 쓰기(overcommit)가 없다. request와 limit을 둘 다 적으면 두 값이 같아야 한다.
- `limits`에만 적어도 되고, request는 limit 값으로 채워진다. request만 적을 수는 없다.

```yaml
resources:
  limits:
    nvidia.com/gpu: 1
```

NVIDIA plugin 문서는 GPU를 요청하지 않은 컨테이너에 노드의 GPU가 전부 보일 수 있다고 경고한다. CUDA 이미지의 `NVIDIA_VISIBLE_DEVICES=all`이 남은 채 nvidia 런타임으로 시작하면 `Allocate`가 불리지 않아 이 값을 덮어쓸 쪽이 없다. 스케줄러가 세지 않는 사용이라 다른 파드의 GPU와 겹치므로, GPU를 쓰는 파드는 확인용이라도 `nvidia.com/gpu`를 적는다.

## GPU 나눠 쓰기

CPU는 `500m`처럼 나눠 줄 수 있다. CFS가 100ms 주기마다 시간을 잘라 컨테이너들에 나눠 주기 때문이다([CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %}) 참고). device plugin의 GPU는 정수라서 GPU 하나가 컨테이너 하나에 통째로 간다. 노트북 파드가 GPU를 거의 쓰지 않아도 다른 파드는 그 GPU를 받지 못하고, 이런 GPU는 GPU 지표를 Prometheus 형식으로 내보내는 DCGM exporter의 `DCGM_FI_DEV_GPU_UTIL`(사용률)로 찾는다.

NVIDIA가 내놓은 나누는 방법은 세 가지이고, 무엇까지 떼어 주느냐가 다르다.

### time-slicing

device plugin 설정에서 GPU 하나를 여러 개로 부풀려 알린다.

```yaml
sharing:
  timeSlicing:
    failRequestsGreaterThanOne: true
    resources:
      - name: nvidia.com/gpu
        replicas: 4
```

GPU 1개 노드가 `nvidia.com/gpu: 4`로 보이고, 제품 라벨 끝에 `-SHARED`가 붙어(`A100-SXM4-40GB-SHARED`) nodeSelector로 이런 노드를 고를 수 있다.

GPU는 받은 프로세스들의 작업을 번갈아(interleave) 돌리고, 모든 프로세스에 같은 시간을 준다. 아래 데모에서 모드를 바꿔 실험 넷을 제출하면 통째로 할당과 time-slicing에서 실험이 끝나는 시각을 비교할 수 있다.

<figure class="fig" data-figure="gpu-kubeflow-timeslice">
  <figcaption>실험 넷을 통째로 할당과 time-slicing으로 돌릴 때 (시간은 모양을 보여 주는 대략값)</figcaption>
</figure>

- 통째로 할당: 실험 1은 10분에 끝나고, 실험 4는 30분을 Pending으로 기다려 40분에 끝난다.
- time-slicing: 넷 다 바로 시작하지만 각자 4분의 1 속도로 돌아, 전환 비용까지 더해 42분쯤 함께 끝난다.

통째로 할당에서는 실험이 Pending 줄에서 차례를 기다리고, time-slicing에서는 GPU 안에서 번갈아 돌며 기다린다. 넷이 GPU 하나의 시간을 나눠 가지므로 첫 결과가 10분에서 42분으로 밀린다.

replica 둘을 요청해도 계산 시간을 두 배 받지 않아서, 위 설정의 `failRequestsGreaterThanOne`으로 1개를 넘는 요청을 거절한다. 더 큰 한계는 격리다. replica 사이에 메모리도 장애도 나누지 않아서, 한 파드가 GPU 메모리를 다 쓰면 옆 파드의 할당이 실패한다.

### MIG와 MPS

MIG(Multi-Instance GPU)는 GPU를 하드웨어에서 자른다. A100, H100은 최대 7개 인스턴스로 나뉘고, 인스턴스마다 연산 유닛(SM), 메모리, L2 캐시, 복사 엔진을 따로 받는다. 크기는 정해진 프로필에서만 고른다.

```text
A100 40GB 프로필   SM     메모리   최대 개수
1g.5gb            1/7    5GB      7
2g.10gb           2/7    10GB     3
3g.20gb           3/7    20GB     2
7g.40gb           7/7    40GB     1
```

NVIDIA MIG User Guide의 공개 사양이다.

아래 그림처럼 한 파드가 메모리를 늘릴 때 time-slicing에서는 옆 파드까지 실패하고, MIG에서는 넘친 파드만 자기 인스턴스 안에서 실패한다.

<figure class="fig" data-figure="gpu-kubeflow-mig">
  <figcaption>한 파드가 메모리를 늘릴 때 time-slicing과 MIG</figcaption>
</figure>

대가는 유연성이다. 프로필 크기로만 자르고, 분할을 바꾸려면 그 GPU를 쓰는 파드를 모두 비워야 한다. device plugin의 MIG 전략에 따라 자원 이름도 달라진다.

- `single`: 노드의 GPU를 모두 같은 프로필로 자르고 `nvidia.com/gpu`로 알린다.
- `mixed`: 프로필마다 `nvidia.com/mig-3g.20gb` 같은 이름으로 따로 알린다.

MPS(Multi-Process Service)는 여러 프로세스의 작업을 한 GPU에서 동시에 돌린다. device plugin은 클라이언트마다 메모리를 같은 몫으로 묶고 연산 몫도 제한하지만, 아직 실험 기능이고 MIG를 켠 GPU에는 쓰지 못한다.

- time-slicing: 시간만 번갈아 준다. 메모리와 장애 격리가 없다.
- MPS: 메모리와 연산 몫을 소프트웨어로 나눈다. 실험 기능이다.
- MIG: 연산, 메모리, 캐시를 하드웨어에서 나눈다. 정해진 크기로만 자른다.

셋 다 결과는 자원 이름과 정수 개수다. 스케줄러는 `nvidia.com/gpu: 1`이 T4(16GB)인지 A100(80GB)인지 구분하지 못한다.

## DRA 장치 할당

쿠버네티스 문서는 device plugin이 컨테이너마다 개수로만 요청하고, 장치를 나눠 쓰지 못하고, 속성으로 거르지 못한다고 적는다. 그래서 GPU 메모리 40GB가 필요한 학습이 T4 노드에 배치될 수 있고, 지금까지는 GPU Feature Discovery가 다는 `nvidia.com/gpu.product`, `nvidia.com/gpu.memory` 라벨과 nodeSelector로 피해 왔다.

DRA(Dynamic Resource Allocation)는 PVC(필요한 디스크 조건을 적는 요청 객체)로 스토리지를 요청하듯 장치를 요청한다. 쿠버네티스 1.34에서 `resource.k8s.io`의 핵심 API가 정식(GA)이 됐다.

- DeviceClass: 장치 종류. 드라이버나 관리자가 만든다(`gpu.nvidia.com`).
- ResourceSlice: 드라이버가 노드의 장치와 속성(모델, 메모리)을 올린다.
- ResourceClaim, ResourceClaimTemplate: 파드가 원하는 장치를 CEL 식(쿠버네티스가 조건 검사에 쓰는 짧은 표현식)으로 적는다.

스케줄러는 claim의 조건에 맞는 장치를 ResourceSlice에서 찾아 할당 결과를 ResourceClaim에 적고, 그 장치에 닿는 노드에 파드를 놓는다.

아래 그림처럼 개수로 요청하면 T4와 A100이 똑같이 GPU 1개로 보이고, 속성으로 요청하면 메모리 조건에 맞는 A100 노드만 남는다.

<figure class="fig" data-figure="gpu-kubeflow-dra">
  <figcaption>개수로 요청할 때와 속성으로 요청할 때 스케줄러의 선택</figcaption>
</figure>

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

파드는 `resources.claims`로 이 템플릿을 가리킨다. 같은 ResourceClaim을 여러 컨테이너나 파드가 가리키면 장치 하나를 같이 쓴다.

DRA 자원에는 아직 선점(preemption)이 없다. 우선순위가 높은 파드도 장치가 빌 때까지 Pending으로 기다린다.

## GPU Operator

GPU 노드 하나에 드라이버, toolkit, CDI 명세, device plugin이 서야 하고, 여기에 MIG 분할과 모니터링이 더해진다. 노드마다 손으로 맞추다 순서가 어긋나면 device plugin이 셀 GPU가 없다. GPU Operator는 이 층들을 쿠버네티스 안의 파드로 올리고 `ClusterPolicy` 리소스 하나로 관리한다.

- Node Feature Discovery: NVIDIA PCI 벤더 ID(`10de`)가 보이는 노드에 `pci-10de.present` 라벨을 단다.
- 드라이버 컨테이너: 호스트에 패키지를 깔지 않고 컨테이너에서 커널 모듈을 올린다.
- container toolkit: containerd 설정에 nvidia 런타임과 CDI를 넣는다.
- device plugin, GPU Feature Discovery(모델과 메모리 라벨), DCGM exporter(지표), MIG manager(분할 적용)

아래 그림처럼 새 GPU 노드가 들어오면 라벨이 붙고, 앞 층이 준비된 뒤에야 다음 층이 뜬다.

<figure class="fig" data-figure="gpu-kubeflow-operator">
  <figcaption>새 GPU 노드에 GPU Operator가 층을 올리는 순서</figcaption>
</figure>

층 사이는 Operator의 validator 파드가 확인한다. toolkit이 containerd를 설정하기 전에 GPU 파드가 뜨면 장치 파일이 빠지기 때문이다.

노드에 직접 깐 층은 Operator에서 끈다.

- `driver.enabled=false`: 드라이버를 호스트에 직접 설치한 경우
- `toolkit.enabled=false`: toolkit과 containerd 설정을 직접 한 경우

한 층을 두 곳에서 깔면 버전이 둘이 되어 첫 절의 버전 불일치가 다시 생긴다.

## Kubeflow Pipelines

Kubeflow는 GPU를 직접 다루지 않는다. 노트북, 파이프라인, 학습 작업은 모두 `nvidia.com/gpu`를 요청하는 평범한 파드가 되어 앞 절의 층을 그대로 지난다.

KFP v2 SDK는 파이썬으로 적은 단계(component)를 IR YAML(PipelineSpec)로 컴파일하고, 백엔드가 이를 Argo Workflows(단계마다 파드를 띄우는 쿠버네티스 워크플로 엔진)의 Workflow로 바꿔 실행한다. 단계마다 컨테이너가 따로 뜨고, 단계끼리는 메모리를 나누지 못해 작은 값은 파라미터로, 모델 파일 같은 큰 데이터는 아티팩트로 넘긴다.

GPU는 단계마다 붙인다. `set_accelerator_limit`은 음이 아닌 정수만 받아, device plugin의 정수 규칙이 그대로 이어진다.

```python
from kfp import dsl

@dsl.pipeline
def train_pipeline():
    data = prepare()                      # CPU 단계
    model = train(data=data.output)
    model.set_accelerator_type("nvidia.com/gpu").set_accelerator_limit(1)
    evaluate(model=model.output)          # CPU 단계
```

아래 그림처럼 노트북은 열려 있는 동안 GPU를 쥐고, 파이프라인은 학습 단계의 파드가 도는 동안만 쥔다.

<figure class="fig" data-figure="gpu-kubeflow-pipeline">
  <figcaption>하루 동안 노트북과 파이프라인이 GPU를 쥐는 시간 (시간은 대략값)</figcaption>
</figure>

학습 단계 파드가 끝나면 GPU는 다른 파드에 돌아간다. 캐시도 GPU를 아낀다. 입력과 코드가 같은 단계가 이미 성공했다면 KFP가 앞선 결과를 쓰고 그 단계의 파드를 띄우지 않으며, 다시 돌려야 할 때는 `set_caching_options(False)`로 끈다.

노트북은 time-slicing GPU에 두고, 오래 걸리는 학습은 파이프라인 단계로 넘겨 GPU 통째나 MIG 조각으로 받는다.

## 정리

- 컨테이너는 장치 파일과 호스트 드라이버 라이브러리가 있어야 GPU를 본다. nvidia 런타임이 `NVIDIA_VISIBLE_DEVICES`의 GPU만 넣는다.
- device plugin은 GPU 개수를 노드에 올리고 `Allocate`로 고른 GPU를 런타임에 전한다. GPU는 정수이고 넘쳐 쓰지 않는다.
- 정수라서 GPU는 통째로 간다. time-slicing은 시간만, MPS는 메모리 몫까지, MIG는 하드웨어를 나눈다.
- 개수로는 GPU 종류를 가리지 못한다. DRA는 장치를 속성으로 요청한다.
- GPU Operator는 이 층들을 순서대로 파드로 올린다. 직접 깐 층은 끈다.
- Kubeflow Pipelines는 단계마다 파드를 띄워 학습 단계만 GPU를 쥔다.

## 참고

- [Kubernetes — Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [Kubernetes — Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [Kubernetes — Dynamic Resource Allocation](https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/)
- [Kubernetes — How DRA Works](https://kubernetes.io/docs/concepts/resource-management/dynamic-resource-allocation/how-dra-works/)
- [Kubernetes v1.34: DRA has graduated to GA](https://kubernetes.io/blog/2025/09/01/kubernetes-v1-34-dra-updates/)
- [NVIDIA Container Toolkit — Architecture Overview](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/arch-overview.html)
- [NVIDIA Container Toolkit — Support for Container Device Interface](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/cdi-support.html)
- [NVIDIA Container Toolkit — Release Notes (1.18.0 기본 모드 변경)](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/1.19.1/release-notes.html)
- [NVIDIA Container Toolkit — Specialized Configurations with Docker (NVIDIA_VISIBLE_DEVICES)](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/docker-specialized.html)
- [NVIDIA k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)
- [NVIDIA GPU Operator — Time-Slicing GPUs in Kubernetes](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-sharing.html)
- [NVIDIA MIG User Guide — Supported MIG Profiles](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/supported-mig-profiles.html)
- [Kubeflow — IR YAML](https://www.kubeflow.org/docs/components/pipelines/concepts/ir-yaml/)
- [Kubeflow — Pipelines Components](https://www.kubeflow.org/docs/components/pipelines/concepts/component/)
- [KFP SDK — kfp.dsl (PipelineTask)](https://kubeflow-pipelines.readthedocs.io/en/stable/source/dsl.html)
- 원글: [Kubeflow(v1.1, v1.2) install (CentOS 7)](https://kimjanghyun1010.tistory.com/20), [k3s gpu containerd 설정 kubeflow 구축](https://kimjanghyun1010.tistory.com/75), [k3s Install](https://kimjanghyun1010.tistory.com/25)
