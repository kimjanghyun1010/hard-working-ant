---
title: 컨테이너 이해하기
description: 커널 하나를 같이 쓰는 프로세스가 자기만의 서버처럼 도는 원리를 루트 교체, namespace, cgroup, 이미지 레이어와 OverlayFS, copy-up과 볼륨의 순서로 정리했다.
date: 2026-10-27 12:00:00 +0900
series: Back to the Basic
tags: [container, docker, linux, namespace, cgroup, overlayfs]
scripts: [figures/container.js]
---

## VM과 컨테이너

컨테이너는 자기만의 서버를 가진 것처럼 돌지만, 호스트에서 보면 프로세스 하나다. 커널 하나를 같이 쓰는 프로세스를 떼어 놓으려면 네 가지를 따로 줘야 한다. 루트 파일 시스템, 보이는 커널 자원(namespace), 쓸 수 있는 양(cgroup), 그리고 루트에 깔 파일(이미지)이다.

같은 문제를 VM은 커널을 따로 둬서 푼다. 하이퍼바이저(hypervisor)는 CPU, 메모리, 디스크를 VM 여러 대에 나눠 주는 소프트웨어이고, VM마다 게스트 커널을 따로 부팅한다.

컨테이너 런타임은 커널을 하나만 둔다. 새 프로세스를 만드는 시스템 콜 `clone(2)`에 `CLONE_NEWPID`, `CLONE_NEWNET` 같은 플래그를 붙여 프로세스를 만들고, 그 프로세스를 cgroup에 넣은 뒤 루트를 이미지의 파일로 바꾼다. 아래 그림처럼 파일 읽기 한 번이 게스트 커널과 하이퍼바이저 없이 호스트 커널로 바로 간다.

<figure class="fig" data-figure="container-stack">
  <figcaption>파일 읽기 요청이 디스크까지 가는 길</figcaption>
</figure>

계산하는 명령은 CPU의 가상화 기능(Intel VT-x, AMD-V) 덕분에 VM 안에서도 CPU에서 바로 돈다. 두 방식의 차이는 I/O 경로, VM마다 따로 드는 커널 메모리, 뜨는 시간에서 난다. VM은 OS를 부팅하고 컨테이너는 프로세스 하나를 띄운다.

대가는 격리의 벽이다. 커널을 같이 쓰므로 커널 취약점 하나가 그 서버의 모든 컨테이너에 닿는다. 남이 올린 코드를 돌리는 곳은 컨테이너마다 경량 VM을 씌우는 Kata Containers나, 시스템 콜을 사용자 공간의 커널이 대신 받는 gVisor를 쓴다.

## 루트 파일 시스템 교체

컨테이너 안에서 `ls /`를 치면 호스트 디렉터리 대신 이미지의 파일만 보인다. 프로세스의 루트(/)를 다른 디렉터리로 바꿨기 때문이다.

가장 오래된 방법은 `chroot(2)`다. 매뉴얼은 이 호출이 `/`로 시작하는 경로를 풀 때의 출발점 하나만 바꾼다고 적고, 보안 목적으로 쓰지 말라고 경고한다. 안에서 돌릴 bash, ls와 그 라이브러리도 미리 넣어 둬야 한다.

```bash
mkdir -p root-v1/bin root-v1/lib/x86_64-linux-gnu root-v1/lib64
cp /bin/bash /bin/ls root-v1/bin
ldd /bin/bash /bin/ls     # 필요한 라이브러리를 보고 같은 경로로 복사한다
chroot root-v1 /bin/bash
```

빠져나갈 길은 chroot가 현재 디렉터리(cwd)를 바꾸지 않는 데서 생긴다. `CAP_SYS_CHROOT` 권한(capability, root의 권한을 기능별로 쪼갠 것 중 하나)이 있는 프로세스가 안쪽 디렉터리로 chroot를 한 번 더 하면, 지금 있는 디렉터리가 새 루트 바깥에 남는다. 거기서 `..`를 따라 올라가면 루트 검사에 걸리지 않고 진짜 /에 닿는다.

```c
mkdir(".out", 0755);
chroot(".out");              // 루트만 안쪽으로 옮기고 cwd는 바깥에 둔다
chdir("../../../../..");     // 새 루트를 지나치지 않으니 진짜 /까지 오른다
chroot(".");
execl("/bin/sh", "sh", NULL);
```

`pivot_root(2)`는 경로의 출발점이 아니라 mount namespace(프로세스 묶음마다 따로 갖는 마운트 목록)의 루트 마운트 자체를 바꾼다. 새 루트를 /로 올리고 옛 루트를 그 아래 `put_old`로 내린 뒤 떼어 내면, 위로 올라갈 마운트가 남지 않는다. 새 루트는 마운트 지점이어야 하고, 호출에는 `CAP_SYS_ADMIN`이 필요하다.

```bash
unshare --mount /bin/bash                  # 새 mount namespace
mount -t tmpfs -o size=10M none root-v2    # 새 루트는 마운트 지점이어야 한다
cp -a root-v1/. root-v2/ && mkdir root-v2/put_old
cd root-v2 && pivot_root . put_old
umount -l /put_old                         # 옛 루트를 떼어 낸다
```

아래 그림처럼 chroot는 출발점만 옮겨서 위로 가는 길이 남고, pivot_root는 옛 루트를 떼어 내서 길 자체를 없앤다.

<figure class="fig" data-figure="container-root">
  <figcaption>chroot와 pivot_root에서 위로 올라가는 길</figcaption>
</figure>

runc도 같은 순서를 밟는다. 새 루트로 옮긴 뒤(`pivot_root`) 옛 루트를 떼어 내는데(`umount2`), 그 전에 옛 루트에서 일어나는 마운트 변화가 호스트 쪽으로 번지지 않게 전파(mount propagation)를 끊어 둔다. 끊지 않으면 컨테이너 안에서 뗀 마운트가 호스트에서도 떨어질 수 있다.

떼어 낸 루트도 다시 마운트할 수 있으면 되살아난다. `--privileged` 컨테이너는 호스트의 디스크 장치가 보이고 mount도 부를 수 있어서 호스트 파일 시스템을 다시 붙일 수 있다.

## namespace

루트를 바꿔도 `ps`, `ip addr`, `hostname`은 여전히 호스트를 보여 준다. 프로세스 번호나 네트워크 장치는 파일이 아니라 커널 자원이기 때문이다. namespace는 커널 자원 하나를 프로세스 묶음마다 따로 보이게 하고, 리눅스에는 8가지가 있다.

- mnt: 마운트 목록. 앞 절의 pivot_root가 이 안에서 일어난다.
- uts: 호스트 이름.
- ipc: 공유 메모리와 메시지 큐.
- pid: 프로세스 번호.
- net: 네트워크 장치, IP, 라우팅 표, 포트.
- user: UID와 GID.
- cgroup: 자기 cgroup 경로가 /로 보인다.
- time: 부팅 후 시간. 리눅스 5.6부터 있다.

다루는 시스템 콜은 셋이다.

- `clone(2)`: `CLONE_NEW*` 플래그를 주면 새 namespace를 만들고 자식을 그 안에 낳는다.
- `unshare(2)`: 부른 프로세스 자신을 새 namespace로 옮긴다.
- `setns(2)`: `/proc/<pid>/ns/` 아래 파일을 열어 이미 있는 namespace에 들어간다.

namespace는 `/proc/<pid>/ns/net` 같은 링크로 보이고, `net:[4026532301]`의 번호가 같으면 같은 namespace다. 보통은 마지막 프로세스가 나가면 사라지지만, 이 파일을 열어 두거나 다른 경로에 바인드 마운트(파일이나 디렉터리를 다른 경로에 한 번 더 붙이는 마운트)하면 프로세스 없이도 남는다. `ip netns add`가 만든 이름 있는 network namespace가 이렇게 남는다.

```bash
lsns                           # 호스트의 namespace 목록과 첫 프로세스
readlink /proc/4321/ns/net     # net:[4026532301]
nsenter -t 4321 -n ip addr     # 4321의 network namespace에서 호스트의 ip 명령 실행
```

아래 그림처럼 같은 프로세스, 같은 패킷, 같은 사용자가 호스트와 컨테이너 안에서 다른 번호와 장치로 보인다.

<figure class="fig" data-figure="container-ns">
  <figcaption>호스트와 컨테이너가 같은 것을 다르게 보는 모습</figcaption>
</figure>

PID namespace의 첫 프로세스는 그 안에서 PID 1이 되고 init의 규칙을 떠안는다.

- 바깥에서 보낸 신호는 PID 1이 핸들러(그 신호를 받으면 실행할 함수)를 등록한 것만 닿는다. SIGKILL과 SIGSTOP만 예외다. 핸들러 없는 앱은 `docker stop`의 SIGTERM을 무시하고, 기본 10초 뒤 SIGKILL로 끝난다.
- 부모를 잃은 프로세스는 PID 1의 자식이 되므로, PID 1이 이들을 거둬야(wait) 좀비(끝났는데 종료 상태를 아무도 거두지 않아 프로세스 표에 남은 항목)가 쌓이지 않는다.
- PID 1이 끝나면 커널이 namespace 안의 나머지 프로세스에 SIGKILL을 보낸다. 컨테이너의 수명이 첫 프로세스의 수명과 같은 이유다.

앱이 신호를 직접 다루지 않으면 `docker run --init`으로 작은 init(tini)을 PID 1에 두고 앱을 그 자식으로 띄운다.

user namespace는 안의 UID를 밖의 다른 UID로 옮겨 적는다(`/proc/<pid>/uid_map`). 안에서 root(UID 0)인 프로세스가 호스트에서는 UID 100000 같은 권한 없는 사용자라, 루트를 빠져나와도 호스트 파일을 고치지 못한다. Docker와 쿠버네티스는 이 namespace를 기본으로 만들지 않아서, 따로 켜지 않으면 컨테이너의 root는 호스트의 root다.

namespace는 나눠 갖기도 한다. 쿠버네티스 파드 안 컨테이너는 network, ipc, uts namespace를 같이 쓴다. 앱 옆에 붙어 프록시나 로그 수집을 맡는 사이드카(sidecar) 컨테이너가 앱에 `localhost:8080`으로 붙는 이유다.

containerd는 작은 pause 컨테이너를 먼저 띄워 이 namespace를 잡아 두고, 앱 컨테이너를 그 안으로 들여보낸다. CRI-O는 기본값(`drop_infra_ctr=true`)에서 파드 단위 PID namespace를 쓰지 않으면 pause 컨테이너를 띄우지 않고, pinns라는 작은 도구로 namespace 파일을 바인드 마운트해 남겨 둔다.

namespace는 보이는 것만 나누고 양은 나누지 않는다. 컨테이너 프로세스도 호스트의 CPU와 메모리를 다른 프로세스와 똑같이 나눠 쓰므로, 한 컨테이너가 메모리를 다 쓰면 옆 컨테이너도 같이 모자란다.

## cgroup

cgroup(control group)은 프로세스 묶음이 쓰는 CPU, 메모리, I/O, 프로세스 수를 재고 막는다. 커널은 이것을 `/sys/fs/cgroup`에 붙은 가상 파일 시스템(cgroup2)으로 보여 준다. 디렉터리 하나가 cgroup 하나이고, 하위 디렉터리를 만들면 자식 cgroup이 되며, 그 안의 파일에 값을 쓰면 제한이 걸린다.

```bash
mkdir /sys/fs/cgroup/demo
echo 512M > /sys/fs/cgroup/demo/memory.max            # 메모리 상한
echo "30000 100000" > /sys/fs/cgroup/demo/cpu.max     # 100ms마다 30ms
echo 100 > /sys/fs/cgroup/demo/pids.max               # 프로세스 100개까지
echo $$ > /sys/fs/cgroup/demo/cgroup.procs            # 지금 셸을 넣는다
```

PID를 `cgroup.procs`에 쓰면 그 프로세스의 스레드가 전부 옮겨 간다. 이후 fork(프로세스가 자기를 복제해 자식을 만드는 호출)한 자식은 부모의 cgroup에서 태어나서, 런타임이 첫 프로세스 하나만 넣어도 컨테이너 안에서 생기는 프로세스가 모두 같은 상한을 받는다.

쿠버네티스 파드 스펙의 limit도 kubelet과 containerd가 이 파일에 쓰는 값이다. 아래 그림처럼 디렉터리를 만들고, 상한을 쓰고, PID를 넣으면 그때부터 커널이 그 프로세스의 사용량을 그 cgroup에 합산한다.

<figure class="fig" data-figure="container-cgroup">
  <figcaption>kubelet과 런타임이 컨테이너 하나에 cgroup을 만드는 순서</figcaption>
</figure>

cgroup v2에서 프로세스는 맨 아래 cgroup에만 둔다. 자원을 자식에게 나눠 주는 중간 cgroup은 자기 프로세스를 가질 수 없다는 규칙이 있어서, 노드에는 `kubepods.slice` 아래 파드 cgroup, 그 아래 컨테이너 cgroup이 생기고 프로세스는 컨테이너 cgroup에만 들어간다. 부모의 상한은 자식 전체에 걸리므로 파드 cgroup의 상한이 컨테이너들의 합을 한 번 더 막는다.

- `cpu.max`: `$MAX $PERIOD` 꼴이고 기본값은 `max 100000`(상한 없음, 주기 100ms)이다. `30000 100000`이면 100ms마다 30ms만 돌고, 다 쓰면 다음 주기까지 멈춘다. 쓰로틀링은 [CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %})에 정리했다.
- `pids.max`: 프로세스 수 상한. 넘는 `fork`와 `clone`을 거절해서, 자기를 끝없이 복제하는 fork 폭탄이 메모리 상한에 닿기 전에 노드의 PID를 바닥내는 것을 막는다.

메모리 상한(`memory.max`)에 닿을 때의 회수와, 그 cgroup 안에서만 일어나는 OOM kill은 [메모리 이해하기]({{ site.baseurl }}{% post_url 2026-10-26-memory %})에 정리했다.

## 이미지 레이어와 OverlayFS

pivot_root로 올릴 새 루트에는 OS 파일과 앱이 깔려 있어야 한다. 이 파일을 컨테이너마다 통째로 복사하면 백 개에 백 벌이 들므로, 이미지는 변경분(레이어)을 쌓은 묶음으로 두고 컨테이너는 그 위에 얇은 쓰기 층 하나만 얹는다.

컨테이너 이미지 형식은 OCI(Open Container Initiative)가 표준으로 정해 두었다. 이 명세에서 레이어는 파일 시스템 변경분을 하나로 묶은 tar 파일이다. 더하거나 고친 파일은 그대로 넣고, 지운 파일은 이름 앞에 `.wh.`를 붙인 빈 파일(화이트아웃, whiteout)로 적는다.

레이어 하나의 이름은 압축을 푼 tar 내용으로 계산한 sha256 해시(DiffID)다. 내용이 한 바이트만 달라도 이름이 바뀐다.

디스크에 풀어 둔 레이어는 DiffID가 아니라 아래 레이어까지 이어 계산한 ChainID로 구분한다. 같은 변경분이라도 깔린 바닥이 다르면 결과 파일 시스템이 다르기 때문이다. DiffID가 같아도 아래 레이어가 다르면 따로 저장되고, 베이스부터 같은 레이어를 쌓은 이미지끼리만 디스크를 나눠 쓴다.

```text
ChainID(L0)    = DiffID(L0)
ChainID(L0|L1) = sha256(ChainID(L0) + " " + DiffID(L1))
```

Docker의 `/var/lib/docker/image/overlay2/layerdb/sha256/` 아래 디렉터리 이름이 이 ChainID이고, 그 안의 `diff` 파일에 DiffID가, `parent` 파일에 아래 레이어의 ChainID가 들어 있다.

Dockerfile에서는 `RUN`, `COPY`, `ADD`가 레이어를 하나씩 만들고 `CMD`, `ENV`는 설정만 바꾼다. 아래 그림처럼 베이스가 같은 이미지 둘은 베이스 레이어를 디스크에 한 벌만 둔다.

```dockerfile
FROM node:22-slim
COPY package*.json /app/
RUN cd /app && npm ci
COPY . /app/
CMD node /app/server.js
```

<figure class="fig" data-figure="container-layers">
  <figcaption>Dockerfile 명령마다 쌓이는 레이어 (크기는 예시)</figcaption>
</figure>

빌드 캐시도 레이어 단위로 맞춘다. 어떤 명령의 입력이 바뀌면 그 레이어와 위의 레이어를 전부 다시 만들기 때문에, 위처럼 `package.json`을 먼저 복사해 `npm ci`를 돌리면 소스만 고쳤을 때 의존성 설치를 건너뛴다.

레이어를 겹쳐 하나의 /로 보여 주는 일은 커널의 OverlayFS가 한다.

- lowerdir: 이미지 레이어들. 읽기 전용이고, 콜론으로 여럿을 적으면 왼쪽이 위층이다.
- upperdir: 컨테이너마다 하나씩 생기는 쓰기 층.
- workdir: 파일을 위층으로 옮기는 동안 중간 파일을 두는 곳. upperdir와 같은 파일 시스템이어야 한다.
- merged: 겹쳐 보이는 결과. 컨테이너의 /가 여기다.

같은 이름이 여러 층에 있으면 위층 것이 보인다. 아래 그림처럼 읽을 때는 위층부터 찾아 내려가고, 고치면 파일을 위층으로 복사(copy-up)한 뒤 바꾸고, 지우면 위층에 화이트아웃을 만든다.

<figure class="fig" data-figure="container-overlay">
  <figcaption>읽기, 고치기, 지우기에서 OverlayFS 세 층</figcaption>
</figure>

OverlayFS의 화이트아웃은 장치 번호가 0/0인 문자 장치 파일이고, 디렉터리를 통째로 가릴 때는 `trusted.overlay.opaque` 속성을 단다. lowerdir는 어느 경우에도 바뀌지 않아서 컨테이너 백 개가 레이어 한 벌을 같이 읽는다.

Docker의 overlay2 드라이버는 레이어마다 `/var/lib/docker/overlay2/<id>/`를 두고, 그 안에 내용(`diff`), 아래 레이어 목록(`lower`), 짧은 이름(`link`)을 둔다. 짧은 이름의 링크는 `l/` 디렉터리에 모아 두는데, lowerdir 경로를 줄여 mount 인자가 페이지 크기를 넘지 않게 하려는 것이다. overlay2는 lower 층을 128개까지 쌓는다.

```text
$ docker info
 Storage Driver: overlay2
 Docker Root Dir: /var/lib/docker
$ ls /var/lib/docker/overlay2/<id>
committed  diff  link  lower  work
$ mount -t overlay
overlay on /var/lib/docker/overlay2/<id>/merged type overlay
  (rw,lowerdir=l/K3TQ...:l/ZQ7M...,upperdir=<id>/diff,workdir=<id>/work)
```

이미지를 만들 때도 같은 규칙이 걸린다. 앞 레이어에서 받은 파일을 다음 `RUN`에서 지우면 화이트아웃 레이어가 하나 더 쌓일 뿐 아래 레이어의 파일은 그대로라, 이미지가 줄지 않는다. 받은 파일은 같은 `RUN` 안에서 지운다.

```dockerfile
RUN curl -fsSLO https://example.com/tool.tar.gz \
 && tar xzf tool.tar.gz && rm tool.tar.gz
```

## copy-up과 볼륨

레이어를 고치지 않는 대가는 쓰기에서 치른다. OverlayFS는 블록이 아니라 파일 단위로 동작해서, 2GB 파일의 한 바이트를 고쳐도 처음 한 번은 2GB를 통째로 upperdir에 복사한 뒤에 쓴다. 두 번째 쓰기부터는 위층 파일에 바로 쓴다.

chmod나 chown처럼 속성만 바꿀 때는 `metacopy=on` 옵션이 속성만 위로 올리고, 내용 복사는 파일을 쓰려고 열 때로 미룬다. 내용을 고치는 쓰기는 이 옵션이 있어도 통째로 복사한다.

아래 데모에서 4KB 설정 파일과 2GB DB 파일을 골라 한 줄 고치기를 누르고, 쓰기가 시작되기까지 걸리는 시간을 비교한다.

<figure class="fig" data-figure="container-cow">
  <figcaption>이미지 안의 파일을 처음 고칠 때 (복사 시간은 디스크 1GB/s를 가정한 대략값)</figcaption>
</figure>

4KB 파일은 복사가 1ms 안에 끝나 차이가 없다. 2GB 파일은 디스크가 초당 약 1GB를 쓴다고 보면 2초쯤(대략값) 복사에 쓰는 동안 첫 쓰기가 기다린다. 디스크도 2GB를 더 차지한다.

upperdir는 수명에도 한계가 있다. 컨테이너와 함께 생기고 `docker rm`과 함께 지워지므로, 새 버전으로 바꾸면 그 안에 쓴 파일이 사라진다.

볼륨(volume)은 호스트의 디렉터리나 디스크를 컨테이너 경로에 직접 마운트한 것이다. 스토리지 드라이버를 거치지 않으니 copy-up이 없고, 컨테이너를 지워도 남는다. Docker 문서도 쓰기가 많은 작업에는 볼륨이 가장 빠르고 예측 가능하다고 권한다.

```bash
docker run -v pgdata:/var/lib/postgresql/data postgres:17   # 이름 있는 볼륨
docker diff <컨테이너>    # upperdir의 변경 목록 (A 추가, C 변경, D 삭제)
docker ps -s             # SIZE는 upperdir, virtual은 이미지까지 합친 크기
```

쿠버네티스에서는 파드와 함께 사라져도 되는 임시 파일은 `emptyDir`(파드와 수명이 같은 빈 디렉터리)로, 남아야 하는 데이터는 PersistentVolumeClaim(디스크를 요청해 파드에 붙이는 객체)으로 붙인다. DB, 로그, 업로드처럼 크고 자주 쓰는 파일은 처음부터 볼륨 경로에 두고, 운영 중인 컨테이너는 `docker diff`로 upperdir에 쌓이는 파일이 없는지 본다.

## 정리

- 컨테이너는 커널 하나를 같이 쓰는 프로세스다. VM보다 가볍지만 커널 취약점은 모든 컨테이너에 닿는다.
- chroot는 경로의 출발점만 바꿔 cwd로 빠져나갈 길이 남는다. pivot_root는 mount namespace의 루트를 바꾸고 옛 루트를 떼어 낸다.
- namespace는 프로세스 번호, 네트워크, 호스트 이름 같은 커널 자원을 따로 보이게 한다. PID 1은 핸들러 없는 신호를 받지 않고, 끝나면 namespace 전체가 끝난다.
- cgroup은 디렉터리 하나에 프로세스를 묶어 쓰는 양을 막고, fork한 자식은 부모의 cgroup을 물려받는다.
- 이미지는 읽기 전용 레이어를 쌓은 것이고 디스크에서는 아래 레이어까지 포함한 ChainID로 구분된다. OverlayFS가 컨테이너마다 쓰기 층 하나를 얹어 겹쳐 보여 준다.
- 쓰기는 파일 단위 copy-up을 치르고 upperdir는 컨테이너와 함께 지워진다. 크고 자주 쓰는 데이터는 볼륨에 둔다.

## 참고

- [namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [pid_namespaces(7)](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)
- [user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)
- [chroot(2)](https://man7.org/linux/man-pages/man2/chroot.2.html)
- [pivot_root(2)](https://man7.org/linux/man-pages/man2/pivot_root.2.html)
- [runc — libcontainer/rootfs_linux.go](https://github.com/opencontainers/runc/blob/main/libcontainer/rootfs_linux.go)
- [Linux kernel — Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [Linux kernel — Overlay Filesystem](https://docs.kernel.org/filesystems/overlayfs.html)
- [OCI Image Spec — Image Layer Filesystem Changeset](https://github.com/opencontainers/image-spec/blob/main/layer.md)
- [OCI Image Spec — Image Configuration](https://github.com/opencontainers/image-spec/blob/main/config.md)
- [Docker — OverlayFS storage driver](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/)
- [Docker — Volumes](https://docs.docker.com/engine/storage/volumes/)
- [Docker — Build cache](https://docs.docker.com/build/cache/)
- [Docker — docker container stop](https://docs.docker.com/reference/cli/docker/container/stop/)
- [Kubernetes — Pods](https://kubernetes.io/docs/concepts/workloads/pods/)
- [CRI-O — crio.conf(5)](https://github.com/cri-o/cri-o/blob/main/docs/crio.conf.5.md)
- 원글: [Container System(cgroup namespaces)](https://kimjanghyun1010.tistory.com/64), [Container System(filesystem)](https://kimjanghyun1010.tistory.com/90)
