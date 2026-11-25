---
title: S3 로그 시스템
description: 검색 엔진에 로그를 다 넣을 때의 비용과 보관 정책부터 S3에 쌓아 Glue로 변환하고 Athena로 조회하는 구조, 직접 만든 북마크와 작은 파일 문제까지 정리했다.
date: 2026-11-02 12:00:00 +0900
series: 인프라 운영
tags: [s3, athena, glue, iceberg, elasticsearch, logging]
scripts: [figures/s3-log-system.js]
---

## 검색 엔진 로그 보관

### 저장 구조

로그를 Elasticsearch에 넣고 Kibana로 보면 편하다. 그런데 보관 기간을 2주에서 3개월로 늘리자 디스크와 노드 비용이 같이 커진다.

Elasticsearch는 로그를 받으면 원문(`_source`)만 쓰지 않는다. 아무 단어로나 찾을 수 있게 역색인을 만들고, 집계와 정렬을 위해 열 단위 데이터(doc values)도 만든다. 복제본 수(`number_of_replicas`)는 기본 1이라 이 묶음이 다른 노드에 한 벌 더 생긴다.

같은 로그 한 줄이 두 저장소에 어떤 모양으로 놓이는지 견줘 보자. 노드 1에 블록이 쌓인 뒤 노드 2에 같은 묶음이 한 번 더 생기는 순간을 본다.

<figure class="fig" data-figure="s3-log-system-es-store">
  <figcaption>로그 한 줄이 Elasticsearch와 S3에 저장되는 모양 (블록 크기는 모양을 보여 주는 대략값)</figcaption>
</figure>

Elasticsearch는 검색을 빠르게 하려고 디스크를 더 쓰고, 그 디스크는 늘 켜 둔 노드에 붙어 있다. S3는 압축한 파일을 올린 크기만큼만 과금하고, 여러 가용 영역에 나눠 두는 일은 S3가 맡는다.

- Elasticsearch: 원문, 역색인, 열 데이터에 복제본까지. 노드가 켜져 있는 시간 전체를 낸다.
- S3: 압축 파일 한 벌. 저장한 GB와 요청 수만큼 낸다.

최근 며칠치를 바로 검색해야 하는 로그만 검색 엔진에 두고, 오래 보관할 로그는 S3로 보낸다.

### 보관 기간 정책

Elasticsearch에 로그를 계속 넣으면 날마다 인덱스가 하나씩 늘어난다. 디스크가 차면 데이터 노드를 붙여야 하고, 노드를 붙이면 샤드가 새 노드로 옮겨 가며 고르게 나뉜다. 늘어나는 디스크를 노드로 따라가는 셈이다.

ILM(Index Lifecycle Management)은 인덱스의 나이에 따라 단계를 옮기는 정책이다. 단계는 hot, warm, cold, frozen, delete가 있고, 각 단계의 `min_age`는 인덱스를 만든 시각부터 잰다. 롤오버를 쓰면 롤오버된 시각부터 잰다.

두 장면에서 아래 디스크 막대가 용량 선을 넘는지 지켜보자.

<figure class="fig" data-figure="s3-log-system-ilm">
  <figcaption>날마다 생기는 인덱스와 delete 단계의 min_age</figcaption>
</figure>

정책이 없으면 인덱스가 쌓여 9일째에 용량을 넘는다. delete 단계에 `min_age: 5d`를 걸면 만든 지 5일 된 인덱스가 지워져 디스크가 5일치에서 멈춘다.

정책을 만들고 인덱스 템플릿에 연결한다. 템플릿은 7.8부터 `_template`이 폐기 예정이 됐고, 지금은 `_index_template`을 쓴다.

```json
PUT _ilm/policy/delete-5d
{
  "policy": {
    "phases": {
      "hot":    { "actions": {} },
      "delete": { "min_age": "5d", "actions": { "delete": {} } }
    }
  }
}

PUT _index_template/logs
{
  "index_patterns": ["cluster_platform-*", "cluster_system-*"],
  "template": { "settings": { "index.lifecycle.name": "delete-5d" } }
}
```

템플릿은 새로 만드는 인덱스에만 적용된다. 이미 있는 인덱스에는 설정을 따로 넣는다.

```json
PUT cluster_platform-*/_settings
{ "index.lifecycle.name": "delete-5d" }
```

Kibana의 Index Lifecycle Policies 화면에서도 정책을 만들고 인덱스에 붙일 수 있다. 보관 기간은 "검색해야 하는 기간"으로 짧게 잡고, 그 뒤의 보관은 S3에 맡긴다.

## S3 버킷 구조

로그 소스가 늘면 버킷도 소스마다 하나씩 만들고 싶어진다. 권한과 수명 주기를 프리픽스로 가를 수 있으면 버킷 하나로 충분하다.

이 구성은 버킷 하나에 입력, 상태, 출력을 프리픽스로 나눠 담는다. 입력 경로는 소스마다 다르다. Fluentd와 Datadog 아카이브는 Hive 스타일(`dt=`, `hour=`)로 떨어지고, CloudFront와 WAF는 AWS가 정한 `YYYY/MM/DD/HH` 형식으로 떨어진다.

| 소스 | 경로 | 포맷 | 파티션 |
|---|---|---|---|
| Fluentd | `fluentd/{env}/{service}/` | JSON.gz | `dt=YYYYMMDD/hour=HH/` |
| Datadog 아카이브 | `datadog/{env}/{service}/` | JSON.zst (기본값) | `dt=YYYYMMDD/hour=HH/` |
| CloudFront 표준 로그(v2) | `cloudfront-{service}-{env}/` | Parquet | `YYYY/MM/DD/HH/` |
| WAF | `AWSLogs/{acct}/WAFLogs/{region}/{acl}/` | .log.gz | `YYYY/MM/DD/HH/mm/` |

두 장면에서 파일이 어느 프리픽스로 떨어지고, 수명 주기가 어느 줄만 바꾸는지 본다.

<figure class="fig" data-figure="s3-log-system-bucket">
  <figcaption>버킷 하나에 나눠 담은 입력, 상태, 출력</figcaption>
</figure>

레이아웃이 두 갈래라 파일을 훑는 코드도 두 갈래다. 어느 쪽인지 인자로 넘기게 했는데, 잘못 주면 에러가 나지 않고 엉뚱한 폴더를 훑어 0건으로 끝난다. 로그에는 성공으로 남아서 한동안 몰랐다.

수명 주기 규칙은 입력 프리픽스에만 건다.

```json
{
  "Rules": [{
    "ID": "inputs-to-glacier",
    "Filter": { "Prefix": "fluentd/" },
    "Status": "Enabled",
    "Transitions": [{ "Days": 30, "StorageClass": "GLACIER" }]
  }]
}
```

Glacier로 내릴 때 두 가지를 같이 본다.

- 최소 보관 기간: Glacier Flexible Retrieval은 90일, Deep Archive는 180일이다. 그 전에 지우면 남은 기간만큼 과금된다.
- 작은 객체: 2024년 9월부터 128KB보다 작은 객체는 기본으로 전환하지 않는다. 작은 로그 파일이 많으면 생각보다 덜 내려간다.

소스마다 레이아웃을 표로 적어 두고, 0건으로 끝난 실행은 성공이 아니라 경고로 남긴다.

## Glue 변환

### Glue 과금 구조

처음에는 Glue Workflow, Job, Crawler로 정석 구성을 했다. 동작은 문제가 없었는데, 스케줄을 30분으로 늦춰 실시간성을 포기해도 요금이 크게 줄지 않았다.

Glue는 DPU 시간으로 과금한다. DPU 하나는 vCPU 4개와 메모리 16GB다.

- Spark 잡: 최소 2 DPU, 지정하지 않으면 10 DPU를 잡는다. 초 단위 과금에 실행마다 최소 1분이다.
- 크롤러: 초 단위 과금에 실행마다 최소 10분이다.
- 잡이 뜨고 내리는 시간은 과금하지 않는다.

잡은 DPU 전체가 과금 대상이다. 두 장면에서 연한 칸(과금)과 진한 칸(일함)의 차이를 본다.

<figure class="fig" data-figure="s3-log-system-glue-bill">
  <figcaption>Spark 잡 한 번과 크롤러 한 번의 과금 구간 (시간은 예시값)</figcaption>
</figure>

옮길 파일이 몇 개뿐이어도 잡은 10 DPU를 잡고, 크롤러는 1분 만에 끝나도 10분어치를 낸다. 하루 48번 돌리면 이 고정분이 48번 붙는다. 스케줄을 늦춰도 실행 한 번에 붙는 몫은 그대로라 총액이 덜 줄었다.

Glue에는 남는 자원으로 돌리는 Flex 실행도 있다. 단가는 낮지만 공식 문서도 시작과 완료 시각이 들쭉날쭉해도 되는 급하지 않은 잡에 맞는다고 적는다. 실제로 성능이 나빴고, 여러 잡을 동시에 넣으면 일부가 자리를 못 잡고 멈춰 접었다.

잡의 DPU 수는 기본값 10을 그대로 두지 말고 일의 양에 맞춰 줄인다. 실행 횟수가 잦다면 크롤러의 최소 10분부터 계산해 본다.

### 상시 컨테이너

실행마다 붙는 고정분을 없애려면 잡을 계속 떠 있게 하면 된다. Glue는 Spark 런타임과 라이브러리를 그대로 담은 Docker 이미지(`public.ecr.aws/glue/aws-glue-libs`)를 내놓는다. 이 이미지를 ECS Fargate Spot에 올려 상시 루프로 돌렸다.

| | 관리형 Glue 잡 | 컨테이너 + ECS |
|---|---|---|
| 과금 단위 | DPU 시간 | 태스크가 떠 있는 시간 |
| 자원 크기 | 최소 2 DPU, 기본 10 DPU | vCPU와 메모리를 필요한 만큼 |
| 실행 방식 | 스케줄마다 새로 뜬다 | 한 번 떠서 계속 돈다 |
| 스키마 등록 | 크롤러 | Iceberg 메타데이터 (크롤러 없음) |
| 남는 자원 | Flex | Fargate Spot |

같은 2시간치 로그를 두 방식으로 돌려 보자. 모드를 바꿔 가며 크롤러 줄과 변환 블록이 어떻게 놓이는지 지켜본다.

<figure class="fig" data-figure="s3-log-system-glue-loop">
  <figcaption>30분마다 뜨는 잡과 상시 컨테이너 (시간은 예시값)</figcaption>
</figure>

30분마다 잡을 띄우면 실행마다 10 DPU를 잡고 크롤러가 10분씩 과금되며, 로그는 최대 30분 늦게 테이블에 들어간다. 상시 컨테이너는 같은 파일을 몇 분마다 조금씩 처리하고 크롤러가 없다. 처리하는 파일은 같고, 바뀐 것은 실행 주체 하나다.

Fargate Spot은 AWS가 자원을 회수할 때 2분 전에 SIGTERM을 보내고 태스크를 멈춘다. 그래서 루프는 짧은 단위로 커밋하고, 다시 떠도 이어서 돌게 만든다.

상시 컨테이너로 옮기기 전에, 컨테이너 이미지에서 빠지는 기능이 무엇인지 먼저 본다.

### 작업 북마크

컨테이너로 옮긴 뒤 같은 파일을 돌 때마다 다시 읽는다. 공식 문서의 컨테이너 이미지 미지원 기능 목록에 작업 북마크(job bookmark)가 들어 있다.

작업 북마크는 어디까지 처리했는지를 남겨 두는 기능이다. S3 입력이면 객체의 마지막 수정 시각(`LastModified`)으로 다시 처리할 객체를 가린다고 문서에 적혀 있다. 기준선 하나만 있으면 흉내 낼 수 있다는 뜻이다.

서비스마다 상태 파일을 하나 두고 "여기까지 봤다"는 시각을 적는다. 두 장면에서 보라색 기준선이 어디로 움직이는지 본다.

<figure class="fig" data-figure="s3-log-system-bookmark">
  <figcaption>LastModified 기준선과 상태 파일</figcaption>
</figure>

한 번 돌 때는 `hour` 하나만 처리하고 커밋한다. Hive 스타일 파티션이라 `hour`가 자연스러운 경계가 되고, 실패해도 그 시간대만 다시 하면 된다.

```json
{
  "job_name": "etl-live-api-gateway",
  "states": {
    "datasource_live_api-gateway": {
      "max_last_modified": "2026-11-02T11:55:03+00:00",
      "files_processed": 9,
      "last_processed_at": "2026-11-02T12:00:00+00:00"
    }
  }
}
```

`LastModified`는 boto3의 `list_objects_v2` 결과에 객체마다 들어 있어 따로 조회할 필요가 없다. 상태 파일은 입력과 같은 버킷의 `bookmarks/` 아래에 둔다.

### 경계 누락

기준선을 만들고 며칠 뒤, 몇 시간에 한두 건씩 로그가 테이블에서 빠진다. 기준선보다 늦은 파일만 읽는 규칙이 경계에서 파일을 흘린다.

S3의 `LastModified`는 파일이 목록에 보이는 시각이 아니다. 멀티파트 업로드는 업로드를 시작한 시각이 찍힌다. 큰 파일을 올리는 동안 다른 파일로 기준선이 넘어가면, 업로드가 끝나 목록에 보일 때는 이미 기준선보다 앞이다.

모드를 바꿔 가며 목록을 떠 보자. 1차 목록 뒤에 나타난 X가 두 번째 실행에서 읽히는지 본다.

<figure class="fig" data-figure="s3-log-system-edge">
  <figcaption>늦게 보인 파일과 되돌아보는 창</figcaption>
</figure>

기준선만 보면 두 번째 실행은 e만 읽고 X는 영영 읽지 않는다. 되돌아보는 창을 두면 기준선 바로 앞 구간을 다시 보고, 처리한 파일에 붙여 둔 객체 태그로 X만 골라 처리한다. 바뀐 것은 기준선 앞을 한 번 더 보는 일 하나다.

| 태그 | 값 |
|---|---|
| `etl_processed` | `true` |
| `etl_processed_at` | ISO 8601 (UTC) |

태그 조회는 파일마다 요청이라 공짜가 아니다. 기준선보다 확실히 늦은 파일은 태그를 보지 않고 바로 처리하고, 창 안의 파일만 태그를 본다. 태그는 객체당 10개까지 붙는다.

경계를 막느라 붙인 장치가 더 있다.

- 기준선을 되돌리지 않는다: 창 안을 회수하는 중에 기준선이 뒤로 가면 같은 구간을 다시 읽어 중복으로 쌓인다.
- 성공한 배치까지만 커밋한다: 중간에 실패했는데 기준선만 앞서 가면 그 사이가 통째로 빈다.
- 한 번에 훑는 날짜에 상한을 둔다: 밀린 상태에서 한꺼번에 훑으면 LIST 요청 비용이 튄다. LIST는 GET보다 12.5배 비싸다.
- 오래 밀린 구간은 건너뛴다: 너무 오래된 백로그는 상시 루프가 아니라 따로 재처리한다.
- Glacier 객체는 읽지 않고 지나간다: 복원 전 객체에서 읽기가 실패해 기준선이 멈추는 것을 막는다.
- 신규 0건이면 넓혀 훑는다: 폐기된 서비스에서 기준선이 과거에 멈춰 매번 헛스캔하는 것을 막는다.

직접 만든 북마크는 만드는 것보다 경계에서 새지 않게 하는 데 시간이 더 든다. 입력 건수와 테이블 행 수를 시간 단위로 맞춰 보는 점검부터 붙인다.

## Athena 조회

### 카탈로그와 테이블

ETL이 Iceberg 테이블에 쌓고 나면 조회할 곳이 필요하다. Athena에는 저장소가 없다. 데이터는 S3에 있고, 그것이 어떤 테이블인지는 Glue Data Catalog가 들고 있다.

Athena는 Glue 카탈로그에 만든 Iceberg 테이블만 지원한다. 카탈로그에는 테이블 위치가 있고, 파일 목록과 파티션 값은 Iceberg 메타데이터(metadata.json과 manifest)에 있다. 다섯 단계를 따라가며 마지막에 어느 파일을 읽는지 본다.

<figure class="fig" data-figure="s3-log-system-catalog">
  <figcaption>쿼리 하나가 카탈로그와 Iceberg 메타데이터를 거쳐 파일에 닿는 순서</figcaption>
</figure>

Iceberg가 자기 메타데이터를 들고 있어서 크롤러로 스키마를 다시 추론할 필요가 없다. 앞의 Glue 구성에서 크롤러가 빠진 이유다.

테이블은 Athena에서 한 번 만든다.

```sql
CREATE TABLE logs.app_logs (
  ts timestamp, level string, message string,
  environment string, service string, dt string, hour string)
PARTITIONED BY (environment, service, dt, hour)
LOCATION 's3://log-bucket/iceberg/app_logs/'
TBLPROPERTIES ('table_type' = 'ICEBERG');
```

파티션 키는 여기서 정하고 나중에 바꾸기 어렵다. 뒤에 나오는 문제 대부분이 이 한 줄에서 시작된다.

### 파티션 조건

대시보드에서 14시 로그 1시간을 봤을 뿐인데 그 쿼리의 스캔량이 하루치다. 쿼리는 성공하고 결과도 맞아서 아무도 이상하게 여기지 않는다.

Athena는 실행 시간이 아니라 읽은 바이트로 과금한다. 1TB당 5달러이고, MB 단위로 올림하며 쿼리마다 최소 10MB다. 읽는 양을 줄이는 수단은 `WHERE`에 건 파티션 조건이다.

조회 버튼을 눌러 보자. 모드를 바꿔 가며 빨간 칸이 몇 개 칠해지는지 본다.

<figure class="fig" data-figure="s3-log-system-scan">
  <figcaption>1시간을 조회할 때 읽는 시간 폴더 (폴더 하나 1GB로 가정)</figcaption>
</figure>

`dt`만 걸면 그날 24시간 폴더를 다 읽어 24GB, `hour`까지 걸면 한 폴더만 읽어 1GB다. 결과 행은 같고 스캔량만 24배 차이 난다. 다른 날짜는 두 모드 모두 `dt` 조건으로 건너뛴다.

시간 파티션을 만들어 두는 것과 쿼리가 그 파티션을 거는 것은 별개다. 파티션 키는 "무엇으로 자를 수 있나"가 아니라 "쿼리가 실제로 무엇으로 좁히나"로 고른다.

대시보드의 필터 후보도 같은 함정이다. 필터마다 쿼리를 따로 날리면 같은 범위를 필터 수만큼 반복해서 읽는다. `GROUPING SETS`나 CTE로 한 번에 묶는다.

```sql
SELECT level, service, count(*)
FROM logs.app_logs
WHERE dt = '20261102' AND hour = '14'
GROUP BY GROUPING SETS ((level), (service));
```

### 스캔 한도

폭주하는 쿼리가 무서워 워크그룹에 쿼리당 스캔 한도를 걸었다. 한도를 넘는 쿼리는 취소된다. 세 장면에서 청구액이 어디서 멈추는지 본다.

<figure class="fig" data-figure="s3-log-system-cap">
  <figcaption>쿼리 하나가 읽은 바이트 (테이블 1.2TB, 하루 50GB로 가정)</figcaption>
</figure>

취소된 쿼리도 취소될 때까지 읽은 만큼 과금된다. 한도에 걸리면 쓰는 사람은 결과를 못 받고 요금은 한도까지 나간다. 한도는 상한일 뿐이고, 막아야 할 자리는 쿼리 조건 쪽이다.

- 쿼리당 한도: 10MB에서 7EB 사이로 정한다. 넘으면 그 쿼리를 취소한다.
- 워크그룹 전체 한도: 넘어도 쿼리를 취소하지 않는다. CloudWatch 알람과 SNS 알림만 보낸다.

쿼리를 짜는 곳이 여러 군데라 말로 부탁해서는 조건이 지켜지지 않는다. 실행 이력을 읽어 위반을 잡는 규칙 검사를 따로 뒀다. SQL 문자열과 실행 통계만 받아 위반 목록을 돌려주게 만들어서, AWS SDK 없이 단위 테스트가 된다.

| 코드 | 등급 | 잡는 것 |
|---|---|---|
| `SCAN_CAP_HIT` | CRITICAL | 스캔 한도로 취소됨. 결과 0건인데 한도만큼 과금 |
| `MISSING_DT` | CRITICAL | `dt` 조건이 없다. 테이블 전체를 읽는다 |
| `MISSING_HOUR` | HIGH | 하루보다 짧은 구간을 보는데 `hour` 조건이 없다 |
| `SCAN_LARGE` | MEDIUM | 한도에는 안 걸렸지만 한 번에 많이 읽었다 |
| `MISSING_ENVIRONMENT` | MEDIUM | 모든 환경을 읽는다 |
| `FACET_FANOUT` | MEDIUM | 필터 후보마다 쿼리를 따로 날린다 |
| `MISSING_SERVICE` | LOW | 모든 서비스를 읽는다 |

판정은 전부 규칙으로 정하고, 애매하면 위반으로 올리지 않는다. 정규식 기반이라 서브쿼리 안에만 조건이 있어도 통과로 보는데, 실제로 파티션을 건너뛰므로 의도한 관대함이다. 오탐이 쌓이면 아무도 보지 않게 된다. 한도는 마지막 상한으로만 두고, 매일 위반 목록의 CRITICAL부터 고친다.

## 작은 파일

### 작은 파일 합치기

몇 주 지나자 같은 쿼리가 점점 느려진다. 스캔량은 그대로인데 파일 수가 늘었다.

상시 루프는 몇 초에 한 번꼴로 테이블에 덧붙인다(append). 커밋할 때마다 작은 Parquet 파일이 하나씩 생긴다. 파일이 많으면 쿼리마다 열고 메타데이터를 읽는 횟수가 늘어난다. 두 장면에서 파일 수가 오르고 내려가는 모양을 본다.

<figure class="fig" data-figure="s3-log-system-small-files">
  <figcaption>하루 파티션의 파일 수와 OPTIMIZE 실행 (10초마다 커밋 가정)</figcaption>
</figure>

Athena의 `OPTIMIZE`는 Iceberg 테이블의 작은 파일을 합친다. `WHERE`에는 파티션 컬럼만 쓸 수 있고, 합칠 때 읽은 바이트만큼 과금된다.

```sql
OPTIMIZE logs.app_logs REWRITE DATA USING BIN_PACK
WHERE dt = '20261102';
```

Glue Data Catalog의 관리형 압축(table optimizer)은 전체 테이블을 계획하는 단계에서 죽어서 쓰지 못했다. 그래서 `dt` 단위로 범위를 좁혀 `OPTIMIZE`를 돌리는 별도 태스크를 뒀고, 돌리면서 세 가지에 걸렸다.

- 한 번에 다 못 합친다: 실행이 `ICEBERG_OPTIMIZE_MORE_RUNS_NEEDED`로 끝나기도 한다. 실패가 아니라 남은 일이 있다는 뜻이라, 성공할 때까지 같은 문을 반복한다. 이를 실패로 처리하면 압축이 끝나지 않는다.
- 압축 자체가 스캔 한도에 걸린다: `dt`에서 `service`, `hour` 순으로 범위를 자동으로 쪼갠다.
- Spot 회수로 중간에 끊긴다: 끝낸 범위를 S3에 완료 표시로 남겨 다시 떠도 이어서 돈다.

새로 만든다면 자동 압축이 기본으로 켜진 S3 Tables도 후보다. 이미 만든 테이블이면 `dt` 단위 `OPTIMIZE`를 매일 돌리고, 파티션별 파일 수를 지표로 남긴다.

### 파티션 스펙

압축을 잘 돌려도 파일 수가 어느 선 아래로 내려가지 않는다. 파티션마다 파일이 최소 하나는 있어야 해서, 압축한 뒤 파일 수의 하한은 파티션 수다.

`hour`를 파티션에 넣으면 시간마다 파티션이 생겨 하한이 계속 오른다. 빼면 파일 수는 줄지만 앞에서 아낀 `hour` 건너뛰기를 잃는다. 두 장면에서 아래 두 숫자가 서로 반대로 움직이는 것을 본다.

<figure class="fig" data-figure="s3-log-system-partition">
  <figcaption>hour가 있는 스펙과 없는 스펙의 하루 (서비스 3개)</figcaption>
</figure>

읽는 쪽은 잘게 자르길 원하고 쓰는 쪽은 덜 자르길 원한다. 같은 키를 반대로 당긴다. 파티션 스펙을 처음 정할 때 쿼리가 거는 조건과 커밋 주기를 같이 놓고 본다. 나중에 바꾸려면 테이블을 옮겨야 한다.

## 정리

| 주제 | 기억할 점 |
|---|---|
| Elasticsearch 보관 | 원문에 색인과 복제본까지 디스크를 쓴다. 검색할 기간만 두고 ILM delete로 지운다 |
| ILM 설정 | `_index_template`에 정책을 붙이고, 기존 인덱스는 `_settings`로 붙인다 |
| S3 버킷 | 입력, 상태, 출력을 프리픽스로 나눈다. 수명 주기는 입력에만 건다 |
| Glue 과금 | 잡은 DPU 전체에 실행마다 최소 1분, 크롤러는 최소 10분 |
| 상시 컨테이너 | Glue 이미지를 Fargate Spot에서 루프로 돌린다. 북마크는 직접 만든다 |
| 북마크 | LastModified 기준선을 hour 단위로 커밋한다 |
| 경계 누락 | 멀티파트 업로드는 시작 시각이 찍힌다. 되돌아보는 창과 객체 태그로 회수한다 |
| Athena 과금 | 읽은 바이트로 낸다. `dt`와 `hour` 조건이 스캔량을 정한다 |
| 스캔 한도 | 취소돼도 읽은 만큼 낸다. 조건은 규칙 검사로 강제한다 |
| 작은 파일 | `dt` 단위 `OPTIMIZE`를 성공할 때까지 반복한다 |
| 파티션 스펙 | 파일 수 하한은 파티션 수다. 읽기와 쓰기를 같이 놓고 정한다 |

## 참고

- [AWS Glue Pricing](https://aws.amazon.com/glue/pricing/)
- [AWS Glue: Adding Spark jobs (기본 버전, Flex)](https://docs.aws.amazon.com/glue/latest/dg/add-job.html)
- [AWS Glue: Develop and test jobs locally using a Docker image](https://docs.aws.amazon.com/glue/latest/dg/develop-local-docker-image.html)
- [AWS Glue: Tracking processed data using job bookmarks](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuations.html)
- [AWS Glue: Optimizing Iceberg tables (table optimizers)](https://docs.aws.amazon.com/glue/latest/dg/table-optimizers.html)
- [Amazon Athena Pricing](https://aws.amazon.com/athena/pricing/)
- [Amazon Athena: Query Apache Iceberg tables](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg.html)
- [Amazon Athena: Workgroup data usage controls](https://docs.aws.amazon.com/athena/latest/ug/workgroups-setting-control-limits-cloudwatch.html)
- [Amazon Athena: OPTIMIZE](https://docs.aws.amazon.com/athena/latest/ug/optimize-statement.html)
- [Amazon Athena: Query restored Amazon Glacier objects](https://docs.aws.amazon.com/athena/latest/ug/querying-glacier.html)
- [Amazon S3: Object metadata (Last-Modified)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingMetadata.html)
- [Amazon S3: Lifecycle transition considerations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html)
- [Amazon S3: Object tagging](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html)
- [Amazon S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [Amazon S3 Tables: Maintenance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-maintenance.html)
- [Amazon ECS: Fargate capacity providers (Spot 중단)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)
- [Amazon CloudFront: Standard logging (v2)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging.html)
- [AWS WAF: Sending logs to Amazon S3](https://docs.aws.amazon.com/waf/latest/developerguide/logging-s3.html)
- [Datadog: Log Archives](https://docs.datadoghq.com/logs/log_configuration/archives/)
- [Elastic: Index lifecycle](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management/index-lifecycle)
- [Elastic: Apply a lifecycle policy](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management/policy-apply)
- [Elastic: Templates](https://www.elastic.co/docs/manage-data/data-store/templates)
- [Elastic: Index settings (number_of_shards, number_of_replicas)](https://www.elastic.co/docs/reference/elasticsearch/index-settings/index-modules)
- [Elastic: Clusters, nodes, and shards](https://www.elastic.co/docs/deploy-manage/distributed-architecture/clusters-nodes-shards)
- 원글: [S3로 로그시스템 만들기](https://kimjanghyun1010.tistory.com/111), [AWS Athena (w/ glue)](https://kimjanghyun1010.tistory.com/108), [Elastic Search 데이터 삭제 정책 등록(ILM)](https://kimjanghyun1010.tistory.com/21), [ElasticSearch 무중단 증설](https://kimjanghyun1010.tistory.com/119)
