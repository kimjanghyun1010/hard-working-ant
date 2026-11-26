---
title: 사설망 연결
description: 패킷이 서브넷과 라우팅 테이블을 따라 다음 홉으로 가는 길부터 VNet 피어링, IPsec 사이트 간 VPN, CIDR 겹침과 비대칭 라우팅까지 정리했다.
date: 2026-11-14 12:00:00 +0900
series: 인프라 운영
tags: [network, azure, vnet, vpn, ipsec, routing]
scripts: [figures/private-network.js]
---

## 패킷 경로

사무실 PC에서 클라우드 VM의 DB에 붙어야 한다. DB에 공인 IP를 달고 방화벽을 열면 바로 되지만, 그러면 DB 포트가 인터넷 전체에 열린다. 사설 IP끼리 오가는 길을 따로 만들면 DB는 인터넷에 보이지 않는다.

길은 연결하는 상대에 따라 두 가지로 만든다.

- 클라우드 안의 두 네트워크: VNet 피어링
- 사무실(온프레미스)과 클라우드: IPsec 사이트 간 VPN

어느 쪽이든 패킷 하나의 길은 세 가지로 정해진다. 출발한 서브넷, 그 서브넷의 라우팅 테이블, 테이블에서 고른 줄의 다음 홉이다.

### 주소 공간과 서브넷

VNet(Virtual Network)은 클라우드 안의 사설망 하나다. AWS의 VPC와 같은 개념이고, 만들 때 주소 공간을 CIDR로 정한다.

`10.1.0.0/16`의 `/16`은 앞 16비트를 고정한다는 뜻이다. 남은 16비트로 주소 65,536개를 쓴다. 서브넷은 이 공간을 다시 잘게 자른 조각이고, VM은 서브넷 하나에 붙는다.

아래 그림에서 고정 비트가 늘 때 주소 수가 어떻게 줄고, IP 하나가 어느 서브넷에 들어가는지 본다.

<figure class="fig" data-figure="private-network-cidr">
  <figcaption>고정 비트 수로 정해지는 주소 공간과 서브넷</figcaption>
</figure>

```text
/16  →  2^16 = 65,536개
/24  →  2^8  = 256개   (Azure 예약 5개를 빼면 251개)
/27  →  2^5  = 32개    (Azure 예약 5개를 빼면 27개)
```

Azure는 서브넷마다 첫 주소 네 개와 마지막 주소 하나를 예약한다. VPN 게이트웨이가 들어갈 `GatewaySubnet`은 /27 이상으로 잡는다.

주소 공간은 처음부터 넉넉하게, 그리고 다른 네트워크와 겹치지 않게 고른다. 나중에 이을 사무실과 다른 VNet의 대역까지 한 표에 적어 두고 고른다.

### 라우팅 테이블과 다음 홉

같은 VNet의 VM끼리는 바로 통하는데, 옆 VNet의 VM에는 ping이 가지 않는다. 패킷이 갈 곳은 서브넷마다 붙은 라우팅 테이블이 정한다.

라우팅 테이블의 줄 하나는 목적지 대역과 다음 홉(next hop)이다. Azure는 서브넷을 만들 때 기본 경로(시스템 경로)를 넣어 둔다.

- VNet 자기 대역: 다음 홉은 가상 네트워크. 서브넷끼리는 설정 없이 통한다.
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`: 다음 홉은 없음. 길을 만들기 전까지 사설 대역은 버린다.
- `0.0.0.0/0`: 다음 홉은 인터넷.

세 장면에서 목적지가 바뀔 때 테이블의 어느 줄이 켜지고, 패킷이 어디서 멈추는지 지켜보자.

<figure class="fig" data-figure="private-network-route">
  <figcaption>목적지마다 라우팅 테이블에서 고르는 줄과 다음 홉</figcaption>
</figure>

옆 VNet 대역은 VNet 자기 대역이 아니라서 사설 대역 기본 경로에 걸려 버려진다. 피어링과 VPN은 이 테이블에 **다음 홉이 있는 줄을 더 넣는 일**이다.

연결이 안 되면 VM 네트워크 인터페이스(NIC)의 유효 경로(effective routes)부터 본다. 실제로 적용된 줄과 다음 홉이 그대로 나온다.

```bash
az network nic show-effective-route-table -g <리소스 그룹> -n <NIC 이름> -o table
```

### 가장 긴 접두사 일치

방화벽을 거치게 하려고 UDR(사용자 정의 경로)을 넣었는데 일부 트래픽만 방화벽을 지난다. 목적지 하나에 여러 줄이 걸리면 Azure는 접두사가 가장 긴 줄(longest prefix match)을 고른다.

`10.1.2.5`는 `0.0.0.0/0`, `10.0.0.0/8`, `10.1.0.0/16`, `10.1.2.0/24` 네 줄 모두에 들어간다. 아래 그림은 줄마다 목적지와 몇 비트까지 같은지 센다. 두 장면에서 고르는 줄이 바뀌는 순간을 본다.

<figure class="fig" data-figure="private-network-lpm">
  <figcaption>목적지와 일치하는 비트 수로 고르는 경로</figcaption>
</figure>

`10.1.2.5`는 24비트가 다 맞는 /24로, `10.1.3.5`는 24번째 비트에서 어긋나 /16으로 간다. 테이블의 순서가 아니라 길이로 고르기 때문에, /24 UDR은 `10.1.2.x`만 방화벽으로 보내고 같은 VNet의 다른 서브넷은 그대로 지나친다.

접두사 길이가 같으면 UDR, BGP 경로, 시스템 경로 순으로 고른다. 예외가 하나 있다. VNet 자기 대역과 피어링 대역의 시스템 경로는 BGP로 받은 경로가 더 길어도 우선한다. 뒤에 나올 CIDR 겹침이 이 규칙에서 생긴다.

UDR을 넣을 때는 덮어써야 할 시스템 경로와 같거나 더 긴 접두사로 잡고, 넣은 뒤 유효 경로에서 기존 줄이 `Invalid`로 바뀌었는지 확인한다.

## 클라우드 내부 연결

### VNet 피어링

VNet을 서비스마다 나눴더니 API VNet에서 DB VNet으로 갈 길이 없다. VNet 피어링(peering)은 두 VNet을 Microsoft 백본으로 직접 이어 하나처럼 쓰게 한다. 게이트웨이도 암호화도 없이, 같은 리전이면 같은 VNet 안과 같은 지연으로 오간다.

피어링은 링크 두 개로 이루어진다. A에서 B로, B에서 A로 하나씩 있어야 하고, 첫 링크만 있으면 상태가 Initiated, 둘 다 있으면 Connected다. 포털은 한 화면에서 두 링크를 같이 만든다.

세 장면에서 피어링 전후로 라우팅 테이블에 생기는 줄과 패킷이 지나는 길을 본다.

<figure class="fig" data-figure="private-network-peering">
  <figcaption>피어링 링크 두 개와 양쪽 라우팅 테이블</figcaption>
</figure>

두 링크가 Connected가 되면 양쪽 서브넷에 상대 대역으로 가는 `VNet 피어링` 줄이 생긴다. 다른 리전끼리(글로벌 피어링), 다른 구독이나 Entra 테넌트끼리도 이을 수 있다.

- 두 VNet의 주소 공간이 겹치면 피어링을 만들 수 없다.
- 기본 Azure DNS 이름은 피어링 너머에서 풀리지 않는다. Private DNS 영역이나 자체 DNS를 둔다.
- 피어링으로 오가는 트래픽은 들어오고 나가는 양만큼 요금이 붙는다.
- 피어링 뒤에 주소 공간을 늘렸다면 피어링을 동기화(sync)해야 상대 쪽 경로가 갱신된다.

피어링에는 설정이 네 가지 있다. 앞의 둘은 피어링 자체, 뒤의 둘은 게이트웨이 공유에 쓴다.

| 설정 | 기본값 | 쓰임 |
|---|---|---|
| 피어링된 VNet에 액세스 허용 | 켬 | 기본 통신. 끄면 링크는 남고 트래픽만 막힌다 |
| 전달된 트래픽 수신 허용 | 끔 | 상대 VNet의 NVA가 대신 넘겨준 트래픽을 받는다. 경로(UDR)는 따로 만든다 |
| 게이트웨이 또는 Route Server의 트래픽 전달 허용 | 끔 | 게이트웨이가 있는 허브 쪽 링크에서 켠다 |
| 원격 게이트웨이 또는 Route Server 사용 | 끔 | 게이트웨이가 없는 스포크 쪽 링크에서 켠다 |

설정 이름은 포털의 영어 이름을 옮긴 것이다.

피어링을 만들기 전에 두 VNet의 주소 공간이 겹치지 않는지부터 본다. 겹치면 만들 수조차 없고, 주소를 바꾸려면 VNet 안의 자원을 다시 배치해야 한다.

### 비전이성

A와 B, B와 C를 피어링했는데 A에서 C로는 가지 않는다. 피어링은 전이되지 않는다(non-transitive). A의 테이블에는 B 대역만 생기고, B와 C 사이의 경로는 A로 넘어오지 않는다.

모드를 바꿔 가며 A에서 C로 패킷을 보내 보자. 피어링만 있을 때와 허브의 NVA를 거칠 때 패킷이 어디서 멈추는지 본다.

<figure class="fig" data-figure="private-network-transit">
  <figcaption>A-B, B-C 피어링에서 A에서 C로 가는 길</figcaption>
</figure>

피어링만 있으면 A의 테이블에서 `10.3.0.0/16`이 사설 대역 없음 줄에 걸려 버려진다. 허브 B에 NVA(Network Virtual Appliance, 보통 방화벽 VM)를 두고 A와 C 서브넷에 NVA로 가는 UDR을 넣으면 NVA가 대신 넘겨 준다. 바뀐 것은 양쪽 테이블의 한 줄씩이고, 피어링은 그대로다.

이 길이 동작하려면 세 가지가 더 필요하다.

- NVA의 NIC에서 IP 전달(IP forwarding)을 켠다. 꺼져 있으면 Azure가 NVA 자기 주소가 아닌 패킷을 버린다. NVA OS 안의 포워딩도 따로 켠다.
- A와 C 쪽 링크에서 B가 넘겨준 트래픽 수신을 허용한다(전달된 트래픽 수신 허용).
- UDR은 패킷이 출발하는 A와 C 서브넷에 건다. NVA가 있는 서브넷은 따로 두고, 그 서브넷에는 이 UDR을 걸지 않는다. 같은 서브넷에 걸면 패킷이 서브넷을 못 빠져나가는 루프가 생길 수 있다.

스포크끼리 자주 오간다면 A와 C를 직접 피어링하는 편이 빠르다. 검사가 필요한 트래픽만 허브 NVA를 거치게 경로를 나눈다.

### 허브-스포크와 게이트웨이 전송

사무실과 VPN으로 이은 허브 VNet은 잘 닿는데, 허브에 피어링한 스포크 VNet은 사무실에서 닿지 않는다. 비전이성은 게이트웨이에도 똑같이 적용된다. 게이트웨이 전송을 켜기 전까지 허브 게이트웨이는 스포크 대역을 사무실에 알리지 않는다.

게이트웨이 전송(gateway transit)은 스포크가 허브의 게이트웨이를 자기 것처럼 쓰게 한다. 스포크마다 VPN 게이트웨이를 둘 필요가 없어진다. 설정은 피어링 양쪽 링크에 하나씩이다.

- 허브 쪽 링크: 게이트웨이 또는 Route Server의 트래픽 전달 허용
- 스포크 쪽 링크: 원격 게이트웨이 또는 Route Server 사용

두 장면에서 설정 두 개가 켜지는 순간, 사무실 장비의 경로에 스포크 대역이 생기는지 본다.

<figure class="fig" data-figure="private-network-hub">
  <figcaption>게이트웨이 전송 전후로 사무실이 아는 경로</figcaption>
</figure>

켜기 전에는 사무실이 `10.2.0.0/16`으로 가는 길을 몰라 패킷을 터널에 싣지 못한다. 켜면 허브 게이트웨이가 스포크 대역을 사무실에 광고하고, 스포크 테이블에는 사무실 대역이 다음 홉 게이트웨이로 들어온다. 두 설정은 서로 다른 VNet의 링크에 있어서 헷갈리기 쉽다. 설정 이름에 나오는 VNet이 어느 쪽인지 보고 켠다.

- 스포크가 원격 게이트웨이를 쓰면 스포크에는 자기 게이트웨이를 둘 수 없다.
- BGP 없이 정적 경로로 맺은 터널이면 사무실 장비에도 스포크 대역을 직접 넣는다. 정책 기반 VPN이면 2단계 셀렉터에 스포크 대역을 넣는다.
- 스포크가 많으면 게이트웨이가 광고하는 접두사가 늘어난다. 허브 VNet에 요약 접두사(`summarizedGatewayPrefixes`)를 두면 묶어서 광고한다.

게이트웨이 전송은 글로벌 피어링에서도 된다. 스포크를 붙일 때마다 사무실 장비의 경로 표에 그 대역이 보이는지부터 확인한다.

### 대규모 연결 관리

VNet이 서른 개를 넘자 피어링 목록 관리가 그 자체로 일이 됐다. 모든 VNet을 서로 이으면 피어링 수는 VNet 수의 제곱에 가깝게 는다.

```text
풀 메시      n(n-1)/2   →  VNet 30개면 435개
허브-스포크  n-1        →  VNet 30개면 29개
```

두 장면에서 VNet이 늘 때 두 선이 벌어지는 모양을 본다.

<figure class="fig" data-figure="private-network-scale">
  <figcaption>VNet 수에 따른 피어링 수 (계산값)</figcaption>
</figure>

허브-스포크는 피어링 수가 적은 대신 스포크끼리의 트래픽이 허브를 지난다. 이 관리를 덜어 주는 관리형 도구가 두 가지 있다.

- Azure Virtual Network Manager(AVNM): 네트워크 그룹 단위로 메시나 허브-스포크 연결을 선언한다. 메시와 스포크 직접 연결은 피어링이 아니라 연결 그룹(connected group)으로 만들어지고, 유효 경로에 다음 홉 `ConnectedGroup`으로 보인다. 허브-스포크 구성에서는 허브를 게이트웨이로 쓰는 옵션도 같이 켠다.
- Virtual WAN: Microsoft가 관리하는 허브에 VNet, VPN, ExpressRoute를 붙인다. Standard 유형은 허브 라우터가 VNet 사이 전이 연결을 맡는다. Basic 유형은 사이트 간 VPN만 된다.

VNet 수가 적고 거의 바뀌지 않으면 직접 만든 허브-스포크 피어링으로 충분하다. 팀마다 VNet이 계속 늘어나면 AVNM으로 연결을 선언해 두고, 사무실과 지사가 여럿이면 Virtual WAN을 검토한다.

## 사무실 연결

### IPsec 사이트 간 VPN

사무실에서 클라우드 사설망으로 가는 길에는 인터넷밖에 없다. IPsec 사이트 간(site-to-site) VPN은 인터넷 위에 암호화 터널을 만들어 두 사설망을 잇는다. 사용자 PC마다 VPN 클라이언트를 띄우는 방식(point-to-site)과 달리, 사무실의 방화벽 장비와 Azure VPN 게이트웨이가 망 전체를 대신 잇는다.

IPsec은 IP 패킷에 암호화와 인증을 더하는 프로토콜 묶음이다. 터널 모드에서는 원래 패킷 전체를 ESP로 암호화하고, 그 앞에 두 장비의 공인 IP로 된 헤더를 새로 붙인다.

세 장면에서 구간마다 패킷 모양이 어떻게 바뀌는지 본다. 인터넷 구간에서 밖으로 보이는 부분이 어디까지인지 본다.

<figure class="fig" data-figure="private-network-ipsec">
  <figcaption>사무실에서 VNet까지 IPsec 터널 모드 패킷</figcaption>
</figure>

인터넷의 라우터는 바깥 헤더의 공인 IP 두 개만 보고 패킷을 나른다. 사설 IP와 내용은 암호화된 안쪽에 있어 중간에서 읽을 수 없다. VM 쪽에서는 사무실 PC가 같은 사설망에 있는 것처럼 보인다.

Azure 쪽에는 세 가지를 만든다.

- VPN 게이트웨이: VNet의 `GatewaySubnet`에 라우트 기반(route-based)으로 만든다.
- 로컬 네트워크 게이트웨이: 사무실 장비의 공인 IP와 사무실 대역을 적어 두는 리소스
- 연결(connection): 둘을 묶고 사전 공유 키(PSK)를 넣는다.

게이트웨이 SKU는 2026년 11월 기준으로 이렇게 정리된다.

- 새로 만들 때는 이름이 `AZ`로 끝나는 SKU(`VpnGw1AZ`~`VpnGw5AZ`)를 쓴다. 가용 영역을 지원하지 않는 `VpnGw1`~`VpnGw5`는 2025년 11월 1일부터 새로 만들 수 없다.
- 기존 `VpnGw1`~`VpnGw5`는 2025년 9월부터 2026년 9월까지가 AZ SKU로 옮기는 기간이었고, 그 뒤로 폐기 예정이다. 옮기지 않은 게이트웨이는 설정을 바꾸려 하면 오류가 난다.
- Basic SKU는 폐기되지 않는다. 다만 BGP, active-active, 사용자 지정 IPsec/IKE 정책을 지원하지 않고 PowerShell이나 CLI로만 만든다. 개발과 검증용이다.
- 새 게이트웨이의 공인 IP는 Standard SKU여야 한다.
- 예전 SKU인 Standard, HighPerformance는 2025년 9월 30일 폐기로 공지됐다.

기존 게이트웨이를 점검할 때는 SKU 이름이 `AZ`로 끝나는지부터 본다.

```bash
az network vnet-gateway show -g <리소스 그룹> -n <게이트웨이 이름> --query sku.name
```

### IKE 협상

터널 설정을 마쳤는데 상태가 계속 연결 안 됨이고, 장비 로그에는 `NO_PROPOSAL_CHOSEN`이 찍힌다. IPsec 터널은 데이터를 보내기 전에 IKE(Internet Key Exchange)로 양쪽이 쓸 알고리즘과 키를 맞춘다. 이 로그는 양쪽 제안이 하나도 겹치지 않았다는 뜻이다.

IKEv2는 왕복 두 번으로 터널을 연다.

1. IKE_SA_INIT: 암호화, 무결성, DH(Diffie-Hellman) 그룹 제안을 주고받고 DH로 공유 키를 만든다. 이후 메시지는 이 키로 보호된다. 흔히 1단계라고 부른다.
2. IKE_AUTH: 사전 공유 키로 서로를 확인하고, 실제 데이터를 암호화할 IPsec SA를 만든다. IPsec SA 쪽 설정을 흔히 2단계라고 부른다.

두 장면에서 메시지 화살표가 몇 번째에서 멈추는지 본다.

<figure class="fig" data-figure="private-network-ike">
  <figcaption>IKEv2 메시지 네 개와 제안 불일치</figcaption>
</figure>

제안이 맞으면 메시지 네 개 뒤에 ESP 데이터가 흐르고, 하나도 맞지 않으면 첫 응답에서 끝난다. 그래서 양쪽 장비의 1단계와 2단계 제안을 **같은 조합으로** 맞춘다. SA 수명은 Azure 문서 기준으로 양쪽이 같지 않아도 된다.

Azure 기본 정책은 호환성 위주라 1단계 DH가 Group 2(1024비트)다. IKEv2 알고리즘 권고인 RFC 8247은 Group 2를 쓰지 말라고(SHOULD NOT) 하고 Group 14(2048비트)를 필수(MUST)로 둔다. Azure 연결에 사용자 지정 IPsec/IKE 정책을 넣어 양쪽을 같은 조합으로 고정한다.

```text
Azure 연결의 사용자 지정 정책
  IKE (1단계)    AES256, SHA256, DHGroup14
  IPsec (2단계)  AES256, SHA256, PFS2048
  IPsec SA 수명  27,000초   (IKE SA 수명은 28,800초 고정)
```

FortiGate에는 같은 조합을 phase1, phase2 인터페이스에 넣는다.

```text
config vpn ipsec phase1-interface
    edit "to_azure"
        set interface "wan1"
        set ike-version 2
        set proposal aes256-sha256
        set dhgrp 14
        set remote-gw <Azure 게이트웨이 공인 IP>
        set psksecret <사전 공유 키>
    next
end
config vpn ipsec phase2-interface
    edit "to_azure"
        set phase1name "to_azure"
        set proposal aes256-sha256
        set pfs enable
        set dhgrp 14
        set keylifeseconds 27000
        set auto-negotiate enable
    next
end
```

DH 그룹 번호는 강도 순서가 아니라 등록 번호다. Group 24는 14보다 번호가 크지만 RFC 8247에서 쓰지 말라고 분류되고, 256비트 타원 곡선인 Group 19는 권장(SHOULD)이다.

터널이 안 열리면 장비 로그에서 협상이 몇 번째 메시지에서 멈췄는지부터 본다. 첫 응답에서 멈추면 제안 불일치, IKE_AUTH에서 멈추면 사전 공유 키나 식별자 불일치다.

### 방화벽 정책과 라우트

터널은 Up인데 사무실 PC에서 VM으로 ping이 가지 않는다. 터널이 열려도 방화벽 장비가 패킷을 터널로 보내려면 경로와 정책이 둘 다 있어야 한다. FortiGate는 경로를 먼저 찾고, 나갈 인터페이스가 정해지면 그 방향의 정책을 본다.

- 정적 경로: Azure 대역을 터널 인터페이스(`to_azure`)로 보낸다.
- 정책: `lan → to_azure` 허용. 응답은 세션으로 통과하므로 반대 방향 `to_azure → lan` 정책은 Azure 쪽에서 먼저 연결을 여는 트래픽이 있을 때만 만든다.

세 장면에서 터널이 끊겼을 때 패킷이 어느 경로를 타는지 본다. 블랙홀 경로가 없을 때와 있을 때 패킷이 나가는 곳을 견준다.

<figure class="fig" data-figure="private-network-policy">
  <figcaption>FortiGate의 경로 조회와 정책, 터널이 끊겼을 때</figcaption>
</figure>

터널이 끊기면 터널 인터페이스로 가는 경로가 테이블에서 빠진다. 그러면 사설 대역 트래픽이 기본 경로를 따라 wan1로 암호화 없이 나간다. 대개 ISP에서 버려지지만 내부 주소와 내용은 이미 밖으로 나간 뒤다. UDP나 ICMP처럼 연결 없는 세션은 잘못된 길로 기억돼, 터널이 돌아온 뒤에도 세션이 만료될 때까지 막힐 수 있다.

같은 대역에 거리(distance) 254인 블랙홀 경로를 두면, 평소에는 거리 10인 터널 경로에 밀려 쓰이지 않다가 터널이 끊긴 동안만 패킷을 버린다. FortiGate의 IPsec 마법사는 이 경로를 자동으로 만들지만, CLI로 터널을 만들었다면 직접 넣는다.

```text
config router static
    edit 0
        set dst 10.1.0.0 255.255.0.0
        set device "to_azure"
    next
    edit 0
        set dst 10.1.0.0 255.255.0.0
        set blackhole enable
        set distance 254
    next
end
```

정책의 출발지와 목적지는 `all`로 두지 않고 사무실 대역과 Azure 대역 주소 객체로 좁힌다. 터널 경로를 추가할 때마다 같은 대역의 블랙홀 경로가 있는지 같이 본다.

### 터널 이중화

Azure가 게이트웨이를 점검하는 날이면 사무실과의 연결이 잠깐씩 끊긴다. Azure VPN 게이트웨이는 인스턴스 두 개로 돌고, 따로 정하지 않으면 active-standby다. 터널은 활성 인스턴스 하나와만 맺혀 있어서, 대기 인스턴스가 넘겨받는 동안 연결이 끊긴다.

active-active로 만들면 인스턴스마다 공인 IP가 하나씩 생기고, 사무실 장비는 두 인스턴스와 터널을 하나씩 맺는다. Azure는 두 터널에 트래픽을 나눠 보내고, 한 인스턴스가 빠지면 남은 터널로 넘긴다.

모드를 바꿔 가며 인스턴스 점검을 일으켜 보자. 잃은 패킷 수가 어떻게 달라지는지 본다.

<figure class="fig" data-figure="private-network-redundancy">
  <figcaption>게이트웨이 인스턴스 점검 중 터널 1개와 2개</figcaption>
</figure>

터널이 하나면 대기 인스턴스와 터널을 다시 맺을 때까지 패킷이 버려진다. 둘이면 점검 순간 그 터널 위에 있던 패킷만 잃고 나머지는 남은 터널로 간다. 바뀐 것은 터널 수 하나다.

- active-active에는 Standard SKU 정적 공인 IP가 두 개 필요하다. 게이트웨이 요금은 active-standby와 같고 공인 IP 요금만 는다. Basic SKU는 active-active를 지원하지 않는다.
- 사무실 장비는 두 터널을 모두 맺어야 한다. 한쪽만 맺으면 그 인스턴스를 점검할 때 끊긴다.
- 사무실 장비에서는 두 터널 인터페이스로 같은 대역의 경로를 하나씩 두고, 끊긴 터널의 경로가 빠지게 한다. BGP를 쓰면 이 일을 자동으로 한다.
- 사무실 장비도 두 대면 로컬 네트워크 게이트웨이와 연결을 두 개씩 만들어 터널 네 개를 맺는다.

운영용 VPN은 처음부터 active-active로 만들고, 사무실 장비에서 두 터널이 모두 Up인지 모니터링한다.

## 공통 함정

### CIDR 겹침

사무실과 VPN을 붙였는데 VM에서 사무실 서버 `10.0.1.10`으로 가는 패킷이 터널에 실리지 않는다. VNet을 사무실과 같은 `10.0.0.0/16`으로 만든 경우다.

모드를 바꿔 가며 사무실 서버로 패킷을 보내 보자. 두 대역이 겹칠 때 패킷이 VNet 밖으로 나가는지 본다.

<figure class="fig" data-figure="private-network-overlap">
  <figcaption>VNet과 사무실 대역이 겹칠 때 VM이 보낸 패킷</figcaption>
</figure>

겹치면 VM의 테이블에서 `10.0.0.0/16`이 VNet 자기 대역 줄에 걸린다. 앞에서 본 대로 VNet 대역 시스템 경로가 우선이라 게이트웨이 줄은 쓰이지 않고, 패킷은 VNet 안에서 없는 주소를 찾다 사라진다. VNet을 `10.1.0.0/16`으로 나누면 같은 패킷이 게이트웨이 줄을 따라 터널로 간다.

겹침은 연결 방식마다 다르게 드러난다.

- VNet 피어링: 주소 공간이 겹치면 피어링을 만들 수 없다.
- AVNM 메시: 연결은 되지만 겹친 대역 사이 트래픽은 버려진다. `ConnectedGroupAddressOverlap`을 `Disallowed`로 두면 겹치는 VNet을 아예 넣지 않는다.
- VPN: 겹친 대역은 VNet 쪽 경로가 이겨 터널로 가지 않는다. 이미 겹친 채로 이어야 하면 VPN 게이트웨이의 NAT 규칙(VpnGw2 이상)으로 한쪽 대역을 다른 대역으로 바꿔 보이게 한다.

연결을 다 만든 뒤에 주소를 바꾸기는 어렵다. VNet을 만들기 전에 사무실, 다른 VNet, 협력사 망, 쿠버네티스 파드 대역까지 한 표로 모아 겹치지 않는 대역을 고른다.

### 비대칭 라우팅

사무실에서 스포크 VM으로 SSH가 붙다 말다 한다. 허브 방화벽 로그에는 세션 없는 패킷을 버렸다는 기록만 쌓인다. 갈 때와 올 때 패킷이 다른 길을 탄 경우다(비대칭 라우팅).

두 장면에서 요청(파랑)과 응답(주황)이 지나는 길을 견줘 보자. 응답이 방화벽에 닿는 순간 무슨 일이 일어나는지 본다.

<figure class="fig" data-figure="private-network-asym">
  <figcaption>요청과 응답이 지나는 길과 허브 방화벽</figcaption>
</figure>

스포크 서브넷에는 `0.0.0.0/0 → 방화벽` UDR이 있어 응답은 방화벽으로 간다. 그런데 요청은 게이트웨이에서 피어링 경로로 VM에 바로 갔다. 상태 기반 방화벽은 연결을 시작하는 패킷을 보지 못한 응답을 버린다.

GatewaySubnet에도 스포크 대역을 방화벽으로 보내는 UDR을 걸면 요청도 방화벽을 지나 왕복이 맞는다. 다만 GatewaySubnet에는 `0.0.0.0/0` UDR을 걸지 않고 게이트웨이 경로 전파도 끄지 않는다. 둘 다 게이트웨이를 망가뜨린다.

active-active 터널도 같은 모양이 된다. Azure는 흐름 하나를 같은 터널로 보내려 하지만, 사무실 장비가 응답을 다른 터널로 보낼 수 있다. 사무실 장비가 상태 기반 방화벽이면 두 터널에서 오는 같은 흐름을 한 세션으로 다루는지 확인한다.

경로를 바꿀 때는 출발 서브넷 하나만 보지 말고, 요청과 응답이 지나는 서브넷의 유효 경로를 양쪽 다 뽑아 같은 방화벽을 지나는지 본다.

### NSG와 방화벽 정책 순서

허용 규칙을 분명히 넣었는데 연결이 막힌다. 그 앞의 다른 규칙이 먼저 걸린 경우가 많다. 패킷은 가는 길에 필터를 여러 번 지나고, 필터마다 규칙을 읽는 순서가 다르다.

- FortiGate 정책: 목록 위에서부터 보고 처음 일치한 정책을 쓴다.
- NSG(Network Security Group): 우선순위 숫자(100~4096)가 작은 규칙부터 보고 처음 일치한 규칙에서 멈춘다. 기본 규칙(65000번대)은 맨 뒤다.
- NSG가 서브넷과 NIC에 둘 다 있으면 들어올 때 서브넷 NSG, NIC NSG 순으로 보고 나갈 때는 반대다. 둘 다 허용해야 통과한다.

두 장면에서 패킷이 필터마다 멈춰 규칙을 위에서부터 읽는 모습을 본다. 같은 허용 규칙이 있는데도 결과가 갈리는 이유를 본다.

<figure class="fig" data-figure="private-network-filters">
  <figcaption>사무실에서 VM까지 지나는 필터와 규칙을 읽는 순서</figcaption>
</figure>

두 번째 장면의 서브넷 NSG에도 사무실의 443을 허용하는 200번 규칙이 있다. 하지만 100번 거부가 먼저 일치해서 200번은 읽히지도 않는다. NSG는 상태 기반이라 허용된 연결의 응답에는 규칙이 따로 필요 없다.

첫 장면의 기본 규칙 `AllowVnetInBound`가 쓰는 `VirtualNetwork` 태그에는 VNet 대역뿐 아니라 피어링된 VNet과 게이트웨이로 이은 사무실 대역도 들어간다. 사무실 접근을 좁히려면 이 기본 규칙에 기대지 말고 그보다 작은 번호로 허용과 거부를 직접 둔다.

NSG를 서브넷과 NIC 양쪽에 걸면 규칙이 겹쳐 원인을 찾기 어려워서, Azure 문서도 한쪽에만 걸기를 권한다. 막힐 때는 Network Watcher의 IP 흐름 확인(IP flow verify)으로 어느 규칙이 막았는지부터 본다.

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| 라우팅 테이블 | 목적지 대역마다 다음 홉을 정한다 | 가장 긴 접두사가 이긴다. VNet 대역 시스템 경로는 BGP보다 우선 |
| VNet 피어링 | 두 VNet을 백본으로 직접 잇는다 | 전이되지 않는다. 주소 공간이 겹치면 못 만든다 |
| 허브-스포크 | 허브의 NVA와 게이트웨이를 스포크가 같이 쓴다 | UDR, 전달 트래픽 수신, 게이트웨이 전송 설정을 맞는 쪽 링크에 |
| AVNM, Virtual WAN | 연결을 선언하거나 관리형 허브에 맡긴다 | VNet과 지사가 계속 늘 때 |
| IPsec 사이트 간 VPN | 인터넷 위에 암호화 터널을 만든다 | 양쪽 제안을 같은 조합으로. DH Group 14 이상. 새 게이트웨이는 AZ SKU |
| 방화벽 경로와 정책 | 터널로 보낼 경로와 허용 정책 | 거리 254 블랙홀 경로로 누출을 막는다 |
| 터널 이중화 | 게이트웨이 인스턴스마다 터널 | active-active, 사무실 장비에서 두 터널 모두 맺기 |
| 공통 함정 | CIDR 겹침, 비대칭 라우팅, 규칙 순서 | 대역 표 먼저, 유효 경로는 양쪽, 처음 일치한 규칙 |

## 참고

- [Azure — Virtual network traffic routing](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview)
- [Azure — Virtual network FAQ](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-faq)
- [Azure — Virtual network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-peering-overview)
- [Azure — Create, change, or delete a virtual network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-manage-peering)
- [Azure — Configure VPN gateway transit for virtual network peering](https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-peering-gateway-transit)
- [Azure Architecture Center — Hub-spoke network topology in Azure](https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke)
- [Azure Virtual Network Manager — Connectivity configurations](https://learn.microsoft.com/en-us/azure/virtual-network-manager/concept-connectivity-configuration)
- [Azure Virtual WAN — Overview](https://learn.microsoft.com/en-us/azure/virtual-wan/virtual-wan-about)
- [Azure VPN Gateway — VPN Gateway settings (GatewaySubnet)](https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-about-vpn-gateway-settings)
- [Azure VPN Gateway — About gateway SKUs](https://learn.microsoft.com/en-us/azure/vpn-gateway/about-gateway-skus)
- [Azure VPN Gateway — Gateway SKU consolidation and migration](https://learn.microsoft.com/en-us/azure/vpn-gateway/gateway-sku-consolidation)
- [Azure VPN Gateway — About VPN devices and IPsec/IKE parameters](https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-about-vpn-devices)
- [Azure VPN Gateway — Configure custom IPsec/IKE connection policies](https://learn.microsoft.com/en-us/azure/vpn-gateway/ipsec-ike-policy-howto)
- [Azure VPN Gateway — About active-active VPN gateways](https://learn.microsoft.com/en-us/azure/vpn-gateway/about-active-active-gateways)
- [Azure VPN Gateway — About NAT on VPN Gateway](https://learn.microsoft.com/en-us/azure/vpn-gateway/nat-overview)
- [Azure — How network security groups filter network traffic](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works)
- [Azure — Network security groups overview](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview)
- [Azure — Service tags overview](https://learn.microsoft.com/en-us/azure/virtual-network/service-tags-overview)
- [RFC 8247 — Algorithm Implementation Requirements and Usage Guidance for IKEv2](https://www.rfc-editor.org/rfc/rfc8247.html)
- [RFC 7296 — Internet Key Exchange Protocol Version 2 (IKEv2)](https://www.rfc-editor.org/rfc/rfc7296.html)
- [Fortinet — Use of blackhole route in site-to-site IPsec VPN](https://community.fortinet.com/t5/FortiGate/Technical-Tip-Use-of-Black-hole-route-in-site-to-site-IPsec-VPN/ta-p/192526)
- 원글: [Azure Virtual Network Peering](https://kimjanghyun1010.tistory.com/85), [Fortigate](https://kimjanghyun1010.tistory.com/67)
