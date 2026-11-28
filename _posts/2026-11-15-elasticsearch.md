---
title: Elasticsearch 클러스터 설계
description: 노드 역할, 샤드 크기, 프라이머리와 레플리카, 스레드 풀 큐, 샤드 재배치를 따라가며 Elasticsearch 클러스터가 데이터와 요청이 늘어도 멈추지 않고 버티는 구조를 정리한다.
date: 2026-11-15 12:00:00 +0900
series: 데이터베이스
tags: [elasticsearch, shard, replication, thread-pool, scale-out]
scripts: [figures/elasticsearch.js]
---

## 요약

- 노드 역할: 서너 대까지는 노드마다 모든 역할을 맡겨도 된다. 그보다 커지면 마스터 후보 3대를 따로 두어, 무거운 검색과 색인이 선출된 마스터의 응답을 늦추지 않게 한다.
- 샤드 크기: 샤드 하나를 10~50GB, 문서 2억 개 아래로 맞춘다. 프라이머리 수는 문서 위치를 정하는 나눗셈의 제수라 만든 뒤에는 못 바꾸고, 시계열 데이터는 롤오버로 새 인덱스를 만들며 조절한다.
- 복제: 프라이머리가 쓰기마다 순번(seq_no)을 매겨 in-sync 레플리카 전부에 보내고, 모두 받은 뒤 응답한다. 읽기는 복사본 중 덜 바쁜 쪽으로 간다. 같은 샤드의 복사본은 한 노드에 두지 않는다.
- 큐: write와 search 스레드 풀의 큐가 차면 429로 거절한다. 큐를 키우면 거절이 대기로 바뀔 뿐이라, 클라이언트가 백오프하고 모자란 처리량은 노드로 채운다.
- 스케일아웃: 노드를 더하면 샤드가 파일 복사, 놓친 작업 재생, 전환 순서로 옮겨 가고, 그동안 원래 복사본이 요청을 받는다. 샤드 하나가 너무 크면 노드를 늘려도 그 샤드는 빨라지지 않는다.

## 노드 역할 분리

Elasticsearch 클러스터는 노드 여러 대로 이뤄지고, 노드마다 `node.roles`로 역할을 준다. 역할을 적지 않은 노드는 master, 모든 data 역할, ingest를 한꺼번에 맡는다.

- 마스터 후보(master): 인덱스 목록, 매핑, 샤드 위치, 노드 목록을 담은 클러스터 상태(cluster state)를 관리한다. 후보 중 하나가 선출된 마스터가 된다.
- 데이터(data): 샤드를 저장하고 색인과 검색을 실제로 수행한다. `data_hot`, `data_warm`, `data_cold`처럼 티어로 나눌 수 있다.
- 인제스트(ingest): 색인 전에 문서를 가공하는 파이프라인을 돌린다.
- 조정 전용(coordinating only): `node.roles: [ ]`로 역할을 비운 노드다. 요청을 받아 샤드별로 나눠 보내고 결과를 모은다.

역할과 관계없이 요청을 받은 노드가 그 요청의 조정 노드가 된다. 검색이면 관련 샤드마다 복사본 하나에 요청을 뿌리고(scatter), 샤드마다 상위 결과를 받아 최종 순위로 합친다(gather). 아래 그림처럼 조정 노드는 데이터를 갖지 않아도 정렬과 합치기에 메모리와 CPU를 쓴다.

<figure class="fig" data-figure="elasticsearch-layout">
  <figcaption>조정 노드, 데이터 노드, 마스터 후보로 나눈 클러스터</figcaption>
</figure>

선출된 마스터는 클러스터 상태를 바꿀 때마다 모든 노드에 보내고, 마스터 후보 과반의 확인을 받아 확정한다. 노드들은 마스터가 살아 있는지 계속 확인한다.

```text
cluster.fault_detection.leader_check.interval=1s     노드가 마스터를 확인하는 간격
cluster.fault_detection.leader_check.timeout=10s     확인 하나의 응답 제한 시간
cluster.fault_detection.leader_check.retry_count=3   고장으로 보는 연속 실패 수
cluster.publish.timeout=30s                          상태 변경을 확정할 제한 시간
```

마스터 노드가 무거운 집계나 대량 색인까지 맡으면 힙이 차서 GC 멈춤이 길어지고 CPU가 포화된다. 다른 노드의 확인에 10초씩 세 번 답하지 못하면 노드들은 마스터가 고장 났다고 보고 새 선거를 연다. 선거가 끝날 때까지 인덱스 생성, 매핑 변경, 샤드 배치처럼 클러스터 상태를 바꾸는 일은 모두 멈춘다.

아래 데모에서 역할 겸용과 전용 마스터를 고르고 무거운 집계를 보내, 같은 부하에서 마스터가 어떻게 되는지 비교한다.

<figure class="fig" data-figure="elasticsearch-master">
  <figcaption>무거운 집계가 마스터 노드에 닿을 때 (시간은 줄여 그렸다)</figcaption>
</figure>

겸용에서는 집계가 선출된 마스터의 힙까지 채워 확인 응답이 끊기고 재선출이 일어난다. 전용 마스터는 검색을 받지 않아 데이터 노드가 같은 부하에 시달려도 상태 관리를 이어 간다. Elastic 문서는 노드가 몇 대를 넘으면 전용 마스터 후보를 두라고 권한다. 분리 기준은 이렇다.

- 3대 안팎의 작은 클러스터: 모든 노드가 모든 역할을 맡는다. 셋 다 마스터 후보라 1대가 꺼져도 버틴다.
- 데이터 노드가 늘고 부하가 무거워질 때: 마스터 후보 3대를 `node.roles: [ master ]`로 따로 둔다. 데이터를 들지 않으니 작은 사양이면 된다.
- 집계가 무겁거나 클라이언트 연결이 많을 때: 조정 전용 노드를 앞에 둔다. 너무 많이 두면 마스터가 상태를 보내고 확인을 기다릴 곳만 늘어난다.
- 최근 데이터와 오래된 데이터의 조회 빈도가 크게 다를 때: hot, warm, cold 티어로 나눠 디스크 등급을 다르게 쓴다.

마스터 후보가 3대인 이유는 과반 투표다. 3대는 1대 고장을 견디고, 4대는 과반이 3이라 여전히 1대만 견딘다. Elastic 문서도 고가용성 클러스터에 마스터 후보를 최소 3대 요구한다.

## 샤드 크기와 개수

인덱스는 샤드(shard)로 나뉘어 데이터 노드에 흩어진다. 샤드 하나는 독립된 Lucene 인덱스이고, 문서는 세그먼트(segment)라는 바뀌지 않는 파일 묶음에 쌓인다. 문서가 들어갈 샤드는 라우팅 값의 해시로 정한다.

```text
routing_factor = number_of_routing_shards / number_of_shards
shard = (hash(_routing) % number_of_routing_shards) / routing_factor   # _routing 기본값은 문서 _id
```

`number_of_routing_shards`는 인덱스를 만들 때 정해지고, 기본값은 2배씩 쪼개 1024개까지 갈 수 있는 값이다. 프라이머리 수가 `routing_factor`를 바꾸므로, 수가 바뀌면 같은 문서가 가는 샤드가 달라진다. 아래 그림(나머지 연산으로 단순화)처럼 3개를 4개로 바꾸면 문서 4개 중 3개가 다른 샤드에 있어야 한다. 그래서 `index.number_of_shards`는 인덱스를 만들 때만 정할 수 있고, 바꾸려면 새 인덱스를 만든다.

- split: `number_of_routing_shards` 안에서 배수로 늘린다(3 → 6). 세그먼트를 하드 링크로 가져온 뒤 문서를 다시 해시해 다른 샤드 몫을 지운다.
- shrink: 약수로 줄인다(6 → 3, 2, 1). 모든 샤드의 복사본 하나씩을 한 노드에 모은 뒤 하드 링크로 합친다.
- reindex: 원하는 개수로 새 인덱스를 만들고 문서를 하나씩 다시 색인한다. 가장 느리다.

split과 shrink는 원본을 읽기 전용으로 막아야 하고, 그동안 그 인덱스에 쓸 수 없다.

<figure class="fig" data-figure="elasticsearch-routing">
  <figcaption>프라이머리 수에 따라 바뀌는 문서 위치</figcaption>
</figure>

샤드 크기는 양쪽 한계 사이에서 고른다. 검색은 샤드마다 CPU 스레드 하나로 돌아서, 샤드가 크면 그 스레드 하나가 오래 걸리고 장애 뒤 복구도 길어진다. 작은 샤드가 많으면 샤드마다 붙는 고정 비용(힙, 파일 핸들, 클러스터 상태 항목)이 쌓인다. Elastic 문서는 50MB 샤드 천 개를 검색하는 쪽이 같은 데이터를 큰 샤드 몇 개로 검색하는 쪽보다 훨씬 비싸다고 설명한다.

```text
샤드 크기        10GB ~ 50GB
샤드당 문서 수    2억 개 미만
노드당 샤드      1000개 (frozen 제외, 기본 한도)
```

Elastic 공식 문서의 권장값과 기본 한도다.

프라이머리 수는 인덱스가 다 자랐을 때의 크기를 목표 샤드 크기로 나눠 정한다. 상품 카탈로그처럼 계속 고쳐 쓰는 인덱스가 지금 120GB이고 1년에 두 배로 자란다면 이렇게 잡는다.

```text
1년 뒤 240GB ÷ 목표 40GB = 6 → 프라이머리 6개
```

로그처럼 시간 순서로 쌓이는 데이터는 인덱스 하나를 키우지 않는다. 데이터 스트림(data stream)에 쓰고, ILM(Index Lifecycle Management, 인덱스 수명 관리)의 롤오버(rollover)로 조건이 차면 새 인덱스를 만들어 쓰기를 넘긴다. Elastic은 롤오버 조건을 `max_primary_shard_size: 50gb`로 두라고 권하고, 샤드 하나가 문서 2억 개에 닿으면 조건과 관계없이 롤오버한다. 유입이 늘면 다음 인덱스의 샤드 수만 템플릿에서 바꾸면 되므로, 이미 만든 인덱스의 프라이머리 수를 바꿀 일이 줄어든다.

## 프라이머리와 레플리카

샤드마다 프라이머리(primary) 하나와 그 복사본인 레플리카(replica)가 있다. 레플리카 수(`number_of_replicas`, 기본 1)는 언제든 바꿀 수 있다. 쓰기는 반드시 프라이머리를 먼저 거친다.

1. 조정 노드가 라우팅 식으로 샤드를 찾아 그 프라이머리가 있는 노드로 보낸다.
2. 프라이머리가 요청을 검증하고 색인한 뒤, 이 작업에 순번(sequence number)을 매긴다.
3. 같은 작업을 in-sync 복사본 전부에 동시에 보낸다. in-sync 복사본은 확인된 쓰기를 빠짐없이 받은 복사본 목록이고, 마스터가 클러스터 상태에 적어 둔다.
4. 레플리카가 색인하고 로컬 체크포인트(local checkpoint)를 함께 답한다. 그 순번 아래의 작업을 모두 처리했다는 표시다.
5. 프라이머리는 모든 in-sync 복사본의 답을 받은 뒤 응답하고, 모든 복사본이 처리한 가장 높은 순번을 글로벌 체크포인트(global checkpoint)로 올린다.

<figure class="fig" data-figure="elasticsearch-write">
  <figcaption>문서 하나가 프라이머리를 거쳐 레플리카 둘에 쓰이는 순서</figcaption>
</figure>

레플리카 하나가 답하지 못하면 프라이머리는 마스터에 그 복사본을 in-sync 목록에서 빼 달라고 요청하고, 마스터가 확인해 준 뒤에야 클라이언트에 응답한다. 쓰기는 레플리카 장애로 멈추지 않는 대신, 그동안 데이터 사본 수가 줄어든다.

`wait_for_active_shards`(기본 1)는 쓰기를 시작하기 전에 활성 복사본이 그 수만큼 있는지 확인한다. 기본값 1은 프라이머리만 살아 있으면 진행한다는 뜻이다. `2`로 두면 레플리카가 하나도 없는 동안 쓰기가 대기한다. 확인은 시작할 때 한 번뿐이라 도중에 복제가 실패하는 경우는 막지 못하고, 그 결과는 응답의 `_shards`에 실패 수로 남는다.

순번과 글로벌 체크포인트는 프라이머리가 바뀔 때 쓰인다. 프라이머리 노드가 꺼지면 마스터가 in-sync 레플리카 하나를 승격하고, 프라이머리 텀(primary term)을 하나 올린다. 텀이 높은 쪽의 기록이 이기므로 옛 프라이머리가 늦게 보낸 쓰기는 거절된다. 새 프라이머리는 글로벌 체크포인트 위의 작업만 다른 복사본과 맞추면 되고, 전체 데이터를 비교하지 않는다.

읽기는 in-sync 복사본 하나면 충분하다. 조정 노드는 샤드마다 복사본 하나를 고르고, 기본값인 적응형 복제본 선택(adaptive replica selection)은 노드별 이전 응답 시간, 검색 처리 시간, search 큐 길이를 보고 덜 바쁜 복사본에 보낸다.

복사본을 나눠 두는 의미는 장애에서 나온다. 같은 샤드의 복사본 둘은 한 노드에 놓이지 않는다(`SameShardAllocationDecider`). 서버 한 대에 노드를 여러 개 띄운다면 `cluster.routing.allocation.same_shard.host: true`로 같은 호스트까지 막는다. 랙이나 가용 영역 단위 장애에 대비하려면 노드에 속성을 붙이고 할당 인식(allocation awareness)을 켠다.

```yaml
node.attr.zone: zone-a
cluster.routing.allocation.awareness.attributes: zone
```

아래 그림의 두 번째 장면처럼 노드 하나가 꺼지면 그 노드의 프라이머리 자리는 다른 노드의 레플리카가 이어받는다.

<figure class="fig" data-figure="elasticsearch-copies">
  <figcaption>복사본 사이의 읽기 분산과 노드 장애 뒤 승격</figcaption>
</figure>

## 스레드 풀과 큐

노드는 작업 종류마다 정해진 수의 스레드와 대기 줄(큐)을 둔다. 스레드가 모두 바쁘면 요청은 큐에서 대기하고, 큐까지 차면 거절된다.

```text
write   스레드 = 할당된 프로세서 수             큐 = 10000
search  스레드 = int(프로세서 수 × 3 / 2) + 1    큐 = 1000
```

Elasticsearch 8.x 참조 문서의 기본값이다. 8코어 노드라면 write 스레드 8개에 큐 10000, search 스레드 13개에 큐 1000이다.

거절된 요청은 HTTP 429와 `es_rejected_execution_exception`을 받는다. bulk 요청 하나는 조정 노드에서 샤드별 요청으로 쪼개지고, 쪼개진 요청이 각 프라이머리 노드의 write 큐에 자리를 하나씩 잡는다. 그래서 같은 bulk 안에서도 어떤 문서는 들어가고 어떤 문서는 429를 받는다. 응답의 `items`를 문서별로 보고 실패한 것만 다시 보낸다.

큐 말고 메모리로도 거절한다. 색인 중인 요청이 차지한 바이트가 힙의 10%(`indexing_pressure.memory.limit` 기본값)에 닿으면 새 색인을 429로 거절한다. 레플리카 작업은 그 1.5배까지 받아서, 이미 시작한 복제를 새 요청보다 먼저 끝낸다.

거절이 보이면 큐를 키우고 싶어지지만 처리 속도는 스레드 수와 디스크가 정한다. 큐를 키우면 거절 대신 기다림이 길어지고, 대기 중인 요청 본문이 힙을 차지한다. Elastic 블로그도 bulk 큐를 키우는 일은 문제를 미룰 뿐이라고 설명한다. 아래 데모에서 같은 bulk 60건을 큐 키우기와 429 백오프로 보내고, 중간에 API 쓰기 한 건을 끼워 끝나는 시각과 API의 대기 시간을 비교한다.

<figure class="fig" data-figure="elasticsearch-queue">
  <figcaption>스레드 4개, 요청 하나 0.5초인 축소 모델</figcaption>
</figure>

두 방식 모두 스레드 4개가 같은 속도로 일해서 60건이 끝나는 시각은 8초로 같다. 큐를 키우면 429는 없지만 큐가 22건까지 쌓이고, 3초에 들어온 API 쓰기는 앞선 bulk 뒤에서 1.7초를 대기한다. 백오프는 429를 받은 클라이언트가 잠시 보내기를 멈춰 큐가 6건 안에 머물고, API 쓰기는 0.5초만 대기한다. **처리량은 같고, 기다림이 서버 큐에서 bulk 클라이언트 쪽으로 옮겨 간다.**

클라이언트 쪽 기준은 Elastic의 색인 속도 문서를 따른다.

- 429를 받으면 무작위 지수 백오프(randomized exponential backoff)로 기다렸다가 실패한 문서만 다시 보낸다. 기다림을 0.5초, 1초, 2초처럼 늘리고 무작위로 흔들어, 여러 클라이언트가 같은 순간에 다시 몰리지 않게 한다.
- bulk 크기는 노드 하나, 샤드 하나에서 100건, 200건, 400건처럼 두 배씩 늘리며 처리량이 더 오르지 않는 지점을 찾는다. 비슷하면 작은 쪽을 고르고, 요청 하나가 수십 MB를 넘지 않게 한다.
- 보내는 스레드나 프로세스를 늘려 가며 클러스터의 CPU나 디스크 I/O가 포화되는 지점을 찾는다.

백오프가 길어지고 429가 계속되면 처리량 자체가 모자란 것이다. 그때는 노드를 늘려 샤드를 흩는다.

## 무중단 스케일아웃

데이터 노드를 추가하면 마스터가 노드별 샤드 수, 디스크 사용량, 쓰기 부하를 반영한 가중치로 균형을 다시 계산하고, 일부 샤드를 새 노드로 옮긴다(relocation). 옮기는 동안에도 검색과 색인은 계속된다. 복사는 피어 복구(peer recovery)로 일어나고, 소스 코드의 `RecoverySourceHandler`가 이 순서로 진행한다.

1. 파일 복사: 새 노드에 빈 복사본을 만들고, 원본이 세그먼트 파일을 보낸다. 세그먼트는 바뀌지 않는 파일이라 복사 중에도 내용이 그대로다. 같은 크기와 체크섬의 파일이 이미 있으면 건너뛴다.
2. 따라잡기: 새 복사본을 복제 그룹에 넣어 이때부터 들어오는 쓰기를 함께 받게 한 뒤, 파일 복사 동안 쌓인 작업을 순번대로 재생한다.
3. 전환: 순번을 다 따라잡으면 in-sync 목록에 넣는다. 마스터가 클러스터 상태에서 샤드 위치를 새 노드로 바꾸고, 원본 복사본을 지운다.

<figure class="fig" data-figure="elasticsearch-relocate">
  <figcaption>새 노드로 샤드 하나를 옮기는 세 단계</figcaption>
</figure>

원본은 전환이 끝날 때까지 요청을 받는다. 프라이머리를 옮길 때는 마지막에 원본이 작업 허가(operation permit)를 모두 잡아 잠깐 새 쓰기를 멈추고, 프라이머리 역할을 새 복사본에 넘긴다. 도중에 실패하면 원본은 그대로 남고 복구만 다시 하므로 데이터를 잃지 않는다.

놓친 작업을 재생할 수 있는 것은 지운 문서까지 Lucene 안에 표시만 해 두는 소프트 삭제(soft delete) 덕분이다. 복사본마다 보존 리스(retention lease)가 "이 순번부터 필요하다"를 기록하고, 그 뒤의 기록은 지우지 않는다. 노드가 재시작하고 돌아왔을 때도 놓친 작업만 받는다. 리스가 `index.soft_deletes.retention_lease.period`(기본 12시간) 동안 갱신되지 않으면 만료되고, 그 복사본은 파일 전체를 다시 받는다.

재배치는 서비스 트래픽과 같은 디스크와 네트워크를 쓰므로 속도를 묶어 둔다.

```text
indices.recovery.max_bytes_per_sec=40mb                    노드당 파일 복사 속도
cluster.routing.allocation.node_concurrent_recoveries=2     노드당 동시 복구 수
```

속도 제한은 파일 복사에만 걸리고 작업 재생에는 걸리지 않는다. 40MB/s면 50GB 샤드 하나를 옮기는 데 약 21분이 걸리고, 50GB 샤드 20개를 받아야 하는 새 노드는 7시간 넘게 걸려 차오른다.

디스크 워터마크(watermark)는 재배치가 디스크를 채우지 않게 막는다. 기본값은 사용률 기준이다.

- low 85%: 이 위로는 샤드를 새로 받지 않는다.
- high 90%: 이 노드에서 샤드를 내보낸다.
- flood_stage 95%: 이 노드에 샤드가 있는 인덱스를 읽기 전용으로 막는다. high 아래로 내려가면 풀린다.

큰 디스크에서는 남은 공간 기준(low 200GB, high 150GB, flood_stage 100GB)이 상한으로 함께 걸린다.

노드를 늘려 빨라지는 것은 샤드가 여러 노드로 흩어질 때뿐이다. 샤드 하나의 검색은 스레드 하나에서 돌고, 쓰기는 그 샤드의 프라이머리 노드 하나에서 일어난다. 프라이머리가 3개인 인덱스는 노드가 10대여도 쓰기를 받는 노드가 3대다. 200GB 샤드 하나는 어느 노드로 옮겨도 200GB라 검색이 느리고, 옮기는 데만 1시간 25분이 걸린다. 이럴 때는 노드가 아니라 샤드를 나눈다. split으로 프라이머리를 늘리거나, 롤오버 조건을 낮춰 다음 인덱스부터 샤드를 작게 만든다.

## 참고

- [Elastic — Node roles](https://www.elastic.co/docs/deploy-manage/distributed-architecture/clusters-nodes-shards/node-roles)
- [Elastic — Discovery and cluster formation settings](https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/discovery-cluster-formation-settings)
- [Elastic — Cluster state](https://www.elastic.co/docs/deploy-manage/distributed-architecture/discovery-cluster-formation/cluster-state-overview)
- [Elastic — Clusters, nodes, and shards](https://www.elastic.co/docs/deploy-manage/distributed-architecture/clusters-nodes-shards)
- [Elastic — _routing field](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/mapping-routing-field.html)
- [Elastic — Index settings](https://www.elastic.co/docs/reference/elasticsearch/index-settings/index-modules)
- [Elastic — Split index API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-split)
- [Elastic — Shrink index API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-shrink)
- [Elastic — Size your shards](https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards)
- [Elastic — Rollover](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management/rollover)
- [Elastic — Reading and writing documents](https://www.elastic.co/docs/deploy-manage/distributed-architecture/reading-and-writing-documents)
- [Elastic — Index API, Active shards](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-index)
- [Elastic — Sequence IDs](https://www.elastic.co/blog/elasticsearch-sequence-ids-6-0)
- [Elastic — Search shard routing](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-shard-routing)
- [Elastic — Shard allocation awareness](https://www.elastic.co/docs/deploy-manage/distributed-architecture/shard-allocation-relocation-recovery/shard-allocation-awareness)
- [elasticsearch — SameShardAllocationDecider.java](https://github.com/elastic/elasticsearch/blob/main/server/src/main/java/org/elasticsearch/cluster/routing/allocation/decider/SameShardAllocationDecider.java)
- [Elastic — Thread pool settings](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/modules-threadpool.html)
- [Elastic — Rejected requests](https://www.elastic.co/docs/troubleshoot/elasticsearch/rejected-requests)
- [Elastic — Indexing pressure](https://www.elastic.co/docs/reference/elasticsearch/index-settings/pressure)
- [Elastic — Why am I seeing bulk rejections in my Elasticsearch cluster?](https://www.elastic.co/blog/why-am-i-seeing-bulk-rejections-in-my-elasticsearch-cluster)
- [Elastic — Tune for indexing speed](https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/indexing-speed)
- [Elastic — Cluster-level shard allocation and routing settings](https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/cluster-level-shard-allocation-routing-settings)
- [Elastic — Index recovery settings](https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/index-recovery-settings)
- [Elastic — History retention](https://www.elastic.co/docs/reference/elasticsearch/index-settings/history-retention)
- [elasticsearch — RecoverySourceHandler.java](https://github.com/elastic/elasticsearch/blob/main/server/src/main/java/org/elasticsearch/indices/recovery/RecoverySourceHandler.java)
