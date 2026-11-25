---
title: 계층별 이중화
description: 단일 장애점에서 시작해 DNS, CDN, VIP, 앱, 스토리지, DB를 이중화하는 방법과 감지와 전환 시간, 스플릿 브레인까지 정리했다.
date: 2026-10-31 12:00:00 +0900
series: 인프라 운영
tags: [high-availability, failover, route53, keepalived, s3, mongodb]
scripts: [figures/high-availability.js]
---

## 단일 장애점

새벽에 DB 서버 한 대의 디스크가 가득 차자, 웹 서버와 CDN은 멀쩡한데 서비스 전체가 응답하지 않는다. 요청 하나는 DNS, CDN, 로드밸런서, 앱, DB를 차례로 지나야 응답이 되기 때문이다.

하나만 멈춰도 전체가 멈추는 지점을 단일 장애점(SPOF, single point of failure)이라고 한다. 이중화(redundancy)는 계층마다 같은 역할을 하는 것을 둘 이상 두어 단일 장애점을 없애는 일이다.

세 장면에서 DB가 멈추는 순간 오른쪽 위 응답 비율이 어떻게 바뀌는지 본다.

<figure class="fig" data-figure="high-availability-spof">
  <figcaption>계층마다 한 대일 때와 두 대일 때의 DB 장애</figcaption>
</figure>

계층마다 한 대면 앞의 네 계층이 멀쩡해도 응답은 0%다. 두 대를 두면 같은 장애에도 남은 DB로 계속 응답한다.

두 대를 두는 것으로 끝나지는 않는다. 고장 난 쪽을 누가 알아채는지(감지), 요청을 남은 쪽으로 어떻게 돌리는지(전환), 둘이 동시에 주인 노릇을 하지 않게 하는 방법이 계층마다 다르다. 장애를 돌아볼 때는 요청 경로를 그려 놓고 계층마다 몇 대인지부터 센다.

## 이중화 방식

두 대를 둔 뒤에는 평소에 둘 다 일을 시킬지, 한 대는 비워 둘지를 정한다.

- Active-Active: 둘 다 요청을 받는다. 한쪽이 멈추면 남은 쪽이 전부 받는다.
- Active-Standby: 한 대만 받고 다른 한 대는 대기한다. 받던 쪽이 멈추면 대기하던 쪽으로 넘긴다.

같은 서버 A 장애를 두 방식에 걸어 보자. 오른쪽 위 실패 건수와 서버 B의 몫 막대를 견준다.

<figure class="fig" data-figure="high-availability-modes">
  <figcaption>같은 장애에서 Active-Active와 Active-Standby</figcaption>
</figure>

Active-Active는 LB가 A를 빼는 짧은 순간만 실패하지만, B가 평소의 두 배를 받는다. Active-Standby는 B가 비어 있어 부하 걱정은 없지만, 감지하고 넘기는 동안 들어온 요청이 전부 실패한다.

- Active-Active: 한쪽이 멈춰도 버티려면 평소 사용률을 50% 아래로 둔다. 웹 서버, CDN처럼 어느 쪽이 받아도 결과가 같은 계층에 맞는다.
- Active-Standby: 대기 장비 비용과 전환 시간을 치른다. 쓰기 주인이 하나여야 하는 DB, 주소 하나를 한 노드만 가져야 하는 VIP에 맞는다.

Active-Active로 두 대를 돌린다면 서버마다 사용률이 50%를 넘는 시간대가 있는지부터 본다.

## 요청 경로 이중화

요청이 들어오는 길은 이름 해석, 엣지, 진입 주소, 앱 순서다. 이 계층들은 데이터를 갖지 않아서 살아 있는 쪽으로 요청만 돌리면 된다.

### DNS 가중치 라우팅

CDN 업체 한 곳에서 장애가 나자 정적 파일이 전부 안 뜬다. CDN을 두 곳(AWS CloudFront, Azure Front Door)에 두고 DNS가 둘 중 하나를 골라 답하게 하면 이 장애를 피한다.

Route 53의 가중치 라우팅(weighted routing)은 같은 이름, 같은 타입의 레코드를 여러 개 두고 가중치 비율대로 답한다. 몫은 절대값이 아니라 전체 가중치 합에 대한 비율이다.

```text
CloudFront 70, Front Door 30   →  70 / (70 + 30) = 70%
새 CDN을 1, 기존을 255로 두면  →  1 / (1 + 255) = 약 0.4%
```

레코드마다 헬스체크를 붙이면 실패한 레코드는 답에서 빠진다. 세 장면에서 Route 53 안의 상태 점과 오른쪽 위 비율을 본다.

<figure class="fig" data-figure="high-availability-dns">
  <figcaption>가중치 70 : 30 레코드에서 헬스체크가 실패할 때 Route 53의 답</figcaption>
</figure>

한쪽이 실패하면 남은 쪽만 답한다. 둘 다 실패하면 아무것도 답하지 않는 대신 전부 정상으로 보고 다시 가중치대로 고른다. 이름 해석이 아예 실패하는 것보다 죽은 주소라도 주는 편을 택한 동작이다.

설정은 레코드 두 개다. `set_identifier`가 같은 이름의 두 레코드를 구분한다.

```hcl
resource "aws_route53_record" "cloudfront" {
  zone_id         = var.zone_id
  name            = "cdn.example.com"
  type            = "CNAME"
  ttl             = 60
  set_identifier  = "aws"
  health_check_id = aws_route53_health_check.cloudfront.id
  records         = [var.cloudfront_domain]
  weighted_routing_policy { weight = 70 }
}
# Front Door 레코드는 set_identifier = "azure", weight = 30
```

헬스체크 종류와 가중치 0에는 함정이 하나씩 있다.

- 헬스체크는 TCP로 둔다. HTTPS로 특정 경로를 보면 그 파일이 캐시에서 밀리거나 오리진이 잠깐 흔들릴 때 멀쩡한 엣지까지 빠진다. TCP 헬스체크는 Host 헤더를 보내지 않아 엣지에 연결되는지만 본다. 대신 오리진 장애는 못 잡는다. 이건 다음 절 오리진 그룹의 몫이다.
- 레코드를 끄려면 지우지 않고 가중치를 0으로 둔다. 다만 헬스체크가 붙은 0짜리 레코드는 0이 아닌 레코드가 전부 실패하면 다시 답에 들어온다. 확실히 빼려면 헬스체크도 뗀다.

Route 53 자체가 멈추는 경우까지 막으려면 서브 도메인을 다른 DNS 업체와 나눠 갖는다. 부모 존의 NS 레코드에 두 업체의 네임서버를 함께 적으면, 리졸버는 한쪽이 답하지 않을 때 다른 쪽에 묻는다. 대신 같은 가중치 구성을 두 곳에 유지해야 하고, 한쪽만 바꾸면 리졸버마다 다른 답을 받는다.

실제로 나뉘는지는 같은 주소를 여러 번 불러 응답 헤더를 센다. CloudFront는 `x-amz-cf-id`, Front Door는 `x-azure-ref`를 붙인다.

```bash
for i in $(seq 1 200); do
  curl -s -o /dev/null -D - https://cdn.example.com/ | grep -ioE '^(x-amz-cf-id|x-azure-ref)'
done | sort | uniq -c
```

가중치를 바꾼 뒤에는 이 측정을 다시 돌려 비율이 따라오는지 확인한다.

### CDN 오리진 그룹

엣지는 살아 있는데 오리진 S3 버킷이 있는 리전이 흔들리면, DNS 헬스체크는 정상인데 캐시에 없는 파일만 안 뜬다. CloudFront 오리진 그룹(origin group)은 1차와 2차 오리진을 묶어, 1차가 연결되지 않거나 정해 둔 상태 코드를 주면 같은 요청을 2차로 보낸다.

캐시에 있는 파일은 오리진까지 가지 않으니, 이 경로는 캐시를 빗나간 요청만 탄다. 넘어가는 요청도 `GET`, `HEAD`, `OPTIONS`뿐이다. 업로드 같은 쓰기는 넘어가지 않으니 쓰기 경로는 따로 이중화한다.

1차 오리진이 끊긴 순간부터 2차로 넘어가기까지를 데모로 견준다. 모드를 바꿔 가며 1차 오리진 끊기를 누르고, 2차 오리진 줄에 블록이 생기는 시각을 본다.

<figure class="fig" data-figure="high-availability-origin">
  <figcaption>1차 오리진이 끊겼을 때 2차로 넘어가기까지</figcaption>
</figure>

기본값에서는 10초씩 세 번 연결을 시도해 30초를 기다린 뒤에야 2차로 넘어간다. 연결 제한 시간을 2초, 시도를 1회로 줄이면 2초 만에 넘어간다. 바뀐 건 1차를 포기하기까지 기다리는 시간 하나다.

```hcl
origin {
  origin_id           = "s3-seoul"
  domain_name         = var.seoul_bucket_domain
  connection_attempts = 1   # 1~3, 기본 3
  connection_timeout  = 2   # 1~10초, 기본 10
}
origin_group {
  origin_id = "s3-group"
  failover_criteria { status_codes = [500, 502, 503, 504] }
  member { origin_id = "s3-seoul" }
  member { origin_id = "s3-tokyo" }
}
```

너무 줄이면 1차가 잠깐 느릴 때도 2차로 넘어간다. 오리진의 평소 연결 시간을 재 보고 그보다 넉넉하게 잡는다.

### 컨트롤 플레인 VIP

kubeadm으로 만든 클러스터에서 컨트롤 플레인 노드 한 대가 멈추면, 돌던 파드는 그대로 돌지만 kubectl, 스케줄링, 오토스케일이 전부 멈춘다. 그래서 컨트롤 플레인을 세 대 두는데, kubectl과 kubelet이 붙을 주소는 하나여야 한다.

kubeadm은 이 주소를 `--control-plane-endpoint`로 받고, 공식 문서는 여기에 로드밸런서 주소를 넣으라고 한다. 온프레미스에서 흔히 쓰는 조합이 keepalived와 haproxy다.

- keepalived: VRRP로 두 노드가 가상 IP(VIP) 하나의 주인을 정한다. 우선순위가 높은 MASTER가 VIP를 갖고 1초마다 광고를 보낸다.
- haproxy: VIP로 들어온 6443 포트 요청을 살아 있는 kube-apiserver 세 대로 나눈다.

```bash
kubeadm init --control-plane-endpoint "10.0.0.100:6443" --upload-certs
```

MASTER가 멈추면 BACKUP은 광고가 끊긴 것을 보고 VIP를 가져간다. 두 장면에서 VIP 칩이 어느 노드로 옮겨 가는지 본다.

<figure class="fig" data-figure="high-availability-vip">
  <figcaption>keepalived 두 대와 kube-apiserver 세 대</figcaption>
</figure>

BACKUP은 광고가 `advert_int`의 3배에 약간의 여유 시간을 더한 만큼(기본 1초면 약 3초) 오지 않으면 MASTER가 죽었다고 판단한다. VIP가 옮겨 가도 kubectl이 쓰는 주소는 그대로라 설정을 바꿀 일이 없다.

노드는 살아 있는데 apiserver만 죽은 경우는 헬스체크 스크립트로 잡는다. 스크립트가 연속으로 실패하면 우선순위를 깎아 BACKUP보다 낮춘다.

```text
vrrp_script check_apiserver {
  script "/etc/keepalived/check_apiserver.sh"   # localhost:6443/healthz 를 curl
  interval 1
  fall 2
  weight -10          # MASTER 101 - 10 = 91 < BACKUP 100
}
vrrp_instance VI_1 {
  state MASTER        # 다른 노드는 BACKUP
  priority 101        # 다른 노드는 100
  virtual_router_id 51
  advert_int 1
  virtual_ipaddress { 10.0.0.100 }
  track_script { check_apiserver }
}
```

- 컨트롤 플레인은 세 대, 다섯 대처럼 홀수로 둔다. etcd가 과반으로 결정해서 네 대는 세 대와 똑같이 한 대 장애까지만 버틴다. 뒤의 레플리카셋 선거와 같은 계산이다.
- VIP를 나눠 갖는 노드는 같은 서브넷에 있어야 한다.
- haproxy와 keepalived를 컨트롤 플레인 노드에 static pod로 올리거나, 둘을 합친 kube-vip를 쓰는 방법도 kubeadm 문서에 있다.

설정 뒤에는 MASTER에만 VIP가 붙어 있는지 확인하고, MASTER를 직접 꺼서 BACKUP으로 넘어가는지 본다.

```bash
ip -4 addr show dev eth0 | grep -w 10.0.0.100
```

### 앱 Active-Standby

쿠버네티스 없이 Docker Compose로 서비스 하나를 돌리는데, 배포할 때마다 컨테이너가 다시 뜨며 몇 초씩 끊긴다. 앞에 nginx를 두고 같은 앱 컨테이너를 active와 standby 두 벌 띄우면, 한쪽을 갱신하는 동안 다른 쪽이 받는다.

- nginx와 두 컨테이너는 미리 만든 Docker 네트워크에 붙인다. Compose 파일 안에서 만들면 그 프로젝트에 묶이므로 `external: true`로 붙인다.
- 같은 Compose 파일을 프로젝트 이름만 바꿔(`-p active`, `-p standby`) 두 번 띄우면 컨테이너 이름이 `active-app-1`, `standby-app-1`이 된다.
- nginx는 컨테이너 이름으로 프록시한다.

배포는 standby를 먼저 갱신하고, nginx가 standby를 가리키게 바꾼 뒤, active를 갱신하고 되돌리는 순서다. 세 장면에서 nginx 상자의 대상과 요청 점이 가는 쪽을 본다.

<figure class="fig" data-figure="high-availability-app">
  <figcaption>nginx 뒤 active와 standby로 끊김 없이 배포하기</figcaption>
</figure>

`nginx -s reload`는 새 설정으로 워커 프로세스를 새로 띄우고, 기존 워커는 처리 중이던 요청을 끝낸 뒤 내려간다. 그래서 대상을 바꾸는 순간에도 끊기는 요청이 없다.

```bash
docker exec nginx curl -s -o /dev/null -w "%{http_code}" http://standby-app-1:8080/   # 200이면 진행
sed -i "s/active-app-1/standby-app-1/" /mnt/nginx/server/default.conf
docker exec nginx nginx -s reload
```

이 구조는 배포와 컨테이너 장애를 막지만, 서버가 한 대라 서버 자체가 멈추면 전부 멈춘다. 전환도 스크립트를 돌릴 때만 일어난다. 컨테이너가 죽었을 때 자동으로 넘기려면 nginx upstream의 `backup`을 쓴다.

```nginx
upstream app {
  server active-app-1:8080;
  server standby-app-1:8080 backup;
}
```

평소에는 active만 받고, active와의 통신이 `fail_timeout`(기본 10초) 안에 `max_fails`(기본 1회)만큼 실패하면 그 뒤 10초 동안 backup으로 보낸다. 서버 장애까지 막으려면 같은 구성을 두 번째 서버에 두고 앞의 VIP로 묶는다. 이 구조를 쓴다면 막는 장애와 못 막는 장애부터 운영 문서에 적어 둔다.

## 데이터 이중화

요청 경로는 살아 있는 쪽으로 돌리면 끝이지만, 데이터는 두 벌이 같은 내용이어야 한다. 복제가 늦으면 넘어간 쪽에 옛 데이터가 있고, 쓰기 주인이 둘이 되면 데이터가 갈라진다.

### 스토리지 복제

정적 파일을 서울 S3 버킷 하나에 두면 서울 리전이 흔들릴 때 손쓸 방법이 없다. 도쿄에 버킷을 하나 더 만들고 교차 리전 복제(CRR, Cross-Region Replication)를 건다.

한 방향만 걸면 배포 파이프라인이 늘 서울에 써야 하고, 서울이 막히면 배포도 멈춘다. 양방향으로 걸면 어느 쪽에 써도 반대편으로 넘어간다. 두 장면에서 복제본이 반대 화살표로 되돌아가는지 본다.

<figure class="fig" data-figure="high-availability-replication">
  <figcaption>서울과 도쿄 버킷의 양방향 복제</figcaption>
</figure>

양방향이면 서울에서 간 객체가 다시 서울로 돌아올 것 같지만, S3는 다른 복제 규칙이 만든 복제본을 다시 복제하지 않는다. 그래서 순환 없이 어느 쪽에 올려도 양쪽이 같아진다.

```hcl
resource "aws_s3_bucket_replication_configuration" "seoul_to_tokyo" {
  bucket = aws_s3_bucket.seoul.id
  role   = aws_iam_role.replication.arn
  rule {
    id     = "all-to-tokyo"
    status = "Enabled"
    filter {}
    delete_marker_replication { status = "Enabled" }
    source_selection_criteria {
      replica_modifications { status = "Enabled" }
    }
    destination {
      bucket = aws_s3_bucket.tokyo.arn
      replication_time {
        status = "Enabled"
        time { minutes = 15 }   # 15만 허용
      }
      metrics {
        status = "Enabled"
        event_threshold { minutes = 15 }
      }
    }
  }
  depends_on = [aws_s3_bucket_versioning.seoul, aws_s3_bucket_versioning.tokyo]
}
# 도쿄에서 서울 방향은 소스와 대상만 바꿔 도쿄 provider로 하나 더 둔다
```

- 복제는 양쪽 버킷에 버전 관리가 켜져 있어야 걸린다. `depends_on`이 그 순서를 잡는다.
- 삭제도 따라가게 하려면 삭제 마커 복제를 켠다. 끄면 한쪽에서 지운 파일이 다른 쪽에 남는다.
- `replica_modifications`를 켜면 복제본에 붙은 메타데이터 변경도 원본 쪽으로 맞춰진다.
- 복제는 보통 몇 초 안에 끝나지만 보장은 없다. Replication Time Control(RTC)을 켜면 99.9%를 15분 안에 복제하고, 15분을 넘긴 객체를 `OperationMissedThreshold` 이벤트로 알려 준다.
- 복제는 비동기라 같은 키를 양쪽에서 거의 동시에 쓰면 잠시 서로 다른 내용이 보일 수 있다. 쓰기는 파이프라인 하나로 모은다.

복제가 밀리는 줄 모르고 넘기면 넘어간 쪽에 옛 파일이 있다. 전환 전에 `OperationMissedThreshold` 알림과 복제 지연 지표부터 확인한다.

### 다중 리전 엔드포인트

버킷을 둘로 만들어도 앱 설정에 서울 버킷 이름이 박혀 있으면, 장애 때 설정을 바꾸고 다시 배포해야 한다. S3 Multi-Region Access Point(MRAP)는 여러 리전의 버킷 앞에 전역 엔드포인트 하나를 세운다. 요청은 AWS Global Accelerator를 거쳐 활성 상태인 가장 가까운 버킷으로 간다.

라우팅 상태는 버킷마다 활성과 비활성 둘이다.

- Active-Active: 둘 다 활성이다. 가까운 쪽으로 가고, 한 리전에 트래픽 장애가 나면 다른 활성 리전으로 자동으로 돌린다.
- Active-Passive: 한쪽만 활성이다. 콘솔이나 API로 장애 조치(failover)를 걸면 두 리전의 상태가 맞바뀐다.

두 장면에서 서울 버킷을 비활성으로 돌린 뒤 요청 점이 어디로 가는지 본다.

<figure class="fig" data-figure="high-availability-mrap">
  <figcaption>MRAP 이름 하나 뒤의 서울과 도쿄 버킷</figcaption>
</figure>

라우팅 상태를 바꾸면 약 2분 뒤부터 새 요청이 도쿄로 간다. 이미 열린 연결은 끊지 않고 끝까지 처리한다. 앱은 MRAP 별칭 하나만 알고 있어서 설정을 바꿀 일이 없다.

```bash
aws s3control submit-multi-region-access-point-routes \
  --region ap-northeast-1 --account-id 123456789012 --mrap "$MRAP_ARN" \
  --route-updates Bucket=seoul-bucket,TrafficDialPercentage=0 \
                  Bucket=tokyo-bucket,TrafficDialPercentage=100
```

- 라우팅 명령은 정해진 다섯 리전(도쿄, 시드니, 버지니아 북부, 오레곤, 아일랜드)에서만 받는다. 서울 엔드포인트로 보내면 안 된다.
- 접근 정책은 MRAP와 별도 리소스로 붙이고, 정책의 ARN에는 이름이 아니라 별칭(alias)을 넣는다.
- 객체 권한은 `accesspoint/<별칭>/object/*`로 따로 적는다. 이 줄이 없으면 목록은 보이는데 객체를 못 읽는다.

AWS 문서는 장애 조치를 설정하기 전에 앞 절의 양방향 복제와 `replica_modifications`를 먼저 켜라고 권한다. 넘어간 쪽에 쓴 파일이 원래 쪽으로 돌아와야 다시 되돌릴 수 있기 때문이다. MRAP를 붙인다면 앱 설정에서 버킷 이름이 전부 빠졌는지부터 확인한다.

### 레플리카셋 선거

MongoDB 레플리카셋 세 대 중 Primary가 멈추면 10여 초 동안 쓰기가 실패하다가 다시 된다. 남은 두 대가 투표로 새 Primary를 뽑는 시간이다.

레플리카셋은 Primary 한 대가 쓰기를 받고, Primary가 한 일을 oplog에 적으면 Secondary가 그 oplog를 받아 따라 한다. Primary가 응답하지 않으면 남은 멤버가 선거를 연다.

- 하트비트: 멤버끼리 2초마다 주고받는다. Primary와 10초(`electionTimeoutMillis` 기본값) 넘게 연락이 끊기면 Secondary가 선거를 연다.
- 과반: 투표 멤버 과반의 표를 먼저 받은 멤버가 Primary가 된다. 기본 설정이면 새 Primary가 나오기까지 보통 12초를 넘지 않는다.
- 후보 조건: 투표하는 멤버는 자기보다 oplog가 뒤처진 후보에게 표를 주지 않는다. 그래서 가장 최근까지 따라온 멤버가 뽑힌다.
- 우선순위: `priority`는 기본 1이고 0에서 1000까지 준다. 높을수록 선거를 먼저 열고 이길 가능성이 크다. 0이면 Primary가 되지 않는다.

데모에서 1대 장애와 2대 장애를 번갈아 눌러 보고, 남은 멤버 옆에 뜨는 표 수를 본다.

<figure class="fig" data-figure="high-availability-quorum">
  <figcaption>세 대 레플리카셋에서 한 대와 두 대가 멈출 때 (10초 대기는 줄여 그렸다)</figcaption>
</figure>

한 대가 멈추면 남은 둘이 2/3 과반을 만들어 새 Primary를 뽑는다. 두 대가 멈추면 남은 하나는 1/3이라 Primary가 될 수 없고 쓰기가 멈춘다. 바뀐 건 남은 멤버 수 하나다.

과반은 살아 있는 멤버가 아니라 전체 투표 멤버 수로 센다. 그래서 멤버를 짝수로 늘려도 버티는 장애 수가 늘지 않는다.

| 투표 멤버 | 과반 | 버티는 장애 |
|---|---|---|
| 2 | 2 | 0 |
| 3 | 2 | 1 |
| 4 | 3 | 1 |
| 5 | 3 | 2 |

etcd FAQ와 MongoDB 문서의 과반 계산이다.

데이터를 두 벌만 둘 여유가 있으면 Arbiter를 더한다. Arbiter는 데이터 없이 투표만 하는 멤버라 작은 장비로 세 번째 표를 만든다(Primary, Secondary, Arbiter를 줄여 PSA). Percona Operator for MongoDB는 `cr.yaml`의 `replsets[].arbiter.enabled`로 Arbiter를 붙인다. 데이터 멤버가 이미 세 대인데 Arbiter를 더하면 투표 멤버가 넷이 되어 버티는 장애 수는 그대로다.

투표 멤버 수는 홀수로 맞추고, 장애 테스트 때는 Primary를 꺼 보며 쓰기가 몇 초 만에 돌아오는지 잰다.

### 쓰기 롤백

Primary가 멈췄다 돌아온 뒤, 분명 성공 응답을 받은 주문 몇 건이 DB에 없다. Primary가 쓰기를 받고 Secondary에 복제하기 전에 멈추면 새 Primary는 그 쓰기를 모른다. 돌아온 옛 Primary는 새 Primary에 맞추려고 자기만 가진 쓰기를 되돌린다. 이것을 롤백(rollback)이라고 한다.

쓰기를 언제 성공으로 돌려줄지는 write concern이 정한다.

- `w: 1`: Primary에 쓰면 바로 성공을 돌려준다.
- `w: "majority"`: 투표 멤버 과반에 복제된 뒤 성공을 돌려준다.

데모에서 두 모드로 쓰고 Primary 끄기를 누른 뒤, rs0 줄 끝에 롤백 블록이 생기는지 본다.

<figure class="fig" data-figure="high-availability-rollback">
  <figcaption>쓰기 X 직후 Primary가 멈출 때 (시간은 모양을 보여 주는 대략값)</figcaption>
</figure>

`w: 1`은 X가 rs0에만 있을 때 성공을 돌려줘서, rs1이 Primary가 되면 X가 사라진다. `w: "majority"`는 X가 rs1에 복제된 뒤 성공을 돌려줘서 누가 Primary가 돼도 X가 남는다. 응답이 복제 한 번만큼 늦어지는 대신 **성공한 쓰기는 사라지지 않는다.**

- MongoDB 5.0부터 기본 write concern은 `majority`다. 다만 Arbiter가 있고 데이터 멤버 수가 과반 이하면 기본값이 `w: 1`이 된다. PSA가 바로 이 경우다.
- PSA에서 `majority`를 쓰면 Arbiter는 쓰기를 받지 않으니 Primary와 Secondary가 둘 다 살아 있어야 쓰기가 끝난다. Secondary 하나만 멈춰도 쓰기가 기다린다. Percona Operator는 Arbiter를 켜면 기본값을 `majority`로 맞춘다.
- 되돌린 쓰기는 `<dbpath>/rollback/<컬렉션 UUID>/removed.<시각>.bson` 파일로 남는다. `bsondump`로 읽어 필요한 것만 다시 넣는다.

PSA 구성이라면 지금 기본값이 무엇인지부터 확인한다.

```javascript
db.adminCommand({ getDefaultRWConcern: 1 })
```

## 전환 설계

### 감지와 전환 시간

같은 장애가 나도 어떤 계층은 3초 만에, 어떤 계층은 2분이 넘어서 돌아온다. 전환 시간은 장애를 알아채는 감지 시간과, 알아챈 뒤 요청이 실제로 옮겨 가는 시간을 더한 값이다.

```text
keepalived VIP    광고 3회 놓침 (advert_int 1초 × 3)       약 3초
MongoDB 선거      하트비트 10초 + 선거                      약 12초
CDN 오리진 그룹   연결 시도 10초 × 3회 (요청마다)            30초
S3 MRAP           라우팅 상태 변경 뒤 반영                   약 2분
Route 53 가중치   헬스체크 30초 × 3회 + TTL 60초             약 2분 30초
```

같은 장애 시각에서 다섯 계층의 막대가 자라는 속도를 견준다.

<figure class="fig" data-figure="high-availability-time">
  <figcaption>계층별 감지(주황)와 전환(보라) 시간</figcaption>
</figure>

VIP는 3초인데 DNS는 2분 30초로 50배 차이가 난다. DNS는 헬스체크가 실패를 세 번 확인하는 데 90초, 리졸버가 캐시한 옛 답이 만료되는 데 TTL 60초가 더 걸린다. MRAP는 사람이 상태를 바꾼 뒤부터 잰 값이라, 장애를 알아채는 시간이 그 앞에 더 붙는다.

시간을 줄이는 손잡이는 계층마다 다르다.

- 감지: 헬스체크 간격과 실패 횟수. Route 53은 간격을 30초에서 10초로 줄일 수 있다(추가 요금).
- 전파: DNS TTL. 낮출수록 빨리 넘어가지만 리졸버 질의가 늘어난다.
- 되돌아오기: 감지를 빠르게 할수록 잠깐 느린 것도 장애로 보고 오갈 수 있다. 복귀 조건(keepalived `rise`, 연속 성공 횟수)은 넉넉히 둔다.

복구 목표 시간이 정해져 있다면 요청 경로의 계층마다 이 덧셈을 해 보고 가장 긴 계층부터 줄인다.

### 스플릿 브레인

keepalived 두 대를 설정했는데, 두 노드 모두에 VIP가 붙어 있고 접속이 됐다 안 됐다 한다. 둘 사이의 VRRP 패킷이 방화벽에 막혀 둘 다 상대가 죽었다고 보고 MASTER가 된 상태다. 이렇게 둘이 동시에 주인 노릇을 하는 것을 스플릿 브레인(split brain)이라고 한다.

두 장면에서 연결이 끊긴 뒤 주인이 몇 곳이 되는지 견준다.

<figure class="fig" data-figure="high-availability-split">
  <figcaption>두 대의 VRRP와 세 대의 과반 투표에서 네트워크가 끊길 때</figcaption>
</figure>

두 대만 있으면 상대가 죽은 것과 상대와 연결만 끊긴 것을 구분할 방법이 없다. 세 대가 과반으로 정하면 연결이 1 : 2로 갈려도 과반을 보는 쪽은 한 곳뿐이라, 소수 쪽 Primary는 스스로 내려오고 주인은 하나로 남는다.

- VIP 같은 Active-Standby 쌍: VRRP(IP 프로토콜 112)를 양쪽 방화벽에서 열어 둔다. 막혀 있으면 VIP가 넘어가지 않는 게 아니라 양쪽 다 VIP를 잡는다.
- 데이터를 가진 계층: 투표 멤버를 셋 이상 홀수로 두고 과반으로 정하게 한다. DB의 스플릿 브레인은 양쪽에 다른 쓰기가 쌓여서 VIP보다 되돌리기 훨씬 어렵다.

```bash
iptables -I INPUT  -p vrrp -j ACCEPT
iptables -I OUTPUT -p vrrp -j ACCEPT
```

keepalived를 설정한 뒤에는 BACKUP 노드에 VIP가 없는지부터 확인한다.

## 정리

| 계층 | 방식 | 전환 시간 | 기억할 점 |
|---|---|---|---|
| DNS | Active-Active, 가중치 | 헬스체크 30초 × 3 + TTL | 전부 실패하면 전부 정상으로 보고 답한다 |
| CDN 오리진 | 오리진 그룹 | 기본 30초, 줄일 수 있다 | GET, HEAD, OPTIONS만 넘어간다 |
| 컨트롤 플레인 | Active-Standby, VIP | 약 3초 | VRRP가 막히면 VIP가 두 곳에 생긴다 |
| 앱 | Active-Standby, nginx | reload 순간 | 서버 한 대면 서버 장애는 못 막는다 |
| 스토리지 | 양방향 복제 | 보통 몇 초, RTC 15분 | 복제본은 다시 복제되지 않는다 |
| 스토리지 엔드포인트 | MRAP | 약 2분 | 앱은 별칭 하나만 안다 |
| DB | 과반 투표 | 약 12초 | 홀수로 두고 `w: "majority"`, PSA 기본값 주의 |

## 참고

- [AWS — Weighted routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-weighted.html)
- [AWS — How Amazon Route 53 chooses records when health checking is configured](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-how-route-53-chooses-records.html)
- [AWS — Values that you specify when you create or update health checks](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-creating-values.html)
- [AWS — Optimize high availability with CloudFront origin failover](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/high_availability_origin_failover.html)
- [Kubernetes — Creating Highly Available Clusters with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/)
- [kubeadm — Options for Software Load Balancing](https://github.com/kubernetes/kubeadm/blob/main/docs/ha-considerations.md)
- [keepalived.conf(5)](https://github.com/acassen/keepalived/blob/master/doc/man/man5/keepalived.conf.5.in)
- [etcd — FAQ](https://etcd.io/docs/v3.6/faq/)
- [nginx — Controlling nginx](https://nginx.org/en/docs/control.html)
- [nginx — ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [AWS — What does Amazon S3 replicate?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html)
- [AWS — S3 Replication Time Control](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-time-control.html)
- [AWS — Multi-Region Access Points routing states](https://docs.aws.amazon.com/AmazonS3/latest/userguide/FailoverConfiguration.html)
- [AWS — Using Multi-Region Access Point failover controls](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingFailover.html)
- [MongoDB — Replica Set Elections](https://www.mongodb.com/docs/manual/core/replica-set-elections/)
- [MongoDB — Replica Set Configuration](https://www.mongodb.com/docs/manual/reference/replica-configuration/)
- [MongoDB — Write Concern](https://www.mongodb.com/docs/manual/reference/write-concern/)
- [MongoDB — Rollbacks During Replica Set Failover](https://www.mongodb.com/docs/manual/core/replica-set-rollbacks/)
- [Percona Operator for MongoDB — Arbiter](https://docs.percona.com/percona-operator-for-mongodb/arbiter.html)
- 원글: [CDN 이중화](https://kimjanghyun1010.tistory.com/117), [MRAP로 S3 고가용성 구성](https://kimjanghyun1010.tistory.com/116), [kubeadm 설치 (w/ master HA)](https://kimjanghyun1010.tistory.com/103), [Docker Compose Active-Standby 구성 (w/ nginx)](https://kimjanghyun1010.tistory.com/88), [Percona MongoDB](https://kimjanghyun1010.tistory.com/40)
