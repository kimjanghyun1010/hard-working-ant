---
title: Python 동시성
description: GIL이 한 번에 한 스레드만 돌리는 원리부터 블로킹 I/O와 GIL 해제, asyncio 이벤트 루프, Uvicorn과 FastAPI 스레드 풀, 워커 프로세스, free-threaded 빌드까지 Python 서버가 요청 여러 개를 동시에 처리하는 구조를 따라간다.
date: 2026-11-09 12:00:00 +0900
series: Back to the Basic
tags: [python, gil, asyncio, fastapi, uvicorn, kubernetes]
scripts: [figures/python-concurrency.js]
---

## GIL과 스레드

Python 서버 프로세스 하나에 요청 100개가 한꺼번에 들어와도, 그중 Python 코드를 실행하는 것은 한 순간에 하나다. 나머지는 무언가를 기다리고 있어야 동시 처리가 성립한다.

CPython(python.org에서 받는 표준 구현)에는 GIL(Global Interpreter Lock)이 있다. 인터프리터 전체에 걸린 락 하나이고, 스레드는 이 락을 쥔 동안만 바이트코드(Python 코드를 컴파일한 명령)를 실행한다. Python은 객체마다 참조 수(reference count)를 세다가 0이 되면 메모리를 푸는데, 여러 스레드가 이 수를 동시에 고치면 값이 깨지기 때문이다.

GIL을 넘기는 순서는 CPython 소스 `Python/ceval_gil.c` 머리 주석에 적혀 있다.

1. GIL을 기다리는 스레드는 switch interval만큼 기다린다. 기본값은 5000µs, 5ms다.
2. 그때까지 GIL이 풀리지 않으면 `gil_drop_request` 플래그를 세운다.
3. GIL을 쥔 스레드는 평가 루프가 한 바퀴 돌 때마다 이 플래그를 확인하고, 서 있으면 GIL을 내놓는다.
4. 내놓은 스레드는 다른 스레드가 GIL을 실제로 잡을 때까지 기다린다. 멀티코어에서 자기가 곧바로 다시 잡아 버리는 일을 막는 장치다.

```python
>>> import sys
>>> sys.getswitchinterval()
0.005
```

5ms는 보장이 아니라 목표다. 소스 주석도 바이트코드 하나가 얼마든지 오래 걸릴 수 있어서 전환 주기를 강제하지는 못한다고 적는다.

스레드는 모두 OS 스레드라서 커널은 각자 다른 vCPU(가상 머신이나 컨테이너가 받는 CPU 한 개)에 올릴 수 있다. 하지만 아래 그림처럼 GIL을 쥔 하나만 실행하고 나머지는 GIL을 기다린다.

<figure class="fig" data-figure="python-concurrency-gil">
  <figcaption>계산 스레드 4개와 GIL 하나 (5ms 간격은 늘려 그렸다)</figcaption>
</figure>

계산만 하는 프로세스는 스레드를 몇 개 띄워도 CPU 사용률이 100%(vCPU 1개) 언저리에서 멈춘다. 스레드를 늘리면 GIL을 주고받는 횟수만 늘어난다.

GIL이 한 번에 지키는 단위는 바이트코드 하나라서 내 코드의 공유 변수까지 지키지는 않는다. `count += 1`은 읽기, 더하기, 쓰기의 여러 바이트코드라 그 사이에 전환이 끼면 더한 1 하나가 사라진다. Python FAQ도 이런 연산은 원자적이지 않다고 적으니, 공유 값을 고치는 코드는 `threading.Lock`으로 감싼다.

## 블로킹 I/O와 GIL 해제

스레드가 Python 서버에서 여전히 쓰이는 이유는 기다리는 동안 GIL을 놓기 때문이다. 파일이나 소켓을 읽고 쓰는 C 코드는 시스템 콜을 부르기 전에 GIL을 놓고, 돌아온 뒤 다시 잡는다. C API 문서는 이 패턴을 매크로 한 쌍으로 보여 준다.

```c
Py_BEGIN_ALLOW_THREADS
n = read(fd, buf, size);   /* 커널에서 기다리는 동안 GIL을 놓는다 */
Py_END_ALLOW_THREADS
```

요청 하나가 계산 5ms, DB 대기 80ms, 계산 5ms라고 하자. GIL을 쥐는 시간은 앞뒤 10ms뿐이라, 아래 그림처럼 스레드 4개가 DB 대기를 겹치면 스레드 하나로 360ms 걸리던 요청 4개가 105ms에 끝난다.

<figure class="fig" data-figure="python-concurrency-io">
  <figcaption>DB를 기다리는 요청 4개를 스레드 1개와 4개로 처리할 때 (시간은 대략값)</figcaption>
</figure>

GIL을 놓는 곳은 I/O만이 아니다. `zlib` 압축과 `hashlib` 해시처럼 Python 객체를 건드리지 않는 긴 C 코드도 GIL을 놓는다. 일의 성격에 따라 스레드의 효과가 갈린다.

- I/O 대기 위주: 스레드로 대기를 겹친다. 효과가 크다.
- Python 코드로 하는 계산: 스레드로는 빨라지지 않는다.
- GIL을 놓는 C 확장 안의 계산: 스레드로도 여러 vCPU에서 돈다.

WSGI 서버가 이 방식으로 동시성을 얻는다. WSGI 앱은 요청 하나를 받아 응답 하나를 돌려주는 동기 함수라서, 서버는 응답이 끝날 때까지 스레드 하나를 그 요청에 묶어 둔다. Gunicorn의 gthread 워커는 프로세스마다 스레드 풀을 두므로, 동시에 처리하는 요청 수는 워커 수와 스레드 수를 곱한 값을 넘지 못한다.

연결마다 스레드를 묶는 구조는 WebSocket이나 긴 폴링처럼 연결을 오래 붙잡고 대부분 기다리기만 하는 서버에서 무거워진다. 연결 수천 개면 OS 스레드 수천 개와 그 스택 메모리가 필요하다.

## asyncio 이벤트 루프

asyncio는 기다림을 스레드 여러 개가 아니라 스레드 하나 안의 코루틴으로 겹친다. 코루틴은 `async def`로 만든 함수이고, `await`에서 멈춰 차례를 이벤트 루프에 넘긴다. 루프는 소켓들을 커널에 맡겨 두고 준비된 것만 깨우는데, 리눅스에서는 `selectors.DefaultSelector`가 epoll을 고른다(macOS와 BSD는 kqueue).

루프가 한 바퀴 도는 순서는 `asyncio/base_events.py`의 `_run_once`에 있다.

1. 예약된 타이머 중 가장 이른 것까지 남은 시간을 대기 상한(timeout)으로 잡는다. 바로 돌릴 콜백이 있으면 0이다.
2. `selector.select(timeout)`으로 소켓이 준비되기를 기다린다. epoll에서는 `epoll_wait` 시스템 콜이다.
3. 준비된 소켓과 시간이 된 타이머의 콜백을 ready 큐에 넣는다.
4. ready 큐의 콜백을 하나씩 차례로 실행한다. 코루틴은 다음 `await`까지 돈다.

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

3초, 2초, 1초 걸리는 호출 세 개를 차례로 부르면 대기가 이어 붙어 6초가 걸린다. 아래 그림처럼 태스크로 만들어 함께 기다리면 가장 긴 3초에 끝난다.

<figure class="fig" data-figure="python-concurrency-loop">
  <figcaption>3초, 2초, 1초 걸리는 호출 세 개를 차례로와 함께 기다릴 때</figcaption>
</figure>

asyncio는 병렬이 아니라 **한 스레드가 여러 대기를 겹치는 동시성**이다. 연결 하나를 기다리는 데 드는 것은 OS 스레드가 아니라 코루틴 객체와 epoll에 등록한 파일 디스크립터라서, 스레드 하나로 연결 수천 개를 붙잡는다. 3.11에 들어온 `TaskGroup`은 작업 하나가 실패하면 나머지를 취소해 줘서, 공식 문서도 `gather`보다 안전하다고 적는다.

### 이벤트 루프 블로킹

4단계의 콜백은 하나씩 차례로 돌고, 도는 동안 루프는 2단계로 돌아가지 못한다. `async def` 안에서 `time.sleep`, `requests.get`, 동기 DB 드라이버처럼 await 없이 기다리는 함수를 부르면 그동안 다른 요청은 전부 멈춘다.

아래 데모에서 모드를 바꿔 요청 A를 보내면, 10ms에 도착한 요청 B가 얼마나 밀리는지 견줄 수 있다.

<figure class="fig" data-figure="python-concurrency-blocking">
  <figcaption>async def 안의 동기 호출이 이벤트 루프를 막는 모습</figcaption>
</figure>

동기 호출이면 B는 194ms를 기다리고, await이면 바로 처리된다. await은 DB 응답을 기다리는 동안 루프를 2단계 select로 돌려보내 B를 받게 하지만, 동기 호출은 응답이 올 때까지 루프 스레드를 쥐고 놓지 않는다. Node.js는 I/O API가 대부분 비동기라 루프를 막는 쪽이 주로 긴 계산이지만, Python은 동기 라이브러리가 많아서 **기다림**이 루프를 막는 경우가 흔하다.

고치는 방법은 기다리는 함수의 종류에 따라 다르다.

- 비동기 라이브러리로 바꾼다: `requests` 대신 `httpx.AsyncClient`, 동기 DB 드라이버 대신 asyncpg나 SQLAlchemy의 async 엔진.
- 바꿀 수 없으면 `await asyncio.to_thread(func)`로 루프의 기본 스레드 풀에 넘긴다. 기다리는 동안 GIL을 놓으므로 I/O에는 효과가 있다.
- CPU 계산이면 `loop.run_in_executor(ProcessPoolExecutor(), func)`로 프로세스에 넘긴다. to_thread는 GIL 때문에 계산에는 도움이 안 된다.

막히는 곳은 디버그 모드로 찾는다. `PYTHONASYNCIODEBUG=1`로 켜면 콜백 하나가 `slow_callback_duration`(기본 0.1초)보다 오래 루프를 잡을 때 경고가 남는다.

```text
Executing <Task ... coro=<handler() ...>> took 0.201 seconds
```

## ASGI 서버와 스레드 풀

ASGI는 이벤트 루프 위에서 도는 웹 서버와 앱 사이의 규약이다. 앱은 `async def app(scope, receive, send)` 하나이고, 연결에서 일어나는 일을 이벤트로 받고 보낸다. HTTP 요청은 `http.request`를 받고 `http.response.start`와 `http.response.body`를 보내는 이벤트 몇 개로 나뉘고, WebSocket은 연결이 살아 있는 동안 이벤트를 계속 주고받는다.

Uvicorn은 이 규약을 구현한 서버다. 요청 헤더를 다 읽으면 `loop.create_task(cycle.run_asgi(app))`로 요청마다 태스크 하나를 만들고, 요청 100개면 태스크 100개가 루프 스레드 하나를 나눠 쓴다.

FastAPI 엔드포인트는 `async def`와 `def` 두 가지로 쓸 수 있고, 실행되는 자리가 다르다.

- `async def`: 요청 태스크 안에서 루프 스레드가 바로 돌린다. 안에서 await 없이 기다리면 루프 전체가 멈춘다.
- `def`: FastAPI가 Starlette의 `run_in_threadpool`로 넘기고, 이 함수는 `anyio.to_thread.run_sync`를 부른다. 루프는 결과를 await하므로 동기 DB 드라이버를 써도 막히지 않는다.

```python
@app.get("/a")
async def a():
    return await db.fetch_all(query)   # 비동기 드라이버

@app.get("/b")
def b():
    return sync_db.execute(query)      # 동기 드라이버, 스레드 풀에서 실행
```

아래 그림처럼 세 경우 중 async def 안에서 동기 호출을 할 때만 요청 A가 루프를 붙잡고, 뒤따라온 B와 C가 줄을 선다.

<figure class="fig" data-figure="python-concurrency-fastapi">
  <figcaption>엔드포인트 종류에 따라 요청 A가 실행되는 자리</figcaption>
</figure>

FastAPI 문서는 await를 지원하는 라이브러리를 쓰면 `async def`, 동기 라이브러리를 쓰면 `def`, 판단이 안 서면 `def`를 권한다. `def`가 안전한 대신 스레드 풀에는 칸 수 제한이 있다.

스레드 풀의 크기는 AnyIO 소스의 기본값 `CapacityLimiter(40)`이 정한다. 동시에 도는 `def` 엔드포인트와 `def`로 쓴 의존성(Depends)은 합쳐서 40개까지이고, 41번째는 칸이 빌 때까지 기다린다. 이 대기는 루프 밖에서 생겨서 CPU 사용률은 낮은데 응답만 줄을 서는 모습으로 나타난다. 느린 동기 호출이 많다면 시작할 때 `anyio.to_thread.current_default_thread_limiter().total_tokens`를 늘린다.

어느 쪽을 고르든 Uvicorn 프로세스 하나에는 GIL이 하나다. 루프 스레드와 풀 스레드 40개가 Python 코드를 실행하려면 같은 GIL을 차례로 쥐어야 해서, 요청마다 계산이 늘면 프로세스 하나는 vCPU 하나 남짓에서 멈춘다.

## 워커 프로세스와 CPU request

여러 vCPU를 쓰려면 프로세스를 나눈다. 프로세스마다 인터프리터와 GIL이 따로 있어서 서로 기다리지 않는다. 아래 데모에서 모드를 바꿔 100ms짜리 계산 4개를 보내면, 스레드 4개와 프로세스 4개가 끝나는 시각을 견줄 수 있다.

<figure class="fig" data-figure="python-concurrency-workers">
  <figcaption>100ms짜리 계산 4개를 스레드와 프로세스로 돌릴 때 (차례 간격은 크게 그렸다)</figcaption>
</figure>

스레드 4개는 GIL을 번갈아 쥐어 400ms에, 프로세스 4개는 vCPU 넷에서 동시에 돌아 100ms에 끝난다. 계산 400ms어치는 두 모드가 같지만, 프로세스는 저마다 GIL을 따로 가져서 계산을 한 줄로 세우지 않고 나란히 놓는다. 대가로 메모리가 프로세스 수만큼 들고, 프로세스 사이에 인자와 결과를 넘길 때마다 pickle로 직렬화한다.

Uvicorn은 `--workers`로 워커 프로세스를 띄운다.

```bash
uvicorn main:app --workers 4
```

- `--workers`를 주지 않으면 `WEB_CONCURRENCY` 환경 변수를, 그것도 없으면 1을 쓴다.
- 부모 프로세스가 listen 소켓을 열어 워커들에 넘기고, 워커들은 같은 소켓에서 연결을 나눠 받는다.
- 부모는 워커가 살아 있는지 확인하고 죽은 워커를 다시 띄운다.

쿠버네티스에서는 FastAPI 문서가 컨테이너마다 Uvicorn 프로세스 하나를 두고 레플리카로 늘리라고 권한다. 복제와 재시작을 쿠버네티스가 하므로 컨테이너 안에 프로세스 관리자를 또 둘 이유가 없다. 이때 CPU request를 프로세스 수에 맞춰야 하고, 아래 그림처럼 둘이 어긋나면 CPU가 놀거나 모자란다.

<figure class="fig" data-figure="python-concurrency-pods">
  <figcaption>워커 수와 CPU request의 조합 (Python 계산이 몰린 상황의 대략값)</figcaption>
</figure>

- 워커 1개에 request 4: Python 코드는 vCPU 하나까지만 쓴다. 나머지 3은 예약만 하고 노는데, 스케줄러는 request를 보고 노드를 고르므로 그만큼 다른 파드가 못 들어온다.
- 워커 4개에 request 1, limit 1: 네 프로세스가 vCPU 하나를 나눠 각자 0.25만 쓰고, limit에 걸리면 쓰로틀링(throttling)도 생긴다.

계산이 많은 파드는 프로세스 하나에 request 1 정도로 잡고 레플리카로 늘린다. I/O 대기가 대부분인 API 서버는 프로세스 하나가 vCPU 하나도 다 쓰지 못하므로, 실제 사용량을 재서 그보다 낮게 잡는다.

CPU 수로 크기를 정하는 기본값은 컨테이너에서 어긋난다. `os.cpu_count()`는 노드의 CPU 수를, 3.13에 들어온 `os.process_cpu_count()`는 affinity(이 프로세스가 돌아도 되는 CPU 목록)까지만 보고 CPU limit은 보지 않아서, 64코어 노드의 request 1짜리 파드에서도 64를 돌려준다.

- `ThreadPoolExecutor`의 기본 스레드 수는 `min(32, CPU 수 + 4)`다. `asyncio.to_thread`가 쓰는 루프의 기본 풀도 이 값을 따른다.
- `ProcessPoolExecutor`의 기본 프로세스 수는 CPU 수다. request 1인 파드에서 프로세스 64개를 띄운다.
- 3.13부터 `PYTHON_CPU_COUNT` 환경 변수나 `-X cpu_count`로 이 값을 덮어쓴다.

```yaml
env:
  - name: PYTHON_CPU_COUNT
    value: "1"
```

Go, Java, Node.js가 CPU limit을 읽는 방식은 [CPU 이해하기]({{ site.baseurl }}{% post_url 2026-10-25-k8s-cpu-request-limit %})의 limit 설정 기준에 정리했다.

## free-threaded 빌드

프로세스를 나누지 않고 GIL 자체를 없애는 작업이 PEP 703이다. Python 3.13에 GIL을 끈 free-threaded 빌드가 실험 기능으로 들어왔고, 3.14에서 공식 지원으로 올라왔다(PEP 779). 기본 빌드는 여전히 GIL이 있는 쪽이고, free-threaded는 `python3.14t`처럼 따로 골라 설치한다.

GIL이 지키던 참조 수는 다른 방법으로 지킨다.

- 편향 참조 카운팅(biased reference counting): 객체를 만든 스레드는 원자적이지 않은 싼 연산으로, 다른 스레드는 원자적 연산으로 참조 수를 고친다.
- 불멸 객체(immortalization): `None`, `True`, `False`, 작은 정수, intern된 문자열(같은 내용이면 객체 하나를 함께 쓰도록 등록한 문자열)처럼 여기저기서 공유하는 객체는 참조 수를 아예 고치지 않는다.
- 객체별 락: list, dict, set마다 가벼운 락이 붙는다.
- 메모리 할당기: pymalloc 대신 스레드 안전한 mimalloc을 쓴다.

```text
$ python3.14t -VV           # "free-threading build"가 보이면 GIL 없는 빌드
>>> sys._is_gil_enabled()   # 지금 이 프로세스에서 GIL이 켜져 있는지
```

GIL을 없앤 값은 단일 스레드 속도와 호환성으로 치른다.

- 단일 스레드 성능: 3.14 What's New는 기본 빌드보다 5~10% 느리다고 적는다.
- 메모리: 기본 빌드보다 더 쓴다.
- C 확장: free-threading 지원 표시가 없는 확장을 import하면 경고를 내고 GIL을 다시 켠다. 계산 스레드 4개는 다시 차례로 돈다. `PYTHON_GIL=0`이나 `-X gil=0`으로 강제로 끌 수는 있다.

GIL이 없어도 `count += 1` 경합은 그대로라 락은 직접 건다. 쓰는 C 확장(DB 드라이버, 수치 계산 라이브러리)이 모두 free-threading을 지원해야 워커 프로세스 대신 스레드로 vCPU 여러 개를 쓸 수 있다.

## 정리

- CPython 프로세스 하나에서 Python 코드는 GIL을 쥔 스레드 하나만 실행하고, 기다리는 스레드가 있으면 약 5ms마다 GIL을 넘긴다.
- 블로킹 I/O와 일부 C 코드는 GIL을 놓으므로, 스레드는 대기를 겹치는 데 쓸모 있지만 Python 계산은 빨라지지 않는다.
- asyncio는 스레드 하나가 epoll로 대기를 겹치고, await 없이 기다리는 호출 하나가 루프 전체를 멈춘다.
- Uvicorn은 요청마다 태스크를 만들고, FastAPI의 `def` 엔드포인트는 AnyIO 스레드 풀(기본 40칸)에서 돈다.
- 여러 vCPU는 워커 프로세스로 쓰고, 쿠버네티스에서는 컨테이너당 프로세스 하나에 request와 풀 크기를 맞춘다.
- free-threaded 빌드(3.14 공식 지원)는 GIL을 없애지만, 단일 스레드 비용과 C 확장 지원을 함께 따진다.

## 참고

- [CPython 소스 — Python/ceval_gil.c](https://github.com/python/cpython/blob/main/Python/ceval_gil.c)
- [Python — sys.setswitchinterval](https://docs.python.org/3/library/sys.html#sys.setswitchinterval)
- [Python — Library and Extension FAQ, Threads](https://docs.python.org/3/faq/library.html#threads)
- [Python C API — Thread states and the global interpreter lock](https://docs.python.org/3/c-api/threads.html)
- [Gunicorn — Design](https://gunicorn.org/design/)
- [CPython 소스 — Lib/asyncio/base_events.py](https://github.com/python/cpython/blob/main/Lib/asyncio/base_events.py)
- [Python — selectors](https://docs.python.org/3/library/selectors.html)
- [Python — asyncio Coroutines and Tasks](https://docs.python.org/3/library/asyncio-task.html)
- [Python — Developing with asyncio](https://docs.python.org/3/library/asyncio-dev.html)
- [ASGI — Introduction](https://asgi.readthedocs.io/en/latest/introduction.html)
- [Uvicorn — Settings](https://uvicorn.dev/settings/)
- [Uvicorn 소스 — protocols/http/httptools_impl.py](https://github.com/encode/uvicorn/blob/master/uvicorn/protocols/http/httptools_impl.py)
- [FastAPI — Concurrency and async / await](https://fastapi.tiangolo.com/async/)
- [Starlette — Thread Pool](https://www.starlette.dev/threadpool/)
- [AnyIO — Working with threads](https://anyio.readthedocs.io/en/stable/threads.html)
- [FastAPI — Server Workers](https://fastapi.tiangolo.com/deployment/server-workers/)
- [FastAPI — FastAPI in Containers](https://fastapi.tiangolo.com/deployment/docker/)
- [Python — concurrent.futures](https://docs.python.org/3/library/concurrent.futures.html)
- [Python — os.process_cpu_count](https://docs.python.org/3/library/os.html#os.process_cpu_count)
- [PEP 703 — Making the Global Interpreter Lock Optional in CPython](https://peps.python.org/pep-0703/)
- [PEP 779 — Criteria for supported status for free-threaded Python](https://peps.python.org/pep-0779/)
- [What's New In Python 3.14](https://docs.python.org/3/whatsnew/3.14.html)
- [Python — Python support for free threading](https://docs.python.org/3/howto/free-threading-python.html)
- 원글: [GIL, ASGI, Uvicorn(/w fastapi)](https://kimjanghyun1010.tistory.com/98), [비동기 ??? asyncio ???](https://kimjanghyun1010.tistory.com/45)
