---
title: TLS와 인증서
description: 처음 보는 서버와 세션키를 나누는 키 합의부터 핸드셰이크, 인증서 체인, 폐기 확인과 수명 단축, 사설 CA와 쿠버네티스 인증서까지 TLS가 상대를 믿는 근거를 따라간다.
date: 2026-10-30 12:00:00 +0900
series: Back to the Basic
tags: [tls, certificate, nginx, openssl, kubernetes]
scripts: [figures/tls-certificate.js]
---

## 세션키 합의

처음 만나는 브라우저와 서버는 둘만 아는 키를 어떻게 만들고, 그 상대가 진짜 서버라는 것을 무엇으로 믿을까? TLS(Transport Layer Security)는 성격이 다른 두 암호를 섞어 이 문제를 푼다.

- 대칭키: 암호화와 복호화에 같은 키를 쓴다. AES가 대표적이고 빠르다. 대신 그 키를 상대에게 어떻게 건네느냐가 문제다.
- 비대칭키: 공개키와 개인키가 짝이다. 개인키로 만든 서명은 공개키로 누구나 확인할 수 있다. 계산이 무거워 데이터 전체에 쓰기엔 느리다.

TLS는 둘을 나눠 쓴다. 데이터는 대칭키(세션키)로 암호화하고, 비대칭키는 세션키를 만드는 키 합의와 서버의 서명에만 쓴다. 아래 그림처럼 키 합의(ECDHE)에서는 공개값만 네트워크를 지나는데 양쪽에 같은 세션키가 생긴다.

<figure class="fig" data-figure="tls-certificate-keys">
  <figcaption>대칭키 암호화, 키 합의, 서명</figcaption>
</figure>

ECDHE(Elliptic Curve Diffie-Hellman Ephemeral)에서 양쪽은 연결마다 비밀값을 새로 뽑고, 비밀값에서 계산한 공개값만 보낸다. 브라우저는 자기 비밀값과 서버 공개값을, 서버는 자기 비밀값과 브라우저 공개값을 섞어 같은 결과를 얻는다. 중간에서 두 공개값을 다 봐도 공개값에서 비밀값을 거꾸로 구하는 계산(타원곡선 이산로그)이 현실적으로 불가능해 결과를 알 수 없다.

TLS 1.2까지는 세션키를 서버 공개키로 암호화해 보내는 RSA 키 전송도 있었다. 이 방식은 서버 개인키가 나중에 새면 녹화해 둔 과거 통신까지 풀린다. ECDHE는 연결이 끝나면 비밀값을 버려서 개인키가 새도 지난 통신이 안전하고, 이를 전방 보안(forward secrecy)이라고 한다. TLS 1.3은 RSA 키 전송을 빼서 공개키로 키를 합의하는 연결은 모두 전방 보안을 갖는다. 예외는 미리 나눈 키(PSK)만으로 세션을 재개하는 연결과 0-RTT로 먼저 보내는 데이터다.

키 합의에는 빈틈이 하나 남는다. 공개값에는 보낸 사람이 적혀 있지 않아서, 중간자가 양쪽에 자기 공개값을 끼워 넣으면 브라우저와 중간자, 중간자와 서버가 따로 키를 합의한다. 그래서 서버는 자기 개인키로 공개값에 서명하고, 브라우저는 그 서명을 서버 공개키로 확인한다.

## 핸드셰이크

### 메시지 순서

핸드셰이크(handshake)는 알고리즘 조합(cipher suite) 선택, 키 합의, 서명을 한 번의 주고받기에 담는다. TLS 1.3의 메시지 순서는 이렇다.

```text
ClientHello          지원 버전, cipher suite 목록, key_share(브라우저 공개값)
ServerHello          고른 cipher suite, key_share(서버 공개값)
  -- 여기부터 핸드셰이크 키로 암호화 --
EncryptedExtensions  나머지 협상 결과
Certificate          서버 인증서와 중간 인증서
CertificateVerify    지금까지 오간 메시지 해시에 대한 서명
Finished             핸드셰이크 전체가 변조되지 않았다는 확인값
```

ClientHello에 공개값을 미리 실어 보내서 서버는 ServerHello 직후 세션키를 계산하고, 인증서부터 암호화해 보낸다. 브라우저가 미리 고른 곡선을 서버가 지원하지 않으면 서버가 HelloRetryRequest로 다른 곡선을 요구하고, 이때는 왕복이 하나 늘어난다.

CertificateVerify는 ClientHello부터 Certificate까지 오간 메시지의 해시에 서명한다. 중간자가 공개값 하나라도 바꾸면 해시가 달라져 서명 확인에서 걸린다.

서버도 상대를 확인하려면 Certificate 앞에 CertificateRequest를 보낸다. 그러면 클라이언트도 자기 인증서와 CertificateVerify 서명을 돌려주고, 양쪽이 서로 인증하는 이 방식을 mTLS(mutual TLS)라고 한다.

TLS 1.2는 같은 일에 2 RTT(Round Trip Time, 요청이 갔다가 응답이 돌아오는 왕복 한 번), TLS 1.3은 1 RTT를 쓴다. 아래 데모에서 모드를 TLS 1.2와 TLS 1.3으로 바꿔 접속하며 왕복 100ms 서버의 첫 응답 시각을 비교한다.

<figure class="fig" data-figure="tls-certificate-handshake">
  <figcaption>왕복 100ms 서버에서 첫 응답까지 걸리는 시간</figcaption>
</figure>

TCP 연결 1 RTT와 HTTP 요청 1 RTT를 더하면 TLS 1.2는 4 RTT(400ms), TLS 1.3은 3 RTT(300ms)에 첫 응답이 온다. 암호 계산량은 거의 같고, 줄어든 100ms는 메시지를 기다리던 시간이다. 그래서 차이는 왕복 시간에 비례해 같은 리전 서버끼리(왕복 1ms)는 거의 없고, 해외 사용자나 모바일망에서 커진다. 연결을 재사용하면 핸드셰이크 자체를 건너뛰므로 서버 사이 호출은 keep-alive와 커넥션 풀부터 확인한다.

### cipher suite 협상

핸드셰이크에서 고르는 알고리즘 조합의 이름이 cipher suite다. TLS 1.2 이름은 네 조각으로 읽는다.

```text
ECDHE    - RSA  - AES128-GCM   - SHA256
키 합의    서명    데이터 암호화    해시
```

TLS 1.3 이름은 `TLS_AES_128_GCM_SHA256`처럼 데이터 암호화와 해시만 담는다. 키 합의 곡선은 ClientHello의 supported_groups, 서명 알고리즘은 signature_algorithms 확장에서 따로 고르기 때문이다. 그래서 RFC 8446에 정의된 TLS 1.3 cipher suite는 다섯 개뿐이다.

nginx는 받을 버전을 `ssl_protocols`(최신 기본값 `TLSv1.2 TLSv1.3`)로 정하고, cipher suite는 버전별로 따로 적는다.

- `ssl_ciphers`: TLS 1.2 이하. 기본값 `HIGH:!aNULL:!MD5`이고 TLS 1.3에는 영향이 없다.
- `ssl_conf_command Ciphersuites`: TLS 1.3. OpenSSL 설정을 그대로 넘긴다.

`ssl_prefer_server_ciphers`의 기본값이 `off`라 서버는 클라이언트 목록을 위에서부터 훑어 자기 목록과 처음 겹치는 조합을 고르고, 겹치는 것이 없으면 handshake failure로 끊는다. 아래 그림처럼 TLS 1.3을 모르는 클라이언트는 TLS 1.3만 받는 설정과 겹치는 줄이 없다.

<figure class="fig" data-figure="tls-certificate-negotiate">
  <figcaption>클라이언트 목록과 서버 목록이 겹치는 줄</figcaption>
</figure>

Mozilla 권장 설정 6.0은 둘로 나뉜다. Intermediate는 IE 11, Java 8u161처럼 TLS 1.2까지만 아는 클라이언트도 받고, Modern은 TLS 1.3을 아는 Chrome 70, Java 11 이후만 받는다.

```nginx
# Intermediate: TLS 1.2 클라이언트도 받는다
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;

# Modern: TLS 1.3만 받는다
ssl_protocols TLSv1.3;
```

Intermediate의 TLS 1.2 목록은 전부 ECDHE로 시작해 RSA 키 전송이 없다. Modern으로 올리기 전에 접속 로그 형식에 `$ssl_protocol`을 넣어 TLS 1.2로 붙는 클라이언트 비율을 보고, 협상 결과는 서버에 직접 붙어 확인한다.

```bash
openssl s_client -connect shop.example.com:443 -tls1_2 </dev/null | grep -E "Protocol|Cipher"
```

## 인증서와 체인

서명을 확인하려면 서버 공개키가 필요한데, 공개키를 서버가 그냥 보내면 중간자도 자기 공개키를 보낼 수 있다. 인증서는 "이 공개키는 shop.example.com의 것"이라는 내용에 믿을 만한 인증 기관(CA, Certificate Authority)이 서명한 문서다(X.509, RFC 5280).

클라이언트는 인증서에서 네 가지를 확인한다.

- 이름: 접속한 주소가 SAN(Subject Alternative Name, 인증서가 덮는 이름 목록)에 있는지. 예전에 이름을 적던 CN(Common Name)은 보지 않고, 와일드카드 `*.shop.example.com`은 바로 아래 한 단계 이름만 맞는다(RFC 9525).
- 기간: 오늘이 notBefore와 notAfter 사이인지.
- 용도: extendedKeyUsage에 serverAuth가 있고, CA 인증서가 아닌지(basicConstraints CA:FALSE).
- 서명: 발급자(Issuer)의 공개키로 인증서 서명이 맞는지.

마지막 확인에서 발급자 공개키가 또 필요하다. 공인 CA는 루트 개인키로 서버 인증서에 직접 서명하지 않고, 루트가 서명한 중간 CA로 서명한다. 클라이언트의 신뢰 저장소(OS나 브라우저에 든 루트 목록)에는 루트만 있으므로, 서버가 중간 인증서를 같이 보내야 서버 인증서에서 루트까지 서명을 이어 따라갈 수 있다.

아래 데모에서 모드를 바꿔, 중간 인증서까지 보낼 때와 서버 인증서만 보낼 때 클라이언트 검증이 어디서 갈리는지 비교한다.

<figure class="fig" data-figure="tls-certificate-chain">
  <figcaption>서버가 보내는 인증서와 클라이언트의 체인 검증</figcaption>
</figure>

중간 인증서를 보내면 루트까지 서명이 이어지고, 빼면 발급자를 찾지 못해 `unable to get local issuer certificate`로 멈춘다. Chrome은 인증서의 AIA(Authority Information Access) 확장에 적힌 주소에서 중간 인증서를 내려받고, Firefox는 CA들이 공개한 중간 인증서를 미리 받아 둔다. curl처럼 OpenSSL로 검증하는 클라이언트나 Java는 기본으로 이런 보정이 없어서, 브라우저에서는 열리는 사이트가 브라우저가 아닌 클라이언트에서만 실패한다.

nginx에는 서버 인증서를 맨 앞에, 그 뒤에 중간 인증서를 이어 붙인 파일 하나를 준다. 순서가 바뀌면 개인키와 첫 인증서가 맞지 않아 nginx가 `key values mismatch` 오류를 내고 시작하지 않는다. 루트는 클라이언트가 이미 갖고 있어 넣지 않는다.

```bash
cat server.crt intermediate.crt > fullchain.crt
openssl s_client -connect shop.example.com:443 -showcerts </dev/null | grep -E "^ *[0-9] s:|Verify return code"
```

## 폐기와 수명

### 폐기 확인

개인키가 유출돼 CA가 인증서를 폐기(revoke)해도, 인증서 파일의 서명은 여전히 맞다. 서명 검증만으로는 폐기를 알 수 없어서 클라이언트가 따로 물어야 한다.

- CRL(Certificate Revocation List): CA가 폐기한 인증서의 일련번호 목록에 서명해 주기적으로 공개한다. 목록을 통째로 받아야 한다.
- OCSP(Online Certificate Status Protocol): 인증서 하나의 상태를 CA의 OCSP 응답자에게 묻는다.
- OCSP stapling: 서버가 OCSP 응답을 미리 받아 두었다가 핸드셰이크에 붙여 보낸다.

아래 그림처럼 클라이언트가 직접 물으면 핸드셰이크 중간에 CA까지 한 번 더 다녀온다.

<figure class="fig" data-figure="tls-certificate-revocation">
  <figcaption>OCSP를 클라이언트가 직접 물을 때와 서버가 붙여 보낼 때</figcaption>
</figure>

Mozilla 측정으로 OCSP 조회는 핸드셰이크를 중앙값 약 100ms 붙잡는다. 요청이 대개 평문이라 CA와 경로 위의 누구나 사용자가 어느 사이트에 가는지 알 수 있다. stapling은 두 문제를 다 없애고, OCSP 응답에는 CA 서명이 있어 서버가 위조하지 못한다.

nginx에서는 이렇게 켠다.

```nginx
ssl_certificate         /etc/nginx/ssl/fullchain.crt;
ssl_certificate_key     /etc/nginx/ssl/server.key;
ssl_stapling            on;
ssl_stapling_verify     on;
ssl_trusted_certificate /etc/nginx/ssl/ca-chain.pem;
resolver                kube-dns.kube-system.svc.cluster.local valid=30s ipv6=off;
```

nginx는 인증서의 AIA에서 OCSP 응답자 주소를 읽고 `resolver`로 그 이름을 푼다. `resolver`가 빠지면 주소를 풀지 못해 stapling이 붙지 않는다. `ssl_stapling_verify`는 받은 응답의 서명을 확인하므로 `ssl_trusted_certificate`에 중간 인증서와 루트를 넣는다.

공인 인증서에서는 OCSP가 걷히고 있다.

- CA/B 포럼(공인 CA와 브라우저 회사의 규정 기구)은 2023년 SC-063으로 OCSP를 선택, CRL을 필수로 바꿨다.
- Let's Encrypt는 2025년 5월 7일 새 인증서에서 OCSP 주소를 빼고, 8월 6일 응답자를 껐다. 이유로 프라이버시를 들었다.
- Firefox는 137부터 CRLite를 켰다. 모든 폐기 정보를 압축해 12시간마다 받아 두는 방식으로, 하루 평균 300kB를 내려받는다.

OCSP 주소가 없는 인증서에 stapling을 켜면 nginx는 `"ssl_stapling" ignored, no OCSP responder URL in the certificate` 경고를 남기고 건너뛴다. 인증서를 바꿀 때 `openssl x509 -in server.crt -noout -ocsp_uri`로 주소가 있는지부터 본다.

### 인증서 수명

폐기 확인이 불완전하니, 유출돼도 금방 만료되도록 수명 자체를 줄이고 있다. 아래 그림처럼 상한이 계단식으로 내려간다.

<figure class="fig" data-figure="tls-certificate-lifetime">
  <figcaption>공인 TLS 인증서의 최대 유효기간과 Let's Encrypt 기본 유효기간</figcaption>
</figure>

- CA/B 포럼 SC-081: 398일이던 상한이 2026년 3월 15일부터 200일, 2027년 3월 15일부터 100일, 2029년 3월 15일부터 47일이다.
- Let's Encrypt: 지금 90일이다. 2027년 2월 10일부터 기본 64일, 2028년 2월 16일부터 45일이 된다.

47일이면 1년에 8번 갱신해야 하므로 ACME(CA에 발급과 갱신을 자동으로 요청하는 프로토콜, RFC 8555) 클라이언트인 cert-manager나 certbot으로 자동화한다. Let's Encrypt는 60일 고정 갱신으로는 부족하다며, CA가 갱신 시점을 알려 주는 ARI(ACME Renewal Information)를 쓰거나 수명의 3분의 2 지점에서 갱신하라고 권한다.

## 사설 CA와 쿠버네티스

### 사설 CA

사내 도메인(shop.home.lan)이나 클러스터 내부 통신에는 공인 CA가 인증서를 발급하지 않는다. 직접 CA를 만들어 서명하고, 그 CA 인증서를 클라이언트의 신뢰 저장소에 넣는다. CA 한 장만 신뢰시키면 서버 인증서는 몇 장이든 추가 배포 없이 통한다.

OpenSSL 3.0 이상에서는 세 단계다.

```bash
# 1. CA
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc \
  -keyout ca.key -out ca.crt -days 3650 -subj "/CN=Home Private CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

# 2. 서버 개인키와 CSR
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc \
  -keyout server.key -out server.csr -subj "/CN=shop.home.lan" \
  -addext "subjectAltName=DNS:shop.home.lan,DNS:*.shop.home.lan" \
  -addext "extendedKeyUsage=serverAuth"

# 3. CA 서명과 확인
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -out server.crt -days 365 -copy_extensions copyall
openssl verify -CAfile ca.crt server.crt
```

CSR(Certificate Signing Request)에는 서버 공개키와 이름만 담기고, 개인키는 만들어진 자리를 떠나지 않는다. CA 인증서에는 `basicConstraints=CA:TRUE`와 `keyCertSign`이 있어야 다른 인증서에 서명할 수 있다. `critical`이 붙은 확장은 그 확장을 모르는 클라이언트가 인증서를 거절해야 한다는 표시다(RFC 5280 4.2).

자주 틀리는 것은 셋이다.

- `*.shop.home.lan`은 `shop.home.lan` 자체를 덮지 않으므로 맨 이름도 SAN에 넣는다.
- CN만 적고 SAN을 빼면 이름이 맞지 않는다고 거절된다.
- CA 개인키를 서버에 두면 서버 하나가 털릴 때 어떤 이름의 인증서든 위조할 수 있다. CA 키는 서명할 때만 꺼내고, 서버에는 `server.crt`와 `server.key`만 올린다.

### 쿠버네티스 인증서

쿠버네티스는 사설 CA를 계정 시스템으로도 쓴다. API 서버는 mTLS로 `--client-ca-file`의 CA가 서명한 클라이언트 인증서를 받으면, 주체(Subject) 필드의 CN을 사용자 이름으로, O(Organization)를 그룹으로 읽는다. 인증서 한 장이 곧 계정 하나라서, 손으로 클러스터를 세우는 공개 튜토리얼 kubernetes-the-hard-way는 컴포넌트마다 인증서를 따로 만든다.

| 인증서 | CN (사용자) | O (그룹) | 권한 |
|---|---|---|---|
| admin | admin | system:masters | 인가 검사를 건너뛰는 최고 관리자 |
| kubelet | system:node:node-0 | system:nodes | Node 인가. 자기 노드에 묶인 것만 |
| kube-proxy, scheduler 등 | system:kube-proxy 등 | | CN에 묶인 기본 바인딩 |
| kube-api-server | kubernetes | | API 서버의 서버 인증서 |
| service-accounts | service-accounts | | 계정이 아니라 서비스 어카운트 토큰 서명 키 |

값은 kubernetes-the-hard-way의 `ca.conf` 기준이고, O는 권한에 쓰이는 것만 적었다.

인증 다음의 인가(authorization)는 그 계정이 요청한 일을 해도 되는지 판단한다. 아래 그림처럼 kubelet 인증서는 Node 인가(kubelet에 자기 노드 관련 객체만 허락하는 모드)로 자기 노드 것만 읽고, admin 인증서는 인가 검사를 통째로 건너뛴다.

<figure class="fig" data-figure="tls-certificate-k8s">
  <figcaption>API 서버가 클라이언트 인증서를 계정으로 읽는 과정</figcaption>
</figure>

system:masters 그룹은 RBAC(역할을 만들고 RoleBinding으로 계정에 묶어 권한을 주는 방식) 검사를 건너뛰고 인가 웹훅에도 가지 않는다. 그래서 RoleBinding을 지워도 권한이 회수되지 않는다.

쿠버네티스는 클라이언트 인증서 폐기도 지원하지 않아 한 번 발급한 인증서는 만료까지 유효하고, kubeadm 기본값으로 1년(CA는 10년)이다. 새어 나간 admin 인증서를 막으려면 CA를 바꾸고 전부 다시 발급해야 한다.

API 서버 인증서의 SAN에는 `127.0.0.1`, 서비스 IP `10.32.0.1`, `kubernetes.default.svc.cluster.local`처럼 접속에 쓰는 이름을 전부 넣는다. 사람 계정은 OIDC(OpenID Connect, 외부 로그인 서비스의 토큰으로 사용자를 확인하는 표준) 같은 외부 인증에 RBAC를 붙이고, system:masters 인증서는 비상용으로 따로 보관한다.

## 정리

- ECDHE는 공개값만 주고받아 연결마다 새 세션키를 만든다(전방 보안). 공개값만으로는 상대가 누구인지 모른다.
- 서버는 CertificateVerify로 핸드셰이크 전체에 서명한다. TLS 1.3은 1 RTT다.
- 그 공개키가 도메인의 것임은 루트까지 이어지는 체인이 증명한다. 중간 인증서를 빼면 브라우저 밖 클라이언트가 실패한다.
- 유출된 인증서도 서명은 맞다. OCSP는 걷히고 수명은 2029년 47일까지 줄어 갱신을 자동화한다.
- 쿠버네티스는 인증서가 곧 계정이고 폐기가 없어서 system:masters 인증서를 나눠 주지 않는다.

## 참고

- [RFC 8446 — The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446)
- [RFC 9525 — Service Identity in TLS](https://www.rfc-editor.org/rfc/rfc9525)
- [RFC 5280 — Internet X.509 PKI Certificate and CRL Profile](https://www.rfc-editor.org/rfc/rfc5280)
- [nginx — ngx_http_ssl_module](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)
- [nginx — Configuring HTTPS servers](https://nginx.org/en/docs/http/configuring_https_servers.html)
- [CIS Kubernetes Benchmark 3.1.1](https://tenable.com/audits/items/CIS_Kubernetes_v1.23_v1.0.1_Level_1_Master.audit:d21d4a746a494fe16227b8a7328bb4da)
- [Mozilla — SSL Configuration Generator (guidelines 6.0)](https://ssl-config.mozilla.org/)
- [Mozilla Security Blog — Preloading Intermediate CA Certificates into Firefox](https://blog.mozilla.org/security/2020/11/13/preloading-intermediate-ca-certificates-into-firefox/)
- [OpenSSL — x509v3_config](https://docs.openssl.org/3.0/man5/x509v3_config/)
- [Let's Encrypt — Ending OCSP Support in 2025](https://letsencrypt.org/2024/12/05/ending-ocsp/)
- [Let's Encrypt — Decreasing Certificate Lifetimes to 45 Days](https://letsencrypt.org/2025/12/02/from-90-to-45/)
- [CA/Browser Forum — Ballot SC-063v4](https://cabforum.org/2023/07/14/ballot-sc063v4-make-ocsp-optional-require-crls-and-incentivize-automation/)
- [CA/Browser Forum — Ballot SC-081v3](https://cabforum.org/2025/04/11/ballot-sc081v3-introduce-schedule-of-reducing-validity-and-data-reuse-periods/)
- [Mozilla Hacks — CRLite in Firefox](https://hacks.mozilla.org/2025/08/crlite-fast-private-and-comprehensive-certificate-revocation-checking-in-firefox/)
- [Kubernetes — Authenticating](https://kubernetes.io/docs/reference/access-authn-authz/authentication/)
- [Kubernetes — Role Based Access Control Good Practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/)
- [Kubernetes — Node Authorization](https://kubernetes.io/docs/reference/access-authn-authz/node/)
- [Kubernetes — Certificate Management with kubeadm](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/)
- [kubernetes-the-hard-way — ca.conf](https://github.com/kelseyhightower/kubernetes-the-hard-way/blob/master/ca.conf)
- 원글: [사설 인증서 발급](https://kimjanghyun1010.tistory.com/60), [Nginx Cipher 추가](https://kimjanghyun1010.tistory.com/110), [Nginx Ingress Controller OCSP 설정](https://kimjanghyun1010.tistory.com/92)
