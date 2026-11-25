---
title: 컨테이너 이해하기
description: 하이퍼바이저 VM과 컨테이너의 차이부터 namespace, cgroup, 이미지 레이어와 overlayfs, 볼륨, 파드까지 정리했다.
date: 2026-10-27 12:00:00 +0900
series: Back to the Basic
tags: [container, docker, linux, namespace, cgroup, overlayfs]
scripts: [figures/container.js]
---

## 가상화 방식

API 서버와 배치 작업을 서버 한 대에 같이 올렸더니, 배치가 도는 밤마다 API가 같이 느려진다. 둘이 같은 파일 시스템, 같은 포트 번호, 같은 메모리를 나눠 쓰기 때문이다.

서버 한 대를 여러 서비스가 서로 모르게, 서로 넘치지 않게 나눠 쓰는 방법은 두 가지다.

- 하이퍼바이저 가상화: 서비스마다 가짜 컴퓨터(VM)를 한 대씩 만들어 준다.
- 컨테이너: 커널은 하나를 같이 쓰고, 프로세스마다 보이는 것과 쓰는 양만 나눈다.

### 하이퍼바이저와 VM

하이퍼바이저(hypervisor)는 CPU, 메모리, 디스크 같은 하드웨어를 VM 여러 대에 나눠 주는 소프트웨어다. VM마다 자기 커널을 따로 부팅하므로, VM 안의 프로그램은 서버 한 대를 통째로 가진 것처럼 돈다.

- Type 1 (베어메탈): 하드웨어 위에 바로 설치한다. VMware ESXi, Hyper-V, Xen.
- Type 2 (호스트형): 윈도우나 맥 같은 일반 OS 위에서 프로그램으로 돈다. VMware Workstation, VirtualBox.

컨테이너는 커널을 하나만 둔다. 컨테이너 안의 프로세스도 호스트에서 보면 프로세스 하나이고, 커널이 그 프로세스에게 보여 줄 것(namespace)과 쓸 양(cgroup)만 따로 정한다.

두 장면에서 앱이 파일을 읽을 때 요청이 디스크까지 몇 층을 지나는지 견줘 보자.

<figure class="fig" data-figure="container-stack">
  <figcaption>파일 읽기 요청이 디스크까지 가는 길</figcaption>
</figure>

VM은 게스트 커널과 하이퍼바이저를 거쳐 디스크에 닿고, VM마다 커널과 OS가 메모리를 따로 차지한다. 컨테이너는 호스트 커널을 바로 부르니 중간 층이 없고, 뜨는 데도 프로세스 하나 띄우는 시간이면 된다.

그림은 I/O 경로만 보여 준다. 계산하는 명령은 요즘 CPU의 가상화 기능 덕분에 VM 안에서도 CPU에서 바로 돌아서, 두 방식의 차이는 주로 디스크와 네트워크 I/O, 그리고 커널을 따로 두는 메모리에서 난다.

대신 격리의 벽이 다르다. VM은 커널이 따로라 하나가 뚫려도 하이퍼바이저가 한 번 더 막지만, 컨테이너는 커널을 같이 쓰므로 커널 취약점 하나가 그 서버의 모든 컨테이너에 닿는다. 남이 올린 코드를 돌리는 환경처럼 벽이 중요한 곳은 VM이나 경량 VM(Kata Containers 등) 위에 컨테이너를 올린다.

### 오버커밋

물리 코어가 4개인 서버에 vCPU 4개짜리 VM을 세 대 올리는 일이 흔하다. 오버커밋(overcommit)은 물리 자원보다 많은 양을 VM에 나눠 주는 방식이다.

모든 VM이 한꺼번에 바쁜 일은 드물다는 데 기대어, 하이퍼바이저가 바쁜 vCPU에 물리 코어를 번갈아 붙인다. 몇 배까지 나눠 줄지는 정해진 값이 없고 운영자가 부하를 보고 정한다.

두 장면에서 코어 4개의 시간축이 어떻게 차는지 지켜보자.

<figure class="fig" data-figure="container-overcommit">
  <figcaption>vCPU 12개를 물리 코어 4개에 나눠 붙이는 모습</figcaption>
</figure>

바쁜 때가 엇갈리면 코어 4개로 vCPU 12개가 모두 제때 돈다. 셋이 같이 바쁘면 각 VM은 시간의 3분의 1만 받고 나머지 3분의 2는 차례를 기다린다. VM 안의 리눅스는 이 시간을 steal로 센다.

메모리도 오버커밋한다.

- 같은 내용의 메모리 페이지를 VM끼리 하나로 합친다(리눅스 KSM 등).
- 쓰지 않는 메모리를 압축하거나 디스크(스왑)로 내린다.
- 게스트 안의 드라이버가 메모리를 잡아 하이퍼바이저에 돌려준다(벌루닝).

메모리는 CPU처럼 차례를 기다려서 해결되지 않는다. 디스크로 내린 페이지를 다시 쓰려면 메모리보다 약 1000배 느린 SSD에서 읽어 와야 한다. VM 안에서 `top`의 `st` 값이 꾸준히 오르면 VM 설정보다 호스트의 오버커밋 비율부터 본다.

## namespace

### chroot와 pivot_root

컨테이너 안에서 `ls /`를 치면 호스트의 디렉터리가 하나도 안 보인다. 컨테이너마다 루트(/)를 따로 갖기 때문이다.

가장 오래된 방법은 chroot다. 프로세스의 루트를 `/srv/app` 같은 디렉터리로 바꾸면 그 프로세스에게는 그 아래만 보인다. 대신 bash, ls와 그 라이브러리처럼 실행에 필요한 파일을 그 안에 미리 넣어 둬야 한다.

```bash
mkdir -p root-v1/bin root-v1/lib/x86_64-linux-gnu root-v1/lib64
cp /bin/bash /bin/ls root-v1/bin
ldd /bin/bash /bin/ls     # 필요한 라이브러리를 보고 같은 경로로 복사한다
chroot root-v1 /bin/bash
```

chroot는 프로세스의 루트 표시만 바꾼다. root 권한이 있으면 안쪽 디렉터리로 chroot를 한 번 더 해서 빠져나갈 수 있다. 새 루트가 지금 위치보다 아래로 내려가니 지금 위치는 루트 밖에 남고, 거기서 `..`를 따라 올라가면 진짜 루트에 닿는다.

pivot_root는 mount namespace 안에서 루트 파일 시스템 자체를 바꾼다. 새 루트를 /로 올리고 옛 루트를 그 아래 `put_old`로 옮긴 뒤, 그 마운트를 떼어 낸다.

```bash
unshare --mount /bin/bash                  # 새 mount namespace
mount -t tmpfs -o size=10M none root-v2    # 새 루트는 마운트 지점이어야 한다
cp -a root-v1/. root-v2/ && mkdir root-v2/put_old
cd root-v2 && pivot_root . put_old
umount -l /put_old                         # 새 루트에 umount도 넣어 둔다
```

두 장면에서 bash가 `..`를 따라 어디까지 올라가는지 지켜보자.

<figure class="fig" data-figure="container-root">
  <figcaption>chroot와 pivot_root에서 위로 올라가는 길</figcaption>
</figure>

chroot는 벽을 세우지 않고 출발점만 옮겨서 위로 가는 길이 남는다. pivot_root는 옛 루트를 떼어 내서 길 자체를 없앤다. runc 같은 컨테이너 런타임도 pivot_root로 루트를 바꾸고 옛 루트를 떼어 낸다.

떼어 낸 루트도 다시 마운트할 권한이 있으면 되살릴 수 있다. `--privileged`나 `CAP_SYS_ADMIN`을 받은 컨테이너는 이 권한을 가지므로, 이런 옵션이 붙은 컨테이너부터 찾아본다.

### namespace 종류

컨테이너 안에서 `ps`를 치면 앱이 PID 1이다. 호스트에서 보면 같은 프로세스가 PID 4321이다.

namespace는 커널 자원 하나를 프로세스 묶음마다 따로 보이게 한다. 리눅스에는 8가지가 있고, Docker와 쿠버네티스는 보통 user와 time을 뺀 나머지를 새로 만든다. 쿠버네티스는 그중 network, ipc, uts를 파드 단위로 만든다.

| namespace | 따로 보이는 것 | 컨테이너 안에서 |
|---|---|---|
| mnt | 마운트 목록 | 이미지의 파일 시스템이 /로 보인다 |
| uts | 호스트 이름 | `hostname`이 호스트와 다르다 |
| ipc | 공유 메모리, 메시지 큐 | 호스트의 `ipcs` 목록이 안 보인다 |
| pid | 프로세스 번호 | 앱이 PID 1이다 |
| net | 네트워크 장치, IP, 라우팅 표, 방화벽 규칙, 포트 | eth0와 IP가 따로라 같은 포트를 여럿이 연다 |
| user | UID, GID | 안의 root가 밖에서는 일반 사용자다 |
| cgroup | cgroup 경로 | 자기 cgroup이 /로 보인다 |
| time | 부팅 후 시간 (리눅스 5.6부터) | 시계를 따로 둔다 |

세 장면에서 같은 프로세스와 같은 패킷이 호스트와 컨테이너 안에서 어떻게 다르게 보이는지 본다.

<figure class="fig" data-figure="container-ns">
  <figcaption>호스트와 컨테이너가 같은 것을 다르게 보는 모습</figcaption>
</figure>

PID 4321과 PID 1은 같은 프로세스이고, 컨테이너 eth0는 veth 한 쌍과 브리지로 호스트 eth0에 이어진 별도 장치다. user namespace를 켜면 컨테이너 안의 root가 호스트에서는 100000번 같은 권한 없는 사용자로 바뀌어, 밖으로 빠져나와도 호스트 파일을 고치지 못한다.

namespace는 보이는 것만 바꾸고 자원의 양은 나누지 않는다. 컨테이너 프로세스도 호스트 커널이 다른 프로세스와 똑같이 스케줄링한다.

쿠버네티스에서 user namespace는 1.36부터 정식 기능이다. 파드에 `hostUsers: false`를 적어 켜고, 노드에는 리눅스 6.3 이상과 containerd 2.0이나 CRI-O 1.25 이상이 필요하다.

```bash
lsns                           # 호스트의 namespace 목록과 첫 프로세스
readlink /proc/4321/ns/net     # net:[4026532301] 번호가 같으면 같은 namespace
nsenter -t 4321 -n ip addr     # 4321의 network namespace에 들어가 명령 실행
```

컨테이너 이미지에 디버깅 도구가 없으면, 호스트에서 `nsenter`로 그 namespace에 들어가 호스트의 도구로 본다.

## cgroup

### cgroup 구조

같은 노드의 배치 파드가 메모리를 마구 쓰는데도 API 파드는 멀쩡하다. 파드마다 cgroup으로 쓸 양에 상한을 걸어 두었기 때문이다.

cgroup(control group)은 프로세스 묶음이 쓰는 CPU, 메모리, 디스크 I/O, 프로세스 수를 재고 제한한다. 커널은 이것을 `/sys/fs/cgroup` 아래 디렉터리와 파일로 보여 준다. 디렉터리 하나가 cgroup 하나이고, 그 안의 파일에 값을 쓰면 제한이 걸린다.

```bash
mkdir /sys/fs/cgroup/demo
echo 512M > /sys/fs/cgroup/demo/memory.max            # 메모리 상한
echo "30000 100000" > /sys/fs/cgroup/demo/cpu.max     # 100ms마다 30ms
echo $$ > /sys/fs/cgroup/demo/cgroup.procs            # 지금 셸을 넣는다
```

쿠버네티스에서는 kubelet과 containerd가 이 일을 한다. 파드 하나에 cgroup이 생기는 순서를 따라가 보자.

<figure class="fig" data-figure="container-cgroup">
  <figcaption>kubelet과 런타임이 컨테이너 하나에 cgroup을 만드는 순서</figcaption>
</figure>

디렉터리를 만들고, 상한을 쓰고, PID를 넣으면 그 프로세스와 자식 프로세스가 쓰는 양을 커널이 그 cgroup에 합산한다. 파드 스펙의 limit은 이 파일 값으로 들어간다.

CPU 쪽 값(`cpu.max`, `cpu.weight`)과 쓰로틀링은 [CPU 이해하기]({{ '/2026/10/25/k8s-cpu-request-limit/' | relative_url }})에서 다뤘다. 여기서는 메모리를 본다.

cgroup에는 v1과 v2가 있다. v1은 `cpu`, `memory`처럼 자원마다 트리가 따로였고, v2는 트리 하나에 자원별 파일이 모여 있다. 요즘 배포판은 v2가 기본이고, 노드가 어느 쪽인지는 이렇게 본다.

```bash
stat -fc %T /sys/fs/cgroup     # cgroup2fs면 v2, tmpfs면 v1
```

### memory limit과 OOM

배치 파드 하나에 메모리 누수가 생겼다. limit이 있으면 그 파드만 재시작되고, 없으면 같은 노드의 API까지 느려진다.

`memory.max`에 닿으면 커널은 먼저 그 cgroup의 페이지 캐시처럼 비울 수 있는 메모리를 회수한다. 그래도 모자라면 그 cgroup 안에서만 프로세스 하나를 골라 죽인다(OOM kill). 쿠버네티스는 이것을 `OOMKilled`로 보여 주고 컨테이너를 다시 띄운다.

아래 데모에서 A의 메모리를 새게 해 보자. 모드를 바꿔 가며 A가 늘어나는 동안 B의 응답 시간이 어떻게 되는지 본다.

<figure class="fig" data-figure="container-oom">
  <figcaption>4GiB 노드에서 메모리가 새는 파드 A와 옆 파드 B (모양을 보여 주는 예시)</figcaption>
</figure>

limit이 없으면 A가 노드의 남은 메모리를 다 가져간다. 노드가 메모리를 회수하느라 B의 요청까지 느려지고, 끝내 커널 OOM killer나 kubelet의 축출(eviction)이 노드 전체에서 대상을 고른다.

limit 1GiB를 걸면 A는 1GiB에서 혼자 OOMKilled되고 다시 뜬다. 새는 양과 속도는 같고, 바뀐 것은 **터지는 범위** 하나다.

```text
$ cat /sys/fs/cgroup/memory.events     # 컨테이너 안에서
low 0
high 0
max 1287
oom 4
oom_kill 4
```

재시작이 잦은 파드는 `kubectl describe pod`의 Last State에서 OOMKilled부터 보고, `memory.events`의 `oom_kill`로 횟수를 확인한다. memory는 request와 limit을 같게 두는 편이 안전하다는 점도 [CPU 이해하기]({{ '/2026/10/25/k8s-cpu-request-limit/' | relative_url }}) 끝에 적어 두었다.

## 이미지와 파일 시스템

### 이미지 레이어

500MB짜리 이미지를 고쳐 다시 올렸는데 푸시가 몇 초 만에 끝난다. 바뀐 레이어만 올라가기 때문이다.

이미지는 파일 시스템 한 덩어리가 아니라 변경분(레이어)을 쌓은 묶음이다. 레이어마다 내용의 sha256 값이 이름이라, 같은 내용이면 같은 레이어로 본다.

- `RUN`, `COPY`, `ADD`처럼 파일 시스템을 바꾸는 명령이 레이어를 하나씩 만든다.
- `CMD`, `ENV`, `LABEL`은 설정만 바꾸고 레이어를 만들지 않는다.
- `FROM`은 베이스 이미지의 레이어를 그대로 가져온다.

```dockerfile
FROM node:22-slim
COPY package*.json /app/
RUN cd /app && npm ci
COPY . /app/
CMD node /app/server.js
```

두 장면에서 명령마다 레이어가 쌓이는 모습과, 이미지 둘이 베이스 레이어를 같이 쓰는 모습을 본다.

<figure class="fig" data-figure="container-layers">
  <figcaption>Dockerfile 명령마다 쌓이는 레이어 (크기는 예시)</figcaption>
</figure>

같은 베이스로 만든 이미지 열 개는 베이스 레이어를 디스크에 한 벌만 둔다. 레지스트리에 올리고 내려받을 때도 이미 있는 레이어는 건너뛴다.

```bash
docker image inspect node:22-slim | jq '.[0].RootFS.Layers'   # 레이어 sha256 목록
docker history node:22-slim                                    # 명령별 레이어와 크기
```

### 빌드 캐시

소스 한 줄을 고쳤을 뿐인데 빌드할 때마다 `npm ci`가 처음부터 다시 돈다.

빌드 캐시는 레이어를 아래부터 차례로 맞춰 본다. 어떤 명령의 입력(명령 문자열, 복사하는 파일)이 바뀌면 그 레이어와 그 위의 레이어를 전부 다시 만든다.

두 장면은 같은 소스 수정을 Dockerfile 순서만 바꿔 빌드한다. 어느 줄에서 다시 실행이 시작되는지 본다.

<figure class="fig" data-figure="container-cache">
  <figcaption>소스 한 줄을 고친 뒤 다시 빌드하는 시간 (시간은 예시)</figcaption>
</figure>

소스를 먼저 복사하면 소스가 바뀔 때마다 그 위의 `npm ci`도 다시 돈다. `package.json`만 먼저 복사해 의존성을 설치하면, 소스가 바뀌어도 마지막 `COPY`만 다시 한다.

자주 바뀌는 파일일수록 Dockerfile 아래쪽에서 복사한다.

### overlayfs

컨테이너 안에서 `/etc/nginx/nginx.conf`를 고쳐도 이미지는 그대로이고, 같은 이미지로 띄운 다른 컨테이너에는 반영되지 않는다.

OverlayFS는 여러 디렉터리를 겹쳐 하나로 보여 주는 리눅스 파일 시스템이다. 같은 이름의 파일이 여러 층에 있으면 위층 것이 보인다.

- lowerdir: 이미지 레이어들. 읽기 전용이다.
- upperdir: 컨테이너마다 하나씩 생기는 쓰기 층.
- merged: 둘을 겹쳐 보여 주는 곳. 컨테이너의 /가 여기다.

세 장면에서 파일을 읽고, 고치고, 지울 때 어느 층이 바뀌는지 지켜보자.

<figure class="fig" data-figure="container-overlay">
  <figcaption>읽기, 고치기, 지우기에서 OverlayFS 세 층</figcaption>
</figure>

고치면 파일이 upperdir로 복사(copy-up)된 뒤 바뀌고, 지우면 upperdir에 화이트아웃(whiteout)이라는 표시가 생겨 아래 파일을 가린다. 어느 경우에도 lowerdir는 그대로라서, 같은 이미지로 띄운 컨테이너 백 개가 레이어 한 벌을 같이 쓴다.

이미지를 만들 때도 같다. 앞 레이어에서 받은 파일을 다음 `RUN`에서 지우면 화이트아웃 레이어가 하나 더 쌓일 뿐 이미지는 줄지 않는다. 받은 파일은 같은 `RUN` 안에서 지운다.

```dockerfile
RUN curl -fsSLO https://example.com/tool.tar.gz \
 && tar xzf tool.tar.gz && rm tool.tar.gz
```

Docker는 이 일을 스토리지 드라이버에 맡긴다.

- overlay2: 커널 OverlayFS를 쓰는 Docker의 기본 드라이버다. aufs와 옛 overlay 드라이버는 Docker 24.0에서, devicemapper는 25.0에서 빠졌다.
- containerd 이미지 저장소: Docker 29.0부터 새로 설치하면 기본이다. 겹치는 방식은 containerd의 overlayfs snapshotter로 같다.
- 쿠버네티스 노드의 containerd도 overlayfs snapshotter가 기본이다.

노드에서 컨테이너 하나의 세 층은 마운트 옵션에 그대로 보인다(경로는 줄였다).

```text
$ mount -t overlay
overlay on /run/containerd/.../rootfs type overlay
  (rw,lowerdir=.../snapshots/12/fs:.../snapshots/11/fs,upperdir=.../snapshots/40/fs,workdir=.../snapshots/40/work)
```

### copy-on-write

DB 파일을 컨테이너 안 경로에 그냥 두고 돌렸더니, 컨테이너를 띄우고 처음 쓰는 순간 몇 초씩 멈춘다.

copy-up은 파일 단위로 일어난다. 2GB 파일의 한 바이트를 고쳐도 처음 한 번은 2GB를 통째로 upperdir에 복사한 뒤에 쓴다. 두 번째 쓰기부터는 이미 위층에 있으니 바로 쓴다.

모드를 바꿔 가며 한 줄 고치기를 눌러 보자. 쓰기가 시작되기 전에 복사가 얼마나 걸리는지 본다.

<figure class="fig" data-figure="container-cow">
  <figcaption>이미지 안의 파일을 처음 고칠 때 (복사 시간은 디스크 1GB/s를 가정한 대략값)</figcaption>
</figure>

4KB 설정 파일은 복사가 1ms도 걸리지 않아 차이가 없다. 2GB 파일은 약 2초를 복사에 쓰고 그동안 쓰기가 멈추며, 디스크도 2GB를 더 쓴다. 고친 내용은 한 바이트로 같고 복사할 파일 크기만 다르다.

크고 자주 쓰는 파일(DB, 로그, 업로드)은 이미지 층이 아니라 볼륨에 둔다.

### 볼륨

새 버전을 배포했더니 사용자가 올린 파일이 전부 사라졌다. 파일이 컨테이너의 upperdir에 있었기 때문이다.

upperdir는 컨테이너와 함께 생기고 함께 지워진다. 볼륨(volume)은 호스트의 디렉터리나 디스크를 컨테이너 경로에 직접 마운트한 것이라, OverlayFS를 거치지 않고 컨테이너가 지워져도 남는다.

모드를 바꿔 가며 새 버전으로 교체를 눌러 보자. 교체 뒤에 파일 세 개가 어디에 남는지 본다.

<figure class="fig" data-figure="container-volume">
  <figcaption>컨테이너를 새 버전으로 바꿀 때 파일이 남는 곳</figcaption>
</figure>

컨테이너 레이어에 둔 파일은 옛 컨테이너와 함께 사라지고, 볼륨에 둔 파일은 새 컨테이너에 그대로 붙는다. 바뀐 것은 저장 위치 하나다. 볼륨은 copy-up도 없어서 쓰기도 빠르다.

```bash
docker run -v uploads:/data myapp:2.0    # 이름 있는 볼륨을 /data에 붙인다
docker diff <컨테이너>                    # upperdir에 생긴 변경 목록
docker ps -s                             # SIZE는 upperdir, virtual은 이미지까지 합친 크기
```

쿠버네티스에서는 파드와 함께 사라져도 되는 임시 파일은 `emptyDir`, 남아야 하는 데이터는 PersistentVolumeClaim으로 붙인다. 운영 중인 컨테이너는 `docker diff`로 upperdir에 쌓이는 파일부터 보고, 남아야 할 것이 있으면 볼륨으로 옮긴다.

## 쿠버네티스의 파드

### 파드와 namespace 공유

사이드카 컨테이너가 앱 컨테이너에 `localhost:8080`으로 붙는다. 컨테이너는 둘인데 네트워크는 하나다.

파드는 namespace 일부를 같이 쓰는 컨테이너 묶음이다. containerd와 CRI-O는 파드를 만들 때 작은 pause 컨테이너를 먼저 띄워 network, ipc, uts namespace를 잡아 두고, 앱 컨테이너들을 그 namespace에 넣는다.

두 장면에서 파드 안 컨테이너가 같이 쓰는 것과 따로 쓰는 것을 본다.

<figure class="fig" data-figure="container-pod">
  <figcaption>파드 안 컨테이너가 같이 쓰는 network namespace와 따로 쓰는 cgroup</figcaption>
</figure>

network namespace가 하나라서 파드 안 컨테이너들은 IP 하나를 같이 쓰고, 같은 포트를 둘이 동시에 열 수 없다. 파일 시스템과 cgroup은 컨테이너마다 따로라, app이 memory limit에 걸려 재시작돼도 사이드카는 그대로 돈다.

PID namespace는 기본으로 따로다. 사이드카가 앱 프로세스를 보거나 신호를 보내야 하면 파드에 `shareProcessNamespace: true`를 준다.

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| VM | 하드웨어를 나눠 커널을 따로 둔다 | 벽이 두껍고 무겁다. 오버커밋이 넘치면 steal |
| 컨테이너 | 커널 하나를 같이 쓰는 프로세스 | 커널 취약점은 모든 컨테이너에 닿는다 |
| pivot_root | 루트를 바꾸고 옛 루트를 떼어 낸다 | chroot는 빠져나갈 수 있다 |
| namespace | 보이는 것을 나눈다 | 자원의 양은 나누지 않는다 |
| cgroup | 쓰는 양을 재고 막는다 | memory.max에 닿으면 그 컨테이너만 OOM |
| 이미지 레이어 | 변경분을 쌓는다 | 다음 레이어에서 지워도 줄지 않는다. 자주 바뀌는 건 아래에 |
| OverlayFS | 레이어를 겹쳐 하나로 보여 준다 | 처음 고칠 때 파일을 통째로 copy-up |
| 볼륨 | 호스트 저장소를 직접 마운트 | 남아야 하거나 자주 쓰는 데이터는 여기에 |
| 파드 | network, ipc, uts를 같이 쓴다 | 파일 시스템과 cgroup은 컨테이너마다 |

## 참고

- [namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [chroot(2)](https://man7.org/linux/man-pages/man2/chroot.2.html)
- [pivot_root(2)](https://man7.org/linux/man-pages/man2/pivot_root.2.html)
- [Linux kernel — Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [Linux kernel — Overlay Filesystem](https://docs.kernel.org/filesystems/overlayfs.html)
- [Docker — Storage drivers](https://docs.docker.com/engine/storage/drivers/)
- [Docker — Select a storage driver](https://docs.docker.com/engine/storage/drivers/select-storage-driver/)
- [Docker — Deprecated Engine features](https://docs.docker.com/engine/deprecated/)
- [Docker — Volumes](https://docs.docker.com/engine/storage/volumes/)
- [Docker — Build cache](https://docs.docker.com/build/cache/)
- [Kubernetes — User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- [Kubernetes — Pods](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Kubernetes — Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- 원글: [CS 가상화](https://kimjanghyun1010.tistory.com/86), [Container System(cgroup namespaces)](https://kimjanghyun1010.tistory.com/64), [Container System(filesystem)](https://kimjanghyun1010.tistory.com/90), [Kube System](https://kimjanghyun1010.tistory.com/65)
