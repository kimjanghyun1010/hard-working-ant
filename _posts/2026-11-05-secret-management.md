---
title: 시크릿 관리
description: DB 비밀번호 하나가 git에서 파드 안 프로세스까지 가는 동안 평문으로 남는 자리를 따라간다. Secret과 etcd 암호화, Sealed Secrets와 External Secrets, Vault의 봉인과 리스, 실행 중인 파드의 값 교체까지.
date: 2026-11-05 12:00:00 +0900
series: CI/CD와 IaC
tags: [secret, kubernetes, argocd, gitops, vault, azure]
scripts: [figures/secret-management.js]
---

## Secret 저장과 전달

GitOps(git에 적은 상태로 클러스터를 맞추는 운영 방식)에서는 Argo CD 같은 도구가 git을 읽어 배포하므로, DB 비밀번호도 git에 있어야 한다. 비밀번호는 git에서 파드 안 프로세스까지 가는 동안 어디에 평문으로 남을까? git은 지운 값도 히스토리와 모든 클론에 남기므로, 한 번 푸시한 평문은 값을 바꾸는 것 말고 되돌릴 방법이 없다.

쿠버네티스에서 비밀번호를 담는 객체는 Secret이고, 객체는 매니페스트라는 YAML 파일로 적는다. `data`의 값은 base64로 인코딩한 문자열이라 키 없이 누구나 원래 값으로 되돌린다. base64는 바이너리 값도 YAML에 담으려고 쓰는 표기법이지 암호가 아니다.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db
type: Opaque
data:
  password: czNjcjN0   # echo -n s3cr3t | base64
```

API 서버는 기본 설정에서 이 값을 그대로 etcd에 쓴다. etcd는 클러스터의 모든 객체를 담는 키값 저장소이고, Secret은 `/registry/secrets/<네임스페이스>/<이름>` 키에 들어간다. 아래 그림처럼 저장하고 다시 읽는 어느 단계에도 암호 키가 쓰이지 않는다.

<figure class="fig" data-figure="secret-management-base64">
  <figcaption>base64로 적은 값이 etcd에 저장되고 다시 읽히는 과정</figcaption>
</figure>

etcd 다음 자리는 노드다. 노드마다 도는 에이전트 kubelet은 그 Secret을 쓰는 파드의 노드에만 값을 내려보내고, 볼륨으로 붙일 때는 디스크 대신 메모리 파일 시스템(tmpfs)에 쓴다. 파드가 지워지면 kubelet이 노드의 복사본도 지운다.

평문을 읽는 경로는 넓다.

- `get secrets` 권한이 있는 사용자: API로 바로 읽는다.
- 네임스페이스에 파드를 만들 수 있는 사용자: 그 Secret을 붙인 파드를 띄워 읽는다. Deployment를 만들 수 있는 권한도 같다.
- `privileged: true`로 도는 컨테이너: 그 노드에서 쓰이는 Secret을 모두 읽는다.
- etcd나 etcd 백업에 접근하는 사람: 파일만으로 읽는다.

앞의 세 경로는 RBAC(역할마다 API 권한을 나누는 체계)와 파드 보안 설정으로 좁힌다. 마지막 경로는 API 밖이라 RBAC가 닿지 않는다.

## etcd 저장 암호화

etcd 경로는 API 서버가 etcd에 쓰기 직전에 암호화해서 막는다(저장 시 암호화, encryption at rest). API 서버에 `--encryption-provider-config`로 EncryptionConfiguration 파일을 주면, 목록의 첫 provider로 암호화해 쓰고 읽을 때는 저장된 값에 맞는 provider를 차례로 시도한다.

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources: [secrets]
    providers:
      - kms:
          apiVersion: v2
          name: my-kms
          endpoint: unix:///var/run/kms-plugin/socket.sock
      - identity: {}   # 암호화를 켜기 전에 쓴 평문 Secret을 읽는다
```

provider는 암호 방식과 키를 두는 자리로 나뉜다.

- `identity`: 암호화하지 않는다. 아무것도 설정하지 않았을 때의 기본값이다.
- `aescbc`: CBC 방식이 패딩 오라클 공격(복호화 오류 응답으로 평문을 알아내는 공격)에 약해 공식 문서가 권하지 않는다.
- `aesgcm`: 쓰기 20만 번마다 키를 바꿔야 해서, 자동 회전이 없으면 권하지 않는다.
- `secretbox`: 강하지만 키가 컨트롤 플레인 호스트의 설정 파일에 있다. 앞의 둘도 마찬가지다.
- `kms` v2: 키를 클러스터 밖 KMS(키를 보관하고 암호화를 대신 해 주는 서비스)에 둔다.

키가 설정 파일에 있으면 etcd 백업 유출은 막아도, 컨트롤 플레인 호스트를 털리면 키도 함께 털린다. KMS provider는 봉투 암호화(envelope encryption)로 이 문제를 푼다. 데이터는 데이터 키(DEK)로 암호화하고, DEK는 KMS 안에만 있는 키 암호화 키(KEK)로 감싸서 감싼 DEK만 데이터 옆에 둔다.

v2는 KEK가 바뀔 때만 바뀌는 시드(seed)에 난수를 섞어 쓰기마다 일회용 DEK를 만들어서, 쓰기마다 KMS를 부르던 v1보다 호출이 크게 준다. 같은 시드로 몇 번을 쓸지 통제할 수 없어서, 공식 문서는 KEK를 적어도 90일마다 바꾸라고 권한다.

모드를 바꿔 가며 백업 열어 보기를 눌러, 같은 Secret이 백업 파일에 어떤 모양으로 남는지 비교한다.

<figure class="fig" data-figure="secret-management-etcd">
  <figcaption>암호화 없음과 KMS v2에서 etcd 백업에 남는 값</figcaption>
</figure>

암호화가 없으면 백업을 `etcdctl get`으로 열기만 해도 비밀번호가 보인다. KMS v2에서는 값이 `k8s:enc:kms:v2:<provider 이름>:` 접두어가 붙은 암호문으로 남고, 감싼 DEK를 풀 KEK가 클러스터 밖에 있어 백업만으로는 읽지 못한다.

암호화는 etcd에 쓰는 한 단계만 바꾼다. API로 읽으면 여전히 평문이 나오고, 설정을 켜기 전에 쓴 Secret은 다시 쓰기 전까지 평문 그대로다.

```bash
kubectl get secrets --all-namespaces -o json | kubectl replace -f -
```

암호화를 켜도 Secret 매니페스트를 git에 올릴 수 없다는 사정은 그대로다.

## 암호문과 참조

git에서 평문을 빼는 방법은 둘이다. 값을 암호문으로 바꿔 git에 두거나, git에는 "어느 저장소의 어느 값"이라는 참조만 두고 값은 git 밖 저장소에 둔다. 어느 쪽이든 평문은 어딘가에서 다시 생기고, 그 시점은 세 가지다.

- 렌더링 때: Argo CD에서 git을 읽어 매니페스트를 만드는 repo-server가 값을 채운다. argocd-vault-plugin(AVP)
- 컨트롤러가 받을 때: 클러스터 안에서 객체를 지켜보며 일하는 프로그램(컨트롤러)이 Secret을 만든다. Sealed Secrets, External Secrets Operator(ESO)
- 파드가 시작할 때: kubelet이 볼륨을 붙이며 값을 가져온다. Secrets Store CSI Driver

아래 그림처럼 평문이 늦게 생길수록 쥐는 곳이 준다.

<figure class="fig" data-figure="secret-management-timing">
  <figcaption>방식마다 평문이 되는 단계</figcaption>
</figure>

### Sealed Secrets

Sealed Secrets는 누구나 잠글 수 있지만 개인키로만 여는 공개키 암호를 쓴다. 컨트롤러가 처음 뜰 때 4096비트 RSA 키 쌍을 만들고, 개발자는 공개키로 봉인한 SealedSecret만 git에 올린다. 값은 일회용 AES-256-GCM 세션 키로 암호화하고, 그 세션 키를 RSA-OAEP로 감싼다.

기본 범위(strict)에서는 이름과 네임스페이스가 암호문에 묶여, 다른 네임스페이스로 복사하면 풀리지 않는다. 컨트롤러는 30일마다 새 키를 만들고 옛 키를 지우지 않는다. 키 갱신은 비밀번호 교체가 아니라서, 값을 바꾸고 다시 봉인하는 일은 사람이 한다.

개인키는 컨트롤러 네임스페이스의 일반 Secret에 저장된다. etcd 암호화가 없으면 git의 모든 SealedSecret을 푸는 키가 etcd에 평문으로 있는 셈이고, 이 키를 잃으면 git의 SealedSecret을 아무도 풀지 못한다. **개인키 백업과 etcd 암호화**를 함께 챙긴다.

### 렌더링 주입

AVP는 Argo CD의 설정 관리 플러그인(CMP, 매니페스트를 만드는 외부 도구)으로, repo-server 파드에 사이드카(같은 파드에서 함께 도는 보조 컨테이너)로 붙는다. values.yaml의 값 자리에 `<path:경로#키>`를 적어 두면, `helm template`(Helm 차트를 YAML로 펼치는 명령)으로 만든 YAML에서 자리표시자를 찾아 저장소의 값으로 바꾼다. AWS Secrets Manager(ASM)라면 경로에 시크릿 이름을, `#` 뒤에 그 안의 키를 적는다.

```yaml
extraEnvs:
  - name: REDIS_PASSWORD
    value: <path:company/dev#redis-password>
```

아래 그림처럼 값은 repo-server 안에서 평문이 되고, 완성된 매니페스트는 Argo CD가 캐시로 쓰는 Redis에 평문으로 남는다.

<figure class="fig" data-figure="secret-management-avp">
  <figcaption>자리표시자가 repo-server 안에서 값으로 바뀌는 흐름</figcaption>
</figure>

캐시는 값 교체도 막는다. repo-server는 같은 커밋이면 매니페스트 생성 결과를 캐시에서 꺼내 쓰고(`--repo-cache-expiration` 기본 24시간), AVP를 다시 돌리지 않는다. ASM에서 값을 바꾼 뒤 Refresh와 Sync를 눌러도 옛 값이 적용되고, 캐시를 버리는 Hard Refresh를 해야 AVP가 새 값을 가져온다.

```bash
argocd app diff <앱> --hard-refresh
```

아무도 Hard Refresh를 하지 않으면, 이미지 태그만 바꾼 다음 배포가 렌더링을 다시 하면서 비밀번호도 함께 바뀐다. 비밀번호 교체가 상관없는 배포에 섞여 들어가 장애 원인을 가리기 어려워진다.

Argo CD 문서는 이 방식을 권하지 않는다.

- Redis 캐시와 repo-server API로 평문이 보인다.
- 시크릿 갱신이 앱 배포에 묶인다.
- 렌더링 결과를 git에 커밋하는 Rendered Manifests 패턴과 맞지 않는다.

쓰는 동안은 네트워크 정책으로 Redis와 repo-server로 가는 직접 접근을 막는다.

### 클러스터 주입

ESO는 git에 둔 ExternalSecret을 보고 외부 저장소에서 값을 읽어 Secret을 만든다. `refreshInterval`(기본 1시간)마다 다시 읽어서, 저장소의 값이 바뀌면 Secret도 따라 바뀐다.

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: redis
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-store
  target:
    name: redis
  data:
    - secretKey: password
      remoteRef:
        key: company/dev
        property: redis-password
```

아래 그림처럼 Argo CD는 참조만 동기화하고, 값은 ESO와 저장소 사이에서만 오간다.

<figure class="fig" data-figure="secret-management-eso">
  <figcaption>ExternalSecret이 Secret이 되기까지</figcaption>
</figure>

결과물이 일반 Secret이라 기존 차트는 `secretKeyRef`로 그대로 읽는다. 같은 이유로 etcd 저장 암호화는 여전히 필요하다.

Secrets Store CSI Driver는 Secret 객체를 거치지 않는다. CSI는 외부 스토리지를 파드 볼륨으로 붙이는 표준 인터페이스다. 파드가 시작할 때 kubelet이 CSI 볼륨을 붙이면, 드라이버가 저장소별 provider(Azure, AWS, GCP, Vault)에게 값을 받아 파드의 tmpfs 볼륨에 파일로 쓴다. `secretObjects`로 Secret도 만들 수 있는데, 볼륨을 붙인 파드가 있는 동안만 존재한다.

AKS 애드온으로 쓸 때는 노드의 파드가 나눠 쓰는 관리 ID 대신 서비스 계정마다 나뉘는 워크로드 ID로 Key Vault에 접근하고, 읽기 전용 역할만 준다.

## Vault 내부 구조

ASM과 Key Vault는 넣어 둔 값을 꺼내 주는 저장소다. 여러 서비스가 같은 DB 계정을 나눠 쓰고, 값이 새면 다음 교체 때까지 쓸 수 있다. HashiCorp Vault는 요청마다 수명이 붙은 계정을 만들어 이 시간을 줄이고, AVP, ESO, CSI provider가 모두 백엔드로 지원한다.

### 봉인과 해제

Vault는 데이터를 담는 스토리지 백엔드를 믿지 않는다. 데이터가 Vault를 떠날 때마다 배리어(barrier)가 256비트 AES-GCM으로 암호화해서, 백엔드에는 암호문만 있다. 키는 세 겹이다.

- 암호화 키: 데이터를 암호화한다. 키링(keyring)에 들어 있다.
- 루트 키(root key): 키링을 암호화한다. 백엔드에 다른 데이터와 함께 암호문으로 있다.
- 봉인 해제 키(unseal key): 루트 키를 푼다. Vault 어디에도 저장하지 않는다.

Vault는 시작할 때마다 봉인(sealed) 상태다. 백엔드는 읽을 수 있지만 루트 키를 풀 수 없어 어떤 값도 복호화하지 못한다. 기본 설정은 봉인 해제 키를 샤미르 비밀 분산(Shamir's Secret Sharing)으로 조각 5개로 나누고, 그중 3개가 모여야 키를 다시 맞춘다.

```bash
vault operator init               # 기본 -key-shares=5 -key-threshold=3
vault operator unseal <조각>       # 서로 다른 조각으로 세 번 하면 Unsealed
```

조각을 나눠 들면 혼자 Vault를 열지 못하지만, 재시작마다 세 사람이 모여야 한다. 보통은 자동 해제(auto unseal)로 봉인 해제 키 보관을 클라우드 KMS나 HSM(키를 밖으로 꺼낼 수 없는 전용 장비)에 맡긴다. 이때 운영자가 받는 복구 키로는 루트 키를 풀 수 없어서, KMS에 닿지 못하면 Vault도 열리지 않는다.

### 토큰과 리스

Vault에 값을 묻는 쪽은 먼저 인증 방법(auth method)으로 로그인해 토큰을 받는다. 쿠버네티스 인증은 파드의 서비스 계정 JWT(쿠버네티스가 서명한 신원 토큰)를 받아 TokenReview API로 API 서버에 진짜인지 묻고, 역할에 묶인 서비스 계정과 네임스페이스면 정책(policy)이 붙은 토큰을 준다. 정책에 없는 경로는 모두 거부된다.

동적 시크릿과 service 토큰(기본 종류의 Vault 토큰)에는 리스(lease)가 붙는다. 리스는 유효 시간(TTL)과 갱신 가능 여부를 담고, 서버 설정의 기본 TTL과 최대 TTL은 둘 다 768시간(32일)이다. 리스가 끝나면 만료 관리자(expiration manager)가 비밀값을 폐기한다.

### 동적 시크릿

리스가 힘을 쓰는 곳은 동적 시크릿(dynamic secret)이다. database 시크릿 엔진은 비밀번호를 저장해 두지 않고, 요청이 올 때마다 역할에 적은 `creation_statements`로 DB 계정을 새로 만들어 돌려준다. 서비스마다 계정이 달라 DB 감사 로그에서 접속자가 갈리고, 리스가 끝나면 Vault가 그 계정을 지운다.

{% raw %}
```bash
vault write database/roles/app db_name=pg default_ttl=1h max_ttl=24h \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';"
vault read database/creds/app     # 읽을 때마다 새 계정과 lease_id
```
{% endraw %}

아래 그림처럼 계정이 TTL과 함께 사라지므로, 평문이 어딘가에 새도 쓸 수 있는 시간이 TTL로 묶인다. 대신 앱이 한 번 읽은 값을 계속 쓰면 만료 순간 접속이 끊긴다.

<figure class="fig" data-figure="secret-management-lease">
  <figcaption>TTL 1시간 동적 계정의 리스 만료와 연장</figcaption>
</figure>

그래서 동적 시크릿은 갱신을 대신 해 주는 Vault Agent와 함께 쓴다. Agent Injector는 파드에 `vault.hashicorp.com/agent-inject: "true"` 어노테이션이 있으면, 파드 생성 요청을 가로채 고치는 웹훅으로 init 컨테이너(본 컨테이너보다 먼저 한 번 도는 컨테이너)와 사이드카를 끼워 넣는다. 값은 `/vault/secrets` 아래 공유 메모리 볼륨에 파일로 남는다. 사이드카는 리스를 다음 기준으로 관리한다.

- 갱신할 수 있는 리스: TTL의 2/3가 지나면 연장한다.
- 갱신할 수 없는 리스: TTL의 90%에서 새 값을 받아 파일을 다시 쓴다.
- 리스가 없는 KV 값: 5분마다 다시 읽는다(`static_secret_render_interval`).

## 파드의 값 교체

저장소에서 값을 바꿔도 실행 중인 프로세스가 바로 새 값을 보지는 않는다. Secret을 볼륨으로 붙였다면 kubelet이 파일을 갱신한다. kubelet은 Secret을 캐시에 두고 기본 전략(`Watch`)에서 API 서버의 watch로 변경을 받는다. 파드 볼륨에 반영되기까지는 동기화 주기(`syncFrequency`, 기본 1분)에 캐시 전파 지연을 더한 만큼 걸린다.

파일은 원자적으로, 즉 바뀌는 도중의 상태가 보이지 않게 바뀐다. kubelet은 새 값을 타임스탬프 이름의 숨은 디렉터리에 다 쓴 뒤, `..data` 심볼릭 링크를 그 디렉터리로 rename 한 번에 바꾼다. 앱이 여는 `password`는 `..data/password`를 가리키는 링크라서 반쯤 쓰인 파일을 읽지 않는다.

```text
$ ls -la /etc/db
..2026_11_05_03_00_00.123456789/
..data -> ..2026_11_05_03_00_00.123456789
password -> ..data/password
```

출력은 줄인 예시다. 볼륨의 파일 하나만 골라 붙이는 subPath는 이 링크를 거치지 않고 컨테이너가 시작할 때의 파일을 직접 붙인다. 그래서 `..data`가 바뀌어도 옛 파일을 계속 본다.

CSI 볼륨은 드라이버가 저장소를 다시 읽어야 바뀐다. 교체 감지(rotation)는 기본으로 꺼져 있고, 켜면 `--rotation-poll-interval`(기본 2분)마다 저장소를 다시 읽어 파일과 동기화된 Secret을 고친다. AKS 애드온에서는 `--enable-secret-rotation`으로 켠다.

모드를 바꿔 가며 Key Vault 값 바꾸기를 눌러, 맨 아래 줄의 앱이 읽는 값이 언제 새 값이 되는지 비교한다.

<figure class="fig" data-figure="secret-management-rotation">
  <figcaption>값 교체 뒤 파일로 읽는 앱과 환경 변수로 읽는 앱 (2분 폴링 기준)</figcaption>
</figure>

파일로 읽는 앱은 다음 폴링에서 파일이 바뀌어 2분 안에 새 값을 본다. 환경 변수는 컨테이너가 시작할 때 프로세스에 복사되므로, 환경 변수로 읽는 앱은 Secret이 바뀐 뒤에도 그 복사본을 쥐고 있어 재시작해야 새 값을 본다.

- 파일로 읽기: 앱이 파일 변경을 감지하거나 요청마다 다시 읽게 한다. subPath는 쓰지 않는다.
- 환경 변수로 읽기: Reloader처럼 Secret 변경을 보고 롤링 재시작하는 도구를 함께 둔다.

## 정리

- base64는 표기법이라, 기본 설정에서 비밀번호는 etcd, 노드, 파드를 만들 수 있는 사람에게 평문으로 열려 있다.
- 저장 시 암호화는 etcd만 막는다. KMS v2는 KEK를 클러스터 밖에 둔다.
- git에는 암호문이나 참조만 둔다. 평문이 늦게 생길수록 쥐는 곳이 줄고, AVP는 Redis에 평문을 남긴다.
- Vault 동적 시크릿은 리스가 끝나면 계정을 지워 새어 나간 평문의 수명을 TTL로 묶는다.
- Secret 볼륨은 1분 남짓에 갱신되고, subPath와 환경 변수는 재시작해야 새 값을 본다.

## 참고

- [Kubernetes — Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Kubernetes — Distribute Credentials Securely](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/)
- [Kubernetes — Encrypting Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
- [Kubernetes — KMS provider](https://kubernetes.io/docs/tasks/administer-cluster/kms-provider/)
- [Kubernetes — Kubelet Configuration](https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/)
- [Kubernetes 소스 — pkg/volume/util/atomic_writer.go](https://github.com/kubernetes/kubernetes/blob/master/pkg/volume/util/atomic_writer.go)
- [Argo CD — Secret Management](https://argo-cd.readthedocs.io/en/stable/operator-manual/secret-management/)
- [Argo CD — argocd-repo-server](https://argo-cd.readthedocs.io/en/stable/operator-manual/server-commands/argocd-repo-server/)
- [argocd-vault-plugin — How it works](https://argocd-vault-plugin.readthedocs.io/en/stable/howitworks/)
- [argocd-vault-plugin — Usage](https://argocd-vault-plugin.readthedocs.io/en/stable/usage/)
- [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)
- [Sealed Secrets — crypto.md](https://github.com/bitnami-labs/sealed-secrets/blob/main/docs/developer/crypto.md)
- [External Secrets Operator — ExternalSecret](https://external-secrets.io/latest/api/externalsecret/)
- [Secrets Store CSI Driver — Concepts](https://secrets-store-csi-driver.sigs.k8s.io/concepts.html)
- [Secrets Store CSI Driver — Secret Auto Rotation](https://secrets-store-csi-driver.sigs.k8s.io/topics/secret-auto-rotation.html)
- [Microsoft Learn — CSI Driver configuration options](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-configuration-options)
- [Microsoft Learn — CSI Driver identity access](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-identity-access)
- [Vault — Seal/Unseal](https://developer.hashicorp.com/vault/docs/concepts/seal)
- [Vault — Security model](https://developer.hashicorp.com/vault/docs/internals/security)
- [Vault — operator init](https://developer.hashicorp.com/vault/docs/commands/operator/init)
- [Vault — Lease](https://developer.hashicorp.com/vault/docs/concepts/lease)
- [Vault — Server configuration](https://developer.hashicorp.com/vault/docs/configuration)
- [Vault — Kubernetes auth method](https://developer.hashicorp.com/vault/docs/auth/kubernetes)
- [Vault — Database secrets engine](https://developer.hashicorp.com/vault/docs/secrets/databases)
- [Vault — Agent Injector](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/injector)
- [Vault — Agent templates](https://developer.hashicorp.com/vault/docs/agent-and-proxy/agent/template)
- [Reloader](https://github.com/stakater/Reloader)
- 원글: [ArgoCD + Vault Plugin](https://kimjanghyun1010.tistory.com/109), [azure keyvault secrets provider](https://kimjanghyun1010.tistory.com/52)
