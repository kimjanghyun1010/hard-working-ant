---
title: Prometheus 모니터링
description: 주기마다 숫자를 가져가는 Prometheus가 그 사이의 몰림, 느린 꼬리 요청, 밖에서만 보이는 장애를 어떻게 잡고 알리고 오래 남기는지 스크레이프부터 Thanos까지 따라간다.
date: 2026-11-01 12:00:00 +0900
series: 인프라 운영
tags: [prometheus, monitoring, promql, alertmanager, thanos]
scripts: [figures/prometheus.js]
---

## 요약

- Prometheus는 주기마다 `/metrics`를 가져가 점을 찍고, 대상이 응답하지 않으면 `up` 0을 적는다. 점 사이의 일은 모른다.
- `up` 1은 `/metrics`가 응답했다는 뜻까지라, exporter는 마지막 성공 시각을 내보내고 사용자 쪽 장애는 blackbox로 밖에서 잰다.
- 점 사이의 사건은 Counter로 쌓아 rate로 읽고, rate는 범위 전체의 평균이다.
- 느린 꼬리는 Histogram 버킷으로 세어 p99로 읽는다. 버킷과 라벨은 시계열 수를 곱으로 늘린다.
- 알림은 `for`로 튐을 거르고 그만큼 늦게 알린다. Alertmanager가 묶고, 원인 알림으로 결과 알림을 막는다.
- 로컬 TSDB는 15일을 남기는 단일 노드 저장소라, Thanos로 블록을 객체 저장소에 올리고 해상도를 낮춰 오래 읽는다.

## 스크레이프

Prometheus가 아는 것은 주기마다 대상에게서 받아 적은 숫자뿐이다. 15초마다 찍힌 점들로 그 사이의 몰림, 소수의 느린 요청, 밖에서만 보이는 장애를 어떻게 잡아낼까?

Prometheus는 값을 받아 두지 않고 가지러 간다(pull). `scrape_interval`(기본 1분, 흔히 15초로 줄인다)마다 대상의 `/metrics`에 HTTP GET을 보내고, `scrape_timeout`(기본 10초) 안에 돌아온 텍스트를 시계열 DB(TSDB)에 시각과 함께 적는다. 이 한 번의 수집을 스크레이프(scrape)라고 한다.

```text
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="idle"} 8231.52
node_cpu_seconds_total{cpu="0",mode="user"} 912.07
```

중괄호 안의 `cpu="0"` 같은 이름과 값 쌍을 라벨(label)이라 하고, 지표 이름과 라벨 값이 모두 같은 줄이 시간에 따라 쌓인 것을 시계열(time series) 하나로 센다. 위 두 줄은 시계열 두 개다.

`/metrics`를 내주는 프로그램을 exporter라고 한다. OS나 드라이버가 세는 숫자를 이 형식으로 바꿔 준다. 리눅스 서버용 node_exporter는 커널이 숫자를 내놓는 `/proc`와 `/sys`를 읽는다.

아래 그림처럼 대상마다 한 칸씩 쌓인다.

<figure class="fig" data-figure="prometheus-scrape">
  <figcaption>15초마다 세 대상에서 값을 가져오는 스크레이프</figcaption>
</figure>

스크레이프마다 Prometheus는 대상이 내준 값 말고도 몇 가지 시계열을 스스로 적는다.

- `up`: 수집에 성공하면 1, 실패하면 0
- `scrape_duration_seconds`: 수집에 걸린 시간

가져가는 쪽이 Prometheus라서 대상이 죽은 것도 Prometheus가 먼저 안다. 대상이 값을 보내는(push) 방식이면 값이 안 올 때 대상이 죽은 것인지 보낼 게 없는 것인지 따로 가려야 한다. 다만 `up`이 1이어도 모든 게 정상이라는 뜻은 아니다.

## 수집 실패와 외부 프로브

`up`이 1이라는 것은 `/metrics`가 200을 돌려줬다는 뜻까지다. exporter가 값을 다른 곳에서 읽어 오는 구조라면 그 읽기가 실패해도 `/metrics`는 멀쩡히 응답한다. 큐에서 메시지를 꺼내 가는 컨슈머의 수를 RabbitMQ API로 읽어 내주는 exporter를 파이썬 라이브러리 `prometheus_client`로 만들면 이렇다.

```python
from prometheus_client import start_http_server, Gauge
import requests, time

consumers = Gauge('rabbitmq_queue_consumers', 'Consumers on the queue', ['queue'])
last_ok = Gauge('rabbitmq_poll_last_success_timestamp_seconds', 'Last successful poll')

def poll(queue):
    r = requests.get(f'{API}/queues/%2F/{queue}', auth=AUTH, timeout=5)
    r.raise_for_status()
    consumers.labels(queue).set(r.json()['consumers'])
    last_ok.set_to_current_time()

if __name__ == '__main__':
    start_http_server(8000)  # 데몬 스레드로 /metrics를 띄운다
    while True:
        try:
            poll('orders')
        except requests.RequestException as e:
            print(f'poll failed: {e}')
        time.sleep(10)
```

조회가 실패하면 Gauge는 직전 값을 그대로 내준다. 실제 컨슈머는 0인데 그래프는 5에서 평평하고, `up`도 1이다.

그래서 마지막 성공 시각을 같이 내보내고, 그 시각이 오래되면 PromQL(Prometheus의 조회 언어) 조건으로 알린다.

```promql
time() - rabbitmq_poll_last_success_timestamp_seconds > 60
```

안쪽 숫자가 전부 정상이어도 사용자는 못 들어올 수 있다. 인증서가 만료됐거나 Ingress(클러스터 밖 요청을 서비스로 나눠 주는 입구), DNS가 잘못되면 앱의 `/metrics`는 그대로 응답한다. blackbox exporter(9115)는 Prometheus가 `/probe?target=...&module=http_2xx`로 부르면 그 주소에 사용자처럼 HTTP, TCP, ICMP, DNS 요청을 보내고 결과를 지표로 돌려준다.

- `probe_success`: 성공 1, 실패 0
- `probe_http_status_code`: 응답 코드
- `probe_ssl_earliest_cert_expiry`: 인증서 만료 시각(유닉스 초)

아래 그림처럼 인증서가 만료되면 안쪽의 `up`과 바깥의 `probe_success`가 갈린다.

<figure class="fig" data-figure="prometheus-blackbox">
  <figcaption>안쪽 스크레이프와 바깥 프로브가 갈리는 순간</figcaption>
</figure>

대상 목록에는 사이트 주소를 적지만 실제로 요청을 보낼 곳은 blackbox exporter라서, 스크레이프 설정에서 주소를 옮겨 적는다(relabel).

```yaml
- job_name: blackbox-http
  metrics_path: /probe
  params:
    module: [http_2xx]
  static_configs:
    - targets: ['https://shop.example.com']
  relabel_configs:
    - source_labels: [__address__]
      target_label: __param_target         # 사이트 주소를 ?target= 으로
    - source_labels: [__param_target]
      target_label: instance               # 그래프에는 사이트 주소로
    - target_label: __address__
      replacement: blackbox-exporter:9115  # 요청은 blackbox로
```

알림은 `probe_success == 0`과 `probe_ssl_earliest_cert_expiry - time() < 86400 * 30` 두 가지로 시작해, 인증서 만료는 30일 전에 알린다.

## Counter와 rate

대상이 제대로 응답해도 Prometheus는 점과 점 사이에서 일어난 일을 모른다. 받는 것은 스크레이프 순간의 숫자라서, 숫자의 종류에 따라 점 사이의 일이 남기도 하고 사라지기도 한다.

- Gauge: 지금 값. 올라가고 내려간다. 큐 길이, 메모리 사용량.
- Counter: 지금까지 쌓인 값. 늘기만 하고 프로세스가 재시작할 때만 0으로 돌아간다. 처리한 요청 수, 보낸 바이트 수.

아래 데모에서 모드를 바꿔 가며 요청 몰리게 하기를 누르고, 15초와 30초 수집 사이의 9초짜리 몰림이 아래 그래프에 남는지 비교한다.

<figure class="fig" data-figure="prometheus-gauge-counter">
  <figcaption>같은 요청을 Gauge와 Counter로 내보냈을 때 남는 값</figcaption>
</figure>

"지난 1초 요청 수"를 Gauge로 내보내면 15초와 30초에 찍힌 값이 둘 다 평소 수준이라 몰림이 없다. Counter로 내보내면 두 수집 사이에 늘어난 양이 다음 값에 그대로 실려, 초당 증가량으로 바꾸면 그 구간이 솟는다. Gauge는 **수집 순간의 값**만 넘기고, Counter는 지난 수집 뒤로 쌓인 양을 놓치지 않는다.

Counter는 기울기로 읽는다. `rate()`는 범위 안 샘플의 증가량을 초로 나눠 초당 증가량을 낸다. 범위 양 끝에 샘플이 딱 맞지 않으므로 범위 끝까지 늘려 잡아(extrapolation) 계산하고, 값이 줄어든 지점은 재시작으로 보고 이어 붙인다.

```promql
rate(http_requests_total{job="api"}[5m])
```

범위 안에는 샘플이 두 개 이상 있어야 해서, 대시보드 도구 Grafana의 `$__rate_interval`은 범위를 수집 주기의 4배 이상으로 잡는다.

여러 시계열을 합칠 때는 `sum(rate(...))`처럼 rate를 먼저 한다. rate는 값이 조금이라도 줄면 재시작으로 보기 때문이다. 먼저 합치면 시계열 하나가 재시작해 합계가 1,000에서 600으로 줄었을 때, rate는 합계 전체가 0부터 다시 600까지 센 것으로 보고 600을 통째로 증가량에 더해 가짜 급등을 그린다.

[CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %})의 CPU 사용률도 idle 시간 Counter의 rate를 1에서 뺀 값이다.

rate 값은 범위 전체의 평균이다. `[5m]`이면 9초 동안 초당 90건 늘어난 몰림(810건)이 300초에 퍼져 초당 2.7건 오른 것으로만 보인다. 범위를 줄이면 몰림이 살아나지만, 15초 수집에서 `[30s]` 아래로 내리면 샘플이 두 개가 안 돼 값이 빈다. 응답 시간도 평균 내면 소수의 느린 요청이 묻힌다.

## Histogram

평균 응답 시간이 0.12초여도 100건 중 1건이 1초 가까이 걸릴 수 있다. 이런 꼬리는 백분위수로 본다. p99는 요청을 빠른 순으로 줄 세웠을 때 99% 지점의 값이다.

Histogram은 응답 시간을 구간(bucket)별로 세어 두고, 조회할 때 백분위수를 계산하게 해 준다. Histogram 하나는 Counter 여러 개로, 버킷마다 "이 값 이하인 요청 수"를 누적해서 센다.

```text
http_request_duration_seconds_bucket{le="0.1"}  700
http_request_duration_seconds_bucket{le="0.25"} 900
http_request_duration_seconds_bucket{le="0.5"}  970
http_request_duration_seconds_bucket{le="1"}    995
http_request_duration_seconds_bucket{le="+Inf"} 1000
http_request_duration_seconds_sum   118.5
http_request_duration_seconds_count 1000
```

0.31초 걸린 요청은 `le="0.5"`, `le="1"`, `le="+Inf"` 세 버킷을 하나씩 올린다. 아래 그림처럼 99% 선은 0.5초와 1초 버킷 사이에 걸린다(요청 1,000건은 설명용 값이다).

<figure class="fig" data-figure="prometheus-histogram">
  <figcaption>응답 시간 버킷과 p99</figcaption>
</figure>

`histogram_quantile`은 버킷 안에 요청이 고르게 퍼져 있다고 보고 선형으로 나눈다. 990번째 요청은 0.5초 버킷(970건)과 1초 버킷(995건) 사이 25건 중 20번째라서 0.5 + 0.5 × 20/25 = 0.9초로 계산한다.

```promql
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

버킷 경계 사이는 추정값이다. Prometheus 문서의 예에서는 요청이 220ms 근처에 몰려 있는데, 200~300ms 버킷에 걸린 p95를 295ms로 계산한다.

백분위수가 `+Inf` 버킷에 걸리면 바로 아래 경계값이 답으로 나와, 1초를 넘는 요청은 얼마나 느린지 알 수 없다. 그래서 경계는 목표 응답 시간(예: 0.3초) 근처에 촘촘히 둔다.

앱이 p99를 직접 계산해 내주는 Summary는 파드 셋의 p99를 평균 내도 전체 p99가 되지 않는다. Histogram은 버킷 개수를 더한 뒤 계산해 여러 파드의 p99를 낸다.

대가는 시계열 수다. 라벨 값 조합 하나가 시계열 하나이고, 위 Histogram은 조합마다 7개(버킷 5개, sum, count)를 만든다. 경로 20개, 상태 코드 5개, 파드 3개면 300개 조합이라 2,100개가 된다. 요청 ID나 사용자 ID처럼 값이 끝없는 것을 라벨로 붙이면 안 되는 이유가 이것이다.

p99가 목표를 넘어도 Prometheus는 그 값을 TSDB에 적을 뿐 아무도 부르지 않는다.

## 알림 규칙과 Alertmanager

사람을 부르는 일은 둘로 나뉜다. Prometheus가 규칙을 평가해 알림을 만들고, Alertmanager가 받아 Slack 같은 곳으로 보낸다.

알림 규칙은 PromQL 조건 하나와 `for` 하나이고, Prometheus는 규칙을 `evaluation_interval`(기본 1분)마다 평가한다. 조건이 처음 참이 되면 대기 상태(pending), `for` 동안 평가마다 계속 참이면 발생 상태(firing)가 되어 Alertmanager로 간다.

{% raw %}
```yaml
groups:
  - name: api
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{code=~"5.."}[5m]))
            / sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "오류율 {{ $value | humanizePercentage }}"
```
{% endraw %}

아래 데모에서 for 없음과 for 5m을 바꿔 가며 30분 재생하기를 누르고, 2분짜리 튐과 10분짜리 장애에 Slack 알림이 몇 개, 언제 오는지 비교한다.

<figure class="fig" data-figure="prometheus-for">
  <figcaption>for가 없을 때와 5분일 때 같은 오류율에서 오는 알림</figcaption>
</figure>

for가 없으면 2분짜리 튐에도 발생과 해소 알림이 오고, for 5m을 두면 튐은 pending에서 끝나는 대신 장애도 5분 늦게 알린다. for는 튐을 거르는 만큼 **진짜 장애도 늦게** 알리므로, 그만큼 이어지면 사람이 움직여야 하는 시간으로 정한다.

Prometheus는 규칙마다 따로 알림을 만든다. 노드 여덟 대가 물린 스위치가 죽으면 HostDown 알림이 여덟 개다. Alertmanager는 이 알림을 받아 묶고, 기다리고, 받을 곳을 골라 보낸다.

- `group_by`: 같은 라벨 값을 가진 알림을 한 메시지로 묶는다.
- `group_wait`(기본 30초): 새 묶음의 첫 알림이 오면 같은 묶음이 더 올 때까지 기다렸다 보낸다.
- `repeat_interval`(기본 4시간): 해결되지 않은 알림을 다시 보내는 간격이다.

아래 그림처럼 HostDown 여덟 개는 메시지 하나가 되고, 인증서 알림은 경로 규칙에 따라 다른 채널로 간다.

<figure class="fig" data-figure="prometheus-alertmanager">
  <figcaption>알림을 묶고 경로를 골라 보내는 Alertmanager</figcaption>
</figure>

```yaml
route:
  receiver: slack-default
  group_by: [alertname, cluster]
  routes:
    - matchers: ['alertname =~ "CertExpiringSoon|CertExpired"']
      receiver: slack-cert
      repeat_interval: 168h
inhibit_rules:
  - source_matchers: ['alertname = "SwitchDown"']
    target_matchers: ['alertname = "HostDown"']
    equal: [rack]
receivers:
  - name: slack-default
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack-default
        send_resolved: true
  - name: slack-cert
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack-cert
```

`inhibit_rules`는 원인 알림이 떠 있는 동안 그 결과 알림을 막는다. 위 설정이면 SwitchDown이 뜬 랙의 HostDown은 보내지 않아, 원인인 스위치 알림만 남는다.

## TSDB와 장기 보관

알림 규칙과 rate는 Prometheus 자기 디스크의 데이터로 계산한다. 들어오는 샘플은 메모리의 head 블록에 쌓이고, 장애에 대비해 먼저 WAL(write-ahead log) 파일에 적힌다. 2시간마다 head가 디스크 블록 하나로 굳는다.

보관 기간은 기본 15일이고, 샘플 하나는 평균 1~2바이트다. 필요한 디스크는 이렇게 어림한다.

```text
디스크 = 보관 초 × 초당 샘플 수 × 샘플당 바이트
       = 1,296,000 (15일) × 13,333 (시계열 20만 개를 15초마다) × 2
       ≈ 35GB
```

로컬 저장소는 묶이지도 복제되지도 않아서, 디스크 하나에 15일만 남고 두 클러스터를 한 그래프에 그릴 수도 없다. Thanos는 완성된 2시간 블록을 S3 같은 객체 저장소(용량 걱정 없이 파일을 쌓는 저장소)로 올리고, 여러 Prometheus와 저장소를 하나처럼 조회하게 한다.

- sidecar: Prometheus 옆에서 블록을 올리고, 최근 데이터 조회에 답한다.
- store gateway: 객체 저장소의 블록으로 답한다.
- query: 둘의 결과를 합치고 중복을 지운다.
- compactor: 블록을 합치고 해상도를 낮춘 사본을 만든다(다운샘플링). 동시 실행에 안전하지 않아 하나만 띄운다.

아래 그림처럼 query는 최근 구간은 sidecar에, 그 이전은 store gateway에 묻는다.

<figure class="fig" data-figure="prometheus-thanos">
  <figcaption>두 클러스터의 Prometheus와 Thanos</figcaption>
</figure>

sidecar를 붙이면 Prometheus의 블록 크기 하한과 상한(`--storage.tsdb.min-block-duration`, `max-block-duration`)을 둘 다 2h로 맞춘다. Prometheus가 스스로 블록을 합치면 이미 올린 블록과 겹쳐 compactor가 다루는 데이터가 깨질 수 있어서다.

각 Prometheus에는 `external_labels`(예: `cluster: sub-1`)로 이름표를 단다. 이 값이 전체 Thanos 안에서 고유해야 query가 어느 클러스터의 데이터인지 가른다.

15초 원본이면 시계열 하나가 1년에 약 210만 개 샘플이라 1년 그래프가 열리지 않는다. compactor는 40시간이 지난 원본에서 5분 해상도 사본을, 10일이 지난 5분 해상도에서 1시간 해상도 사본을 만든다. 1시간 해상도면 1년이 8,760개다.

다운샘플링은 공간을 줄이지 않는다. 원본 옆에 사본이 둘 더 생겨 최대 3배까지 늘고, 공간은 해상도별 보관 기간으로 줄인다.

```text
--retention.resolution-raw=30d
--retention.resolution-5m=180d
--retention.resolution-1h=2y
```

원본을 30일만 두면 그보다 오래된 구간은 5분보다 자세히 볼 수 없으니, 보관 기간은 얼마나 오래 전까지 몇 분 단위로 볼 일이 있는지로 정한다.


## 참고

- [Prometheus — Overview](https://prometheus.io/docs/introduction/overview/)
- [Prometheus — FAQ (pull과 push)](https://prometheus.io/docs/introduction/faq/)
- [Prometheus — Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [Prometheus — Jobs and instances (up, scrape_*)](https://prometheus.io/docs/concepts/jobs_instances/)
- [Prometheus — Metric types](https://prometheus.io/docs/concepts/metric_types/)
- [Prometheus — Query functions (rate, histogram_quantile)](https://prometheus.io/docs/prometheus/latest/querying/functions/)
- [Prometheus — Histograms and summaries](https://prometheus.io/docs/practices/histograms/)
- [Prometheus — Metric and label naming](https://prometheus.io/docs/practices/naming/)
- [Prometheus — Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus — Storage](https://prometheus.io/docs/prometheus/latest/storage/)
- [Alertmanager — Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [Grafana — Prometheus template variables ($__rate_interval)](https://grafana.com/docs/grafana/latest/datasources/prometheus/template-variables/)
- [client_python](https://prometheus.github.io/client_python/)
- [blackbox_exporter](https://github.com/prometheus/blackbox_exporter)
- [windows_exporter](https://github.com/prometheus-community/windows_exporter)
- [Thanos — Sidecar](https://thanos.io/tip/components/sidecar.md/)
- [Thanos — Compactor](https://thanos.io/tip/components/compact.md/)
- [Thanos — Querier](https://thanos.io/tip/components/query.md/)
- 원글: [Prometheus Client](https://kimjanghyun1010.tistory.com/69), [blackbox exporter 배포 및 alertmanager slack 설정](https://kimjanghyun1010.tistory.com/50), [Prometheus (Windows exporter)](https://kimjanghyun1010.tistory.com/56), [GPU Exporter (/w windows)](https://kimjanghyun1010.tistory.com/96), [Prometheus Loki](https://kimjanghyun1010.tistory.com/62), [Thanos](https://kimjanghyun1010.tistory.com/66)
