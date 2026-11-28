---
title: 계층별 이중화
description: 서버 한 대가 멈춰도 요청이 계속 성공하려면 두 대 말고 무엇이 더 필요한지, 감지와 전환, 데이터 복제, 과반 투표 순서로 따라간다.
date: 2026-10-31 12:00:00 +0900
series: 인프라 운영
tags: [high-availability, failover, route53, keepalived, s3, mongodb]
scripts: [figures/high-availability.js]
---

## 단일 장애점

요청 하나는 DNS, CDN(사용자 가까이에서 응답을 대신 주는 캐시 서버망), 로드밸런서, 앱, DB를 차례로 지나야 응답이 된다. 이 가운데 하나만 멈춰도 전체가 멈추는 지점을 단일 장애점(SPOF, single point of failure)이라고 한다. 계층마다 같은 역할을 둘 이상 두는 이중화(redundancy)로 단일 장애점을 없애는데, 한 대가 멈춘 순간에도 요청이 계속 성공하려면 두 대를 두는 것만으로는 모자라다.

아래 그림처럼 계층마다 한 대면 DB 하나가 멈출 때 앞의 네 계층이 멀쩡해도 응답은 0%다. 두 대를 두면 남은 DB로 계속 응답한다.

<figure class="fig" data-figure="high-availability-spof">
  <figcaption>계층마다 한 대일 때와 두 대일 때의 DB 장애</figcaption>
</figure>

그림은 남은 DB로 요청이 바로 넘어가는 경우만 그렸다. 실제로는 네 가지가 더 갖춰져야 넘어간다.

- 감지: 한쪽이 멈췄다는 것을 누군가 알아챈다.
- 전환: 클라이언트가 쓰는 주소가 남은 쪽을 가리킨다.
- 복제: 남은 쪽에 같은 데이터가 있다.
- 주인 하나: 연결만 끊겼을 때 두 대가 동시에 주인 노릇을 하지 않는다.

두 대를 평소에 어떻게 쓰느냐에 따라 감지와 전환의 부담이 달라진다.

- Active-Active: 둘 다 요청을 받는다. 한쪽이 멈추면 남은 쪽이 전부 받는다.
- Active-Standby: 한 대만 받고 다른 한 대는 대기한다. 받던 쪽이 멈추면 대기하던 쪽으로 넘긴다.

<figure class="fig" data-figure="high-availability-modes">
  <figcaption>같은 장애에서 Active-Active와 Active-Standby</figcaption>
</figure>

Active-Active는 로드밸런서가 멈춘 쪽을 빼는 짧은 순간만 실패하지만, 남은 쪽이 평소의 두 배를 받는다. N대 가운데 한 대가 빠져도 버티려면 평소 사용률을 (N-1)/N 아래로 둔다. 두 대면 50%, 세 대면 약 67%다.

Active-Standby는 대기 장비가 놀고, 감지하고 넘기는 동안 들어온 요청이 실패한다. 그래도 쓰기 주인이 하나여야 하는 DB, 한 노드만 가져야 하는 가상 IP(VIP)는 이 방식으로 둔다.

## 장애 감지

멈춘 서버는 멈췄다고 알리지 못한다. 그래서 감지는 살아 있다는 신호가 끊긴 것으로 판단한다. 정해진 간격으로 신호(하트비트, heartbeat)를 주고받거나 상대에게 묻고, 정해진 횟수만큼 답이 없으면 멈췄다고 본다. 감지 시간은 대략 간격 곱하기 횟수다.

keepalived가 쓰는 VRRP(Virtual Router Redundancy Protocol)가 이 방식이다. 두 노드가 VIP 하나를 나눠 갖고, 우선순위가 높은 MASTER가 VIP를 쥔 채 `advert_int`(보통 1초)마다 광고를 보낸다. 광고는 같은 네트워크의 여러 장비가 함께 받는 멀티캐스트 주소 224.0.0.18로 간다. BACKUP은 광고가 아래 시간 동안 오지 않으면 MASTER가 멈췄다고 본다.

```text
Master_Down_Interval = 3 × advert_int + Skew_Time
Skew_Time            = (256 - priority) / 256 × advert_int
BACKUP priority 100, advert_int 1초  →  3 + 0.61 = 약 3.6초
```

Skew_Time은 BACKUP이 여럿일 때 우선순위가 높은 쪽이 먼저 나서게 하는 차이다. MASTER가 정상 종료할 때는 우선순위 0인 광고를 보낸다. 이 광고를 받은 BACKUP은 기다리는 시간을 Skew_Time으로 줄여, priority 100이면 약 0.61초 뒤에 넘겨받는다.

아래 그림은 쿠버네티스 클러스터를 만드는 도구인 kubeadm으로 세운 컨트롤 플레인(클러스터를 관리하는 서버들) 앞에 keepalived 두 대를 둔 구성이다.

<figure class="fig" data-figure="high-availability-vip">
  <figcaption>keepalived 두 대와 kube-apiserver 세 대</figcaption>
</figure>

kubeadm은 이 VIP를 `--control-plane-endpoint`로 받는다. VIP 뒤에서는 TCP 로드밸런서인 haproxy가 6443 포트 요청을 쿠버네티스 API 서버(kube-apiserver) 세 대로 나눈다. 광고는 노드가 살아 있는지만 알려 준다. 노드는 멀쩡한데 apiserver만 죽은 경우는 헬스체크 스크립트로 잡아 우선순위를 깎는다.

```text
vrrp_script check_apiserver {
  script "/etc/keepalived/check_apiserver.sh"   # localhost:6443/healthz 를 curl
  interval 1
  fall 2
  weight -10          # MASTER 101 - 10 = 91 < BACKUP 100
}
```

다른 계층도 간격과 횟수로 감지한다.

- MongoDB 레플리카셋: 쓰기를 받는 Primary 한 대와 사본을 든 Secondary로 이뤄진다. 멤버끼리 2초마다 하트비트를 주고받고, Primary와 10초(`electionTimeoutMillis` 기본값) 넘게 연락이 끊기면 Secondary가 새 Primary를 뽑는 선거를 연다.
- etcd(쿠버네티스의 상태를 저장하는 DB): 리더가 100ms마다 하트비트를 보내고, 1000ms 동안 받지 못한 멤버가 선거를 연다.
- Route 53(AWS의 DNS) 헬스체크: 세계 여러 곳의 체커가 30초(빠른 체크는 10초)마다 묻고, 연속 3회(기본 실패 임계값) 실패하면 비정상으로 센다. 체커의 18%를 넘게 정상이라고 보면 정상으로 친다.

Route 53의 18%는 일부 지역에서만 길이 끊긴 것을 장애로 보지 않으려는 값이다. 간격과 횟수를 줄이면 빨리 알아채지만 잠깐의 지연이나 GC 멈춤(메모리 정리로 프로세스가 잠시 서는 것)도 장애로 본다. etcd 문서가 선거 제한 시간을 멤버 사이 왕복 시간의 10배 이상으로 두라고 하는 것도 네트워크가 한두 번 흔들려서는 선거가 열리지 않게 하려는 비율이다.

신호가 끊긴 것만으로는 **상대가 죽은 것과 상대와의 길만 끊긴 것을 구분하지 못한다**. 두 대만 있는 구성은 이 둘을 같은 장애로 처리한다.

## 요청 전환

감지한 뒤에는 클라이언트가 쓰는 주소가 남은 쪽을 가리키게 바꾼다. 주소를 바꾸는 자리가 IP, 프록시, 이름, DNS 가운데 어디냐에 따라 전환에 드는 시간이 다르다.

- IP를 옮긴다(VIP): 같은 네트워크의 장비는 ARP로 IP에 해당하는 MAC 주소(랜카드 고유 주소)를 찾아 표에 적어 둔다. 새 MASTER는 묻지 않았는데 "이 IP는 이 MAC"이라고 알리는 gratuitous ARP를 보내, 스위치와 이웃 호스트가 이 표를 고치게 한다. keepalived는 전환 직후 5개를 보내고 5초 뒤 5개를 더 보낸다(`garp_master_repeat`, `garp_master_delay` 기본 5).
- 프록시가 대상을 바꾼다: nginx upstream(요청을 넘길 서버 묶음)은 서버와의 통신이 `fail_timeout`(기본 10초) 안에 `max_fails`(기본 1회)만큼 실패하면 그 서버를 10초 동안 빼고 `backup` 서버로 보낸다. CloudFront 오리진 그룹은 1차 원본 서버(오리진)에 연결이 안 되면 같은 요청을 2차로 보내는데, 기본값이 10초씩 3번 시도라 30초를 기다린다.
- 이름 뒤를 바꾼다: S3 Multi-Region Access Point(MRAP)는 여러 리전 버킷 앞에 이름 하나를 두고, 라우팅 상태를 바꾸면 약 2분 뒤부터 새 요청을 다른 리전으로 보낸다. 이미 열린 연결은 끊지 않는다.
- DNS 답을 바꾼다: Route 53은 헬스체크가 실패한 레코드를 답에서 뺀다.

VIP는 ARP가 통하는 한 네트워크(서브넷) 안에서만 옮길 수 있다. 224.0.0.18도 라우터를 넘지 않는 주소라, VIP를 나눠 갖는 노드는 같은 서브넷에 있어야 한다. CloudFront는 GET, HEAD, OPTIONS 요청만 2차로 넘기므로 업로드 같은 쓰기 경로는 따로 이중화한다.

리전이나 업체 단위 장애는 DNS가 맡는다. Route 53 가중치 라우팅(weighted routing)은 같은 이름의 레코드 여러 개를 가중치 비율대로 답한다. 아래 그림은 CDN 두 곳(CloudFront, Azure Front Door)을 70 : 30으로 나눈 구성이다.

<figure class="fig" data-figure="high-availability-dns">
  <figcaption>가중치 70 : 30 레코드에서 헬스체크가 실패할 때 Route 53의 답</figcaption>
</figure>

둘 다 실패하면 Route 53은 답을 비우지 않고 전부 정상으로 보고 가중치대로 고른다. 이름 해석이 아예 실패하는 것보다 죽은 주소라도 주는 편을 택한 동작이다.

DNS 전환이 느린 이유는 캐시에 있다. 클라이언트 대신 이름을 물어 주는 서버(리졸버)는 받은 답을 레코드에 적힌 유효 시간(TTL) 동안 들고 있다가 다시 쓴다. TTL 60초면 헬스체크가 실패를 세 번 확인하는 90초 뒤에도 최대 60초 동안 옛 CDN으로 간다. 감지와 전환을 더한 계층별 시간은 아래 그림과 같다.

<figure class="fig" data-figure="high-availability-time">
  <figcaption>계층별 감지(주황)와 전환(보라) 시간</figcaption>
</figure>

VIP는 3.6초, DNS는 2분 30초로 40배 넘게 차이 난다. MRAP는 사람이 상태를 바꾼 뒤부터 잰 값이라 장애를 알아채는 시간이 그 앞에 더 붙는다. 복구 목표 시간이 있다면 요청 경로의 계층마다 이 덧셈을 하고 가장 긴 계층부터 줄인다.

## 데이터 복제

여기까지의 계층은 데이터를 갖지 않아서 어느 쪽이 받아도 결과가 같다. DB와 스토리지는 넘어간 쪽에 같은 데이터가 있어야 한다. 그래서 원본에 쓴 내용을 다른 쪽에 복사(복제, replication)해 두는데, 대부분 비동기라 쓰기 성공과 복제 완료 사이에 틈이 있다.

S3 교차 리전 복제(CRR)는 대부분의 객체를 몇 초 안에 옮기지만 시간을 보장하지 않는다. Replication Time Control(RTC)을 켜면 99.9%를 15분 안에 복제하고, 15분을 넘긴 객체를 `OperationMissedThreshold` 이벤트로 알려 준다. 양쪽 버킷에 버전 관리가 켜져 있어야 복제를 걸 수 있다.

- 서울에서 도쿄, 도쿄에서 서울로 양방향 규칙을 걸어도 순환하지 않는다. S3는 다른 복제 규칙이 만든 복제본을 다시 복제하지 않는다.
- MRAP 문서는 장애 조치를 설정하기 전에 양방향 복제와 복제본 수정 동기화(`replica_modifications`)를 켜라고 권한다. 넘어간 쪽에 쓴 파일이 원래 쪽으로 돌아와야 다시 되돌릴 수 있다.

MongoDB 레플리카셋은 Primary 한 대가 쓰기를 받아 oplog(쓰기 기록)에 적고, Secondary가 그 oplog를 가져가 따라 한다. Primary가 쓰기를 받고 Secondary에 복제하기 전에 멈추면 새 Primary는 그 쓰기를 모른다. 돌아온 옛 Primary는 새 Primary에 맞추려고 자기만 가진 쓰기를 되돌리는데, 이것을 롤백(rollback)이라고 한다.

쓰기를 언제 성공으로 돌려줄지는 write concern 설정으로 고른다.

- `w: 1`: Primary에 쓰면 바로 성공을 돌려준다.
- `w: "majority"`: 투표 멤버 과반에 복제된 뒤 성공을 돌려준다.

아래 데모에서 rs0은 처음 Primary, rs1은 Secondary이고, X는 클라이언트가 보낸 쓰기 하나다. 두 모드에서 각각 쓰고 Primary 끄기를 눌러 rs0 줄 끝에 롤백 블록이 생기는지 비교한다.

<figure class="fig" data-figure="high-availability-rollback">
  <figcaption>쓰기 X 직후 Primary가 멈출 때 (시간은 모양을 보여 주는 대략값)</figcaption>
</figure>

`w: 1`은 쓰기 X가 옛 Primary(rs0)에만 있을 때 성공을 돌려준다. X를 모르는 Secondary(rs1)가 새 Primary가 되면 X는 사라진다. `w: "majority"`는 X가 rs1까지 복제된 뒤 성공을 돌려주므로 누가 Primary가 돼도 X가 남는다.

`majority`는 응답이 복제 한 번 왕복만큼 늦어지지만, 그 대가로 **성공 응답을 받은 쓰기가 롤백되지 않는다**. MongoDB 문서는 이 보장에 투표 멤버 전부의 저널링(쓰기를 디스크의 기록 파일에 먼저 남기는 것)을 조건으로 건다.

- 되돌린 쓰기는 `<dbpath>/rollback/<컬렉션 UUID>/removed.<시각>.bson` 파일로 남는다. `bsondump`로 읽어 필요한 것만 다시 넣는다.
- 기본 write concern은 `majority`다. 다만 Arbiter(데이터 없이 투표만 하는 멤버)가 있고 데이터 멤버 수가 투표 과반 이하면 기본값이 `w: 1`이 된다. Primary, Secondary, Arbiter 세 대(PSA)가 바로 이 경우다.
- PSA에서 `majority`를 쓰면 Arbiter는 데이터를 받지 않으니 Primary와 Secondary가 둘 다 살아 있어야 쓰기가 끝난다. Secondary 하나만 멈춰도 쓰기가 대기한다. `wtimeout`을 넘기면 오류를 돌려주지만 이미 쓴 내용을 되돌리지는 않는다.

PSA 구성이라면 지금 기본값을 먼저 확인한다.

```javascript
db.adminCommand({ getDefaultRWConcern: 1 })
```

## 과반 투표

감지는 신호가 끊긴 것만 본다. 두 노드 사이의 VRRP 패킷이 방화벽에 막히면 BACKUP은 MASTER가 죽었다고 보고 VIP를 잡고, MASTER도 VIP를 놓지 않는다. 이렇게 둘이 동시에 주인 노릇을 하는 것을 스플릿 브레인(split brain)이라고 한다. 같은 IP를 두 노드가 번갈아 자기 것이라고 알리니 접속이 됐다 안 됐다 한다.

두 대만으로는 상대가 죽은 것과 연결만 끊긴 것을 구분할 방법이 없다. 세 대 이상이 과반으로 정하면, 네트워크가 갈려도 과반을 보는 쪽은 한 곳뿐이다. 아래 그림의 두 장면은 연결이 끊긴 뒤 주인이 몇 곳이 되는지 견준다.

<figure class="fig" data-figure="high-availability-split">
  <figcaption>두 대의 VRRP와 세 대의 과반 투표에서 네트워크가 끊길 때</figcaption>
</figure>

MongoDB Primary는 투표 멤버 과반과 연락이 닿지 않으면 스스로 Secondary로 내려간다. 과반 쪽에서는 표를 과반 먼저 받은 멤버가 Primary가 되는데, 투표하는 멤버는 자기보다 oplog가 뒤처진 후보에게 표를 주지 않는다. 그래서 가장 최근까지 따라온 멤버가 뽑힌다.

- 선거 시간: 기본 설정이면 새 Primary가 나오기까지 보통 12초를 넘지 않는다. 그동안 쓰기는 실패한다.
- 재시도: 드라이버는 Primary가 바뀐 것을 알아채고 쓰기를 한 번 다시 시도한다(retryable writes, 기본 켜짐).

과반은 살아 있는 멤버가 아니라 전체 투표 멤버 수로 센다. 과반은 n/2를 내림하고 1을 더한 값이라, 멤버를 짝수로 늘려도 버티는 장애 수가 늘지 않는다.

| 투표 멤버 | 과반 | 버티는 장애 |
|---|---|---|
| 2 | 2 | 0 |
| 3 | 2 | 1 |
| 4 | 3 | 1 |
| 5 | 3 | 2 |

etcd FAQ와 MongoDB 문서의 과반 계산이다.

etcd가 과반으로 쓰기를 정하므로 kubeadm 컨트롤 플레인도 세 대, 다섯 대처럼 홀수로 둔다. 데이터를 두 벌만 둘 여유가 있으면 Arbiter로 세 번째 표를 만든다. 다만 앞 절처럼 PSA는 기본 write concern이 `w: 1`이 되므로 롤백 위험을 함께 진다. 데이터 멤버가 이미 세 대인데 Arbiter를 더하면 투표 멤버가 넷이 되어 버티는 장애 수는 그대로다.

VRRP에는 투표가 없다. 그래서 keepalived 쌍은 광고가 막히지 않게 하는 것으로 스플릿 브레인을 막는다. VRRP는 TCP(6번), UDP(17번)와 나란한 IP 프로토콜 112번이라 TCP나 UDP 포트 규칙으로는 열리지 않는다.

```bash
iptables -I INPUT  -p vrrp -j ACCEPT
iptables -I OUTPUT -p vrrp -j ACCEPT
```

멀티캐스트가 막힌 클라우드 네트워크에서는 `unicast_peer`에 상대 IP를 적어 광고를 유니캐스트로 보낸다. 설정 뒤에는 BACKUP 노드에 VIP가 없는지 확인한다.

```bash
ip -4 addr show dev eth0 | grep -w 10.0.0.100
```

## 정리

- 단일 장애점은 계층마다 두 대를 두어 없애지만, 남은 쪽이 실제로 요청을 받으려면 감지, 전환, 복제, 주인 하나가 갖춰져야 한다. Active-Active는 사용률을 (N-1)/N 아래로 둔다.
- 감지는 신호가 끊긴 것으로 판단하고, 시간은 간격 곱하기 횟수다. VRRP는 약 3.6초, MongoDB는 10초, Route 53은 30초 × 3회다.
- 전환은 주소를 바꾸는 자리에 따라 다르다. VIP는 gratuitous ARP로 바로, 프록시는 실패 횟수로, DNS는 TTL까지 더해 2분 30초가 걸린다.
- 데이터 계층은 복제가 비동기라 틈이 있다. `w: "majority"`면 성공한 쓰기가 롤백되지 않고, PSA는 기본값이 `w: 1`이다.
- 두 대는 죽음과 단절을 구분하지 못해 스플릿 브레인이 생긴다. 데이터를 가진 계층은 홀수 과반 투표로 정하고, VRRP 쌍은 프로토콜 112를 연다.

## 참고

- [RFC 5798 — Virtual Router Redundancy Protocol (VRRP) Version 3](https://www.rfc-editor.org/rfc/rfc5798)
- [keepalived.conf(5)](https://github.com/acassen/keepalived/blob/master/doc/man/man5/keepalived.conf.5.in)
- [Kubernetes — Creating Highly Available Clusters with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/)
- [kubeadm — Options for Software Load Balancing](https://github.com/kubernetes/kubeadm/blob/main/docs/ha-considerations.md)
- [etcd — Tuning](https://etcd.io/docs/v3.6/tuning/)
- [etcd — FAQ](https://etcd.io/docs/v3.6/faq/)
- [AWS — How Route 53 determines whether a health check is healthy](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-determining-health-of-endpoints.html)
- [AWS — How Amazon Route 53 chooses records when health checking is configured](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-how-route-53-chooses-records.html)
- [AWS — Weighted routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-weighted.html)
- [AWS — Optimize high availability with CloudFront origin failover](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/high_availability_origin_failover.html)
- [nginx — ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [AWS — Using Multi-Region Access Point failover controls](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingFailover.html)
- [AWS — What does Amazon S3 replicate?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html)
- [AWS — S3 Replication Time Control](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-time-control.html)
- [MongoDB — Replica Set Elections](https://www.mongodb.com/docs/manual/core/replica-set-elections/)
- [MongoDB — Write Concern](https://www.mongodb.com/docs/manual/reference/write-concern/)
- [MongoDB — Rollbacks During Replica Set Failover](https://www.mongodb.com/docs/manual/core/replica-set-rollbacks/)
- 원글: [CDN 이중화](https://kimjanghyun1010.tistory.com/117), [MRAP로 S3 고가용성 구성](https://kimjanghyun1010.tistory.com/116), [kubeadm 설치 (w/ master HA)](https://kimjanghyun1010.tistory.com/103), [Docker Compose Active-Standby 구성 (w/ nginx)](https://kimjanghyun1010.tistory.com/88), [Percona MongoDB](https://kimjanghyun1010.tistory.com/40)
