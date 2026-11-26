---
title: Python 동시성
description: GIL이 스레드를 막는 범위부터 asyncio 이벤트 루프, WSGI와 ASGI, FastAPI의 def와 async def, 워커 수와 CPU request까지 정리했다.
date: 2026-11-09 12:00:00 +0900
series: Back to the Basic
tags: [python, gil, asyncio, fastapi, uvicorn, kubernetes]
scripts: [figures/python-concurrency.js]
---

## GIL과 스레드

### GIL 동작

vCPU 4개 서버에서 계산하는 스레드를 1개에서 4개로 늘렸는데 처리 시간이 그대로다. CPython에는 GIL(Global Interpreter Lock)이 있어서, 한 프로세스 안에서 Python 코드를 실행하는 스레드는 한 번에 하나뿐이기 때문이다.

GIL은 인터프리터 전체에 걸린 락 하나다. Python은 객체마다 참조 수(reference count)를 세다가 0이 되면 메모리를 푼다. 여러 스레드가 이 수를 동시에 고치면 값이 깨지므로, 바이트코드를 실행하려면 먼저 GIL을 쥐어야 한다.

- 스레드는 GIL을 쥔 동안만 Python 코드를 실행한다.
- 다른 스레드가 기다리고 있으면, 쥔 스레드는 일정 시간마다 GIL을 내놓는다. 기본값은 5ms다.

```python
>>> import sys
>>> sys.getswitchinterval()
0.005
```

아래 그림은 계산 스레드 4개가 vCPU 4개 서버에서 도는 모습이다. GIL이 넘어갈 때마다 오른쪽에서 불이 켜지는 vCPU가 몇 개인지 본다.

<figure class="fig" data-figure="python-concurrency-gil">
  <figcaption>계산 스레드 4개와 GIL 하나 (5ms 간격은 늘려 그렸다)</figcaption>
</figure>

스레드 4개는 모두 OS 스레드라서 커널은 각자 다른 vCPU에 올릴 수 있다. 하지만 GIL을 쥔 하나만 실행하고 나머지는 GIL을 기다리므로, Python 코드는 한 번에 vCPU 하나에서만 돈다. 계산만 하는 프로세스는 스레드를 몇 개 띄워도 CPU 사용률이 100%(vCPU 1개) 언저리에서 멈춘다.

### 스레드와 프로세스

계산을 여러 vCPU에서 동시에 돌리려면 프로세스를 나눈다. 프로세스마다 인터프리터와 GIL이 따로 있어서 서로 기다리지 않는다.

```python
from concurrent.futures import ProcessPoolExecutor

def work(n):
    return sum(i * i for i in range(n))

with ProcessPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(work, [10_000_000] * 4))
```

`ProcessPoolExecutor`를 `ThreadPoolExecutor`로 바꾸면 코드는 그대로 돌지만 네 작업이 GIL 하나를 나눠 쓴다. 아래 데모에서 계산 4개를 보내 보자. 모드를 바꿔 가며 vCPU 네 줄이 어떻게 차는지, 마지막 작업이 끝나는 시각을 본다.

<figure class="fig" data-figure="python-concurrency-workers">
  <figcaption>100ms짜리 계산 4개를 스레드와 프로세스로 돌릴 때 (차례 간격은 크게 그렸다)</figcaption>
</figure>

스레드 4개는 GIL을 번갈아 쥐어서 vCPU 줄이 한 번에 하나만 찬다. 400ms어치 일을 하나씩 해서 400ms에 끝난다. 프로세스 4개는 네 줄이 동시에 차서 100ms에 끝난다. 일의 총량은 같고, 바뀐 것은 동시에 도는 vCPU 수뿐이다.

프로세스로 나누면 메모리도 프로세스 수만큼 든다. 프로세스 사이에 인자와 결과를 넘길 때마다 pickle로 직렬화하므로, 계산은 짧고 데이터가 크면 넘기는 비용이 이득보다 클 수 있다.

Python 3.14에는 한 프로세스 안에 인터프리터를 여러 개 두는 `concurrent.interpreters`와 `InterpreterPoolExecutor`도 들어왔다. 인터프리터마다 GIL이 따로라 병렬로 돌지만, 여러 인터프리터를 고려해 만들지 않은 C 확장은 아직 쓸 수 없는 경우가 많다.

계산이 느리면 스레드 수가 아니라 프로세스 수부터 본다.

### 공유 변수 경합

GIL이 있으니 스레드끼리 같은 변수를 고쳐도 안전하다고 생각하기 쉽다. 그런데 두 스레드가 `count += 1`을 백만 번씩 해도 결과가 200만이 된다는 보장은 없다.

GIL이 한 번에 지키는 단위는 바이트코드 하나다. `count += 1`은 값을 읽고, 1을 더하고, 다시 쓰는 여러 바이트코드라서 그 사이에 스레드가 바뀔 수 있다. 두 장면에서 A가 값을 읽은 직후에 차례가 넘어가면 count가 어떻게 되는지 본다.

<figure class="fig" data-figure="python-concurrency-race">
  <figcaption>두 스레드가 count += 1을 한 번씩 할 때</figcaption>
</figure>

차례가 끼어들지 않으면 5에서 7이 된다. A가 5를 읽은 뒤 B로 넘어가면 둘 다 5에 1을 더해 6을 써서, 더한 1 하나가 사라진다. Python FAQ도 아래처럼 원자적인 연산과 아닌 연산을 나눠 적어 두었다.

- 원자적: `L.append(x)`, `x = L[i]`, `D[x] = y`
- 원자적이지 않음: `i = i + 1`, `L[i] = L[j]`, `D[x] = D[x] + 1`

공유 값을 읽고 고치는 코드는 락으로 감싼다.

```python
lock = threading.Lock()

with lock:
    count += 1
```

GIL은 인터프리터 내부를 지키는 락이고, 내 코드의 공유 변수까지 지키지는 않는다. FAQ도 헷갈리면 뮤텍스를 쓰라고 맺는다.

### I/O 대기와 GIL

GIL이 있는데도 외부 API를 부르는 작업은 스레드를 4개로 늘리면 4배 가까이 빨라진다. 파일이나 소켓을 읽는 블로킹 I/O 동안에는 CPython이 GIL을 놓기 때문이다.

요청 하나가 계산 5ms, DB 대기 80ms, 계산 5ms라고 하자. GIL을 쥐는 건 앞뒤 10ms뿐이다. 두 장면에서 맨 아래 GIL 줄이 얼마나 비어 있는지 본다.

<figure class="fig" data-figure="python-concurrency-io">
  <figcaption>DB를 기다리는 요청 4개를 스레드 1개와 4개로 처리할 때 (시간은 대략값)</figcaption>
</figure>

스레드 하나는 요청을 차례로 처리해서 360ms가 걸린다. 스레드 4개는 대기를 겹쳐 105ms에 끝난다. GIL 줄은 두 장면 모두 거의 비어 있어서, 스레드끼리 다투는 건 계산하는 10ms씩뿐이다.

그래서 Python에서도 I/O를 기다리는 일에는 스레드가 여전히 쓸모 있다. 일의 성격에 따라 이렇게 나눈다.

- I/O 대기 위주: 스레드나 asyncio로 대기를 겹친다.
- Python 코드로 하는 계산 위주: 프로세스로 나눈다.
- C 확장 안에서 하는 계산: `zlib`, `hashlib`처럼 C 코드를 도는 동안 GIL을 놓는 라이브러리는 스레드로도 병렬이 된다.

스레드 수를 정하기 전에 요청 시간 중 계산과 대기의 비율부터 잰다.

### free-threaded 빌드

Python 3.13부터 GIL을 끈 free-threaded 빌드가 있다(PEP 703). 3.13에서는 실험 기능이었고, 3.14에서 공식 지원으로 올라왔다(PEP 779). 2026년 11월 기준 최신인 3.15에서도 기본 빌드는 GIL이 있는 쪽이고, free-threaded는 따로 골라 설치하는 빌드다.

```text
$ python -VV                 # "free-threading build"가 보이면 GIL 없는 빌드
>>> sys._is_gil_enabled()    # 지금 이 프로세스에서 GIL이 켜져 있는지
```

같은 계산 4개를 free-threaded 빌드에서 돌려 보자. 두 번째 장면은 free-threading 지원 표시가 없는 C 확장을 import한 경우다.

<figure class="fig" data-figure="python-concurrency-freethread">
  <figcaption>free-threaded 빌드에서 계산 4개 (시간은 대략값)</figcaption>
</figure>

GIL이 없으면 4개가 동시에 돌아 100ms 남짓에 끝난다. 대신 단일 스레드 성능은 조금 손해를 보고(3.15 문서 기준 pyperformance 평균 1~8%), 메모리도 더 쓴다. 지원 표시가 없는 C 확장을 import하면 인터프리터가 경고를 내고 GIL을 다시 켜서, 다시 차례로 도는 400ms로 돌아간다.

- 앞의 `count += 1` 경합은 그대로다. 락은 여전히 직접 건다.
- 쓰는 C 확장(DB 드라이버, 수치 계산 라이브러리)이 free-threading을 지원하는지부터 확인한다.

## asyncio 이벤트 루프

asyncio도 스레드 하나에서 이벤트 루프를 돌리고, 리눅스에서는 epoll로 소켓을 기다린다. 대기를 커널에 맡기고 준비된 것만 처리하는 구조는 [CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %})의 Node.js 절과 같다.

### 코루틴과 await

외부 API 세 개를 부르는 코드가 6초 걸린다. 각각 3초, 2초, 1초가 걸리는데 하나가 끝나야 다음을 부르기 때문이다.

`async def`로 만든 함수(코루틴)는 `await`에서 멈추고 이벤트 루프에 차례를 넘긴다. 루프는 그사이 다른 코루틴을 돌리고, 기다리던 결과가 오면 멈췄던 자리부터 다시 돌린다.

```python
import asyncio

async def call(name, sec):
    await asyncio.sleep(sec)   # 외부 API 대기 대신
    return name

async def main():
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(call(n, s)) for n, s in [("A", 3), ("B", 2), ("C", 1)]]
    print([t.result() for t in tasks])

asyncio.run(main())
```

두 장면에서 세 호출이 시간축에 어떻게 놓이는지 견줘 보자.

<figure class="fig" data-figure="python-concurrency-loop">
  <figcaption>3초, 2초, 1초 걸리는 호출 세 개를 차례로와 함께 기다릴 때</figcaption>
</figure>

차례로 부르면 대기가 이어 붙어 6초, 함께 기다리면 가장 긴 3초에 끝난다. 두 번째 장면의 스레드 줄은 결과가 올 때만 잠깐 찬다. asyncio는 병렬이 아니라 **한 스레드가 여러 대기를 겹치는 동시성**이다.

`asyncio.gather`도 같은 일을 한다. 3.11에 들어온 `TaskGroup`은 작업 하나가 실패하면 나머지를 취소해 줘서, 공식 문서도 gather보다 안전하다고 적는다. 새 코드는 TaskGroup으로 묶는다.

### 이벤트 루프 블로킹

FastAPI로 옮긴 뒤 평소엔 빠른데, 특정 API가 불릴 때마다 서버 전체가 함께 멈춘다. `async def` 안에서 `time.sleep`, `requests.get`, 동기 DB 드라이버처럼 await 없이 기다리는 함수를 부르면, 그동안 이벤트 루프 스레드가 통째로 묶인다.

Node.js는 I/O API가 대부분 비동기라 루프를 막는 쪽은 주로 긴 계산이다. Python은 동기 라이브러리가 훨씬 많아서, 계산이 아니라 **기다림**이 루프를 막는 경우가 흔하다.

아래 데모에서 요청 A는 DB를 200ms 기다리고, 요청 B는 10ms에 도착한다. 모드를 바꿔 가며 A를 보내고, B가 얼마나 기다리는지 본다.

<figure class="fig" data-figure="python-concurrency-blocking">
  <figcaption>async def 안의 동기 호출이 이벤트 루프를 막는 모습</figcaption>
</figure>

동기 호출이면 A가 DB를 기다리는 200ms 동안 루프가 멈춰 B는 194ms를 기다린다. await이면 루프가 A를 내려놓고 B를 바로 처리한다. DB가 쿼리에 쓰는 시간은 두 모드가 같고, 바뀐 것은 기다리는 동안 루프가 다른 요청을 받았는지뿐이다.

고치는 방법은 기다리는 함수의 종류에 따라 다르다.

- 비동기 라이브러리로 바꾼다: `requests` 대신 `httpx.AsyncClient`, 동기 DB 드라이버 대신 asyncpg나 SQLAlchemy의 async 엔진.
- 바꿀 수 없으면 스레드로 넘긴다: `await asyncio.to_thread(func)`. 기다리는 동안 GIL을 놓으므로 I/O에는 효과가 있다.
- CPU 계산이면 프로세스로 넘긴다: `loop.run_in_executor(ProcessPoolExecutor(), func)`. to_thread는 GIL 때문에 계산에는 도움이 안 된다.

루프가 막히는 곳은 asyncio 디버그 모드로 찾는다. 개발 환경에서 `PYTHONASYNCIODEBUG=1`로 켜면, 100ms보다 오래 루프를 잡은 콜백이 경고 로그로 남는다.

```text
Executing <Task ... coro=<handler() ...>> took 0.201 seconds
```

## 웹 서버 구성

### WSGI와 ASGI

Flask 앱에 WebSocket을 붙이려 하면 서버와 앱이 주고받는 규약부터 막힌다. Python 웹 서버와 프레임워크 사이에는 두 규약이 있다.

- WSGI: 앱은 요청 하나를 받아 응답 하나를 돌려주는 동기 함수다. 서버는 응답이 끝날 때까지 프로세스나 스레드 하나를 그 요청에 묶어 둔다. Gunicorn과 Flask가 이 조합이다.
- ASGI: 앱은 `async def app(scope, receive, send)`다. 연결 하나에서 이벤트를 여러 번 받고 여러 번 보낸다. Uvicorn과 FastAPI가 이 조합이다.

세 장면에서 서버와 앱 사이를 오가는 메시지 수를 견줘 보자.

<figure class="fig" data-figure="python-concurrency-asgi">
  <figcaption>WSGI 호출 한 번과 ASGI 이벤트</figcaption>
</figure>

WSGI는 호출 한 번에 응답 한 번으로 끝나서, 연결을 붙잡고 메시지를 여러 번 주고받는 WebSocket이나 long-poll을 담을 수 없다. ASGI는 HTTP 요청도 이벤트 몇 개로 나눠 주고받고, WebSocket은 연결이 살아 있는 동안 이벤트를 계속 주고받는다. ASGI 문서는 ASGI를 WSGI의 정신적 후속(spiritual successor)이라고 부른다.

ASGI 서버는 이 이벤트를 이벤트 루프 위에서 처리한다. 앞 절의 루프 블로킹은 ASGI 앱이면 어디서나 생길 수 있다.

### def와 async def

FastAPI 엔드포인트를 `def`로 쓰든 `async def`로 쓰든 똑같이 도는 것처럼 보인다. 둘은 실행되는 자리가 다르다.

- `async def`: 이벤트 루프 스레드에서 바로 돈다. 안에서 await 없이 기다리면 루프 전체가 멈춘다.
- `def`: FastAPI가 외부 스레드 풀에서 돌리고, 루프는 그 결과를 await한다. 동기 DB 드라이버를 써도 루프는 막히지 않는다.

```python
@app.get("/a")
async def a():
    return await db.fetch_all(query)   # 비동기 드라이버

@app.get("/b")
def b():
    return sync_db.execute(query)      # 동기 드라이버, 스레드 풀에서 실행
```

스레드 풀은 Starlette가 쓰는 AnyIO의 기본 풀이고, 동시에 40개까지 돈다. `def`로 쓴 의존성(Depends)도 같은 풀을 쓴다.

세 장면에서 요청 A가 어디서 실행되는지, 뒤따라온 B와 C가 어떻게 되는지 본다.

<figure class="fig" data-figure="python-concurrency-fastapi">
  <figcaption>엔드포인트 종류에 따라 요청 A가 실행되는 자리</figcaption>
</figure>

async def에서 await하면 A는 루프를 비켜 주고, def면 스레드 풀이 대신 기다린다. 두 경우 모두 B와 C가 바로 처리된다. async def 안에서 동기 호출을 하면 A가 루프를 붙잡아 B와 C가 줄을 선다.

FastAPI 문서의 권고는 이렇다.

- 쓰는 라이브러리가 await를 지원하면 `async def`
- 동기 라이브러리(지금은 대부분의 DB 라이브러리)를 쓰면 `def`
- 기다리는 일 없이 계산만 짧게 하면 `async def`
- 판단이 안 서면 `def`

def 요청이 오래 걸리면 40칸이 다 차서, 41번째 def 요청은 칸이 빌 때까지 기다린다. 느린 동기 호출이 많은 서비스에서 응답이 갑자기 줄을 서면, 동시 처리 수가 40에서 멈추는지부터 본다.

### 워커 수와 CPU request

Uvicorn 하나는 프로세스 하나다. Python 코드를 실행하는 GIL도 하나라서, 요청이 몰려 계산이 늘어도 vCPU 하나 남짓에서 멈춘다. 여러 vCPU를 쓰려면 워커 프로세스를 늘린다.

```bash
uvicorn main:app --workers 4
fastapi run --workers 4 main.py
```

- `--workers`를 주지 않으면 `WEB_CONCURRENCY` 환경 변수를 쓰고, 그것도 없으면 1이다.
- Uvicorn의 부모 프로세스가 워커를 관리하고, 죽은 워커는 다시 띄운다.
- Gunicorn을 프로세스 관리자로 쓰던 `uvicorn.workers.UvicornWorker`는 폐기 예정이고, 별도 패키지 `uvicorn-worker`로 옮겨졌다. Gunicorn도 24.0(2026년 1월)에 자체 ASGI 워커를 넣었고 25.1에서 정식 기능이 됐다.
- FastAPI 배포 문서는 Gunicorn 없이 `--workers`만 안내한다. Gunicorn을 넣은 예전 공식 이미지(`tiangolo/uvicorn-gunicorn-fastapi`)는 폐기됐다.

쿠버네티스에서는 컨테이너 안에서 워커를 늘리지 말고 컨테이너마다 Uvicorn 프로세스 하나를 두라고 FastAPI 문서가 권한다. 복제는 쿠버네티스가 레플리카로 하므로 컨테이너 안에 프로세스 관리자를 또 둘 이유가 없다. 이때 CPU request를 프로세스 수에 맞춘다.

세 장면에서 워커 수와 request가 어긋날 때 CPU가 어떻게 남거나 모자라는지 본다.

<figure class="fig" data-figure="python-concurrency-pods">
  <figcaption>워커 수와 CPU request의 조합 (Python 계산이 몰린 상황의 대략값)</figcaption>
</figure>

- 워커 1개에 request 4: GIL 때문에 Python 코드는 vCPU 하나까지만 쓴다. 3개는 예약만 하고 노는데, 스케줄러는 request를 보고 노드를 고르므로 그만큼 다른 파드가 못 들어온다.
- 워커 4개에 request 1, limit 1: 네 프로세스가 vCPU 하나를 나눠 각자 0.25만 쓴다. limit에 걸리면 쓰로틀도 생긴다.
- 파드 4개에 워커 1개씩, request 1: 프로세스마다 vCPU 하나를 받는다.

계산이 많은 Python 파드는 프로세스 하나에 request 1 정도로 잡고, 늘릴 때는 레플리카로 늘린다. I/O 대기가 대부분인 API 서버는 프로세스 하나가 vCPU 하나도 다 쓰지 못하므로, 실제 사용량을 재서 그보다 낮게 잡는다.

CPU 수를 보고 크기를 정하는 기본값도 확인한다. `os.cpu_count()`는 노드의 CPU 수를 돌려주고, 3.13에 들어온 `os.process_cpu_count()`도 CPU affinity만 본다. CPU limit은 쓸 시간만 자르고 쓸 수 있는 CPU 목록은 그대로 두므로(CPU 관리자 static 정책이 아니라면), 64코어 노드에서는 둘 다 64를 돌려준다.

- `ThreadPoolExecutor`의 기본 스레드 수는 `min(32, CPU 수 + 4)`다. `asyncio.to_thread`가 쓰는 기본 풀도 이 값을 따른다.
- `ProcessPoolExecutor`의 기본 프로세스 수는 CPU 수다. request 1인 파드에서 프로세스 64개를 띄운다.
- 3.13부터 `PYTHON_CPU_COUNT` 환경 변수나 `-X cpu_count`로 이 값을 덮어쓸 수 있다.

```yaml
env:
  - name: PYTHON_CPU_COUNT
    value: "1"
```

워커 수와 풀 크기는 노드가 아니라 request에 맞춰 직접 정한다. Go, Java, Node.js가 limit을 어떻게 읽는지는 [CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %})의 limit 설정 기준에 정리했다.

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| GIL | 한 프로세스에서 Python 코드는 한 스레드씩 실행 | 계산은 스레드로 병렬이 안 된다. 프로세스로 나눈다 |
| GIL과 공유 변수 | 바이트코드 하나만 지킨다 | `count += 1`은 원자적이지 않다. 락을 건다 |
| I/O 대기 | 블로킹 I/O 동안 GIL을 놓는다 | 대기 위주 일에는 스레드가 쓸모 있다 |
| free-threaded 빌드 | 3.13 실험, 3.14 공식 지원, 3.15도 선택 빌드 | C 확장 지원 여부 확인. 락은 그대로 |
| asyncio | 스레드 하나가 여러 대기를 겹친다 | 병렬이 아니다. TaskGroup으로 묶는다 |
| 루프 블로킹 | async def 안의 동기 호출이 루프를 멈춘다 | 비동기 라이브러리, to_thread, 프로세스 순으로 푼다 |
| WSGI와 ASGI | 호출 한 번과 이벤트 여러 번 | WebSocket과 긴 연결은 ASGI |
| FastAPI def | 스레드 풀(기본 40)에서 돈다 | 동기 라이브러리는 def로 쓴다 |
| 워커와 request | 프로세스 하나는 Python 코드로 vCPU 하나까지 | 컨테이너당 프로세스 하나, request와 풀 크기를 맞춘다 |

## 참고

- [Python — Library and Extension FAQ, Threads](https://docs.python.org/3/faq/library.html#threads)
- [Python — sys.setswitchinterval](https://docs.python.org/3/library/sys.html#sys.setswitchinterval)
- [Python C API — Thread states and the global interpreter lock](https://docs.python.org/3/c-api/threads.html)
- [Python — Python support for free threading](https://docs.python.org/3/howto/free-threading-python.html)
- [PEP 703 — Making the Global Interpreter Lock Optional in CPython](https://peps.python.org/pep-0703/)
- [PEP 779 — Criteria for supported status for free-threaded Python](https://peps.python.org/pep-0779/)
- [What's New In Python 3.14](https://docs.python.org/3/whatsnew/3.14.html)
- [What's New In Python 3.15](https://docs.python.org/3/whatsnew/3.15.html)
- [Python — asyncio Coroutines and Tasks](https://docs.python.org/3/library/asyncio-task.html)
- [Python — Developing with asyncio](https://docs.python.org/3/library/asyncio-dev.html)
- [Python — concurrent.futures](https://docs.python.org/3/library/concurrent.futures.html)
- [Python — os.process_cpu_count](https://docs.python.org/3/library/os.html#os.process_cpu_count)
- [ASGI — Introduction](https://asgi.readthedocs.io/en/latest/introduction.html)
- [FastAPI — Concurrency and async / await](https://fastapi.tiangolo.com/async/)
- [FastAPI — Server Workers](https://fastapi.tiangolo.com/deployment/server-workers/)
- [FastAPI — FastAPI in Containers](https://fastapi.tiangolo.com/deployment/docker/)
- [Starlette — Thread Pool](https://www.starlette.dev/threadpool/)
- [AnyIO — Working with threads](https://anyio.readthedocs.io/en/stable/threads.html)
- [Uvicorn — Settings](https://uvicorn.dev/settings/)
- [Uvicorn — Deployment](https://uvicorn.dev/deployment/)
- [uvicorn-worker](https://github.com/Kludex/uvicorn-worker)
- [Gunicorn — 2026 Changelog](https://gunicorn.org/2026-news/)
- 원글: [GIL, ASGI, Uvicorn(/w fastapi)](https://kimjanghyun1010.tistory.com/98), [비동기 ??? asyncio ???](https://kimjanghyun1010.tistory.com/45)
