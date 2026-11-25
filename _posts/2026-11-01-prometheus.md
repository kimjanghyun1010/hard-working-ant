---
title: Prometheus 모니터링
description: Prometheus가 메트릭을 가져가는 방식부터 메트릭 타입과 rate, exporter, 알림, Loki 로그, Thanos 장기 보관까지 정리했다.
date: 2026-11-01 12:00:00 +0900
series: 인프라 운영
tags: [prometheus, monitoring, alertmanager, loki, thanos]
scripts: [figures/prometheus.js]
---

## 스크레이프

새벽에 서버 하나가 멈췄는데 아침에 고객 문의를 받고서야 알았다. 이런 일을 막으려면 숫자를 꾸준히 모으고, 숫자가 선을 넘으면 사람을 부르고, 원인을 찾을 로그와 지난 기록을 남겨야 한다. Prometheus는 이 중 숫자를 모으는 일을 맡는다.

Prometheus는 값을 받아 두지 않고 가지러 간다(pull). 정해 둔 주기(`scrape_interval`, 기본 1분)마다 대상의 `/metrics` 주소에 HTTP 요청을 보내고, 돌아온 텍스트를 시계열 DB(TSDB)에 시각과 함께 적는다. 이 한 번의 수집을 스크레이프(scrape)라고 한다.

```text
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="idle"} 8231.52
node_cpu_seconds_total{cpu="0",mode="user"} 912.07
```

`/metrics`를 내주는 프로그램을 exporter라고 한다. 앱이 직접 내주기도 하고, OS나 장비의 숫자를 읽어 대신 내주는 프로그램을 따로 띄우기도 한다.

아래 그림은 Prometheus가 15초마다 세 대상을 돌며 값을 가져오는 모습이다. 두 번째 장면에서 가운데 대상이 응답하지 않을 때 TSDB에 무엇이 남는지 본다.

<figure class="fig" data-figure="prometheus-scrape">
  <figcaption>15초마다 세 대상에서 값을 가져오는 스크레이프</figcaption>
</figure>

가져가는 쪽이 Prometheus라서 대상이 죽은 것도 Prometheus가 먼저 안다. 스크레이프가 실패하면 그 대상의 `up`이 0으로 적힌다. 대상이 값을 보내는 방식(push)이었다면 "값이 안 온다"가 대상이 죽은 것인지 보낼 게 없는 것인지 따로 가려야 한다.

대상은 Prometheus 설정에 적어야 수집된다. kube-prometheus-stack을 쓰면 차트 값에 잡(job)을 얹는다.

```yaml
prometheus:
  prometheusSpec:
    additionalScrapeConfigs:
      - job_name: rabbitmq-consumer
        static_configs:
          - targets: ['consumer-count.default.svc:8000']
```

이 값은 오퍼레이터가 만든 설정 뒤에 검증 없이 그대로 덧붙는다. 오타 하나로 잡이 통째로 빠질 수 있다. 클러스터 안의 서비스는 ServiceMonitor로 등록하면 라벨로 대상을 찾아 준다.

새 대상을 붙였으면 Targets 화면이나 `up{job="..."}`에서 1인지부터 본다.

## 메트릭 타입

### Gauge와 Counter

대시보드의 초당 요청 그래프는 평평한데, 같은 시각 로드밸런서 로그에는 요청이 몰린 흔적이 있다. 숫자를 Gauge로 내보냈는지 Counter로 내보냈는지에 따라 생기는 차이다.

- Gauge: 지금 값. 올라가고 내려간다. 큐 길이, 메모리 사용량, 컨슈머 수.
- Counter: 지금까지 쌓인 값. 늘기만 하고 프로세스가 재시작할 때만 0으로 돌아간다. 처리한 요청 수, 보낸 바이트 수.

Prometheus 문서는 줄어들 수 있는 값에 Counter를 쓰지 말라고 적어 두었다. 반대로 "지난 1초 요청 수"처럼 순간마다 바뀌는 값을 Gauge로 내보내면, 스크레이프 순간의 값만 남고 그 사이에 일어난 일은 사라진다.

아래 데모에서 요청을 몰리게 해 보자. 모드를 바꿔 가며 15초와 30초 수집 사이에 생긴 몰림이 아래 그래프에 남는지 본다.

<figure class="fig" data-figure="prometheus-gauge-counter">
  <figcaption>같은 요청을 Gauge와 Counter로 내보냈을 때 남는 값</figcaption>
</figure>

Gauge로 내보내면 15초와 30초에 찍힌 값이 둘 다 평소 수준이라 몰림이 그래프에 없다. Counter로 내보내면 두 수집 사이에 늘어난 양이 그대로 남아, 초당 증가량으로 바꾸면 그 구간이 솟는다. 요청은 똑같이 들어왔고 바뀐 건 **내보낸 숫자의 종류**뿐이다.

Counter로 본 값도 15초 구간의 평균이라, 9초짜리 몰림이 실제보다 낮고 넓게 보인다. 짧은 몰림을 더 자세히 보려면 스크레이프 주기를 줄인다.

셀 수 있는 사건(요청, 오류, 바이트)은 Counter로, 지금 상태(큐 길이, 연결 수)는 Gauge로 내보낸다.

### rate

Counter 그래프는 오른쪽 위로 올라가는 선 하나라서 값 자체로는 읽을 게 없다. 읽을 것은 기울기다. `rate()`는 범위 안 샘플의 증가량을 초로 나눠 초당 증가량을 낸다.

```promql
rate(http_requests_total{job="api"}[5m])
```

아래 그림에서 위는 Counter 값, 아래는 rate다. 두 번째 장면에서 앱이 재시작해 Counter가 0으로 떨어지는 순간 아래 선이 어떻게 되는지 본다.

<figure class="fig" data-figure="prometheus-rate">
  <figcaption>Counter 값과 rate</figcaption>
</figure>

rate는 값이 줄어든 지점을 재시작으로 보고 보정해서 이어 계산한다. 그냥 앞 값을 빼면 재시작 순간에 큰 음수가 나온다. 그래서 Counter는 빼서 쓰지 않고 `rate`나 `increase`로 읽는다.

범위에는 샘플이 두 개 이상 들어가야 한다. Grafana의 `$__rate_interval`은 스크레이프 주기의 4배 이상을 잡는다. 여러 시계열을 합칠 때는 rate를 먼저 하고 sum을 나중에 한다. 합친 뒤에는 시계열 하나가 재시작한 것을 알아챌 수 없기 때문이다.

```promql
sum by (job) (rate(http_requests_total[5m]))   # rate 먼저
rate(sum by (job) (http_requests_total)[5m:])  # 재시작을 못 본다
```

[CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %})의 CPU 사용률도 같은 계산이다. `node_cpu_seconds_total`은 모드별로 보낸 시간을 쌓는 Counter라서, idle의 rate가 CPU가 쉰 비율이다.

```promql
1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))
```

Counter는 값이 아니라 rate로 읽고, 합칠 때는 rate 다음에 sum을 한다.

### Histogram

평균 응답 시간은 0.12초로 멀쩡한데 느리다는 문의가 온다. 평균은 소수의 느린 요청을 묻어 버린다. Histogram은 응답 시간을 구간(bucket)별로 세어 두고, 조회할 때 백분위수를 계산하게 해 준다.

Histogram 하나는 Counter 여러 개다. 버킷마다 "이 값 이하인 요청 수"를 누적해서 센다.

```text
http_request_duration_seconds_bucket{le="0.1"}  700
http_request_duration_seconds_bucket{le="0.25"} 900
http_request_duration_seconds_bucket{le="0.5"}  970
http_request_duration_seconds_bucket{le="1"}    995
http_request_duration_seconds_bucket{le="+Inf"} 1000
http_request_duration_seconds_sum   118.5
http_request_duration_seconds_count 1000
```

0.3초 걸린 요청은 `le="0.5"`, `le="1"`, `le="+Inf"` 세 버킷을 모두 하나씩 올린다. 아래 그림에서 요청이 버킷을 채우는 모습과, 99% 선이 어느 버킷에 걸리는지 본다.

<figure class="fig" data-figure="prometheus-histogram">
  <figcaption>응답 시간 버킷과 p99</figcaption>
</figure>

1,000건 중 990번째 요청은 970건까지 찬 0.5초 버킷과 995건까지 찬 1초 버킷 사이에 있다. `histogram_quantile`은 요청이 그 버킷 안에 고르게 퍼져 있다고 보고 0.9초로 계산한다. 버킷 경계 사이는 추정값이라, 경계는 목표 응답 시간(예: 0.5초) 근처에 촘촘하게 둔다.

```promql
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

그림의 요청 1,000건은 설명을 위해 만든 값이다. 응답 시간은 평균이 아니라 p95, p99로 읽는다.

## 메트릭 내보내기

### 앱 직접 계측

RabbitMQ 큐에 컨슈머가 몇 개 붙어 있는지 대시보드에서 보고 싶은데, 그 숫자를 내주는 exporter가 없다. 이럴 때는 client 라이브러리로 직접 만든다. Python은 `prometheus_client`, Go는 `client_golang`이 공식 라이브러리다.

exporter가 할 일은 지금 값을 들고 있다가 물어보면 내주는 것뿐이다. `start_http_server`는 데몬 스레드로 HTTP 서버를 띄우므로, 본 코드는 자기 루프를 그대로 돈다. 컨슈머 수는 줄어들 수 있으니 Gauge다.

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
    start_http_server(8000)
    while True:
        try:
            poll('orders')
        except requests.RequestException as e:
            print(f'poll failed: {e}')
        time.sleep(10)
```

여기에는 주기가 둘 있다. exporter가 RabbitMQ를 묻는 주기와 Prometheus가 `/metrics`를 긁는 주기는 따로 돈다.

아래 그림은 exporter가 10초마다 묻고 Prometheus가 30초마다 긁는 1분이다. 컨슈머 수가 바뀐 순간부터 Prometheus에 찍히기까지 얼마나 걸리는지 본다.

<figure class="fig" data-figure="prometheus-client">
  <figcaption>exporter의 조회 주기와 Prometheus의 수집 주기</figcaption>
</figure>

12초에 바뀐 값은 20초 조회에서 Gauge에 들어가고, 30초 수집에서야 Prometheus에 찍힌다. 값이 조회 직후에 바뀌고 수집이 조회 직전에 일어나면 두 주기를 더한 40초까지 늦을 수 있다.

조회가 실패하면 Gauge는 직전 값을 그대로 내준다. 실제 컨슈머는 0인데 그래프는 5에서 평평하고, 평평한 선만 보고는 "안 변한 것"과 "못 읽은 것"을 가를 수 없다. 그래서 위 코드는 마지막 성공 시각을 같이 내보내고, 그 시각이 오래되면 알린다.

```promql
time() - rabbitmq_poll_last_success_timestamp_seconds > 60
```

직접 만든 exporter는 값과 함께 마지막으로 값을 읽은 시각을 내보낸다.

### 서버와 GPU exporter

GPU 서버에서 학습이 멈췄는데 앱 로그와 컨테이너부터 뒤지다가 한참 뒤에야 드라이버 오류를 찾는다. OS와 드라이버의 숫자를 미리 모아 두면 이런 장애를 가장 아래층부터 바로 확인할 수 있다.

Linux 서버는 node_exporter, Windows 서버는 windows_exporter, GPU는 GPU exporter를 띄운다. 셋 다 하는 일은 같다. OS나 드라이버가 이미 세고 있는 숫자를 읽어 `/metrics` 형식으로 바꾼다.

세 장면에서 각 exporter가 어디서 읽어 무엇으로 내주는지 본다.

<figure class="fig" data-figure="prometheus-exporters">
  <figcaption>OS와 드라이버의 숫자를 /metrics로 바꾸는 exporter</figcaption>
</figure>

- node_exporter(9100): `/proc`와 `/sys`를 읽는다. CPU 사용 시간은 앞에서 본 `node_cpu_seconds_total`이다.
- windows_exporter(9182): Windows 성능 카운터와 WMI를 읽는다. 0.31에서 `cs` 수집기가 빠져서, 호스트 이름은 `windows_os_hostname`, 전체 메모리는 `windows_memory_physical_total_bytes`로 본다.
- dcgm-exporter(9400): NVIDIA DCGM으로 GPU 온도, 사용률, XID 오류를 읽는다. DCGM이 Linux만 지원해서 Kubernetes와 Linux 서버에서 쓴다.
- nvidia_gpu_exporter(9835): NVML이나 `nvidia-smi`로 읽는다. Linux와 Windows에서 모두 돈다.

windows_exporter는 MSI로 설치하면서 수집기를 고른다.

```powershell
msiexec /i windows_exporter-0.32.1-amd64.msi --% ENABLED_COLLECTORS="cpu,memory,logical_disk,net,os,service,system" LISTEN_PORT=9182
```

서버가 꺼지면 그 서버의 지표가 전부 사라져 호스트 이름도 같이 없어진다. 알림에 호스트 이름을 남기려면 마지막으로 본 이름을 `up`에 붙인다.

```promql
up{job="windows"} == 0
  * on (instance) group_left (hostname) last_over_time(windows_os_hostname[1d])
```

GPU는 exporter가 드라이버를 읽지 못하는 것 자체가 신호다. 드라이버가 내려가거나 GPU가 버스에서 떨어지면 온도와 사용률이 전부 비어 버린다. nvidia_gpu_exporter는 이 상태를 `nvidia_smi_nvml_return_code`(기본 NVML 방식)나 `nvidia_smi_command_exit_code`(`nvidia-smi` 방식)로 내주고, 0이 아니면 읽기에 실패한 것이다. dcgm-exporter는 마지막 XID 오류 번호를 `DCGM_FI_DEV_XID_ERROR`로 내준다.

exporter를 새로 붙이면 수집 실패를 나타내는 지표(`up`, 종료 코드)에 먼저 알림을 건다.

### 외부 프로브

파드는 전부 Running이고 `up`도 1인데 사용자는 사이트에 못 들어온다. 인증서가 만료됐거나 Ingress, DNS가 잘못된 경우다. 안에서 긁은 숫자로는 보이지 않으니 사용자처럼 밖에서 요청을 보내 봐야 한다.

blackbox exporter는 Prometheus가 `/probe?target=...`으로 부르면 그 대상에 HTTP, TCP, ICMP, DNS 요청을 보내고 결과를 지표로 돌려준다.

- `probe_success`: 성공 1, 실패 0
- `probe_duration_seconds`: 걸린 시간
- `probe_http_status_code`: 응답 코드
- `probe_ssl_earliest_cert_expiry`: 인증서 만료 시각(유닉스 초)

두 장면에서 안쪽 스크레이프와 바깥 프로브의 결과가 언제 갈리는지 본다.

<figure class="fig" data-figure="prometheus-blackbox">
  <figcaption>blackbox exporter가 밖에서 사이트를 재는 흐름</figcaption>
</figure>

프로브가 Ingress를 지나 앱까지 가서 200을 받아 오면 `probe_success`는 1이다. 인증서가 만료되면 앱은 멀쩡해서 `up`은 1인데, 프로브는 TLS 연결에서 실패해 0이 된다.

스크레이프 설정에는 주소를 옮기는 relabel이 필요하다. 대상 목록에는 사이트 주소를 적지만, 실제로 요청을 보낼 곳은 blackbox exporter이기 때문이다.

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

Prometheus Operator를 쓰면 같은 내용을 `Probe` 리소스로 적는다. 알림은 실패와 인증서 만료 두 가지면 시작하기에 충분하다.

```yaml
- alert: ProbeFailed
  expr: probe_success == 0
  for: 5m
- alert: CertExpiringSoon
  expr: probe_ssl_earliest_cert_expiry - time() < 86400 * 30
  for: 10m
```

프로브 주기는 사용자가 겪는 장애를 몇 분 안에 잡도록 30초에서 1분으로 둔다. 서비스마다 바깥 주소 하나씩 프로브를 걸고, 인증서 만료는 30일 전에 알린다.

## 알림

### 알림 규칙과 for

오류율이 1분 튀었다 내려갔는데 Slack에 알림이 두 개(발생, 해소) 왔다. 이런 알림이 하루 수십 개면 사람들은 채널을 음소거하고, 진짜 장애도 같이 묻힌다.

알림 규칙은 PromQL 조건 하나와 `for` 하나다. Prometheus는 규칙을 `evaluation_interval`(기본 1분)마다 평가한다. 조건이 처음 참이 되면 pending, `for` 동안 계속 참이면 firing이 되어 Alertmanager로 간다.

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

아래 데모는 30분 동안 오류율이 2분 튄 뒤 10분짜리 장애가 오는 상황이다. 모드를 바꿔 가며 Slack 줄에 알림이 몇 개 쌓이는지, 장애 알림이 언제 오는지 본다.

<figure class="fig" data-figure="prometheus-for">
  <figcaption>for가 없을 때와 5분일 때 같은 오류율에서 오는 알림</figcaption>
</figure>

for가 없으면 2분짜리 튐에도 발생과 해소 알림이 오고, 장애는 바로 알린다. for 5m을 두면 튐은 pending에서 끝나 조용하고, 장애는 5분 늦게 알린다. 오류율 선은 같고 바뀐 건 **얼마나 지속돼야 사람을 부르는지**뿐이다.

for는 "이만큼 이어지면 사람이 움직여야 한다"는 시간으로 정한다. 조건이 잠깐 풀렸다 다시 걸리며 해소와 발생이 반복되는 알림에는 `keep_firing_for`로 firing을 잠시 더 유지한다.

### Alertmanager

노드 스무 대가 물린 스위치가 죽으면 Prometheus는 HostDown 알림을 스무 개 만든다. 그대로 보내면 Slack에 메시지 스무 개가 쏟아지고, 정작 원인인 스위치 알림은 그 사이에 묻힌다. Alertmanager는 Prometheus가 보낸 알림을 받아 묶고, 기다리고, 경로를 골라 보낸다.

- 묶기(`group_by`): 같은 라벨 값을 가진 알림을 한 메시지로 묶는다.
- 기다리기(`group_wait`, 기본 30초): 묶음의 첫 알림이 오면 같은 묶음이 더 올 때까지 기다렸다가 보낸다.
- 경로(`routes`): 라벨을 보고 받을 곳(receiver)을 고른다.
- 반복(`repeat_interval`, 기본 4시간): 해결되지 않은 알림을 다시 보내는 간격이다.

두 장면에서 알림 여덟 개가 메시지 몇 개가 되는지, 인증서 알림이 어느 채널로 가는지 본다.

<figure class="fig" data-figure="prometheus-alertmanager">
  <figcaption>알림을 묶고 경로를 골라 보내는 Alertmanager</figcaption>
</figure>

노드 8대의 HostDown은 30초 안에 들어와 `alertname`이 같은 한 묶음이 되고 메시지 하나로 나간다. 인증서 알림은 경로 규칙에 걸려 인증서 채널로 가고, 해결될 때까지 일주일에 한 번만 다시 온다.

```yaml
route:
  receiver: slack-default
  group_by: [alertname, cluster]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: ['alertname =~ "CertExpiringSoon|CertExpired"']
      receiver: slack-cert
      repeat_interval: 168h
receivers:
  - name: slack-default
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack-default
        send_resolved: true
  - name: slack-cert
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack-cert
        send_resolved: true
```

경로 조건의 `match`는 폐기 예정이라 `matchers`로 쓴다. Slack 웹훅 주소는 비밀값이라 설정에 직접 적지 않고 `api_url_file`로 읽는다. 받는 곳은 채널 단위로 나누고, 메시지 양식은 템플릿 하나를 같이 쓴다.

알림이 너무 많으면 규칙을 고치기 전에 `group_by`부터 본다.

## 로그

### Loki 구조

메트릭으로는 "5시 3분에 오류율이 올랐다"까지 안다. 왜 올랐는지는 그 시각의 로그를 봐야 한다. Loki는 메트릭과 같은 Grafana 화면에서 같은 라벨로 로그를 찾게 해 주는 로그 저장소다.

Loki는 로그 본문을 색인하지 않는다. 라벨(`job`, `namespace`, `host`)만 색인하고, 같은 라벨 조합의 로그 줄을 스트림(stream) 하나로 묶어 압축한 청크(chunk)로 객체 저장소에 쌓는다. 본문 검색은 조회할 때 해당 스트림의 청크를 병렬로 훑어서 한다. 모든 단어를 색인하는 Elasticsearch보다 저장과 운영이 가볍다.

| 구성 요소 | 하는 일 |
|---|---|
| 수집기 (Alloy) | 파일, 파드 로그, Windows 이벤트를 읽어 라벨을 붙여 보낸다 |
| gateway | 쓰기와 읽기 요청을 맞는 구성 요소로 나눠 보내는 nginx |
| distributor | 받은 로그를 검사하고 스트림별로 ingester에 나눠 보낸다 |
| ingester | 스트림마다 청크를 메모리에서 채우다가 차면 객체 저장소로 내린다 |
| query frontend | 긴 조회를 시간 구간으로 쪼개고 결과를 캐시한다 |
| querier | ingester의 최근 로그와 객체 저장소의 청크를 읽어 답한다 |

아래 그림의 첫 장면은 로그 한 줄이 객체 저장소까지 가는 길, 두 번째 장면은 조회 하나가 쪼개져 돌아오는 길이다.

<figure class="fig" data-figure="prometheus-loki">
  <figcaption>Loki의 쓰기 경로와 읽기 경로</figcaption>
</figure>

로그 줄은 ingester 메모리의 청크를 채우고, 청크가 차거나 오래되면 객체 저장소로 내려간다. 하루짜리 조회는 query frontend가 구간으로 쪼개 querier들이 나눠 읽고, 아직 내려가지 않은 최근 구간은 ingester에서 읽는다.

지금 설치한다면 세 가지가 예전과 다르다.

- 수집기: Promtail은 2026년 3월 2일에 지원이 끝났다. Grafana Alloy를 쓰고, 기존 설정은 `alloy convert --source-format=promtail`로 옮긴다. Windows 이벤트 로그는 `loki.source.windowsevent`로 읽고, Alloy 설치 프로그램이 Windows 서비스로 등록한다.
- Helm 차트: `loki-distributed` 차트는 폐기됐다. `grafana/loki` 차트를 쓴다.
- 인덱스: boltdb-shipper 대신 TSDB 인덱스와 schema v13을 쓴다. 문서에는 Loki 4.0에서 boltdb-shipper가 빠진다고 적혀 있다.

```yaml
schema_config:
  configs:
    - from: "2026-11-01"
      store: tsdb
      object_store: azure
      schema: v13
      index:
        prefix: index_
        period: 24h
```

로그는 메트릭에서 이상한 시각을 찾은 뒤 그 시각, 그 라벨로 좁혀서 본다.

### 라벨과 스트림

로그가 늘자 gateway가 429(Too Many Requests)를 돌려주고 로그 일부가 빠졌다. 수집 한도(`ingestion_rate_mb`, 기본 테넌트당 초당 4MB)를 올리면 당장은 들어가지만, 원인이 라벨에 있을 때가 많다.

Loki는 라벨 값 조합 하나마다 스트림을 하나 만든다. 요청 ID, 사용자 ID, 로그 메시지처럼 값이 끝없이 바뀌는 것을 라벨로 붙이면 줄마다 새 스트림이 생긴다. 색인이 커지고, 청크는 몇 줄만 담은 채 잘게 쪼개져 객체 저장소에 쏟아진다.

아래 데모에서 같은 로그 120줄을 보내 보자. 모드를 바꿔 가며 스트림 수와 청크가 얼마나 차는지 본다.

<figure class="fig" data-figure="prometheus-loki-labels">
  <figcaption>같은 로그를 라벨만 바꿔 보낼 때의 스트림과 청크</figcaption>
</figure>

job과 host만 라벨로 두면 스트림 2개에 청크가 차곡차곡 찬다. message까지 라벨로 올리면 줄마다 스트림이 생겨 120개가 되고, 청크마다 한 줄씩 담긴다. 로그 양은 같고 바뀐 건 **라벨 하나**뿐이다.

수집기 파이프라인에서 JSON을 풀어 `labels` 단계에 message 같은 본문 필드를 넣으면 이렇게 된다. 라벨은 값이 수십 개 안쪽으로 정해진 것(job, namespace, host, level)만 쓴다. 자주 찾는 고유 값은 구조화 메타데이터(structured metadata)로 붙이거나 조회할 때 꺼낸다.

```logql
{job="api", host="web-01"} |= "timeout" | json | status >= 500
```

Grafana 대시보드도 같은 원리다. job, host 순서로 변수를 걸어 스트림을 먼저 좁힌 뒤 본문을 검색하면 가볍다.

429가 나면 한도를 올리기 전에 `logcli series --analyze-labels`로 값이 많은 라벨부터 찾는다.

## 장기 보관

### Thanos 구조

Prometheus는 데이터를 자기 디스크에 두고 기본 15일이 지나면 지운다. 클러스터가 여럿이면 Prometheus도 여럿이라, 두 클러스터를 한 그래프에 그리거나 작년 이맘때와 견주기 어렵다. Thanos는 Prometheus 옆에 붙어 데이터를 객체 저장소로 올리고, 여러 Prometheus와 저장소를 하나처럼 조회하게 한다.

| 구성 요소 | 하는 일 |
|---|---|
| sidecar | Prometheus가 2시간마다 만드는 블록을 객체 저장소로 올리고, 최근 데이터 조회에 답한다 |
| store gateway | 객체 저장소에 올라간 블록으로 조회에 답한다 |
| query | sidecar와 store gateway에 같은 질의를 보내 결과를 합치고 중복을 지운다 |
| query frontend | 긴 조회를 구간으로 쪼개고 결과를 캐시한다 |
| compactor | 객체 저장소의 블록을 합치고 다운샘플링한다. 저장소 하나에 하나만 띄운다 |
| ruler | 합쳐진 데이터로 기록 규칙과 알림 규칙을 평가한다 |
| receiver | sidecar 대신 remote write로 데이터를 받는다 |

아래 그림의 첫 장면은 두 클러스터의 sidecar가 블록을 올리는 모습, 두 번째 장면은 한 달짜리 조회가 어디서 답을 모으는지다.

<figure class="fig" data-figure="prometheus-thanos">
  <figcaption>두 클러스터의 Prometheus와 Thanos</figcaption>
</figure>

각 Prometheus가 2시간 블록을 완성할 때마다 sidecar가 객체 저장소로 올린다. query는 최근 구간은 sidecar에, 그 이전은 store gateway에 묻고 결과를 합친다.

kube-prometheus-stack에서는 클러스터마다 `thanos` 값을 주면 오퍼레이터가 sidecar를 붙인다. `externalLabels`의 cluster 값이 있어야 query에서 어느 클러스터의 데이터인지 가를 수 있다.

```yaml
prometheus:
  prometheusSpec:
    externalLabels:
      cluster: sub-1
    thanos:
      objectStorageConfig:
        existingSecret:
          name: thanos-objstore   # Secret 이름
          key: objstore.yml       # Secret 안의 파일 이름
  thanosService:
    enabled: true
```

오퍼레이터는 sidecar가 올리기 전에 Prometheus가 블록을 합치지 않게 맞춘다. Prometheus 3.9와 sidecar 0.42 이상이면 올라간 블록만 합치게 조율하고, 그보다 오래된 버전에서는 Prometheus의 로컬 압축을 끈다.

다른 클러스터의 sidecar는 서비스 DNS로 닿지 않는다. 내부 로드밸런서로 sidecar의 gRPC 포트(10901)를 열고, query의 `--endpoint`에 그 주소를 적는다.

### 다운샘플링

1년치 그래프를 열면 한참 걸리다가 브라우저가 멈춘다. 15초 간격 원본이면 시계열 하나가 1년에 약 210만 개 샘플이다. compactor는 오래된 블록에서 해상도를 낮춘 사본을 만든다.

- 40시간이 지난 원본: 5분 해상도 사본을 만든다.
- 10일이 지난 5분 해상도: 1시간 해상도 사본을 만든다.

1시간 해상도면 1년이 8,760개다. query에 `--query.auto-downsampling`을 켜면 조회 간격에 맞는 해상도를 골라 읽는다. 아래 그림에서 블록이 나이에 따라 어떤 해상도를 갖게 되는지, 1년 조회가 어느 해상도를 읽는지 본다.

<figure class="fig" data-figure="prometheus-downsample">
  <figcaption>블록 나이에 따른 해상도와 조회 범위별로 읽는 해상도</figcaption>
</figure>

다운샘플링은 저장 공간을 줄이지 않는다. 원본 블록 옆에 5분, 1시간 블록이 더 생겨 최대 3배까지 늘어난다. 공간은 해상도별 보관 기간으로 줄인다.

```text
--retention.resolution-raw=30d
--retention.resolution-5m=180d
--retention.resolution-1h=2y
```

원본을 짧게 두면 오래된 구간은 확대해도 더 자세히 볼 수 없다. 보관 기간은 얼마나 오래 전까지 몇 분 단위로 볼 일이 있는지로 정한다.

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| 스크레이프 | 주기마다 /metrics를 가져온다 | 새 대상은 up부터 본다 |
| Gauge, Counter | 지금 값, 쌓인 값 | 사건은 Counter로 센다 |
| rate | Counter의 초당 증가량 | rate 먼저, sum 나중 |
| Histogram | 버킷별 누적 개수 | 평균 대신 p99 |
| 직접 계측 | client 라이브러리로 값을 내준다 | 마지막 성공 시각도 같이 |
| 외부 프로브 | 밖에서 요청을 보내 잰다 | 인증서 만료는 30일 전에 |
| for | 조건이 이어져야 알린다 | 튐은 거르고 그만큼 늦게 안다 |
| Alertmanager | 묶고 기다리고 경로를 고른다 | 알림이 많으면 group_by부터 |
| Loki | 라벨만 색인하는 로그 저장소 | 값이 끝없는 것은 라벨로 쓰지 않는다 |
| Thanos | 객체 저장소에 올리고 합쳐 조회한다 | 다운샘플링은 공간을 늘린다 |

## 참고

- [Prometheus — Overview](https://prometheus.io/docs/introduction/overview/)
- [Prometheus — Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [Prometheus — Metric types](https://prometheus.io/docs/concepts/metric_types/)
- [Prometheus — Query functions (rate)](https://prometheus.io/docs/prometheus/latest/querying/functions/#rate)
- [Prometheus — Histograms and summaries](https://prometheus.io/docs/practices/histograms/)
- [Prometheus — Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus — Storage](https://prometheus.io/docs/prometheus/latest/storage/)
- [Alertmanager — Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [Grafana — Prometheus template variables ($__rate_interval)](https://grafana.com/docs/grafana/latest/datasources/prometheus/template-variables/)
- [client_python](https://prometheus.github.io/client_python/)
- [Prometheus Operator — API reference](https://prometheus-operator.dev/docs/api-reference/api/)
- [Prometheus Operator — Thanos](https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/platform/thanos.md)
- [blackbox_exporter](https://github.com/prometheus/blackbox_exporter)
- [windows_exporter](https://github.com/prometheus-community/windows_exporter)
- [dcgm-exporter](https://github.com/NVIDIA/dcgm-exporter)
- [nvidia_gpu_exporter](https://github.com/utkuozdemir/nvidia_gpu_exporter)
- [Loki — Labels](https://grafana.com/docs/loki/latest/get-started/labels/)
- [Loki — Label best practices](https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/)
- [Loki — Storage schema](https://grafana.com/docs/loki/latest/operations/storage/schema/)
- [Loki — Promtail](https://grafana.com/docs/loki/latest/send-data/promtail/)
- [Alloy — loki.source.windowsevent](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.windowsevent/)
- [Thanos — Sidecar](https://thanos.io/tip/components/sidecar.md/)
- [Thanos — Compactor](https://thanos.io/tip/components/compact.md/)
- [Thanos — Querier](https://thanos.io/tip/components/query.md/)
- 원글: [Prometheus Client](https://kimjanghyun1010.tistory.com/69), [blackbox exporter 배포 및 alertmanager slack 설정](https://kimjanghyun1010.tistory.com/50), [Prometheus (Windows exporter)](https://kimjanghyun1010.tistory.com/56), [GPU Exporter (/w windows)](https://kimjanghyun1010.tistory.com/96), [Prometheus Loki](https://kimjanghyun1010.tistory.com/62), [Thanos](https://kimjanghyun1010.tistory.com/66)
