---
title: 시크릿 관리
description: 쿠버네티스 Secret이 평문으로 남는 자리부터 git에 암호화해 두기, 렌더링 때 주입하기, 클러스터 안에서 끌어오기까지 시크릿이 파드에 닿는 경로를 정리했다.
date: 2026-11-05 12:00:00 +0900
series: CI/CD와 IaC
tags: [secret, kubernetes, argocd, gitops, vault, azure]
scripts: [figures/secret-management.js]
---

## GitOps와 시크릿

GitOps로 배포하면 클러스터에 올라가는 것은 전부 git에 있어야 한다. replicas나 이미지 태그는 그대로 적으면 되지만, DB 비밀번호를 values.yaml에 적어 푸시하면 문제가 생긴다.

git은 지운 것도 히스토리에 남긴다. 한 번 푸시한 비밀번호는 다음 커밋에서 지워도 모든 클론과 CI 작업 폴더에 그대로 있다. 두 장면에서 설정값과 비밀번호가 같은 길을 가며 어디에 흔적을 남기는지 본다.

<figure class="fig" data-figure="secret-management-git">
  <figcaption>설정값과 비밀번호가 git을 거쳐 클러스터까지 가는 길</figcaption>
</figure>

설정값은 어디에 남아도 상관없지만 비밀번호는 거쳐 간 자리마다 평문으로 남는다. 한 번 새어 나간 값은 회수할 수 없어서, 값을 바꾸는 것 말고는 방법이 없다.

그래서 시크릿은 git에 평문으로 두지 않는다. 방법을 고를 때는 두 가지를 본다.

- 저장 위치: git 안에 암호문으로 두는지, git 밖 시크릿 저장소(AWS Secrets Manager, Azure Key Vault, Vault)에 두는지
- 평문이 되는 시점: 매니페스트를 렌더링할 때, 클러스터 안 컨트롤러가 받을 때, 파드가 시작할 때

## 쿠버네티스 Secret

### base64 인코딩

Secret 매니페스트를 열면 값이 알아볼 수 없는 문자열이라 암호화된 것처럼 보인다. `data` 필드의 값은 base64로 인코딩한 것일 뿐이고, 키 없이 누구나 원래 값으로 되돌린다.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db
type: Opaque
data:
  password: czNjcjN0   # echo -n s3cr3t | base64
```

값이 Secret이 되어 etcd에 들어갔다가 다시 읽혀 나오는 과정을 따라가 보자. 어느 단계에도 키가 없다는 점을 본다.

<figure class="fig" data-figure="secret-management-base64">
  <figcaption>base64로 적은 값이 etcd에 저장되고 다시 읽히는 과정</figcaption>
</figure>

base64는 바이너리 값도 YAML에 담으려고 쓰는 표기법이다. 그래서 Secret 매니페스트를 git에 올리는 것은 평문을 올리는 것과 같다.

쿠버네티스 문서는 Secret을 안전하게 쓰려면 최소한 아래를 하라고 적어 두었다.

- 저장 시 암호화(encryption at rest)를 켠다.
- RBAC로 Secret 접근을 최소로 준다. 네임스페이스에 파드를 만들 수 있는 사람은 그 네임스페이스의 Secret을 모두 읽을 수 있다. Deployment를 만들 수 있는 권한도 마찬가지다.
- Secret을 필요한 컨테이너에만 연결한다.
- 외부 시크릿 저장소를 검토한다.

### etcd 저장 암호화

etcd 백업 파일이 밖으로 나가면 그 안의 Secret이 그대로 읽힌다. 기본 설정의 API 서버는 Secret을 etcd에 평문으로 쓰기 때문이다.

API 서버에 `--encryption-provider-config`로 EncryptionConfiguration을 주면 etcd에 쓰기 전에 암호화한다. 쓸 때는 providers 목록의 첫 번째를 쓰고, 읽을 때는 목록을 차례로 시도한다.

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

provider는 키를 어디에 두느냐로 나뉜다.

- `identity`: 암호화하지 않는다. 기본값이다.
- `aesgcm`, `secretbox`: 키를 설정 파일에 적는다. etcd 유출은 막지만 키가 컨트롤 플레인 호스트에 있어서, 호스트를 털리면 키도 같이 털린다. `aescbc`는 패딩 오라클 공격에 약해 권하지 않는다.
- `kms` v2: 키를 클러스터 밖 KMS에 둔다. 1.29부터 stable이다. etcd와 KMS를 둘 다 털어야 평문이 나온다.

아래 데모에서 모드를 바꿔 가며 etcd 백업을 열어 본다. 같은 Secret이 백업 파일에 어떤 모양으로 남는지 지켜본다.

<figure class="fig" data-figure="secret-management-etcd">
  <figcaption>암호화 없음과 KMS v2에서 etcd 백업에 남는 값</figcaption>
</figure>

암호화가 없으면 백업 파일만으로 비밀번호가 읽힌다. KMS v2를 켜면 etcd에는 `k8s:enc:kms:v2:`로 시작하는 암호문만 남고, 데이터 키(DEK)를 감싸는 키는 클러스터 밖 KMS에 있다. 바뀌는 것은 etcd에 쓰기 직전 한 단계뿐이라, `kubectl get secret` 권한이 있는 사람에게는 여전히 평문이 보인다.

설정을 켜도 이미 저장된 Secret은 평문 그대로다. 한 번씩 다시 써야 암호화된다.

```bash
kubectl get secrets --all-namespaces -o json | kubectl replace -f -
```

관리형 클러스터는 API 서버 설정을 직접 바꿀 수 없어서 클라우드의 KMS 연동을 켠다. AKS는 1.33 이상 새 클러스터에 KMS 데이터 암호화(KMS data encryption)를 권한다. KMS 키를 지우면 그 키로 암호화한 Secret을 되살릴 수 없으니 키 삭제 보호부터 확인한다.

직접 구축한 클러스터라면 EncryptionConfiguration의 첫 provider가 `identity`가 아닌지부터 본다.

## 시크릿 주입 시점

git에 평문을 두지 않는 방법은 모두 평문이 생기는 시점을 뒤로 미룬다. git에는 암호문이나 참조만 두고, 어느 단계에서 누가 풀어 주느냐로 방식이 갈린다.

- 렌더링 때: Argo CD repo-server가 매니페스트를 만들면서 값을 채운다. argocd-vault-plugin, Argo CD에서 쓰는 SOPS(KSOPS, helm-secrets)
- 클러스터 안 컨트롤러가 받을 때: 동기화가 끝난 뒤 컨트롤러가 Secret을 만든다. Sealed Secrets, External Secrets Operator
- 파드가 시작할 때: kubelet이 볼륨을 붙이면서 값을 가져온다. Secrets Store CSI Driver

세 장면에서 칩이 git부터 파드까지 가는 동안 어느 단계에서 평문(주황)으로 바뀌는지 본다.

<figure class="fig" data-figure="secret-management-timing">
  <figcaption>방식마다 평문이 되는 단계</figcaption>
</figure>

평문이 늦게 생길수록 평문을 쥐는 곳이 줄어든다. 렌더링 때 풀면 Argo CD가 평문을 쥐고, 클러스터 컨트롤러가 풀면 Argo CD는 암호문이나 참조만 본다. 파드 시작 때 풀면 Secret 객체를 만들지 않아도 된다.

늦게 푼다고 etcd 걱정이 사라지지는 않는다. Sealed Secrets도 ESO도 결과물은 쿠버네티스 Secret이라 etcd에 남으니, 앞의 저장 암호화는 어느 방식이든 필요하다.

Argo CD 공식 문서도 같은 기준으로 나눈다. 대상 클러스터에서 시크릿을 채우는 방식을 강하게 권하고, 매니페스트 생성 때 주입하는 방식은 강하게 말린다.

## git에 암호화해 두기

값 자체를 암호문으로 바꿔 git에 둔다. 외부 저장소가 없어도 되고, 값이 바뀐 이력이 커밋으로 남는다.

### Sealed Secrets

Sealed Secrets는 공개키 암호를 쓴다. 클러스터 안 컨트롤러가 키 쌍을 만들고, 개발자는 공개키로 봉인한 SealedSecret만 git에 올린다. 개인키는 컨트롤러만 가지고 있어서 저장소가 공개돼도 풀 수 없다.

개인키가 클러스터 밖으로 한 번도 나가지 않는 것을 보자.

<figure class="fig" data-figure="secret-management-sealed">
  <figcaption>공개키로 봉인하고 클러스터 안에서 푸는 흐름</figcaption>
</figure>

```bash
kubectl create secret generic db --from-literal=password=s3cr3t \
  --dry-run=client -o yaml | kubeseal --format yaml > db-sealed.yaml
```

Argo CD는 SealedSecret을 다른 리소스처럼 동기화만 하고 평문은 보지 않는다. 평문 Secret은 컨트롤러가 클러스터 안에서 만든다.

컨트롤러는 30일마다 새 봉인 키를 만들고 옛 키도 지우지 않는다. 키를 갱신해도 이미 올린 값은 그대로라서, 비밀번호 자체를 주기적으로 바꾸고 다시 봉인하는 일은 사람이 한다. 개인키를 잃으면 git의 SealedSecret을 아무도 풀 수 없으니 **개인키 백업**부터 챙긴다.

### SOPS

SOPS는 YAML이나 JSON 파일을 트리로 다뤄 키 이름은 평문으로 두고 값만 암호화한다. diff에서 어느 항목이 바뀌었는지 보여서 리뷰가 쉽다. 암호화 키는 age, PGP, AWS KMS, GCP KMS, Azure Key Vault 중에서 고른다.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db
stringData:
  password: ENC[AES256_GCM,data:...,type:str]
sops:
  age: [...]
```

복호화를 어디서 하느냐는 GitOps 도구마다 다르다. 두 장면에서 키가 놓인 자리와 평문이 남는 자리를 견줘 보자.

<figure class="fig" data-figure="secret-management-sops">
  <figcaption>같은 SOPS 파일을 Flux와 Argo CD가 푸는 자리</figcaption>
</figure>

Flux는 kustomize-controller가 클러스터 안에서 적용 직전에 푼다. Argo CD는 SOPS를 직접 풀지 않아서 KSOPS나 helm-secrets를 repo-server에 붙이고, 그러면 복호화가 렌더링 때 일어난다.

같은 SOPS 파일이어도 Argo CD에서는 다음 묶음의 렌더링 주입과 같은 약점을 진다. Argo CD를 쓴다면 SOPS보다 Sealed Secrets나 클러스터에서 끌어오는 방식부터 본다.

## 렌더링 때 주입하기

git에는 값 대신 자리표시자를 두고, Argo CD가 매니페스트를 만들 때 외부 저장소에서 값을 가져와 채운다. 기존 Helm 차트의 values만 고치면 돼서 붙이기는 쉽다.

### argocd-vault-plugin

argocd-vault-plugin(AVP)은 Argo CD의 설정 관리 플러그인(CMP)으로 돈다. values.yaml의 값 자리에 `<path:경로#키>`를 적어 두면, repo-server가 `helm template`으로 만든 YAML에서 자리표시자를 찾아 저장소의 값으로 바꾼다.

```yaml
extraEnvs:
  - name: REDIS_ADDRESSES
    value: <path:company/dev#redis-addresses>
  - name: REDIS_PASSWORD
    value: <path:company/dev#redis-password>
```

AWS Secrets Manager(ASM)에서는 경로 자리에 시크릿 이름을, `#` 뒤에 그 시크릿 안의 키를 적는다. 백엔드는 `AVP_TYPE`으로 고르고 Vault, Azure Key Vault 등도 된다.

아래 그림에서 자리표시자가 값으로 바뀌는 자리와, 바뀐 매니페스트가 어디에 남는지 본다.

<figure class="fig" data-figure="secret-management-avp">
  <figcaption>자리표시자가 repo-server 안에서 값으로 바뀌는 흐름</figcaption>
</figure>

값은 repo-server 안에서 평문이 되고, Argo CD는 완성된 매니페스트를 Redis에 평문으로 캐시한다. git에서는 비밀번호를 뺐지만 Argo CD 내부에 평문이 생긴다.

그래서 AVP를 쓴다면 repo-server와 Redis로 가는 네트워크 접근을 막아 둔다. Argo CD 문서가 드는 완화책도 이것이다.

### 설치와 설정

AVP는 repo-server 파드에 사이드카로 붙인다. 사이드카는 Argo CD 이미지로 `argocd-cmp-server`를 띄우고, repo-server와 `/var/run/argocd`의 유닉스 소켓으로 주고받는다. 아래는 argo-cd Helm 차트의 `repoServer` 값이다.

```yaml
extraContainers:
  - name: avp-helm
    command: [/var/run/argocd/argocd-cmp-server]
    image: quay.io/argoproj/argocd:v3.6.3   # 쓰는 Argo CD와 같은 버전
    securityContext:
      runAsNonRoot: true
      runAsUser: 999
    env:
      - name: AVP_TYPE
        value: awssecretsmanager
      - name: AWS_REGION
        value: ap-northeast-2
    volumeMounts:
      - { name: var-files, mountPath: /var/run/argocd }
      - { name: plugins, mountPath: /home/argocd/cmp-server/plugins }
      - { name: cmp-tmp, mountPath: /tmp }
      - { name: argocd-cmp-cm, mountPath: /home/argocd/cmp-server/config/plugin.yaml, subPath: avp-helm.yaml }
      - { name: custom-tools, mountPath: /usr/local/bin/argocd-vault-plugin, subPath: argocd-vault-plugin }
```

`custom-tools`는 initContainer가 AVP 바이너리를 내려받아 채우는 볼륨이다. 플러그인이 할 일은 `configs.cmp.create: true`로 두고 `configs.cmp.plugins`에 적는다. 차트가 이 값으로 `argocd-cmp-cm`을 만든다.

```yaml
avp-helm:
  allowConcurrency: true
  discover:
    find:
      command: [sh, -c, "find . -name Chart.yaml"]
  generate:
    command:
      - sh
      - -c
      - |
        helm dependency build . >/dev/null 2>&1 || true
        helm template $ARGOCD_APP_NAME -n $ARGOCD_APP_NAMESPACE ${ARGOCD_ENV_HELM_ARGS} . |
        argocd-vault-plugin generate -
  lockRepo: false
```

Application은 `source.helm` 대신 `source.plugin`을 쓴다. env 이름이 사이드카에 어떤 이름으로 도착하는지 보자.

<figure class="fig" data-figure="secret-management-cmp">
  <figcaption>Application의 env가 사이드카까지 가는 길</figcaption>
</figure>

Argo CD는 Application에 적은 env 이름 앞에 `ARGOCD_ENV_`를 붙여 넘긴다. Application에는 접두어 없이 적고, plugin 명령에서 `ARGOCD_ENV_`를 붙여 읽는다. Application에 `ARGOCD_ENV_`까지 적으면 접두어가 두 번 붙어 명령에서 읽히지 않는다.

```yaml
# 기존
source:
  helm:
    valueFiles: [values-dev.yaml]
# 변경
source:
  plugin:
    name: avp-helm
    env:
      - name: HELM_ARGS
        value: -f values-dev.yaml
```

릴리스 이름은 plugin 명령이 `$ARGOCD_APP_NAME`으로 정한다. 기존 `releaseName`을 쓰던 앱은 이름이 바뀌어 리소스가 새로 만들어질 수 있으니, 옮기기 전에 `argocd app diff`로 렌더링 결과를 견준다.

자격증명은 AWS SDK의 기본 규칙을 따른다. 액세스 키를 Secret으로 넣으면 그 키를 회전할 일이 생기므로, EKS라면 repo-server 서비스 계정에 IAM 역할을 붙인다(IRSA).

`source.helm`을 `source.plugin`으로 바꾸는 일은 환경 수만큼 반복된다. valueFiles가 HELM_ARGS 문자열로 옮겨 가며 오타가 나기 쉬워서, 한 환경에서 diff를 확인한 뒤 넓힌다.

### 값 변경과 Hard Refresh

ASM에서 비밀번호를 바꾸고 Refresh와 Sync를 눌렀는데 클러스터의 값이 그대로다. repo-server는 같은 커밋이면 전에 만든 매니페스트를 캐시에서 꺼내 쓰고, AVP를 다시 돌리지 않는다.

모드를 바꿔 가며 ASM 값을 바꾼 뒤 새로고침해 본다. 캐시 줄의 밀린 값(주황)이 언제 새 값(파랑)으로 바뀌는지 지켜본다.

<figure class="fig" data-figure="secret-management-refresh">
  <figcaption>ASM 값을 바꾼 뒤 Refresh와 Hard Refresh</figcaption>
</figure>

Refresh는 캐시된 매니페스트를 다시 써서, 뒤이은 Sync도 v1을 적용한다. Hard Refresh는 매니페스트 캐시까지 버려 AVP가 다시 돌고, 그다음 Sync가 v2를 적용한다. 둘의 차이는 **캐시를 버리느냐** 하나뿐이다.

```bash
argocd app diff <앱> --hard-refresh
```

Sync가 바꾸는 것은 Secret이고 파드는 그대로다. 환경 변수로 읽는 앱은 재시작해야 새 값을 본다.

### 렌더링 주입의 한계

ASM 값을 월요일에 바꾸고 아무도 Hard Refresh를 누르지 않았다. 수요일에 이미지 태그만 바꾼 배포가 나가자 비밀번호도 같이 바뀌었다. 새 커밋이 생기면 캐시가 맞지 않아 렌더링을 다시 하고, 그때 AVP가 새 값을 가져오기 때문이다.

아래 그림에서 관련 없는 커밋이 생기는 순간 클러스터의 Secret이 함께 바뀌는 것을 본다.

<figure class="fig" data-figure="secret-management-render-risk">
  <figcaption>시크릿 변경이 관련 없는 배포에 섞여 반영되는 과정</figcaption>
</figure>

렌더링 주입에서는 시크릿이 반영되는 시점이 앱 배포에 묶인다. 장애가 나면 이미지 태그 변경과 비밀번호 변경 중 어느 쪽이 원인인지 가리기 어렵다.

Argo CD 공식 문서가 이 방식을 말리는 이유도 세 가지다.

- 보안: Argo CD가 시크릿에 접근해야 하고, 생성한 매니페스트를 Redis에 평문으로 캐시한다.
- 사용성: 시크릿 갱신이 앱 동기화에 묶여, 관련 없는 배포에 시크릿 변경이 섞여 들어간다.
- 렌더링된 매니페스트 패턴(Rendered Manifests pattern)과 함께 쓸 수 없다.

Argo CD는 이 방식을 계속 지원하지만 새 기능이나 개선은 우선하지 않는다고 적었다. AVP 저장소도 마지막 릴리스가 v1.18.1(2024년 6월)이고 기본 브랜치의 마지막 커밋이 2024년 10월이다(2026년 11월 확인, 보관 처리는 되지 않음).

새로 도입한다면 다음 묶음의 방식부터 검토한다. 이미 AVP를 쓰고 있다면 Redis와 repo-server 접근을 막아 두고, 새 앱부터 옮긴다.

## 클러스터 안에서 끌어오기

git에는 "어느 저장소의 어느 값"이라는 참조만 두고, 클러스터 안 구성 요소가 저장소에서 값을 직접 가져온다. Argo CD는 참조만 동기화하므로 평문을 보지 않는다.

### External Secrets Operator

External Secrets Operator(ESO)는 ExternalSecret 리소스를 보고 외부 저장소에서 값을 읽어 쿠버네티스 Secret을 만든다. `refreshInterval`마다 다시 읽어서, 저장소의 값이 바뀌면 Secret도 따라 바뀐다.

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: redis
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-store
    kind: SecretStore
  target:
    name: redis
  data:
    - secretKey: password
      remoteRef:
        key: company/dev
        property: redis-password
```

아래 그림에서 Argo CD가 다루는 것은 참조뿐이고, 값은 ESO와 저장소 사이에서만 오가는 것을 본다.

<figure class="fig" data-figure="secret-management-eso">
  <figcaption>ExternalSecret이 Secret이 되기까지</figcaption>
</figure>

결과물이 평범한 Secret이라 앱 쪽은 바꿀 것이 없다. 다만 Secret으로 etcd에 남으므로 앞의 저장 암호화가 그대로 필요하고, 값이 바뀌어도 환경 변수로 읽는 파드는 재시작해야 한다.

AVP에서 옮긴다면 `<path:...>` 자리표시자들을 ExternalSecret 하나로 모으고, 차트에서는 그 Secret을 `secretKeyRef`로 참조한다. 시크릿 갱신 주기가 앱 배포와 떨어진다.

### Secrets Store CSI Driver

Secrets Store CSI Driver는 Secret 객체를 거치지 않고 값을 파드에 파일로 붙인다. 파드가 시작할 때 kubelet이 CSI 볼륨을 붙이면, 드라이버가 provider에게 값을 받아 파드의 볼륨에 쓴다. 리눅스에서는 이 볼륨이 메모리 파일 시스템(tmpfs)이다.

드라이버는 저장소를 모르고, 저장소별 provider(Azure, AWS, GCP, Vault)가 gRPC로 값을 가져온다. 어느 저장소의 어느 값을 가져올지는 SecretProviderClass에 적는다.

파드 시작 한 번에 값이 어느 길로 들어오는지 따라가 보자.

<figure class="fig" data-figure="secret-management-csi">
  <figcaption>파드가 시작할 때 Key Vault 값이 파일이 되는 과정</figcaption>
</figure>

값은 노드의 드라이버와 provider를 지나 파드의 파일로 남는다. Secret 객체도 필요하면 `secretObjects`로 동기화하는데, 이 Secret은 볼륨을 붙인 파드가 시작한 뒤에 생기고 그 파드들이 모두 지워지면 함께 지워진다.

그래서 동기화한 Secret을 환경 변수로만 쓰는 파드라도 CSI 볼륨은 붙여 둬야 한다.

### AKS 애드온 설정

AKS에서는 드라이버와 Azure provider를 애드온으로 켠다. 노드마다 `aks-secrets-store-csi-driver`와 `aks-secrets-store-provider-azure` 파드가 뜬다.

```bash
az aks enable-addons --addons azure-keyvault-secrets-provider \
  --name <클러스터> --resource-group <리소스 그룹>
```

애드온을 켜면 노드 리소스 그룹(`MC_`)에 `azurekeyvaultsecretsprovider-<클러스터>` 관리 ID가 생겨 노드 VMSS에 붙는다. Key Vault에 접근하는 ID는 둘 중 하나를 쓴다.

- 애드온 관리 ID: 설정이 가장 짧다. 노드에 붙은 ID라서, SecretProviderClass에 이 ID를 적은 파드는 모두 같은 권한을 쓴다.
- 워크로드 ID: 서비스 계정 토큰을 Entra ID 토큰으로 바꾼다. 서비스 계정마다 권한을 나눌 수 있다. 예전 파드 관리 ID(pod-managed identity)는 2022년 10월에 폐기됐다.

두 장면에서 Key Vault가 받는 토큰이 누구 몫인지 견줘 보자.

<figure class="fig" data-figure="secret-management-aks-identity">
  <figcaption>애드온 관리 ID와 워크로드 ID의 권한 범위</figcaption>
</figure>

관리 ID는 같은 노드의 다른 앱도 같은 값을 읽을 수 있다. 앱마다 볼트나 값을 나눠야 하면 워크로드 ID를 쓴다.

어느 ID든 시크릿을 읽는 데는 `Key Vault Secrets User` 역할이면 된다. `Key Vault Administrator`를 주면 값을 지우고 권한까지 바꿀 수 있어서, ID가 털렸을 때 피해가 커진다.

```bash
ID=$(az aks show -g <리소스 그룹> -n <클러스터> \
  --query addonProfiles.azureKeyvaultSecretsProvider.identity.objectId -o tsv)
az role assignment create --role "Key Vault Secrets User" \
  --assignee-object-id $ID --assignee-principal-type ServicePrincipal \
  --scope $(az keyvault show -n <볼트> --query id -o tsv)
```

SecretProviderClass에는 볼트 이름과 테넌트, 가져올 값을 적는다. `userAssignedIdentityID`에는 애드온 ID의 clientId를 넣는다.

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: azure-kv
spec:
  provider: azure
  parameters:
    usePodIdentity: "false"
    useVMManagedIdentity: "true"
    userAssignedIdentityID: <애드온 ID의 clientId>
    keyvaultName: <볼트 이름>
    tenantId: <테넌트 ID>
    objects: |
      array:
        - |
          objectName: password1
          objectType: secret
  secretObjects:
    - secretName: db
      type: Opaque
      data:
        - objectName: password1   # 마운트된 파일 이름
          key: password           # 만들 Secret의 키
```

파드는 CSI 볼륨을 붙이고, 환경 변수는 동기화된 Secret을 참조한다.

```yaml
containers:
  - name: app
    env:
      - name: DB_PASSWORD
        valueFrom:
          secretKeyRef:
            name: db
            key: password
    volumeMounts:
      - name: kv
        mountPath: /mnt/secrets-store
        readOnly: true
volumes:
  - name: kv
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: azure-kv
```

`secretKeyRef`의 `key`는 Key Vault 객체 이름(`password1`)이 아니라 `secretObjects`에서 정한 키(`password`)다. 둘을 헷갈리면 파드가 `CreateContainerConfigError`로 시작하지 못한다.

애드온은 AKS가 버전을 관리해서 사용자가 올릴 일이 없다. 2026년 11월 기준 오픈소스 최신 릴리스는 드라이버 v1.6.2, Azure provider v1.8.2다. 직접 Helm으로 설치한 드라이버가 있으면 지우고 애드온으로 옮긴다.

### 값 교체와 재시작

Key Vault에서 비밀번호를 바꾸면 파드는 바로 새 값을 보지 못한다. 애드온은 기본으로 교체 감지(autorotation)가 꺼져 있고, 켜면 기본 2분마다 저장소를 다시 읽어 파일과 동기화된 Secret을 고친다.

```bash
az aks addon update -g <리소스 그룹> -n <클러스터> \
  --addon azure-keyvault-secrets-provider \
  --enable-secret-rotation --rotation-poll-interval 2m
```

모드를 바꿔 가며 Key Vault 값을 바꿔 본다. 맨 아래 줄에서 앱이 읽는 값이 언제 새 값(파랑)이 되는지 본다.

<figure class="fig" data-figure="secret-management-rotation">
  <figcaption>값 교체 뒤 파일로 읽는 앱과 환경 변수로 읽는 앱 (2분 폴링 기준)</figcaption>
</figure>

파일로 읽는 앱은 다음 폴링 때 파일이 바뀌어 2분 안에 새 값을 본다. 앱이 파일을 다시 읽어야 한다는 조건이 붙는다. 환경 변수는 파드가 시작할 때 한 번 정해져서, 동기화된 Secret이 바뀌어도 재시작 전까지 옛 값이다.

- 파일로 읽기: 앱이 파일 변경을 감지하거나 요청마다 다시 읽게 한다.
- 환경 변수로 읽기: Reloader처럼 Secret 변경을 보고 롤링 재시작하는 도구를 같이 둔다.
- `subPath`로 마운트한 파일은 교체되지 않는다. 쿠버네티스의 제약이라 재시작해야 한다.

## 방식 선택 기준

- 외부 저장소 없이 git만으로 끝내고 싶다: Sealed Secrets. 개인키 백업과 값 교체를 사람이 챙긴다.
- AWS Secrets Manager, Vault 같은 저장소가 이미 있다: External Secrets Operator. 결과가 일반 Secret이라 기존 차트를 그대로 쓴다.
- Secret 객체를 남기지 않거나 AKS에서 Key Vault를 쓴다: CSI 드라이버. 애드온으로 켜고 워크로드 ID로 권한을 나눈다.
- AVP를 이미 쓰고 있다: Redis와 repo-server 접근을 막고, 새 앱부터 ESO로 옮긴다.

어느 방식이든 Secret이 etcd에 남는 한 저장 암호화와 Secret 읽기 RBAC는 따로 챙긴다.

## 정리

| 방식 | 저장 위치 | 평문이 되는 때 | 기억할 점 |
|---|---|---|---|
| 쿠버네티스 Secret | etcd | 항상 (base64) | 저장 암호화와 RBAC를 따로 켠다 |
| Sealed Secrets | git (암호문) | 클러스터 컨트롤러가 받을 때 | 개인키 백업, 값 교체는 사람이 한다 |
| SOPS | git (값만 암호문) | Flux는 적용 직전, Argo CD는 렌더링 때 | Argo CD에서는 플러그인이 필요하다 |
| argocd-vault-plugin | 외부 저장소 | 렌더링 때 | Hard Refresh, Redis 평문 캐시. Argo CD가 권하지 않는다 |
| External Secrets Operator | 외부 저장소 | 컨트롤러가 읽을 때 | 결과는 일반 Secret. refreshInterval마다 갱신 |
| Secrets Store CSI Driver | 외부 저장소 | 파드 시작 때 | 동기화 Secret은 파드가 있을 때만. 환경 변수는 재시작 |

## 참고

- [Kubernetes — Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Kubernetes — Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
- [Kubernetes — Using a KMS provider for data encryption](https://kubernetes.io/docs/tasks/administer-cluster/kms-provider/)
- [Argo CD — Secret Management](https://argo-cd.readthedocs.io/en/stable/operator-manual/secret-management/)
- [Argo CD — Config Management Plugins](https://argo-cd.readthedocs.io/en/stable/operator-manual/config-management-plugins/)
- [Argo CD — argocd app get (--hard-refresh)](https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_app_get/)
- [argocd-vault-plugin — How it works](https://argocd-vault-plugin.readthedocs.io/en/stable/howitworks/)
- [argocd-vault-plugin — Backends](https://argocd-vault-plugin.readthedocs.io/en/stable/backends/)
- [argocd-vault-plugin — Usage (Refreshing values)](https://argocd-vault-plugin.readthedocs.io/en/stable/usage/)
- [argocd-vault-plugin — Releases](https://github.com/argoproj-labs/argocd-vault-plugin/releases)
- [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)
- [SOPS — Security (keys in cleartext, values encrypted)](https://getsops.io/docs/security/)
- [Flux — Manage Kubernetes secrets with SOPS](https://fluxcd.io/flux/guides/mozilla-sops/)
- [KSOPS](https://github.com/viaduct-ai/kustomize-sops)
- [External Secrets Operator — ExternalSecret](https://external-secrets.io/latest/api/externalsecret/)
- [Secrets Store CSI Driver — Concepts](https://secrets-store-csi-driver.sigs.k8s.io/concepts.html)
- [Secrets Store CSI Driver — Releases](https://github.com/kubernetes-sigs/secrets-store-csi-driver/releases)
- [Azure Key Vault provider — Releases](https://github.com/Azure/secrets-store-csi-driver-provider-azure/releases)
- [Microsoft Learn — Use the Azure Key Vault provider for Secrets Store CSI Driver in AKS](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-driver)
- [Microsoft Learn — Access Azure Key Vault with the CSI Driver identity provider](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-identity-access)
- [Microsoft Learn — Secrets Store CSI Driver configuration options (autorotation, sync)](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-configuration-options)
- [Microsoft Learn — KMS etcd encryption in AKS](https://learn.microsoft.com/en-us/azure/aks/use-kms-etcd-encryption)
- [Reloader](https://github.com/stakater/Reloader)
- 원글: [ArgoCD + Vault Plugin](https://kimjanghyun1010.tistory.com/109), [azure keyvault secrets provider](https://kimjanghyun1010.tistory.com/52)
