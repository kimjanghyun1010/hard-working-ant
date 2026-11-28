---
title: Jenkins 파이프라인
description: Jenkinsfile의 코드 한 줄이 컨트롤러와 에이전트 중 어디서, 어떤 권한으로 도는지를 실행기와 큐, CPS 해석과 sh 스텝, 파드 에이전트, kaniko, Shared Library와 권한 순서로 따라간다.
date: 2026-11-03 12:00:00 +0900
series: CI/CD와 IaC
tags: [jenkins, ci, groovy, kubernetes, kaniko]
scripts: [figures/jenkins-pipeline.js]
---

## 컨트롤러와 에이전트

Jenkinsfile의 코드 한 줄은 컨트롤러와 에이전트 중 어디서, 어떤 권한으로 돌까? Jenkins는 일을 두 자리로 나눈다.

- 컨트롤러(controller): webhook(push가 생기면 Git 서버가 보내는 HTTP 요청)을 받아 빌드를 큐에 넣고, Jenkinsfile을 해석해 순서를 정하고, 로그와 결과를 기록한다. 예전 문서의 master다.
- 에이전트(agent): 실제 명령을 실행한다. 예전 문서의 slave다.

아래 그림처럼 커밋 하나가 배포되는 동안 컨트롤러는 순서만 정하고, 빌드와 이미지 push와 배포는 에이전트 파드 안에서 돈다.

<figure class="fig" data-figure="jenkins-pipeline-flow">
  <figcaption>커밋 하나가 컨트롤러와 에이전트 파드를 거쳐 배포되는 길</figcaption>
</figure>

빌드 하나를 돌리는 칸을 실행기(executor)라 한다. 칸이 모자라면 빌드는 큐에서 "Waiting for next available executor"를 띄우고 기다린다.

컨트롤러에도 실행기를 둘 수 있지만 0개로 둔다. 컨트롤러에서 도는 빌드는 Jenkins 프로세스와 같은 권한으로 컨트롤러의 파일 시스템(`JENKINS_HOME`)에 접근하기 때문이다. 쿠버네티스에 Jenkins를 설치하는 공식 패키지인 Jenkins 헬름 차트도 `controller.numExecutors` 기본값이 0이다.

에이전트를 붙이는 방식은 둘이다.

- 고정 에이전트: VM 몇 대를 미리 붙여 둔다. 실행기 수가 정해져 있다.
- 동적 에이전트: 빌드가 큐에 들어오면 클라우드 플러그인이 쿠버네티스 파드나 ECS 태스크를 띄우고, 끝나면 지운다.

아래 데모에서 모드를 바꿔 가며 빌드 5개 넣기를 누르고, 마지막 빌드가 끝나는 시각을 견준다.

<figure class="fig" data-figure="jenkins-pipeline-agents">
  <figcaption>빌드 5개가 몰릴 때 고정 에이전트와 파드 에이전트 (빌드 40초, 파드 생성 15초는 가정값)</figcaption>
</figure>

고정 에이전트 2대면 셋째 빌드부터 큐에서 기다려 마지막 빌드가 120초에 끝난다. 파드 에이전트는 빌드마다 파드를 띄우는 15초를 치르지만 다섯이 같이 돌아 55초에 끝난다. 고정 에이전트의 마지막 빌드는 큐에서 80초를 기다렸고, 파드 에이전트는 그 대기를 파드 생성 15초로 바꿨다.

파드 에이전트에도 천장이 있다. 헬름 차트는 쿠버네티스 cloud 설정 하나가 띄우는 에이전트 파드 수 상한 `containerCap`을 10으로 두어 열한째 빌드부터 다시 큐에서 기다린다. 노드에 자리가 없으면 파드가 Pending으로 남아 큐 대기가 노드 대기로 바뀔 뿐이라, 빌드용 노드 풀은 노드 수를 자동으로 늘리는 클러스터 오토스케일러와 같이 잡는다.

## Jenkinsfile 해석

### CPS 변환

에이전트가 수백 개여도 Jenkinsfile을 해석하는 곳은 컨트롤러 하나다. Jenkins는 Jenkinsfile을 CPS(continuation-passing style)로 바꿔 컨트롤러에서 실행한다. CPS는 "다음에 할 일"을 값으로 들고 다니게 코드를 바꾸는 방식이라, 실행 중인 프로그램의 상태를 통째로 디스크에 저장할 수 있다.

저장된 상태는 빌드 디렉터리의 `program.dat`에 남고, 컨트롤러가 재시작되면 파이프라인은 이 파일에서 멈춘 자리부터 이어진다. 기본 내구성 설정 `MAX_SURVIVABILITY`는 스텝마다 기록을 디스크에 쓴다. 쓰기를 줄인 `PERFORMANCE_OPTIMIZED`는 빠르지만, 컨트롤러가 강제 종료(SIGKILL)나 메모리 부족(OOM)으로 갑자기 끝나면 진행 중이던 빌드를 이어 가지 못할 수 있다.

Jenkinsfile 안에서 Groovy인 것과 Jenkins 스텝인 것은 도는 자리가 다르다.

- `def`, `if`, `each`, 리스트와 맵, 클로저: Groovy 코드다. 컨트롤러가 직접 돌린다.
- `sh`, `writeFile`, `withCredentials`: Jenkins 스텝이다. 명령과 파일에 관한 일은 에이전트에서 한다.

아래 데모에서 같은 JSON 파싱을 Groovy와 `sh`에 맡기는 두 모드를 바꿔 가며 빌드 실행을 누르고, 컨트롤러 줄이 차는 시간을 견준다.

<figure class="fig" data-figure="jenkins-pipeline-cps">
  <figcaption>같은 파싱을 Groovy와 sh에 맡길 때 컨트롤러가 쓰는 시간 (시간은 대략값)</figcaption>
</figure>

Groovy로 파싱하면 30초 동안 컨트롤러가 일하고 에이전트는 기다린다. `sh`로 넘기면 같은 30초를 에이전트가 쓰고 컨트롤러는 결과 한 줄만 받는다.

컨트롤러는 모든 빌드의 Groovy를 한 JVM에서 돌린다. 빌드 10개가 같이 Groovy로 파싱하면 그 JVM 하나가 300초어치 일을 떠안는다. 공식 모범 사례 문서는 `readFile`과 `JsonSlurper`를 같이 쓰면 파일이 컨트롤러 메모리에 두 번 올라간다고 적는다.

```groovy
// 컨트롤러가 파일을 통째로 받아 파싱한다
def report = new groovy.json.JsonSlurper().parseText(readFile('report.json'))

// 에이전트가 읽고 결과 한 줄만 돌려준다
def failed = sh(script: "jq '.failed' report.json", returnStdout: true).trim()
```

Groovy에는 stage 순서와 조건만 두고, 파일 처리, HTTP 호출, 반복 계산은 `sh`로 보낸다.

### sh 스텝

`sh`는 명령을 에이전트로 보낸 뒤 연결을 붙잡고 기다리지 않는다. durable-task 플러그인이 명령을 workspace 옆 임시 디렉터리에 스크립트로 쓰고, 이를 감싼 래퍼 셸이 `nohup`(띄운 셸이 끝나도 명령이 계속 돌게 하는 도구)으로 띄운다.

```text
/home/jenkins/agent/workspace/order@tmp/durable-1a2b3c4d/
├── script.sh            # sh 스텝에 넘긴 명령
├── jenkins-log.txt      # 표준 출력과 오류
└── jenkins-result.txt   # 끝나면 종료 코드가 적힌다
```

컨트롤러는 `jenkins-log.txt`를 읽어 콘솔 로그에 붙이고, `jenkins-result.txt`가 생기면 스텝을 끝낸다. 읽는 간격은 출력이 없으면 0.25초에서 1.2배씩 15초까지 벌어지고, 출력이 오면 0.25초로 돌아온다.

래퍼는 명령이 도는 동안 3초마다 로그 파일을 touch하고, 컨트롤러는 5분마다 이 시각을 보고 프로세스가 살아 있는지 판단한다.

명령이 컨트롤러와 떨어진 프로세스로 돌기 때문에, 컨트롤러가 재시작되는 동안에도 `make test`는 계속 돈다. 컨트롤러는 돌아온 뒤 `program.dat`로 파이프라인을 되살리고, 저장해 둔 위치부터 로그를 다시 읽는다.

### 문자열 치환과 자격증명

`sh`에 넘기는 명령 문자열은 컨트롤러의 Groovy가 완성해서 보낸다. Groovy는 따옴표에 따라 문자열 타입이 다르다.

- `'...'`: `java.lang.String`. `${}` 치환이 없다.
- `"..."`: 치환이 있으면 `groovy.lang.GString`. 컨트롤러가 `${}` 자리를 값으로 채운다.
- `'''...'''`, `"""..."""`: 여러 줄 버전. 치환 규칙은 위와 같다.

아래 그림처럼 큰따옴표 안의 `${TOKEN}`은 컨트롤러를 떠나기 전에 실제 값이 된다.

<figure class="fig" data-figure="jenkins-pipeline-quote">
  <figcaption>따옴표에 따라 비밀값을 푸는 자리</figcaption>
</figure>

값이 명령 문자열에 박히면 셸 프로세스의 인자에 복사돼, 실행 중인 프로세스와 인자를 보여 주는 `ps`로 누구나 볼 수 있다. 작은따옴표면 `$TOKEN` 글자가 그대로 가고, 에이전트의 셸이 `withCredentials`가 넣어 둔 환경 변수에서 값을 읽는다.

```groovy
withCredentials([string(credentialsId: 'registry-token', variable: 'TOKEN')]) {
  sh 'curl -H "Authorization: Bearer $TOKEN" https://registry.example.com/v2/'
}
```

Jenkins는 큰따옴표로 비밀값을 넘긴 스텝을 찾아 콘솔에 경고를 남긴다. 컨트롤러 JVM에 `-Dorg.jenkinsci.plugins.workflow.cps.DSL.UNSAFE_GROOVY_INTERPOLATION=fail`을 주면 경고가 빌드 실패로 바뀐다.

```text
Warning: A secret was passed to "sh" using Groovy String interpolation, which is insecure.
         Affected argument(s) used the following variable(s): [TOKEN]
```

사용자가 넣은 빌드 파라미터를 큰따옴표로 끼우는 것도 같은 문제다. 값에 `; rm -rf ~`가 들어 있으면 에이전트의 셸이 그대로 실행한다. 로그의 `****` 가림도 `withCredentials` 블록 안에서만 동작하므로, 값을 확인할 때는 길이나 해시만 찍는다.

## 파드 에이전트

`sh`가 보낸 명령이 실제로 도는 곳은 에이전트 파드다. Kubernetes 플러그인은 빌드마다 파드 템플릿으로 파드를 만들고, 그 안의 `jnlp` 컨테이너에서 에이전트 프로세스(`jenkins/inbound-agent` 이미지)를 띄운다. 에이전트는 컨트롤러로 먼저 연결을 거는데(inbound), 헬름 차트 기본값은 TCP 50000 포트이고 `agent.websocket: true`면 HTTP(S) 포트로 붙는다.

파드에는 컨테이너를 여럿 둘 수 있어서, 에이전트 이미지에 도구를 다 넣지 않고 kaniko, kubectl처럼 단계별 도구를 컨테이너로 더한다. 아래 그림처럼 단계마다 `container()`로 실행할 컨테이너를 고른다.

<figure class="fig" data-figure="jenkins-pipeline-pod">
  <figcaption>빌드마다 생기고 지워지는 에이전트 파드</figcaption>
</figure>

컨테이너가 달라도 소스가 그대로 보이는 것은 workspace 볼륨 덕분이다. 기본값은 파드가 뜰 때 노드 디스크에 만드는 빈 폴더(`emptyDir`)이고, 파드의 모든 컨테이너가 같은 경로(`/home/jenkins/agent`)에 마운트한다. `container()` 스텝은 쿠버네티스 API의 exec로 다른 컨테이너에서 명령을 돌린다.

차트 기본값이 `podRetention: Never`, `idleMinutes: 0`이라 빌드가 끝나면 파드와 workspace가 함께 지워진다. 남길 파일은 아티팩트나 레지스트리로 내보낸다.

## 데몬 없는 이미지 빌드

에이전트 파드에서 `docker build`를 부르면 `Cannot connect to the Docker daemon`이 뜬다. 쿠버네티스 1.24에서 Docker를 런타임으로 쓰게 해 주던 dockershim이 빠졌다. 그 뒤로 노드는 containerd 같은 런타임으로 컨테이너를 띄우고, 파드가 이미지 빌드를 맡길 Docker 데몬(dockerd)은 없다. 노드의 `docker.sock`을 마운트하는 우회도 있지만, 그 소켓을 쥔 파드는 노드의 root와 같다.

kaniko는 데몬 없이 컨테이너 안에서 이미지를 만든다.

- 베이스 이미지(`FROM`)의 파일 시스템을 자기 컨테이너의 루트에 푼다.
- Dockerfile 명령을 하나씩 직접 실행하고, 명령마다 바뀐 파일을 사용자 공간에서 스냅샷으로 떠 레이어를 만든다.
- 다 만든 이미지를 레지스트리로 바로 push한다. 인증은 `/kaniko/.docker/config.json`에서 읽는다.

자기 컨테이너의 루트를 빌드 대상으로 쓰므로, kaniko는 빌드 중에 `/kaniko`와 마운트된 경로를 뺀 나머지를 지우고 덮어쓴다. 파드에서는 workspace가 마운트된 볼륨이라 안전하다. 아래 그림의 셋째 장면처럼 에이전트와 kaniko가 한 컨테이너에서 돌 때 일이 생긴다.

<figure class="fig" data-figure="jenkins-pipeline-kaniko">
  <figcaption>docker build, kaniko, 한 컨테이너에서 도는 kaniko</figcaption>
</figure>

Jenkins amazon-ecs-plugin의 Fargate 에이전트는 사이드카를 붙일 수 없어(이슈 #331) 에이전트와 kaniko가 한 컨테이너에서 돈다. 여기서는 workspace가 마운트가 아니라서, `FROM`이 여럿인 멀티스테이지 빌드의 다음 `FROM`에서 함께 지워진다. 그래서 `--ignore-path=/home/jenkins`로 뺀다.

kaniko 원 저장소는 2025년 6월 3일에 아카이브됐고, 지금은 Chainguard 포크와 커뮤니티 포크(osscontainertools/kaniko)가 이어 간다.

## Shared Library

kaniko 옵션, `--ignore-path`, 파드 템플릿은 서비스마다 같다. 서비스 20개의 Jenkinsfile에 복사해 두면 옵션 하나를 바꾸는 데 PR 20개가 든다. Shared Library는 파이프라인 코드를 담는 별도 Git 저장소이고, 디렉터리마다 쓰임이 정해져 있다.

- `vars/`: Jenkinsfile에서 부를 함수. 파일 이름이 곧 이름이라 `vars/buildApp.groovy`는 `buildApp()`으로 부른다.
- `src/`: Java 패키지 구조의 Groovy 클래스. 여러 파이프라인이 같이 쓰는 상수와 도우미를 둔다.
- `resources/`: Dockerfile, 파드 템플릿 같은 파일. `libraryResource`로 문자열을 읽는다.

라이브러리는 Jenkinsfile을 컴파일할 때, 실행이 시작되기 전에 받아 온다. `@Library('pipeline-lib@v1.3') _`처럼 버전을 적으면 그 브랜치, 태그, 커밋에 고정하고, 적지 않으면 등록할 때 정한 기본 버전을 쓴다. 아래 그림처럼 라이브러리를 한 번 고치면 버전을 고정하지 않은 서비스에 다음 빌드부터 반영된다.

<figure class="fig" data-figure="jenkins-pipeline-library">
  <figcaption>서비스 Jenkinsfile이 부르는 Shared Library</figcaption>
</figure>

```groovy
// vars/buildApp.groovy
def call(String image) {
  writeFile file: 'Dockerfile', text: libraryResource('docker/python.Dockerfile')
  container('kaniko') {
    sh "/kaniko/executor --context=dir://${env.WORKSPACE} --destination=${image}"
  }
}
```

라이브러리 코드도 Groovy라 컨트롤러에서 돌고, 받는 권한은 등록한 자리에 따라 다르다.

- 글로벌 라이브러리(Manage Jenkins에 등록): 신뢰된(trusted) 코드다. 샌드박스 밖에서 Java와 Jenkins 내부 API를 제한 없이 부른다.
- 폴더 라이브러리: 항상 신뢰되지 않은 코드로, Jenkinsfile과 같은 샌드박스 안에서 돈다.

샌드박스(Groovy sandbox)는 안전하다고 정해 둔 메서드만 허락하는 실행 환경이다. 목록에 없는 메서드를 부르면 스크립트가 그 자리에서 멈추고, 관리자가 Script Approval 화면에서 그 메서드를 승인해야 돈다. 글로벌 라이브러리는 이 검사를 받지 않아서, 공식 문서는 그 저장소에 커밋을 push할 수 있는 사람이 Jenkins에 무제한 접근할 수 있다고 경고한다.

## 권한

Jenkins 헬름 차트의 기본 권한 설정은 `loggedInUsersCanDoAnything`이다. 로그인만 하면 운영 배포 Job도 빌드하고 고칠 수 있다. 역할 단위 권한은 Role-based Authorization Strategy 플러그인으로 준다.

- 전역 역할: `Overall/Administer`, `Overall/Read`처럼 Jenkins 전체에 걸린다. 항목 역할에 무엇을 적든 전역 역할이 우선한다.
- 항목 역할: 정규식 패턴에 맞는 Job과 폴더에만 걸린다. 패턴은 폴더 경로까지 포함한 전체 이름에 맞추고, 대소문자를 가린다.

역할을 받을 그룹은 회사 계정 디렉터리인 LDAP나 AD 같은 인증(security realm)에서 온다. Jenkins 자체 사용자 DB에는 그룹 기능이 없고, 로그인한 모든 사용자가 든 `authenticated`만 있다.

항목 역할의 패턴은 끝을 막아 쓴다. `DEV.*`는 `DEV` 폴더뿐 아니라 `DEVOPS` 폴더에도 맞는다. 폴더 안 Job을 쓰려면 폴더 자체에도 권한이 있어야 해서, 폴더와 그 안을 같이 고르는 `DEV($|/.*)` 꼴로 쓴다. 역할 표는 JCasC(Jenkins 설정을 YAML로 적어 기동 때 적용하는 플러그인)로 차트 values에 둔다.

```yaml
controller:
  JCasC:
    authorizationStrategy: |-
      roleBased:
        roles:
          items:
            - name: dev
              pattern: "DEV($|/.*)"
              permissions: ["Job/Build", "Job/Cancel", "Job/Read"]
              entries:
                - user: developer@example.com
```

아래 그림처럼 역할 표가 developer를 `DEV` 폴더에 묶어도, 표 밖에서 권한이 생기는 자리가 셋 있다.

<figure class="fig" data-figure="jenkins-pipeline-rbac">
  <figcaption>폴더 패턴으로 나눈 역할 표와 그 밖의 권한</figcaption>
</figure>

- 글로벌 라이브러리: 샌드박스 밖에서 도니, 그 저장소의 push 권한이 관리자 권한이다. 브랜치 보호와 리뷰를 걸고, 서비스는 태그로 버전을 고정한다.
- `Job/Configure`: 공식 권한 문서상 `Run/Replay`를 포함한다. Replay는 Jenkinsfile을 고쳐 그 자리에서 다시 돌리는 기능이라, 그 Job이 쓰는 자격증명으로 아무 코드나 돌릴 수 있다. 운영 폴더에서는 빌드와 설정 권한을 나눈다.
- 자격증명 범위: 전역이 아니라 폴더 단위로 둬서, 운영 kubeconfig가 개발 폴더 Job에 보이지 않게 한다.

## 정리

- 컨트롤러는 큐와 해석만 맡고 실행기는 0개다. 파드 에이전트는 큐 대기를 없애지만 `containerCap`과 노드 자리가 새 천장이다.
- Groovy는 CPS로 바뀌어 컨트롤러 한 JVM에서 돌고, 상태는 `program.dat`에 남는다. 무거운 일은 `sh`로 에이전트에 보낸다.
- `sh`는 `nohup` 래퍼와 로그 파일로 돌아 재시작을 견딘다. 명령 문자열은 컨트롤러에서 완성되니 비밀값은 작은따옴표로 넘긴다.
- 파드의 컨테이너는 workspace 볼륨을 같이 쓴다. 노드에 dockerd가 없어 kaniko로 이미지를 만들고, 한 컨테이너면 `--ignore-path`로 workspace를 지킨다.
- 반복되는 빌드 코드는 Shared Library로 모은다. 글로벌 라이브러리는 샌드박스 밖에서 돌아 push 권한이 관리자 권한이다.
- 권한은 역할 표와 함께 `Job/Configure`와 자격증명 범위까지 본다.

## 참고

- [Jenkins — Pipeline Best Practices](https://www.jenkins.io/doc/book/pipeline/pipeline-best-practices/)
- [Jenkins — Pipeline CPS Method Mismatches](https://www.jenkins.io/doc/book/pipeline/cps-method-mismatches/)
- [Jenkins — Scaling Pipelines (durability settings)](https://www.jenkins.io/doc/book/pipeline/scaling-pipeline/)
- [Jenkins — Using a Jenkinsfile (string interpolation, credentials)](https://www.jenkins.io/doc/book/pipeline/jenkinsfile/)
- [Jenkins — Extending with Shared Libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/)
- [Jenkins — In-process Script Approval](https://www.jenkins.io/doc/book/managing/script-approval/)
- [Jenkins — Controller Isolation](https://www.jenkins.io/doc/book/security/controller-isolation/)
- [Jenkins — Permissions](https://www.jenkins.io/doc/book/security/access-control/permissions/)
- [durable-task plugin — BourneShellScript.java](https://github.com/jenkinsci/durable-task-plugin/blob/master/src/main/java/org/jenkinsci/plugins/durabletask/BourneShellScript.java)
- [workflow-durable-task-step plugin — DurableTaskStep.java](https://github.com/jenkinsci/workflow-durable-task-step-plugin/blob/master/src/main/java/org/jenkinsci/plugins/workflow/steps/durable_task/DurableTaskStep.java)
- [workflow-cps plugin — DSL.java (UNSAFE_GROOVY_INTERPOLATION)](https://github.com/jenkinsci/workflow-cps-plugin/blob/master/plugin/src/main/java/org/jenkinsci/plugins/workflow/cps/DSL.java)
- [Jenkins plugin — Kubernetes](https://plugins.jenkins.io/kubernetes/)
- [Jenkins plugin — Role-based Authorization Strategy](https://plugins.jenkins.io/role-strategy/)
- [Jenkins Helm chart — values.yaml](https://github.com/jenkinsci/helm-charts/blob/main/charts/jenkins/values.yaml)
- [amazon-ecs-plugin #331 — Add support for Sidecars in ECS Template](https://github.com/jenkinsci/amazon-ecs-plugin/issues/331)
- [Groovy — Syntax (strings)](https://groovy-lang.org/syntax.html#all-strings)
- [Kubernetes — Migrating from dockershim](https://kubernetes.io/docs/tasks/administer-cluster/migrating-from-dockershim/)
- [GoogleContainerTools/kaniko (archived)](https://github.com/GoogleContainerTools/kaniko)
- [kaniko #2509 — Multi-Stage Image builds are failing at Stage 0](https://github.com/GoogleContainerTools/kaniko/issues/2509)
- [Chainguard — Fork yeah: We're bringing kaniko back](https://www.chainguard.dev/unchained/fork-yeah-were-bringing-kaniko-back)
- 원글: [Jenkinsfile 작성법](https://kimjanghyun1010.tistory.com/17), [Jenkins Shared Library (w/ kaniko)](https://kimjanghyun1010.tistory.com/79), [Jenkins Pipeline간 전역변수 사용(w/ Shared Libray)](https://kimjanghyun1010.tistory.com/81), [Jenkins Chain Job, Artifact](https://kimjanghyun1010.tistory.com/80), [Jenkins RBAC(w/ helm chart)](https://kimjanghyun1010.tistory.com/82), [Jenkins ECS slave (w/ kaniko)](https://kimjanghyun1010.tistory.com/83)
