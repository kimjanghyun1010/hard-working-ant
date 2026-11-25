---
title: TLS와 인증서
description: TLS가 지키는 세 가지부터 핸드셰이크, cipher suite, 인증서 체인과 폐기 확인, 사설 CA와 쿠버네티스 컴포넌트 인증서까지 정리했다.
date: 2026-10-30 12:00:00 +0900
series: Back to the Basic
tags: [tls, certificate, nginx, openssl, kubernetes]
scripts: [figures/tls-certificate.js]
---

## TLS의 역할

카페 와이파이에서 HTTP로 로그인하면 같은 공유기를 거치는 누구나 비밀번호를 읽을 수 있다. 패킷은 서버까지 가는 동안 공유기, 통신사 장비, 프록시를 여러 번 지나고, 그 사이 어디서든 내용을 보거나 바꿀 수 있다.

TLS(Transport Layer Security)는 이 구간에서 세 가지를 막는다.

- 엿보기: 내용을 암호화해서 중간에서 읽지 못하게 한다(기밀성).
- 변조: 내용을 바꾸면 받는 쪽이 알아챈다(무결성).
- 사칭: 접속한 상대가 그 도메인의 진짜 서버인지 인증서로 확인한다(신원).

SSL은 TLS의 옛 이름이다. SSL 3.0과 TLS 1.0, 1.1은 모두 폐기됐고, 지금 쓰는 버전은 TLS 1.2와 1.3이다.

세 장면에서 같은 패킷이 중간자를 지날 때 HTTP 줄과 HTTPS 줄의 결과가 어떻게 갈리는지 본다.

<figure class="fig" data-figure="tls-certificate-roles">
  <figcaption>HTTP와 HTTPS에서 중간자가 할 수 있는 일</figcaption>
</figure>

HTTP는 세 경우 모두 중간자 뜻대로 된다. HTTPS에서 중간자는 암호문만 보고, 바꾼 패킷은 서버가 알아채 받지 않고, 가짜 서버는 맞는 인증서를 내밀지 못해 브라우저가 연결을 끊는다.

세 가지는 하나라도 빠지면 나머지가 무너진다. 암호화를 해도 상대가 가짜 서버면 비밀번호를 공격자에게 암호화해서 건네는 셈이다. 외부 접점만 보지 말고, 서비스 사이 내부 호출에 평문 구간이 남아 있는지부터 찾는다.

## TLS 연결

### 대칭키와 비대칭키

암호화는 키를 쓰는 방식에 따라 둘로 나뉜다.

- 대칭키: 암호화와 복호화에 같은 키를 쓴다. AES가 대표적이고 빠르다. 대신 그 키를 상대에게 어떻게 건네느냐가 문제다.
- 비대칭키: 공개키와 개인키가 짝이다. 공개키는 누구에게나 주고 개인키는 주인만 가진다. 계산이 무거워 데이터 전체에 쓰기엔 느리다.

TLS는 둘을 나눠 쓴다. 데이터는 대칭키(세션키)로 암호화하고, 비대칭키는 세션키를 만드는 키 합의와 서버의 서명에만 쓴다.

세 장면에서 가운데 네트워크 칸에 무엇이 보이는지 본다. 두 번째 장면에서는 공개값만 오가는데 양쪽에 같은 세션키가 생긴다.

<figure class="fig" data-figure="tls-certificate-keys">
  <figcaption>대칭키 암호화, 키 합의, 서명</figcaption>
</figure>

키 합의(ECDHE)에서 오가는 값은 공개값이라 중간에서 봐도 세션키를 계산하지 못한다. 서명은 그 공개값을 정말 서버가 보냈는지 증명한다. 서명이 없으면 중간자가 자기 공개값을 끼워 넣고 양쪽과 따로 키를 합의할 수 있다.

TLS 1.2까지는 세션키를 서버 공개키로 암호화해 보내는 RSA 키 전송도 있었다. 이 방식은 서버 개인키가 나중에 새면 녹화해 둔 과거 통신까지 풀린다. 연결마다 새 키를 합의하는 ECDHE는 개인키가 새도 지난 통신이 안전하고, 이를 전방 보안(forward secrecy)이라고 한다. TLS 1.3은 RSA 키 전송을 아예 뺐다.

TLS 1.2를 받는 서버라면 cipher 목록에 ECDHE로 시작하는 것만 남긴다.

### 핸드셰이크

서울에서 미국 서버로 처음 접속하면 요청을 보내기도 전에 수백 ms가 지나간다. TCP 연결 뒤에 TLS 핸드셰이크(handshake)가 왕복을 더 쓰기 때문이다.

핸드셰이크는 앞의 재료로 세 가지를 정한다.

1. TLS 버전과 알고리즘 조합(cipher suite)을 고른다.
2. 서버가 인증서와 서명을 보낸다.
3. 키 합의로 세션키를 만든다.

TLS 1.2는 이 과정에 2 RTT, TLS 1.3은 1 RTT를 쓴다. TLS 1.3은 첫 메시지(ClientHello)에 키 합의 값을 미리 실어 보내서 왕복 하나를 줄였다. ServerHello 뒤의 메시지는 인증서까지 전부 암호화된다.

모드를 바꿔 가며 왕복 100ms인 서버에 접속해 보고, 첫 응답이 도착하는 시각을 견줘 본다.

<figure class="fig" data-figure="tls-certificate-handshake">
  <figcaption>왕복 100ms 서버에서 첫 응답까지 걸리는 시간</figcaption>
</figure>

TLS 1.2는 TCP 1 RTT, 핸드셰이크 2 RTT, 요청 1 RTT로 400ms 만에 첫 응답이 온다. TLS 1.3은 핸드셰이크가 1 RTT라 300ms다. 암호 계산량은 비슷하고, 줄어든 100ms는 전부 메시지를 기다리던 시간이다.

차이는 왕복 시간에 비례한다. 같은 리전 서버끼리처럼 왕복이 1ms면 거의 차이가 없고, 해외 사용자나 모바일망에서는 체감된다. 연결을 재사용하면 핸드셰이크 자체를 건너뛰므로, 서버 사이 호출은 keep-alive와 커넥션 풀부터 확인한다.

### cipher suite

nginx 설정 예제에서 `ECDHE-RSA-AES128-GCM-SHA256` 같은 긴 이름을 보고, 뜻을 모른 채 그대로 붙여 넣을 때가 많다. cipher suite는 핸드셰이크에서 쓸 알고리즘 조합의 이름이다.

TLS 1.2 이름은 네 조각으로 읽는다.

```text
ECDHE    - RSA  - AES128-GCM   - SHA256
키 합의    서명    데이터 암호화    해시
```

TLS 1.3 이름은 `TLS_AES_128_GCM_SHA256`처럼 짧다. 키 합의와 서명을 cipher suite에서 떼어, ClientHello의 다른 칸(supported_groups, signature_algorithms)에서 따로 고르기 때문이다.

두 장면에서 네 역할 칸이 어디서 채워지는지 본다.

<figure class="fig" data-figure="tls-certificate-suite">
  <figcaption>cipher suite 이름이 정하는 칸</figcaption>
</figure>

TLS 1.2는 이름 하나가 네 칸을 다 정한다. TLS 1.3은 이름이 데이터 암호화와 해시 두 칸만 정하고, 나머지 두 칸은 확장에서 따로 협상한다. 그래서 TLS 1.3 cipher suite는 RFC 8446에 다섯 개만 있고, OpenSSL은 그중 세 개를 기본으로 켠다.

키 합의 칸에는 요즘 X25519MLKEM768이 들어간다. 기존 X25519에 양자 내성 알고리즘 ML-KEM을 섞은 방식으로, Mozilla 권장 설정 6.0이 맨 앞에 둔다.

이름을 읽을 때는 키 합의가 ECDHE인지, 데이터 암호화가 GCM이나 CHACHA20-POLY1305인지부터 본다.

### nginx 암호 설정

TLS 1.3만 받도록 바꾼 다음 날, 오래된 단말이나 사내 배치 서버에서 접속이 안 된다는 연락이 온다. 클라이언트가 내민 목록과 서버가 허용한 목록에 겹치는 것이 없으면 핸드셰이크가 실패한다.

nginx는 버전과 cipher suite를 지시어 넷으로 정한다.

- `ssl_protocols`: 받을 버전. 기본값은 `TLSv1.2 TLSv1.3`(1.23.4부터).
- `ssl_ciphers`: TLS 1.2 이하의 cipher suite 목록. 기본값은 `HIGH:!aNULL:!MD5`.
- `ssl_conf_command Ciphersuites`: TLS 1.3 cipher suite. OpenSSL 설정을 그대로 넘기는 지시어로 1.19.4부터 있다.
- `ssl_prefer_server_ciphers`: 서버 순서를 클라이언트 순서보다 앞세울지. 기본값은 `off`.

`ssl_ciphers`는 TLS 1.3에 영향을 주지 않는다. 같은 개념인데 버전에 따라 적는 자리가 갈린다.

세 장면에서 클라이언트 목록을 위에서부터 훑어 서버 목록과 처음 겹치는 줄을 찾는다. `ssl_prefer_server_ciphers off`라 클라이언트 순서를 따른다.

<figure class="fig" data-figure="tls-certificate-negotiate">
  <figcaption>클라이언트 목록과 서버 목록이 겹치는 줄</figcaption>
</figure>

최신 브라우저는 TLS 1.3으로 바로 맞는다. TLS 1.3을 모르는 클라이언트도 Intermediate 설정이면 ECDHE와 GCM 조합으로 붙지만, TLS 1.3만 받는 Modern 설정에서는 겹치는 줄이 없어 연결이 끊긴다.

Mozilla 권장 설정 6.0은 둘로 나뉜다.

```nginx
# Intermediate: TLS 1.2 클라이언트도 받는다
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;

# Modern: TLS 1.3만 받는다
ssl_protocols TLSv1.3;
```

TLS 1.3 cipher suite 세 개는 OpenSSL 기본값과 Mozilla 권장이 같아서 `ssl_conf_command`로 따로 적을 일이 드물다. 적은 대로 협상되는지는 서버에 직접 붙어서 본다.

```bash
openssl s_client -connect shop.example.com:443 -tls1_2 </dev/null | grep -E "Protocol|Cipher"
openssl ciphers -v 'ECDHE-RSA-AES128-GCM-SHA256'
```

Modern으로 올리기 전에 접속 로그 형식에 `$ssl_protocol`을 넣어, TLS 1.2로 붙는 클라이언트가 얼마나 되는지부터 본다.

## 인증서와 신뢰

### 인증서 구성

가짜 서버를 막으려면 브라우저가 "이 공개키가 정말 shop.example.com의 것"임을 알아야 한다. 인증서는 도메인과 공개키를 묶고, 그 묶음을 믿을 만한 인증 기관(CA, Certificate Authority)이 서명한 문서다.

인증서의 칸을 하나씩 채워 보며, 칸마다 클라이언트가 무엇을 확인하는지 본다.

<figure class="fig" data-figure="tls-certificate-fields">
  <figcaption>서버 인증서 한 장의 칸과 클라이언트가 확인하는 것</figcaption>
</figure>

- 주체(Subject)와 SAN(Subject Alternative Name): 인증서가 보호하는 이름. 요즘 클라이언트는 CN을 보지 않고 SAN만 접속 주소와 맞춘다.
- 공개키: 핸드셰이크에서 서버 서명을 검증할 키.
- 발급자(Issuer)와 서명: 누가 이 내용을 보증했는지. 발급자의 공개키로 서명을 검증한다.
- 유효기간: 시작(notBefore)과 끝(notAfter).
- 용도 확장: 어디에 쓰는 인증서인지(extendedKeyUsage의 serverAuth, clientAuth)와 CA인지(basicConstraints).

지문(fingerprint)은 인증서 안의 칸이 아니다. 인증서 전체를 SHA-256 같은 해시로 계산한 값이라, 같은 인증서를 가리키는 이름표로만 쓴다.

인증서를 받으면 SAN과 만료일부터 본다.

```bash
openssl x509 -in server.crt -noout -subject -issuer -dates -ext subjectAltName
```

### 인증서 체인

새 인증서로 바꾼 뒤 브라우저에서는 잘 열리는데, 다른 서버의 curl이나 Java 클라이언트만 `unable to get local issuer certificate`로 실패한다. 서버가 중간 인증서를 빼고 자기 인증서만 보내는 경우다.

공인 CA는 루트 개인키로 서버 인증서에 직접 서명하지 않는다. 루트가 서명한 중간 CA가 서버 인증서에 서명하고, 클라이언트의 신뢰 저장소(OS나 브라우저)에는 루트만 들어 있다. 그래서 서버가 중간 인증서를 같이 보내야 클라이언트가 서버 인증서에서 루트까지 서명을 이어 따라갈 수 있다.

모드를 바꿔 접속해 보고, 클라이언트 쪽 검증이 어느 칸에서 끊기는지 본다.

<figure class="fig" data-figure="tls-certificate-chain">
  <figcaption>서버가 보내는 인증서와 클라이언트의 체인 검증</figcaption>
</figure>

중간 인증서까지 보내면 클라이언트는 서버 인증서, 중간 CA, 저장소의 루트 순으로 서명을 확인한다. 서버 인증서만 보내면 발급자인 중간 CA를 찾지 못해 첫 칸에서 멈춘다. 보내는 인증서가 한 장 줄었을 뿐인데 결과가 갈린다.

브라우저는 중간 인증서를 따로 받아 오거나 미리 갖고 있어서 이 실수를 가려 주기도 한다. 그래서 브라우저 확인만으로는 부족하다.

nginx에는 서버 인증서 뒤에 중간 인증서를 이어 붙인 파일 하나를 준다. 루트는 클라이언트가 이미 갖고 있어서 넣지 않는다.

```bash
cat server.crt intermediate.crt > fullchain.crt
openssl s_client -connect shop.example.com:443 -showcerts </dev/null | grep -E "^ *[0-9] s:|Verify return code"
```

인증서를 바꾼 뒤에는 브라우저가 아니라 `openssl s_client`로 체인 장수와 `Verify return code: 0`을 확인한다.

### 폐기 확인

개인키가 유출돼 인증서를 폐기(revoke)해도, 유효기간이 남은 인증서 파일은 여전히 서명이 맞다. 그래서 클라이언트가 이 인증서가 아직 유효한지 따로 확인해야 한다.

- CRL(Certificate Revocation List): CA가 폐기한 인증서 목록을 주기적으로 공개한다. 목록을 통째로 받아야 한다.
- OCSP(Online Certificate Status Protocol): 인증서 하나의 상태를 CA의 OCSP 응답자에게 실시간으로 묻는다.
- OCSP stapling: 서버가 OCSP 응답을 미리 받아 두었다가 핸드셰이크에 붙여 보낸다.

모드를 바꿔 접속해 보고, CA 쪽에 무엇이 남는지와 왕복이 몇 번인지 견줘 본다.

<figure class="fig" data-figure="tls-certificate-revocation">
  <figcaption>OCSP를 클라이언트가 직접 물을 때와 서버가 붙여 보낼 때</figcaption>
</figure>

클라이언트가 직접 물으면 핸드셰이크 중간에 CA까지 한 번 더 다녀오고, CA는 어느 IP가 어느 사이트에 접속하는지 알게 된다. stapling이면 서버가 받아 둔 응답을 같이 보내서 추가 왕복이 없고, CA에는 서버의 조회만 남는다. OCSP 응답에는 CA 서명이 있어 서버가 위조하지 못한다.

nginx에서는 이렇게 켠다.

```nginx
ssl_certificate         /etc/nginx/ssl/fullchain.crt;
ssl_certificate_key     /etc/nginx/ssl/server.key;
ssl_stapling            on;
ssl_stapling_verify     on;
ssl_trusted_certificate /etc/nginx/ssl/ca-chain.pem;
resolver                kube-dns.kube-system.svc.cluster.local valid=30s ipv6=off;
resolver_timeout        5s;
```

`resolver`가 빠지면 nginx가 OCSP 응답자 주소를 풀지 못해 stapling이 붙지 않는다. 쿠버네티스 안이면 클러스터 DNS를 적는다.

```bash
openssl x509 -in server.crt -noout -ocsp_uri
openssl s_client -connect shop.example.com:443 -status </dev/null | grep -A2 "OCSP response"
```

그런데 지금은 stapling을 켜도 아무 일이 없는 인증서가 많다. OCSP가 걷히고 있기 때문이다.

- CA/B 포럼(공인 CA와 브라우저 회사의 규정 기구)이 2023년 규정(SC-063)으로 공인 인증서의 OCSP를 선택, CRL을 필수로 바꿨다.
- Let's Encrypt는 2025년 5월 7일 새 인증서에서 OCSP 주소를 빼고, 8월 6일 OCSP 응답자를 껐다.
- Firefox는 142부터 도메인 검증(DV) 인증서에 OCSP 대신 CRLite를 쓴다. 폐기 목록 전체를 압축해 미리 내려받아 두는 방식이다.

이유는 데모에서 본 두 가지, 접속 기록이 CA에 남는 문제와 핸드셰이크를 붙잡는 추가 왕복이다. 인증서에 OCSP 주소가 없으면 nginx는 `"ssl_stapling" ignored, no OCSP responder URL in the certificate` 경고를 남기고 stapling을 건너뛴다.

ingress-nginx 컨트롤러는 2026년 3월에 유지보수가 끝나 보안 수정이 더 나오지 않는다. 그 위에서 OCSP 설정을 손보기보다 Gateway API 구현체나 다른 Ingress 컨트롤러로 옮기는 계획을 먼저 세운다.

인증서를 바꿀 때 `-ocsp_uri`로 OCSP 주소가 있는지부터 보고, 없으면 stapling 설정은 효과가 없다고 본다.

### 인증서 수명

폐기 확인이 이렇게 불완전하니, 다른 쪽에서는 인증서 수명 자체를 줄이고 있다. 유출돼도 금방 만료되면 폐기 확인에 덜 기댄다.

선이 계단처럼 내려가는 시점과, 지금(2026년 11월)이 어느 계단에 있는지 본다.

<figure class="fig" data-figure="tls-certificate-lifetime">
  <figcaption>공인 TLS 인증서의 최대 유효기간과 Let's Encrypt 기본 유효기간</figcaption>
</figure>

- CA/B 포럼 SC-081: 398일이던 상한이 2026년 3월 15일부터 200일, 2027년 3월 15일부터 100일, 2029년 3월 15일부터 47일이다.
- Let's Encrypt: 지금 90일이다. 2027년 2월 10일부터 기본 64일, 2028년 2월 16일부터 45일이 된다.

날짜는 두 곳의 공식 발표 기준이다. 2029년이면 공인 인증서를 한 달 반마다 바꿔야 해서, 사람이 달력을 보고 갱신하는 방식으로는 버티지 못한다.

갱신은 ACME 클라이언트(cert-manager, certbot 등)로 자동화하고, 갱신 시점은 60일처럼 고정하지 말고 수명의 3분의 2 지점으로 둔다. 남은 만료 일수는 지표로 걸어 알림을 받는다.

## 사설 인증서 운영

### 사설 CA

사내 도메인(shop.home.lan)이나 개발 환경에는 공인 CA가 인증서를 발급하지 않는다. 직접 CA를 만들어 서명하고, 그 CA를 클라이언트가 신뢰하게 만든다.

자체 서명 서버 인증서 한 장으로 끝내는 방법도 있지만, 서버가 늘 때마다 클라이언트마다 인증서를 하나씩 신뢰시켜야 한다. CA를 하나 두면 클라이언트는 CA 인증서 한 장만 신뢰하고, 서버 인증서는 몇 장이든 CA가 서명한다.

세 장면에서 키와 인증서가 어디서 만들어져 어디로 가는지 따라간다. 개인키는 만들어진 자리에서 움직이지 않는다.

<figure class="fig" data-figure="tls-certificate-private-ca">
  <figcaption>사설 CA가 서버 인증서를 발급하고 클라이언트가 신뢰하는 과정</figcaption>
</figure>

1. CA 개인키와 자체 서명 CA 인증서를 만든다.
2. 서버가 개인키와 CSR(Certificate Signing Request)을 만들어 CA에 보낸다. CSR에는 공개키와 이름(SAN)만 담긴다.
3. CA가 CSR에 서명해 서버 인증서를 돌려주고, 클라이언트에는 CA 인증서를 배포한다.

OpenSSL 3.0 이상에서는 명령 세 줄이다.

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

`basicConstraints=CA:TRUE`가 이 인증서가 CA라는 표시이고, `keyCertSign`이 다른 인증서에 서명할 권한이다. 서버 인증서에는 둘 다 넣지 않는다. 쿠버네티스에는 시크릿으로 넣는다.

```bash
kubectl create secret tls shop-tls --cert=server.crt --key=server.key
```

만들 때 자주 틀리는 것은 셋이다.

- `*.shop.home.lan`은 `shop.home.lan` 자체를 덮지 않는다. 와일드카드는 바로 아래 한 단계 이름만 맞으므로 맨 이름도 SAN에 같이 넣는다.
- CN만 적고 SAN을 빼면 요즘 클라이언트는 이름이 맞지 않는다고 거절한다.
- 서버 개인키에 암호를 걸면 nginx가 뜰 때마다 암호를 묻거나 `ssl_password_file`이 따로 필요하다. 서버 키는 파일 권한으로 지키고, 대신 CA 개인키를 서버에 두지 않는다.

CA 개인키는 서명할 때만 꺼내는 곳에 두고, 서버에는 `server.crt`와 `server.key`만 올린다.

### 쿠버네티스 컴포넌트 인증서

kubernetes-the-hard-way로 클러스터를 손으로 만들면 바이너리 배치보다 인증서에 손이 훨씬 많이 간다. 컴포넌트마다 인증서가 따로 필요하다.

API 서버는 클라이언트 인증서의 주체를 계정으로 읽는다. CN이 사용자 이름, O가 그룹이다. 인증서 한 장이 곧 계정 하나라서, 컴포넌트마다 다른 권한을 주려면 인증서도 따로 만든다.

| 인증서 | CN (사용자) | O (그룹) | 권한 |
|---|---|---|---|
| admin | admin | system:masters | 인가 검사를 건너뛰는 최고 관리자 |
| kubelet | system:node:node-0 | system:nodes | Node 인가. 자기 노드에 묶인 것만 |
| kube-proxy | system:kube-proxy | | CN에 묶인 기본 바인딩 |
| kube-controller-manager | system:kube-controller-manager | | CN에 묶인 기본 바인딩 |
| kube-scheduler | system:kube-scheduler | | CN에 묶인 기본 바인딩 |
| kube-api-server | kubernetes | | API 서버의 서버 인증서 |
| service-accounts | service-accounts | | 계정이 아니라 서비스 어카운트 토큰 서명 키 |

값은 kubernetes-the-hard-way의 `ca.conf` 기준이고, O는 권한에 쓰이는 것만 적었다.

세 장면에서 API 서버가 인증서 한 장을 받아 누구로 읽는지 본다. 마지막 장면은 admin 인증서가 새어 나간 경우다.

<figure class="fig" data-figure="tls-certificate-k8s">
  <figcaption>API 서버가 클라이언트 인증서를 계정으로 읽는 과정</figcaption>
</figure>

kubelet은 CN과 O 덕분에 자기 노드 것만 읽는다. admin의 그룹 system:masters는 RBAC 검사를 통째로 건너뛰어서, RoleBinding을 지워도 권한이 회수되지 않는다. 유출된 admin 인증서도 서명이 맞으니 API 서버는 똑같이 받아 준다.

쿠버네티스는 클라이언트 인증서 폐기를 지원하지 않는다. 한 번 발급한 인증서는 만료될 때까지 유효하고, kubeadm 기본값으로 1년이다(CA는 10년). 새어 나간 인증서를 막으려면 CA를 바꾸고 전부 다시 발급해야 한다.

서버 쪽 인증서는 SAN이 관건이다. API 서버 인증서에는 `127.0.0.1`, 서비스 IP `10.32.0.1`, `kubernetes.default.svc.cluster.local`처럼 클라이언트가 접속할 때 쓰는 이름을 전부 넣는다. kubelet은 API 서버를 부르기도 하고 자기 API를 열기도 해서 clientAuth와 serverAuth를 같이 단다.

사람에게 system:masters 인증서를 나눠 주지 않는다. 사람 계정은 OIDC 같은 외부 인증에 RBAC를 붙이고, admin 인증서는 비상용으로 따로 보관한다.

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| TLS | 암호화, 무결성, 신원 확인 | 신원 확인이 빠지면 암호화도 소용없다 |
| 키 | 데이터는 대칭키, 키 합의와 서명은 비대칭키 | TLS 1.2는 ECDHE만 남긴다 |
| 핸드셰이크 | 버전, cipher suite, 세션키를 정한다 | 1.2는 2 RTT, 1.3은 1 RTT. 연결 재사용이 먼저다 |
| cipher suite | 알고리즘 조합의 이름 | 1.2는 `ssl_ciphers`, 1.3은 `ssl_conf_command` |
| 인증서 체인 | 서버 인증서부터 루트까지 서명을 잇는다 | 중간 인증서를 같이 보낸다. curl로 확인 |
| 폐기 확인 | CRL, OCSP, stapling | Let's Encrypt는 OCSP를 껐다. `-ocsp_uri`부터 본다 |
| 인증서 수명 | 2026년 3월부터 최대 200일, 2029년 47일 | 갱신을 자동화한다 |
| 사설 CA | CA 한 장으로 서버 인증서 여러 장에 서명 | SAN에 맨 이름까지 넣는다 |
| 쿠버네티스 | 인증서 한 장이 계정 하나 | 폐기가 없다. system:masters를 나눠 주지 않는다 |

## 참고

- [RFC 8446 — The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446)
- [RFC 8996 — Deprecating TLS 1.0 and TLS 1.1](https://www.rfc-editor.org/rfc/rfc8996)
- [RFC 9525 — Service Identity in TLS](https://www.rfc-editor.org/rfc/rfc9525)
- [RFC 5280 — Internet X.509 PKI Certificate and CRL Profile](https://www.rfc-editor.org/rfc/rfc5280)
- [nginx — ngx_http_ssl_module](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)
- [Mozilla — SSL Configuration Generator (guidelines 6.0)](https://ssl-config.mozilla.org/)
- [OpenSSL — x509v3_config](https://docs.openssl.org/3.0/man5/x509v3_config/)
- [Let's Encrypt — Ending OCSP Support in 2025](https://letsencrypt.org/2024/12/05/ending-ocsp/)
- [Let's Encrypt — Decreasing Certificate Lifetimes to 45 Days](https://letsencrypt.org/2025/12/02/from-90-to-45/)
- [CA/Browser Forum — Ballot SC-063v4](https://cabforum.org/2023/07/14/ballot-sc063v4-make-ocsp-optional-require-crls-and-incentivize-automation/)
- [CA/Browser Forum — Ballot SC-081v3](https://cabforum.org/2025/04/11/ballot-sc081v3-introduce-schedule-of-reducing-validity-and-data-reuse-periods/)
- [Mozilla Hacks — CRLite in Firefox](https://hacks.mozilla.org/2025/08/crlite-fast-private-and-comprehensive-certificate-revocation-checking-in-firefox/)
- [Kubernetes — Ingress NGINX Retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [Kubernetes — Authenticating](https://kubernetes.io/docs/reference/access-authn-authz/authentication/)
- [Kubernetes — Role Based Access Control Good Practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/)
- [Kubernetes — Node Authorization](https://kubernetes.io/docs/reference/access-authn-authz/node/)
- [Kubernetes — Certificate Management with kubeadm](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/)
- [kubernetes-the-hard-way — ca.conf](https://github.com/kelseyhightower/kubernetes-the-hard-way/blob/master/ca.conf)
- 원글: [사설 인증서 발급](https://kimjanghyun1010.tistory.com/60), [Nginx Cipher 추가](https://kimjanghyun1010.tistory.com/110), [Nginx Ingress Controller OCSP 설정](https://kimjanghyun1010.tistory.com/92), [kubernetes-the-hard-way](https://kimjanghyun1010.tistory.com/87)
