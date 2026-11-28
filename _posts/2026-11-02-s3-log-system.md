---
title: S3 로그 시스템
description: 로그를 몇 달씩 보관할 때 저장, 변환, 조회 중 어디서 돈이 나가는지 따라간다. Elasticsearch의 저장 구조, Glue의 DPU 과금, 직접 만든 북마크의 경계 누락, Athena의 스캔 과금, Iceberg의 작은 파일까지 정리했다.
date: 2026-11-02 12:00:00 +0900
series: 인프라 운영
tags: [s3, athena, glue, iceberg, elasticsearch, logging]
scripts: [figures/s3-log-system.js]
---

## 검색 엔진 저장 구조

로그를 몇 달씩 보관하고 필요할 때 꺼내 보려면 저장, 변환, 조회 세 곳에 돈이 든다. Elasticsearch는 세 가지를 한 클러스터에서 하는 대신 저장이 가장 비싸다. S3로 옮기면 저장은 싸지지만 변환과 조회에 새 비용이 생긴다.

Elasticsearch는 로그 한 줄을 받으면 세 가지를 디스크에 쓴다.

- 원문(`_source`): 받은 JSON 그대로다.
- 역색인(inverted index): 단어마다 그 단어가 든 문서 번호를 적은 목록이다. 아무 단어로나 바로 찾게 해 준다.
- doc values: 필드 값을 열 단위로 모은 것이다. 집계와 정렬에 쓴다.

복제본 수 `index.number_of_replicas`는 기본 1이라 이 묶음이 다른 노드에 한 벌 더 생긴다. 아래 그림처럼 같은 로그가 Elasticsearch에는 색인과 복제본까지 여러 덩어리로, S3에는 압축 파일 한 벌로 놓인다.

<figure class="fig" data-figure="s3-log-system-es-store">
  <figcaption>로그 한 줄이 Elasticsearch와 S3에 놓이는 모양 (블록 크기는 대략값)</figcaption>
</figure>

Elasticsearch의 디스크는 늘 켜 둔 노드에 붙어 있어서, 보관 기간을 2주에서 3개월로 늘리면 디스크와 함께 노드 시간도 늘어난다. S3는 저장한 GB와 요청 수만큼 내고, 서로 떨어진 데이터센터(가용 영역) 여러 곳에 나눠 두는 일은 S3가 맡는다.

- gp3 EBS: GB당 월 0.08달러. 복제본 1이면 두 벌이라 0.16달러다.
- S3 Standard: 첫 50TB까지 GB당 월 0.023달러. 디스크만 견줘도 약 7배이고, 색인 크기와 노드 시간은 따로 붙는다.

가격은 us-east-1 공개 가격표(2026년 11월 기준)다.

그래서 검색 엔진에는 바로 검색해야 하는 며칠치만 두고 ILM(Index Lifecycle Management)으로 지운다. ILM은 인덱스 나이에 따라 hot, warm, cold, frozen, delete 단계를 옮기는 정책이고, `min_age`는 인덱스를 만든 시각부터 잰다.

```json
PUT _ilm/policy/delete-5d
{ "policy": { "phases": {
    "hot":    { "actions": {} },
    "delete": { "min_age": "5d", "actions": { "delete": {} } } } } }

PUT _index_template/logs
{ "index_patterns": ["app-logs-*", "system-logs-*"],
  "template": { "settings": { "index.lifecycle.name": "delete-5d" } } }
```

템플릿은 새로 만드는 인덱스에만 붙는다. 이미 있는 인덱스는 `PUT app-logs-*/_settings`로 `index.lifecycle.name`을 따로 넣는다.

## S3 원본 로그

S3로 보낸 로그는 소스마다 경로와 포맷이 다르다. Fluentd와 Datadog 아카이브는 압축한 JSON을 Hive 스타일, 곧 `key=value` 꼴의 폴더 이름(`dt=20261102/hour=14/`)으로 떨어뜨리고, CloudFront와 WAF는 AWS가 정한 `YYYY/MM/DD/HH/` 형식으로 떨어뜨린다.

버킷은 하나만 두고 입력(소스별 프리픽스), 상태(`bookmarks/`), 출력(`iceberg/`)을 프리픽스로 나눈다. 권한과 수명 주기 규칙(객체 나이에 따라 저장 등급을 바꾸거나 지우는 규칙)이 프리픽스 단위로 걸리기 때문이다. 수명 주기는 입력에만 걸어, 30일 뒤 꺼낼 때 시간이 걸리는 대신 싼 Glacier 등급으로 내린다.

```json
{ "Rules": [{ "ID": "inputs-to-glacier", "Filter": { "Prefix": "fluentd/" },
    "Status": "Enabled", "Transitions": [{ "Days": 30, "StorageClass": "GLACIER" }] }] }
```

- 최소 보관 기간: Glacier Flexible Retrieval은 90일, Deep Archive는 180일이다. 그 전에 지우면 남은 기간만큼 과금된다.
- 작은 객체: 128KB보다 작은 객체는 기본으로 전환하지 않는다. 작은 로그 파일이 많으면 생각보다 덜 내려간다.

원본 그대로는 조회에 불리하다. JSON은 한 줄에 모든 필드가 붙은 행 단위 포맷이라 필드 하나만 봐도 파일 전체를 풀어 읽는다. Parquet은 같은 열끼리 모아 저장해서 쿼리에 필요한 열만 읽고, 열마다 최솟값과 최댓값을 적어 둔다.

그래서 원본을 Parquet으로 바꿔 Iceberg 테이블에 쌓는 변환 단계가 붙는다. Iceberg는 데이터 파일 목록, 스키마, 파티션을 메타데이터 파일로 관리해 S3의 파일 묶음을 테이블처럼 쓰게 하는 테이블 형식이다.

## Glue 변환 비용

변환은 처음에 AWS의 관리형 Spark(여러 머신에 나눠 데이터를 처리하는 엔진) 서비스인 Glue로 구성했다. Glue는 DPU 시간으로 과금하고, DPU 하나는 vCPU 4개와 메모리 16GB다. 공개 단가는 DPU 시간당 0.44달러다.

- Spark 잡: 최소 2 DPU, 지정하지 않으면 10 DPU를 잡는다. 초 단위 과금에 실행마다 최소 1분이다(Glue 2.0 이상).
- 크롤러: S3 파일을 훑어 스키마를 추론하고 카탈로그에 등록한다. 초 단위 과금에 실행마다 최소 10분이다.

과금은 일한 DPU가 아니라 잡은 DPU 전체에 붙는다. 아래 그림처럼 파일 몇 개를 옮기는 잡도 10 DPU를 모두 과금하고, 1분 만에 끝난 크롤러도 10분어치를 낸다.

<figure class="fig" data-figure="s3-log-system-glue-bill">
  <figcaption>Spark 잡 한 번과 크롤러 한 번의 과금 구간 (시간은 예시값)</figcaption>
</figure>

30분 스케줄이면 하루 48번 돈다. 한 번에 5분 도는 10 DPU 잡의 하루 비용은 이렇다(예시 계산).

```text
10 DPU x 5/60 시간 x 0.44달러 x 48회 = 약 17.6달러/일, 한 달 약 530달러
```

스케줄을 1시간으로 늦춰 실행 횟수를 절반으로 줄여도, 한 번에 처리할 파일이 두 배라 실행 시간이 늘어난다. 줄어드는 것은 실행마다 붙는 최소 과금과 크롤러 10분 같은 고정분뿐이라 총액은 절반까지 줄지 않았다. 남는 자원으로 도는 Flex 실행(DPU 시간당 0.29달러)도 써 봤지만 시작이 늦고 동시에 넣으면 일부가 멈춰 접었다.

실행마다 붙는 고정분을 없애려고 잡을 계속 떠 있게 했다. Glue는 Spark 런타임과 라이브러리를 담은 Docker 이미지(`public.ecr.aws/glue/aws-glue-libs`)를 내놓는다. 이 이미지를 ECS Fargate Spot(언제든 회수될 수 있는 대신 싼 컨테이너 실행 환경)에 올려 상시 루프로 돌리면 과금 단위가 DPU 시간에서 태스크가 떠 있는 시간으로 바뀌고, vCPU와 메모리를 일의 양에 맞춰 고를 수 있다.

Fargate Spot은 AWS가 자원을 회수하기 2분 전에 컨테이너에 SIGTERM을 보낸다. 그 뒤 `stopTimeout`(기본 30초, 최대 120초)이 지나면 SIGKILL로 끝낸다. 그래서 루프는 짧은 단위로 커밋하고, 다시 떠도 이어서 돌게 만든다.

## 직접 만든 북마크

컨테이너 이미지에는 빠지는 기능이 있다. 공식 문서의 미지원 기능 목록에 어디까지 처리했는지 남겨 두는 작업 북마크(job bookmark)가 들어 있다. 이것이 없으면 돌 때마다 같은 파일을 다시 읽는다.

문서는 S3 입력일 때 객체의 마지막 수정 시각(`LastModified`)으로 다시 처리할 객체를 가린다고 적는다. `LastModified`는 boto3 `list_objects_v2` 결과에 객체마다 들어 있어 따로 조회할 필요가 없다. 서비스마다 상태 파일을 `bookmarks/` 아래에 두고 "여기까지 봤다"는 시각(기준선)을 적는다.

```json
{ "job_name": "etl-live-api-gateway",
  "states": { "datasource_live_api-gateway": {
      "max_last_modified": "2026-11-02T11:55:03+00:00",
      "files_processed": 9, "last_processed_at": "2026-11-02T12:00:00+00:00" } } }
```

한 번 돌 때는 `hour` 하나만 처리하고 커밋한다. Hive 스타일 파티션이라 `hour`가 자연스러운 경계가 되고, 실패해도 그 시간대만 다시 하면 된다.

기준선보다 늦은 파일만 읽는 규칙은 경계에서 파일을 흘린다. 큰 파일을 조각으로 나눠 올리는 멀티파트 업로드에서, S3 문서에 따르면 `LastModified`는 업로드를 **시작한 시각**이다.

S3 목록은 강한 일관성이라 업로드가 끝나면 바로 보인다. 11:50에 업로드를 시작한 큰 파일은 11:58에야 목록에 나타나지만 `LastModified`는 11:50이다. 그 사이 11:55 파일을 처리해 기준선이 11:55로 올라갔다면, 이 파일은 기준선보다 이른 시각이라 다시는 읽히지 않는다.

관리형 Glue 북마크도 같은 문제를 다룬다. S3 연결 옵션 `maxBand`(기본 900000ms, 15분)는 마지막 15분 안에 수정된 파일을 따로 추적하게 한다. 직접 만든 북마크에도 기준선 이전 구간을 다시 보는 창을 두었다. 모드를 바꿔 가며 목록 뜨기를 눌러, 첫 목록 뒤에 늦게 나타난 파일이 두 번째 실행에서 읽히는지 비교한다.

<figure class="fig" data-figure="s3-log-system-edge">
  <figcaption>늦게 보인 파일과 되돌아보는 창</figcaption>
</figure>

기준선만 쓰면 두 번째 실행은 기준선보다 늦은 새 파일만 읽고, 늦게 보인 파일은 영영 읽지 않는다. 창을 두면 기준선 이전 구간을 한 번 더 보고, 처리한 파일에 붙여 둔 객체 태그(`etl_processed=true`, `etl_processed_at`)가 없는 파일만 골라 처리한다. 태그 조회는 파일마다 요청이라 창 안의 파일만 태그를 본다.

기준선을 움직이는 규칙도 둘 둔다.

- 기준선을 되돌리지 않는다. 회수하는 중에 기준선이 뒤로 가면 같은 구간을 다시 읽어 중복으로 쌓인다.
- 성공한 배치까지만 커밋한다. 중간에 실패했는데 기준선만 앞서 가면 그 사이가 통째로 빈다.

이 규칙이 맞게 도는지는 입력 파일의 행 수와 테이블 행 수를 시간 단위로 맞춰 보는 점검으로 확인한다.

## Athena 스캔 비용

Athena는 S3의 파일에 SQL을 실행하는 서비스이고, 자기 저장소가 없다. 어떤 파일이 어떤 테이블인지는 Glue Data Catalog가 들고 있고, Athena는 이 카탈로그에 만든 Iceberg 테이블만 지원한다. 카탈로그에는 테이블 위치와 현재 `metadata.json`의 경로만 있고, 파일 목록과 파티션 값은 Iceberg 메타데이터에 있다.

쿼리 하나는 메타데이터를 두 층 거쳐 읽을 파일을 고른다. 스냅샷은 커밋 한 번이 끝난 시점의 테이블 상태이고, 쿼리는 가장 최근 스냅샷에서 시작한다.

- 매니페스트 목록(manifest list): 스냅샷에 속한 매니페스트들과, 매니페스트마다 담긴 파티션 값의 범위.
- 매니페스트(manifest): 데이터 파일 목록과 파일마다의 파티션 값, 열별 최솟값과 최댓값.

Iceberg는 먼저 파티션 범위로 매니페스트를 거르고, 남은 매니페스트에서 파티션 값과 열 통계로 데이터 파일을 거른다. 아래 그림처럼 카탈로그에서 시작해 마지막에 필요한 파일만 읽는다.

<figure class="fig" data-figure="s3-log-system-catalog">
  <figcaption>쿼리 하나가 카탈로그와 Iceberg 메타데이터를 거쳐 파일에 닿는 순서</figcaption>
</figure>

Iceberg가 스키마와 파일 목록을 자기 메타데이터로 들고 있어서 크롤러로 스키마를 추론할 일이 없다. 상시 컨테이너 구성에서 크롤러가 빠진 이유다. 테이블은 Athena에서 한 번 만든다.

```sql
CREATE TABLE logs.app_logs (
  ts timestamp, level string, message string,
  environment string, service string, dt string, hour string)
PARTITIONED BY (environment, service, dt, hour)
LOCATION 's3://log-bucket/iceberg/app_logs/'
TBLPROPERTIES ('table_type' = 'ICEBERG');
```

Athena는 실행 시간이 아니라 읽은 바이트로 과금한다. 1TB당 5달러이고, MB 단위로 올림하며 쿼리마다 최소 10MB다. 파일을 거르는 기준이 `WHERE`의 파티션 조건이라 읽는 양도 그 조건이 정한다. 모드를 바꿔 가며 14시 로그 조회를 눌러, `dt`만 걸 때와 `hour`까지 걸 때 칠해지는 폴더 수를 비교한다.

<figure class="fig" data-figure="s3-log-system-scan">
  <figcaption>1시간을 조회할 때 읽는 시간 폴더 (폴더 하나 1GB로 가정)</figcaption>
</figure>

결과 행은 같은데 `dt`만 걸면 그날 24개 폴더를 다 읽어 24GB, `hour`까지 걸면 1GB다. 테이블에 `hour` 파티션이 있어도 쿼리가 그 조건을 걸지 않으면 매니페스트 단계에서 거를 근거가 없다. 대시보드가 필터 후보마다 쿼리를 따로 날리면 같은 범위를 필터 수만큼 반복해 읽으므로 `GROUP BY GROUPING SETS ((level), (service))`처럼 한 쿼리로 묶는다.

쿼리 설정과 한도를 묶는 단위인 워크그룹에 스캔 한도를 걸면 되지 않나 싶지만, 취소된 쿼리도 취소될 때까지 읽은 만큼 과금된다. 한도에 걸리면 결과는 없고 요금은 한도까지 나간다.

- 쿼리당 한도: 10MB 이상으로 정한다. 넘으면 그 쿼리를 취소한다.
- 워크그룹 전체 한도: 넘어도 쿼리를 취소하지 않고 CloudWatch 알람과 SNS 알림만 보낸다.

## 작은 파일과 파티션 스펙

상시 루프는 몇 초에 한 번꼴로 테이블에 덧붙인다(append). Iceberg의 커밋은 새 데이터 파일, 매니페스트, 스냅샷을 담은 `metadata.json`을 하나씩 만든다. 기본 목표 파일 크기 `write.target-file-size-bytes`는 512MB지만, 10초마다 커밋하면 10초 동안 들어온 로그만큼의 파일이 생긴다.

스캔 바이트는 그대로여도 파일이 많으면 쿼리마다 매니페스트 항목과 GET 요청이 늘어 느려진다. 아래 그림처럼 10초 커밋이면 하루 파티션에 8,640개가 쌓이고, `OPTIMIZE`를 여러 번 돌려야 시간 파티션마다 하나 남짓으로 준다.

<figure class="fig" data-figure="s3-log-system-small-files">
  <figcaption>하루 파티션의 파일 수와 OPTIMIZE 실행 (10초마다 커밋 가정)</figcaption>
</figure>

```sql
OPTIMIZE logs.app_logs REWRITE DATA USING BIN_PACK
WHERE dt = '20261102';
```

- `WHERE`에는 파티션 컬럼만 쓸 수 있고, 합치면서 읽은 바이트만큼 과금된다.
- 합친 뒤에도 옛 파일은 이전 스냅샷이 가리키고 있어 남는다. `VACUUM`이 `vacuum_max_snapshot_age_seconds`(기본 5일)보다 오래된 스냅샷을 만료시킬 때 지워진다.

Glue Data Catalog의 관리형 압축(table optimizer)은 전체 테이블을 계획하는 단계에서 실패해, `dt` 단위로 `OPTIMIZE`를 돌리는 별도 태스크를 뒀다.

- `ICEBERG_OPTIMIZE_MORE_RUNS_NEEDED`로 끝나면 실패가 아니라 남은 일이 있다는 뜻이다. 성공할 때까지 같은 문을 반복한다.
- 압축 자체가 스캔 한도에 걸리면 `dt`에서 `service`, `hour` 순으로 범위를 쪼갠다.

압축을 잘 돌려도 파일 수는 파티션 수 아래로 내려가지 않는다. 파티션마다 파일이 최소 하나는 있어야 해서, `hour`를 넣으면 서비스 3개에 하루 72칸이 생긴다. 아래 그림처럼 `hour`를 빼면 파일 수는 줄지만 1시간 조회가 하루치를 읽는다.

<figure class="fig" data-figure="s3-log-system-partition">
  <figcaption>hour가 있는 스펙과 없는 스펙의 하루 (서비스 3개)</figcaption>
</figure>

`hour`를 빼고 매니페스트의 `ts` 최솟값과 최댓값으로 건너뛰기를 기대할 수도 있다. 하지만 하루치를 한 파일로 합치면 그 파일의 `ts` 범위가 하루 전체라 걸러지지 않는다. 읽는 쪽은 잘게 자르길, 쓰는 쪽은 덜 자르길 원해서 같은 키를 반대로 당긴다.

스펙은 나중에 바꾸기도 어렵다. Iceberg의 파티션 진화(partition evolution)는 메타데이터만 바꾸고 이미 쓴 파일은 옛 스펙으로 둔다. Athena의 Iceberg DDL은 열 추가, 삭제, 변경만 다루고 파티션 스펙을 바꾸는 문은 없다.

새로 만든다면 `PARTITIONED BY (day(ts))`처럼 `ts`에서 파티션을 끌어내는 숨은 파티셔닝(hidden partitioning)으로 쿼리가 `ts` 조건만 걸어도 파티션을 거르게 한다.

## 정리

- Elasticsearch는 원문, 역색인, doc values에 복제본 1벌까지 늘 켜 둔 노드에 쓴다. 검색할 며칠치만 두고 ILM delete로 지운다.
- S3 원본은 저장은 싸지만 행 단위 JSON이라 조회에 불리해서, Parquet 기반 Iceberg 테이블로 변환한다.
- Glue 잡은 붙잡은 DPU 전체에 실행마다 최소 1분, 크롤러는 최소 10분을 낸다. Glue 이미지를 Fargate Spot에서 상시 루프로 돌려 고정분을 없앤다.
- 컨테이너에는 작업 북마크가 없다. `LastModified` 기준선은 멀티파트 업로드 시작 시각 때문에 경계에서 새므로, 되돌아보는 창과 객체 태그로 회수한다.
- Athena는 읽은 바이트로 낸다. 매니페스트에서 파일을 거르는 근거가 파티션 조건이라 `dt`와 `hour` 조건이 스캔량을 정하고, 취소된 쿼리도 읽은 만큼 낸다.
- 잦은 커밋은 작은 파일을 남긴다. `dt` 단위 `OPTIMIZE`를 성공할 때까지 반복하되, 파일 수 하한은 파티션 수라 스펙을 처음 정할 때 읽기와 쓰기를 같이 놓고 본다.

## 참고

- [Elastic: Index settings (number_of_replicas)](https://www.elastic.co/docs/reference/elasticsearch/index-settings/index-modules)
- [Elastic: Index lifecycle](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management/index-lifecycle)
- [Amazon S3: Lifecycle transition considerations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html)
- [Amazon S3: Object metadata (Last-Modified)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingMetadata.html)
- [Amazon S3: Data consistency model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel)
- [Amazon S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [Amazon EBS Pricing](https://aws.amazon.com/ebs/pricing/)
- [AWS Glue Pricing](https://aws.amazon.com/glue/pricing/)
- [AWS Glue: Develop and test jobs locally using a Docker image](https://docs.aws.amazon.com/glue/latest/dg/develop-local-docker-image.html)
- [AWS Glue: Tracking processed data using job bookmarks](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuations.html)
- [AWS Glue: Amazon S3 connection options (maxBand)](https://docs.aws.amazon.com/glue/latest/dg/aws-glue-programming-etl-connect-s3-home.html)
- [Amazon ECS: Fargate Spot termination notices](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)
- [Amazon Athena Pricing](https://aws.amazon.com/athena/pricing/)
- [Amazon Athena: Query Apache Iceberg tables](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg.html)
- [Amazon Athena: Create Iceberg tables (table properties, partition transforms)](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-creating-tables.html)
- [Amazon Athena: Optimize Iceberg tables (OPTIMIZE, VACUUM)](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg-data-optimization.html)
- [Amazon Athena: Workgroup data usage controls](https://docs.aws.amazon.com/athena/latest/ug/workgroups-setting-control-limits-cloudwatch.html)
- [Apache Iceberg: Performance (scan planning)](https://iceberg.apache.org/docs/latest/performance/)
- [Apache Iceberg: Partition evolution](https://iceberg.apache.org/docs/latest/evolution/)
- [Apache Iceberg: Configuration (write.target-file-size-bytes)](https://iceberg.apache.org/docs/latest/configuration/)
- 원글: [Elastic Search 데이터 삭제 정책 등록(ILM)](https://kimjanghyun1010.tistory.com/21)
