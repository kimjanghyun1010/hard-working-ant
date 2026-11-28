---
title: 사설망 연결과 라우팅
description: 떨어진 두 사설망의 패킷이 서로를 찾아가는 길을 사설 주소와 라우팅 테이블, VNet 피어링, IPsec 터널, 정적 경로와 BGP, 상태 기반 방화벽과 비대칭 라우팅 순서로 따라간다.
date: 2026-11-14 12:00:00 +0900
series: 인프라 운영
tags: [network, azure, vnet, vpn, ipsec, bgp, routing]
scripts: [figures/private-network.js]
---

## 사설 주소와 라우팅 테이블

사무실 PC `10.0.1.10`과 클라우드 VM `10.1.1.4`는 둘 다 사설 주소이고, 그 사이에는 인터넷이 있다. 인터넷은 이 패킷을 나르지 않는다.

RFC 1918은 누구나 허락 없이 쓰는 주소 블록 세 개를 정했다. `/8`은 앞 8비트가 고정이고 나머지 비트가 그 대역 안의 주소라는 뜻이다(CIDR 표기).

- `10.0.0.0/8`: 약 1,677만 개
- `172.16.0.0/12`: 약 104만 개
- `192.168.0.0/16`: 65,536개

같은 RFC는 이 대역의 경로 정보를 조직 밖으로 퍼뜨리지 않는다고 정한다. 그래서 인터넷의 라우터는 사설 주소로 가는 길을 모르고, 서로 모르는 두 회사가 같은 `10.0.0.0/16`을 쓰는 일도 흔하다. 두 사설망을 잇는 일은 둘로 나뉜다. **사설 패킷을 실어 나를 통로**를 만들고, 양쪽 라우팅 테이블에 상대 대역으로 가는 줄을 넣는다.

라우팅 테이블의 줄 하나는 목적지 대역(prefix)과 다음 홉(next hop)이다. 다음 홉은 패킷을 다음에 넘길 곳이다. Azure는 VNet(Virtual Network, 클라우드 안의 사설망. AWS의 VPC에 해당)의 서브넷마다 이 테이블을 만들고 시스템 경로를 미리 넣는다.

- VNet 자기 대역: 다음 홉 가상 네트워크(CLI 이름 `VNetLocal`)
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`: 다음 홉 없음(None). 버린다.
- `0.0.0.0/0`: 다음 홉 인터넷

아래 그림처럼 같은 VNet 주소는 바로 전달되고, 길을 만들지 않은 사설 대역은 다음 홉 없음 줄에 걸려 버려진다.

<figure class="fig" data-figure="private-network-route">
  <figcaption>목적지마다 라우팅 테이블에서 고르는 줄과 다음 홉</figcaption>
</figure>

목적지 하나에 여러 줄이 걸리면 접두사가 가장 긴 줄을 고른다(longest prefix match). 테이블에 적힌 순서는 상관없다.

```text
목적지 10.1.2.5
  0.0.0.0/0     인터넷            0비트 일치
  10.0.0.0/8    없음              8비트 일치
  10.1.0.0/16   가상 네트워크     16비트 일치
  10.1.2.0/24   방화벽 10.1.9.4   24비트 일치  ← 선택
```

길이가 같으면 사용자가 직접 넣은 경로(UDR, user-defined route), 라우터끼리 주고받아 배운 BGP 경로, 시스템 경로 순으로 고른다. 예외가 하나 있다. VNet 자기 대역과 피어링 대역의 시스템 경로는 BGP 경로가 더 길어도 이긴다.

VM에 실제로 적용된 줄은 VM 네트워크 카드(NIC)의 유효 경로(effective routes)로 확인한다. 다른 줄에 밀려난 줄은 `Invalid`로 나온다.

```bash
az network nic show-effective-route-table -g <리소스 그룹> -n <NIC 이름> -o table
```

## VNet 피어링

VNet 피어링(peering)은 두 VNet을 연결 면에서 하나처럼 만든다. 피어링을 맺으면 양쪽 모든 서브넷에 상대 VNet의 주소 범위마다 다음 홉 `VNet 피어링` 줄이 생기고, 패킷은 게이트웨이 없이 Microsoft 백본(데이터센터 사이에 깐 자체 회선)으로 바로 간다. 같은 리전이면 지연은 같은 VNet 안과 같고, 대역폭은 VM 크기의 한도만 받으며, 따로 암호화하지 않는다.

피어링은 링크 두 개다. A에서 B로, B에서 A로 하나씩 만들고, 하나만 있으면 Initiated, 둘 다 있으면 Connected다. 아래 그림처럼 두 링크가 Connected가 되는 순간 양쪽 테이블에 줄이 생긴다.

<figure class="fig" data-figure="private-network-peering">
  <figcaption>피어링 링크 두 개와 양쪽 라우팅 테이블</figcaption>
</figure>

피어링은 테이블에 줄을 더하는 일이라 한계도 테이블에서 나온다.

- 주소 공간이 겹치면 만들 수 없다. 같은 대역의 다음 홉이 둘이 된다.
- 피어링 뒤에 주소 공간을 바꾸면 피어링을 동기화(sync)해야 상대 테이블이 갱신된다.
- 전이되지 않는다(non-transitive). A-B, B-C를 맺어도 A의 테이블에는 B 대역만 생긴다.

A에서 C로 가려면 허브 B에 NVA(Network Virtual Appliance, 보통 방화벽 VM)를 두고, A와 C 서브넷에 상대 대역의 다음 홉을 NVA로 하는 UDR을 넣는다. 아래 데모는 모드를 바꿔 피어링만 있을 때와 허브 NVA를 거칠 때를 비교한다.

<figure class="fig" data-figure="private-network-transit">
  <figcaption>A-B, B-C 피어링에서 A에서 C로 가는 길</figcaption>
</figure>

피어링만 있으면 A에서 `10.3.0.0/16`으로 가는 패킷이 `10.0.0.0/8` 다음 홉 없음 줄에 걸려 버려진다. NVA 모드에서는 A 서브넷에 넣은 `10.3.0.0/16 → NVA` UDR이 `/8`보다 길어서 이기고, 패킷은 B의 NVA에 닿은 뒤 **B의 피어링 줄을 따라** C로 다시 나간다. 피어링이 전이되지 않는 것은 그대로이고, NVA가 패킷을 한 번 받아 다시 보내 그 빈자리를 메운다. 이 길에는 설정이 세 가지 더 필요하다.

- NVA NIC에서 IP 전달(IP forwarding)을 켠다. 꺼져 있으면 Azure가 NVA 자기 주소가 아닌 패킷을 버린다.
- A와 C 쪽 피어링 링크에서 `전달된 트래픽 수신 허용`을 켠다.
- NVA는 UDR을 거는 서브넷과 다른 서브넷에 둔다. 같은 서브넷이면 패킷이 서브넷을 빠져나가지 못하는 루프가 생긴다.

## IPsec 터널

사무실과 VNet 사이에는 백본이 없고 인터넷만 있다. IPsec 사이트 간(site-to-site) VPN은 사설 패킷을 통째로 암호화해 공인 IP 패킷 안에 넣는다. 양 끝은 사무실 방화벽 장비(여기서는 FortiGate)와 Azure VPN 게이트웨이다.

ESP(Encapsulating Security Payload, RFC 4303)는 IPsec이 패킷을 암호화해 감싸는 형식이다. 터널 모드에서 안쪽 IP 헤더는 원래의 출발지와 목적지를, 바깥 IP 헤더는 두 장비의 공인 IP를 담는다. 아래 그림처럼 인터넷의 라우터는 바깥 헤더만 보고 나른다.

<figure class="fig" data-figure="private-network-ipsec">
  <figcaption>사무실에서 VNet까지 IPsec 터널 모드 패킷</figcaption>
</figure>

감싼 만큼 패킷이 커진다. AES-CBC와 SHA-256 조합에서 ESP가 붙이는 바이트는 이렇다. SPI는 패킷이 어느 암호화 연결에 속하는지 가리키는 번호, IV는 암호화 시작값, ICV는 변조 검사값이다.

```text
바깥 IP 헤더                     20
ESP 헤더 (SPI 4, 순번 4)          8
IV (AES-CBC)                     16
패딩 0~15 + 길이 1 + 다음 헤더 1   2~17
ICV (HMAC-SHA-256-128)           16
합계                             62~77바이트
```

NAT(network address translation)는 사설 주소를 공인 주소로 바꿔 내보내는 기능으로, 포트 번호로 연결을 구분한다. ESP에는 포트가 없어서 사무실이 NAT 뒤에 있으면 UDP 4500으로 한 번 더 감싸고(NAT-T) 8바이트가 더 붙는다. 이더넷이 한 번에 싣는 패킷 최대 크기(MTU) 1,500바이트에서 이만큼 빠지면 안쪽 TCP가 한 패킷에 실을 수 있는 데이터(MSS)는 약 1,375바이트다.

이보다 큰 패킷은 조각나거나, 조각내지 말라는 IP 헤더 표시인 DF(Don't Fragment) 비트가 켜져 있으면 버려진다. 버린 라우터는 크기를 줄이라는 ICMP(라우터가 오류를 알리는 제어 메시지)를 돌려보내는데, 이 메시지가 중간 방화벽에서 막히면 SSH는 붙는데 큰 파일 전송이나 TLS 핸드셰이크만 멈춘다. Azure VPN 게이트웨이는 TCP MSS를 양방향으로 1,360바이트(IPv4, 인터넷 경유)로 줄여 이를 막고, FortiGate는 터널 정책의 `tcp-mss-sender`, `tcp-mss-receiver`로 같은 일을 한다.

터널은 IKE(Internet Key Exchange)로 양쪽이 SA(security association)를 맺은 뒤에 열린다. SA는 양쪽이 합의한 알고리즘, 키, 수명의 묶음이다. IKEv2(RFC 7296)는 왕복 두 번이다.

1. IKE_SA_INIT: 암호화, 무결성, DH 그룹 제안을 주고받고 DH로 공유 키를 만든다. DH(Diffie-Hellman)는 엿보이는 길 위에서도 둘만 아는 키를 계산해 내는 방법이고, 그룹 번호가 클수록 키가 길다. 이 키로 이후 IKE 메시지를 보호하는 IKE SA가 생긴다.
2. IKE_AUTH: 사전 공유 키(PSK)로 앞의 메시지와 서로의 식별자를 인증하고, 데이터를 암호화할 첫 Child SA(IPsec SA)를 함께 만든다.

장비 설정에서 부르는 1단계는 IKE_SA_INIT와 IKE_AUTH의 인증까지이고, 2단계는 Child SA다. 그래서 FortiGate는 사전 공유 키를 `phase1-interface`에 둔다.

아래 그림처럼 양쪽 제안이 하나도 겹치지 않으면 첫 응답이 `NO_PROPOSAL_CHOSEN`으로 끝난다. IKE_AUTH에서 멈추면 사전 공유 키나 식별자가 다르다.

<figure class="fig" data-figure="private-network-ike">
  <figcaption>IKEv2 메시지 네 개와 제안 불일치</figcaption>
</figure>

Azure 기본 정책은 호환성 위주라 1단계 DH가 Group 2(1,024비트)이고, SA 수명은 IKE 28,800초, IPsec 27,000초다. IKEv2 알고리즘 권고인 RFC 8247은 Group 2를 쓰지 말라고(SHOULD NOT) 하고 Group 14(2,048비트)를 필수(MUST)로 둔다. Azure 연결에 사용자 지정 정책(AES256, SHA256, DHGroup14, PFS2048)을 넣고 FortiGate에 같은 조합을 넣는다. PFS(perfect forward secrecy)는 Child SA 키를 갱신할 때마다 DH를 새로 해서, 키 하나가 새어도 다른 기간의 데이터는 풀리지 않게 한다.

```text
config vpn ipsec phase1-interface
    edit "to_azure"
        set interface "wan1"
        set ike-version 2
        set proposal aes256-sha256
        set dhgrp 14
        set remote-gw 198.51.100.20
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
    next
end
```

터널이 Up이어도 양쪽 라우팅 테이블에 상대 대역 줄이 없으면 패킷은 터널로 가지 않는다.

## 정적 경로와 BGP

### 정적 경로

가장 단순한 방법은 양쪽에 손으로 적는 것이다. Azure에서는 로컬 네트워크 게이트웨이(사무실 장비의 공인 IP와 대역을 적어 두는 리소스)에 사무실 대역을 적으면 VNet 모든 서브넷에 다음 홉 `가상 네트워크 게이트웨이` 줄이 생긴다. FortiGate에는 Azure 대역을 터널 인터페이스로 보내는 정적 경로를 넣는다.

터널이 끊기면 FortiGate는 내려간 인터페이스의 경로를 테이블에서 뺀다. 그러면 `10.1.0.0/16`으로 가는 패킷이 `0.0.0.0/0`을 따라 wan1로 암호화 없이 나간다. 같은 대역에 거리(distance, 낮을수록 우선) 254인 블랙홀 경로를 두면 평소에는 거리 10인 터널 경로에 밀려 있다가 터널이 끊긴 동안만 패킷을 버린다.

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

정적 경로는 대역이 하나 늘 때마다 양쪽을 다 고쳐야 하고, 한쪽을 빠뜨리면 한 방향만 통한다.

### BGP

BGP(Border Gateway Protocol)는 이웃 라우터끼리 "이 대역은 나를 거쳐 갈 수 있다"를 알리는(광고) 프로토콜이다. 터널 안에서 Azure VPN 게이트웨이와 FortiGate가 BGP 세션을 맺으면 대역이 늘거나 줄 때 양쪽 경로가 따라 바뀐다. 양쪽은 AS 번호(ASN)라는 이름표를 단다.

- Azure VPN 게이트웨이의 기본 ASN은 65515다. 65515, 65517~65520과 8074, 8075, 12076은 Azure 예약이라 사무실 쪽에 쓸 수 없다.
- 사설 ASN은 64512~65514, 65521~65534에서 고른다. 여기서는 사무실을 65010으로 둔다.
- 양쪽 ASN은 달라야 한다. BGP는 받은 경로의 AS 경로(AS_PATH)에 자기 ASN이 있으면 루프로 보고 버린다(RFC 4271).
- Azure 쪽 BGP 주소는 VPN 게이트웨이 전용 서브넷인 GatewaySubnet에서 하나 받는다. 게이트웨이 인스턴스 두 개가 각자 공인 IP로 터널을 맺는 active-active 구성이면 둘이다. keepalive 60초, hold 180초로 고정이다.

FortiGate에는 Azure BGP 주소로 가는 /32 경로를 터널 쪽으로 두고 이웃으로 등록한다.

```text
config router bgp
    set as 65010
    config neighbor
        edit "10.1.255.30"
            set remote-as 65515
            set update-source "to_azure"
        next
    end
    config network
        edit 1
            set prefix 10.0.0.0 255.255.0.0
        next
    end
end
```

Azure가 사무실에 광고하는 것은 VNet 대역, 연결된 로컬 네트워크 게이트웨이 대역, 다른 BGP 세션에서 배운 경로다. 사무실에서는 4,000개까지 받고, 넘으면 세션이 끊긴다. active-active 게이트웨이와 터널 두 개를 맺어 두면 끊긴 터널로 받은 경로가 철회되어 남은 터널로 넘어간다.

### 게이트웨이 전송

허브-스포크(hub-spoke)는 가운데 허브 VNet에 공용 장비를 두고 나머지 스포크 VNet을 허브에만 피어링하는 구성이다. 허브에 VPN 게이트웨이를 두고 스포크를 피어링해도, 사무실에서 스포크로는 가지 않는다.

비전이성이 게이트웨이에도 적용되어 허브 게이트웨이가 스포크 대역을 광고하지 않는다. 게이트웨이 전송(gateway transit)은 피어링 양쪽 링크에 설정 하나씩이다.

- 허브 쪽 링크: 게이트웨이 또는 Route Server의 트래픽 전달 허용. Route Server는 NVA와 BGP로 경로를 주고받는 Azure 관리형 서비스다.
- 스포크 쪽 링크: 원격 게이트웨이 또는 Route Server 사용

아래 그림처럼 두 설정을 켜면 사무실 장비의 경로에 스포크 대역이 생긴다.

<figure class="fig" data-figure="private-network-hub">
  <figcaption>게이트웨이 전송 전후로 사무실이 아는 경로</figcaption>
</figure>

원격 게이트웨이를 쓰는 스포크는 자기 게이트웨이를 둘 수 없다.

### 대역 겹침

경로를 주고받는 방식은 대역이 겹치지 않는다는 전제 위에 있다. Azure는 VNet 대역과 똑같은 BGP 경로를 거부하고, 앞에서 본 예외대로 VNet 자기 대역 시스템 경로는 BGP 경로가 더 길어도 이긴다. 아래 데모는 모드를 바꿔 VNet이 사무실과 같은 `10.0.0.0/16`일 때와 `10.1.0.0/16`일 때를 비교한다.

<figure class="fig" data-figure="private-network-overlap">
  <figcaption>VNet과 사무실 대역이 겹칠 때 VM이 보낸 패킷</figcaption>
</figure>

겹치면 사무실 서버로 가는 패킷이 VNet 안에서 없는 주소를 찾다 사라진다. 대역을 나누면 같은 패킷이 게이트웨이 줄을 따라 터널로 간다.

이미 겹친 채로 이어야 하면 VPN 게이트웨이의 NAT 규칙(VpnGw2 등급 이상)으로 한쪽 대역을 다른 대역으로 바꿔 보이게 한다. 대역 표는 VNet을 만들기 전에 사무실, 다른 VNet, 협력사 망, 쿠버네티스 파드 대역까지 모아 정한다.

## 방화벽과 비대칭 라우팅

FortiGate나 Azure Firewall 같은 상태 기반(stateful) 방화벽은 연결의 첫 패킷에서 정책을 보고 세션 표에 연결을 적는다. 응답은 정책을 다시 보지 않고 세션 표와 맞춰 통과시킨다. FortiGate는 경로를 먼저 찾아 나갈 인터페이스를 정한 뒤 그 방향의 정책을 보므로, `lan → to_azure` 정책 하나면 응답까지 지나간다.

세션 표는 한 방화벽이 왕복을 다 볼 때만 맞는다. 갈 때와 올 때 다른 길을 타면(비대칭 라우팅) 응답만 본 방화벽은 세션을 찾지 못해 버린다. FortiGate의 `asymroute`를 켜면 지나가지만 연결 상태를 보지 않는 무상태 방화벽이 되고 보안 검사도 빠진다.

허브-스포크에서 스포크 트래픽을 허브 방화벽으로 모으려고 스포크 서브넷에 `0.0.0.0/0 → 방화벽` UDR을 걸면 이 일이 생긴다. 사무실에서 온 요청은 허브 게이트웨이에서 `VNet 피어링` 줄을 따라 VM으로 바로 가고, 응답만 UDR을 따라 방화벽으로 간다. 아래 그림처럼 방화벽은 처음 보는 응답을 버린다.

<figure class="fig" data-figure="private-network-asym">
  <figcaption>요청과 응답이 지나는 길과 허브 방화벽</figcaption>
</figure>

GatewaySubnet에 스포크 대역을 방화벽으로 보내는 UDR을 걸면 요청도 방화벽을 지나 왕복이 맞는다. UDR은 피어링 줄과 같은 `/16`으로 잡는다. 길이가 같으면 UDR이 이기지만, `10.0.0.0/8` 하나로 묶으면 더 긴 피어링 줄이 이겨 방화벽을 건너뛴다.

GatewaySubnet에는 `0.0.0.0/0` UDR을 걸지 않고 게이트웨이 경로 전파도 끄지 않는다. 둘 다 게이트웨이를 망가뜨린다.

active-active 터널도 같은 모양이 된다. Azure는 흐름 하나를 한 터널로 보내려 하지만 사무실 장비가 응답을 다른 터널로 보낼 수 있다. 경로를 바꿀 때는 요청과 응답이 지나는 서브넷의 유효 경로를 양쪽 다 뽑아 같은 방화벽을 지나는지 확인한다.

## 정리

- 사설 주소는 인터넷이 나르지 않고 조직마다 겹칠 수 있다. 연결은 통로를 만들고 양쪽 라우팅 테이블에 줄을 넣는 일이며, 줄은 가장 긴 접두사로 고른다.
- VNet 피어링은 양쪽 테이블에 상대 대역 줄을 넣어 게이트웨이 없이 백본으로 나른다. 대신 겹치는 대역은 못 잇고 전이되지 않는다.
- IPsec 터널은 사설 패킷을 암호화해 공인 IP 패킷에 넣는다. 62~77바이트가 붙어 MSS를 1,360바이트로 줄이고, IKEv2 제안은 양쪽을 같은 조합으로 맞춘다.
- 터널로 보낼 대역은 정적 경로나 BGP로 정한다. 정적 경로에는 블랙홀 경로를 함께 두고, BGP는 ASN을 달리하며, 스포크 대역은 게이트웨이 전송을 켜야 광고된다.
- 상태 기반 방화벽은 왕복을 모두 봐야 한다. 허브 방화벽을 둘 때는 스포크와 GatewaySubnet 양쪽에 UDR을 걸어 대칭을 맞춘다.

## 참고

- [RFC 1918 — Address Allocation for Private Internets](https://www.rfc-editor.org/rfc/rfc1918.html)
- [Azure — Virtual network traffic routing](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview)
- [Azure — Virtual network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-peering-overview)
- [Azure — Create, change, or delete a virtual network peering](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-manage-peering)
- [RFC 4303 — IP Encapsulating Security Payload (ESP)](https://www.rfc-editor.org/rfc/rfc4303.html)
- [RFC 3602 — AES-CBC Cipher Algorithm and Its Use with IPsec](https://www.rfc-editor.org/rfc/rfc3602.html)
- [RFC 4868 — HMAC-SHA-256, 384, and 512 with IPsec](https://www.rfc-editor.org/rfc/rfc4868.html)
- [RFC 3948 — UDP Encapsulation of IPsec ESP Packets](https://www.rfc-editor.org/rfc/rfc3948.html)
- [RFC 7296 — Internet Key Exchange Protocol Version 2 (IKEv2)](https://www.rfc-editor.org/rfc/rfc7296.html)
- [RFC 8247 — Algorithm Implementation Requirements and Usage Guidance for IKEv2](https://www.rfc-editor.org/rfc/rfc8247.html)
- [Azure VPN Gateway — About VPN devices and IPsec/IKE parameters (MSS clamping)](https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-about-vpn-devices)
- [Azure VPN Gateway — Configure custom IPsec/IKE connection policies](https://learn.microsoft.com/en-us/azure/vpn-gateway/ipsec-ike-policy-howto)
- [Azure VPN Gateway — About BGP with VPN Gateway](https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-bgp-overview)
- [Azure VPN Gateway — FAQ (BGP and routing)](https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-vpn-faq)
- [RFC 4271 — A Border Gateway Protocol 4 (BGP-4)](https://www.rfc-editor.org/rfc/rfc4271.html)
- [Azure — Configure VPN gateway transit for virtual network peering](https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-peering-gateway-transit)
- [Azure VPN Gateway — About NAT on VPN Gateway](https://learn.microsoft.com/en-us/azure/vpn-gateway/nat-overview)
- [Azure Architecture Center — Hub-spoke network topology in Azure](https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke)
- [Fortinet — Connecting a local FortiGate to an Azure VNet VPN](https://docs.fortinet.com/document/fortigate-public-cloud/7.0.0/azure-administration-guide/989216)
- [Fortinet — Use of blackhole route in site-to-site IPsec VPN](https://community.fortinet.com/t5/FortiGate/Technical-Tip-Use-of-Black-hole-route-in-site-to-site-IPsec-VPN/ta-p/192526)
- [Fortinet — Asymmetric routing](https://docs.fortinet.com/document/fortigate/6.0.0/Handbook/58863/asymmetric-routing)
- 원글: [Azure Virtual Network Peering](https://kimjanghyun1010.tistory.com/85), [Fortigate](https://kimjanghyun1010.tistory.com/67)
