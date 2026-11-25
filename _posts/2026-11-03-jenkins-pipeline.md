---
title: Jenkins 파이프라인
description: 커밋 하나가 빌드, 이미지, 배포로 이어지는 Jenkins 파이프라인을 컨트롤러와 에이전트, Jenkinsfile과 Groovy, Shared Library, Job 연결, kaniko 이미지 빌드, 권한까지 정리했다.
date: 2026-11-03 12:00:00 +0900
series: CI/CD와 IaC
tags: [jenkins, ci, groovy, kubernetes, kaniko]
scripts: [figures/jenkins-pipeline.js]
---

## 커밋에서 배포까지

main 브랜치에 커밋 하나를 push하면 몇 분 뒤 새 버전이 클러스터에 떠 있다. 그 사이에 Jenkins는 커밋을 받아 테스트하고, 컨테이너 이미지를 만들어 레지스트리에 올리고, 클러스터에 배포한다.

이 일은 두 자리에서 나눠 한다. 예전 문서의 master와 slave가 지금의 컨트롤러와 에이전트다.

- 컨트롤러(controller): webhook을 받아 빌드를 큐에 넣고, Jenkinsfile을 해석해 순서를 정하고, 결과를 기록한다.
- 에이전트(agent): 실제 명령을 실행한다. 빌드마다 쿠버네티스 파드나 ECS 태스크로 새로 띄울 수 있다.

커밋 하나가 배포까지 가는 길을 따라가 보자. 에이전트 파드가 뜨는 순간부터 컨트롤러는 순서만 정하고, 빌드와 push와 배포가 전부 오른쪽 파드 안에서 도는 것을 본다.

<figure class="fig" data-figure="jenkins-pipeline-flow">
  <figcaption>커밋 하나가 컨트롤러와 에이전트 파드를 거쳐 배포되는 길</figcaption>
</figure>

빌드, 이미지, 배포는 모두 에이전트 안의 셸 명령이고, 빌드가 끝나면 파드는 지워진다. 컨트롤러에 남는 것은 큐와 Jenkinsfile 해석, 빌드 기록뿐이다.

파이프라인이 느려지거나 위험해지는 곳도 이 길 위에 있다. 일이 컨트롤러 한 대에 몰리고, 같은 빌드 코드가 저장소마다 복사되고, 이미지를 만들 데몬이 노드에 없고, 파이프라인을 고칠 수 있는 사람이 생각보다 많다.

## 실행 위치

### 컨트롤러와 에이전트

빌드가 몰리는 오전, 빌드 큐에 "Waiting for next available executor"가 줄줄이 쌓인다. 실행기(executor)는 빌드 하나를 돌리는 칸이고, 칸이 모자라면 빌드는 큐에서 기다린다.

컨트롤러에도 실행기가 있지만 0개로 둔다. 컨트롤러에서 도는 빌드는 Jenkins 프로세스와 같은 권한으로 컨트롤러의 파일 시스템에 접근하기 때문이다. Jenkins 헬름 차트도 `controller.numExecutors` 기본값이 0이다.

에이전트를 붙이는 방식은 둘이다.

- 고정 에이전트: VM 몇 대를 미리 붙여 둔다. 실행기 수가 정해져 있다.
- 동적 에이전트: 빌드가 큐에 들어오면 클라우드 플러그인이 파드나 ECS 태스크를 띄우고, 끝나면 지운다.

아래 데모에서 빌드 5개를 한꺼번에 넣어 보자. 모드를 바꿔 가며 마지막 빌드가 끝나는 시각을 본다.

<figure class="fig" data-figure="jenkins-pipeline-agents">
  <figcaption>빌드 5개가 몰릴 때 고정 에이전트와 파드 에이전트</figcaption>
</figure>

빌드 하나 40초, 파드 생성 15초는 모양을 보여 주려고 가정한 값이다.

고정 에이전트 2대에서는 셋째 빌드부터 큐에서 기다려 마지막 빌드가 120초에 끝난다. 파드 에이전트는 빌드마다 15초씩 파드를 띄우는 값을 치르지만 다섯이 같이 돌아 55초에 끝난다. 빌드 하나에 드는 시간은 같고, **큐에서 기다리는 시간**만 사라졌다.

파드도 노드에 자리가 있어야 뜬다. 노드가 모자라면 파드가 Pending으로 남아 큐 대기가 노드 대기로 바뀔 뿐이다. 빌드용 노드 풀은 오토스케일러와 같이 잡고, 빌드가 몰리는 시간대의 Pending 파드 수부터 본다.

### 파드 에이전트

Kubernetes 플러그인은 에이전트마다 파드를 만들고 빌드가 끝나면 지운다. 파드에는 컨테이너를 여러 개 둘 수 있고, 에이전트 프로세스는 기본으로 `jnlp`라는 이름의 컨테이너에서 돈다.

나머지 컨테이너는 단계별 도구다. 이미지 빌드는 kaniko 컨테이너에서, 배포는 kubectl 컨테이너에서 돌리면 에이전트 이미지에 도구를 다 넣지 않아도 된다.

세 장면에서 빌드 단계가 어느 컨테이너로 옮겨 가는지, 소스가 있는 workspace가 언제 사라지는지 본다.

<figure class="fig" data-figure="jenkins-pipeline-pod">
  <figcaption>빌드마다 생기고 지워지는 에이전트 파드</figcaption>
</figure>

컨테이너는 달라도 workspace 볼륨을 같이 마운트해서, kaniko가 jnlp 컨테이너가 받아 둔 소스를 그대로 읽는다. 빌드가 끝나면 workspace도 파드와 함께 지워지므로, 남길 파일은 아티팩트나 레지스트리로 내보낸다.

파드 템플릿 YAML은 저장소에 두고 불러온다. 빌드 환경이 코드와 같이 리뷰되고 버전이 남는다.

```groovy
pipeline {
  agent {
    kubernetes {
      yaml agentPod('build')        // Shared Library의 함수가 YAML 문자열을 돌려준다
    }
  }
  stages {
    stage('테스트') {
      steps { sh 'make test' }      // 기본 컨테이너 jnlp
    }
    stage('이미지') {
      steps {
        container('kaniko') { sh '/kaniko/executor --context=dir://$WORKSPACE --destination=$IMAGE' }
      }
    }
  }
}
```

에이전트 이미지는 가볍게 두고, 도구는 컨테이너 단위로 파드 템플릿에 더한다.

### ECS 에이전트

쿠버네티스 노드를 빌드용으로 크게 잡아 두기 아까울 때, 무거운 빌드만 ECS Fargate 태스크로 보낼 수 있다. Amazon ECS 플러그인에 클라우드를 등록하고 라벨을 붙이면, `agent { label 'ecs' }`인 stage만 Fargate에서 돈다.

```yaml
jenkins:
  clouds:
    - ecs:
        name: ecs-cloud
        cluster: arn:aws:ecs:ap-northeast-2:111122223333:cluster/jenkins-agent
        templates:
          - label: ecs
            templateName: build
            taskDefinitionOverride: jenkins-agent-task   # Terraform으로 만든 태스크 정의
            capacityProviderStrategies:
              - provider: FARGATE_SPOT
                weight: 1
```

파드 템플릿과 달리 ECS 템플릿에는 컨테이너가 하나뿐이다. 사이드카 컨테이너를 지원해 달라는 이슈(#331)는 2026년 11월에도 열려 있다. 두 장면에서 이미지 빌드 단계가 어디서 도는지 견줘 보자.

<figure class="fig" data-figure="jenkins-pipeline-ecs">
  <figcaption>컨테이너를 고르는 파드와 컨테이너가 하나인 ECS 태스크</figcaption>
</figure>

파드는 이미지 빌드 단계만 kaniko 컨테이너로 옮겨 가고, ECS는 한 컨테이너에서 에이전트와 kaniko가 같이 돈다. 그래서 kaniko 실행 파일을 에이전트 이미지에 넣어 굽는다.

```dockerfile
FROM <kaniko executor 이미지> AS kaniko
FROM jenkins/inbound-agent
COPY --from=kaniko /kaniko /kaniko
ENV PATH=/kaniko:$PATH DOCKER_CONFIG=/kaniko/.docker/
```

레지스트리 인증 파일(`config.json`)은 이미지에 넣지 않는다. 그 이미지를 받을 수 있는 사람은 누구나 비밀번호를 얻는다. ECR이면 태스크 IAM 역할로 인증하고, 다른 레지스트리면 실행할 때 Secrets Manager에서 받아 쓴다.

`FARGATE_SPOT`은 싸지만 AWS가 자리를 돌려받을 때 2분 예고 뒤 태스크를 멈춘다. 도중에 끊겨도 다시 돌리면 되는 빌드만 Spot에 두고, 배포 단계는 일반 Fargate나 파드에 둔다.

### Groovy 실행 위치

빌드 수가 늘자 에이전트는 남는데 컨트롤러 CPU와 메모리가 먼저 찬다. Jenkinsfile에 쓴 Groovy 코드가 전부 컨트롤러에서 돌기 때문이다.

Jenkins는 Jenkinsfile을 CPS(continuation-passing style)로 바꿔 컨트롤러에서 해석한다. `def`, `if`, `each` 같은 Groovy 코드는 컨트롤러가 직접 돌리고, `sh` 같은 스텝을 만나면 그 명령만 에이전트로 보낸다.

Jenkinsfile에서 보는 것의 절반은 Groovy 문법이 아니라 Jenkins가 만든 스텝이다.

- `sh 'make'`는 `sh('make')`다. 최상위 호출의 괄호를 뺄 수 있는 Groovy 문법이라 설정 파일처럼 보일 뿐이다.
- `git url: '...', branch: 'main'`처럼 이름 붙인 인자는 Map 하나를 넘기는 것이다.
- `node`, `stage`, `sh`, `withCredentials`는 Jenkins 스텝이다. Groovy인 것은 `def`, 리스트와 맵, 클로저, `?.`와 `?:` 정도다.

같은 JSON 파싱을 컨트롤러의 Groovy와 에이전트의 셸에 맡겨 보자. 모드를 바꿔 가며 컨트롤러 줄이 얼마나 차는지 본다.

<figure class="fig" data-figure="jenkins-pipeline-cps">
  <figcaption>같은 파싱을 Groovy와 sh에 맡길 때 컨트롤러가 쓰는 시간 (시간은 모양을 보여 주는 대략값)</figcaption>
</figure>

Groovy로 파싱하면 30초 동안 컨트롤러가 일하고 에이전트는 기다린다. sh로 넘기면 같은 30초를 에이전트가 쓰고, 컨트롤러는 결과 한 줄만 받는다. 파싱하는 양은 같고 **그 일을 떠안는 자리**만 바뀌었다.

에이전트는 빌드마다 따로 있지만 컨트롤러는 하나다. 빌드 수십 개의 Groovy가 한 곳에 쌓이고, 공식 문서도 `readFile`과 `JsonSlurper`가 파일을 컨트롤러 메모리에 두 번 올린다고 적어 둔다.

```groovy
// 컨트롤러가 파일을 통째로 읽어 파싱한다
def report = new groovy.json.JsonSlurper().parseText(readFile('report.json'))

// 에이전트가 읽고 결과 한 줄만 돌려준다
def failed = sh(script: "jq '.failed' report.json", returnStdout: true).trim()
```

Groovy에는 stage 순서와 조건만 두고, 파일 처리, HTTP 호출, 반복 계산은 `sh` 안으로 보낸다.

## 파이프라인 코드

### 선언형 뼈대

빌드가 실패했는데 Slack 알림이 오지 않는다. 알림을 마지막 stage에 두면, 앞 stage가 실패했을 때 거기까지 가지 못한다.

선언형(Declarative) 파이프라인은 `pipeline` 블록 하나에 정해진 블록을 채운다. 자리를 벗어난 코드는 실행 전 문법 검사에서 걸린다.

- `agent`: 어디서 돌지. 맨 위에 두면 전체, stage 안에 두면 그 stage만이다. 맨 위를 `none`으로 두면 stage마다 정한다.
- `environment`: 환경 변수. 이것도 둔 위치가 범위다.
- `options`: 시간 제한 같은 동작 옵션.
- `stages`, `stage`, `steps`: 단계와 그 단계에서 실행할 스텝.
- `post`: 끝난 뒤 할 일. 결과에 따라 `always`, `success`, `failure`로 나눈다.

`node { }`로 시작하는 Scripted 방식도 있다. 이쪽은 `node`가 `agent` 역할을 겸한다.

두 장면에서 이미지 stage가 실패했을 때 남은 stage와 post가 어떻게 되는지 본다.

<figure class="fig" data-figure="jenkins-pipeline-skeleton">
  <figcaption>선언형 파이프라인의 블록과 실패했을 때의 흐름</figcaption>
</figure>

실패한 뒤의 stage는 건너뛰지만 post는 돈다. 알림과 작업 공간 정리는 stage가 아니라 post에 둔다.

```groovy
@Library('pipeline-lib@v1.3') _
pipeline {
  agent { kubernetes { yaml agentPod('build') } }
  environment { REGISTRY = 'registry.example.com' }
  options { timeout(time: 30, unit: 'MINUTES') }
  stages {
    stage('빌드')  { steps { sh 'make test' } }
    stage('이미지') { steps { buildImage("${REGISTRY}/order:${GIT_COMMIT}") } }
    stage('배포')  { steps { deploy('order') } }
  }
  post {
    failure { notify('실패') }
    always  { cleanWs() }
  }
}
```

`@Library` 뒤의 밑줄은 오타가 아니다. 애너테이션이 붙을 대상이 필요해서 import 대신 `_`에 붙인다.

### 따옴표와 자격증명

레지스트리 토큰을 `withCredentials`로 받아 셸에 넘긴다. 따옴표 하나 차이로 토큰이 명령 문자열에 그대로 박힌다.

Groovy는 작은따옴표와 큰따옴표가 다른 타입이다.

- `'...'`: `java.lang.String`. `${}` 치환이 없다. 셸에 그대로 넘길 명령에 쓴다.
- `"..."`: 치환이 있으면 `groovy.lang.GString`. Groovy 변수를 문자열에 끼울 때 쓴다.
- `'''...'''`, `"""..."""`: 여러 줄 버전. 치환 규칙은 위와 같다.

두 장면에서 컨트롤러를 떠나는 명령 문자열에 무엇이 들어 있는지 본다.

<figure class="fig" data-figure="jenkins-pipeline-quote">
  <figcaption>따옴표에 따라 비밀값을 푸는 자리</figcaption>
</figure>

큰따옴표면 컨트롤러의 Groovy가 `${TOKEN}`을 실제 값으로 바꾼 뒤 명령을 보낸다. 값이 프로세스 인자에 복사돼 `ps` 같은 도구로 보일 수 있다. 작은따옴표면 `$TOKEN` 글자 그대로 보내고, 에이전트의 셸이 환경 변수에서 값을 읽는다.

```groovy
withCredentials([string(credentialsId: 'registry-token', variable: 'TOKEN')]) {
  sh 'curl -H "Authorization: Bearer $TOKEN" https://registry.example.com/v2/'
}
```

Jenkins 문서도 자격증명에는 Groovy 문자열 치환을 쓰지 말라고 적어 둔다. 사용자가 넣은 파라미터를 큰따옴표로 끼우면 셸 명령 주입으로도 이어진다.

비밀값을 `sh(script: 'echo $X', returnStdout: true)`로 꺼내 `env`에 다시 넣는 것도 피한다. `withCredentials` 블록 밖으로 나온 값은 가려지지 않아 빌드 로그에 그대로 찍힌다. 값을 확인해야 하면 길이나 해시만 찍는다.

### Shared Library

서비스 20개의 Jenkinsfile이 kaniko 옵션 한 줄씩만 다르게 복사돼 있다. 옵션 하나를 바꾸려면 저장소 20개에 PR을 낸다.

Shared Library는 파이프라인 코드를 담는 별도 Git 저장소다. 디렉터리마다 쓰임이 정해져 있다.

- `vars/`: Jenkinsfile에서 부를 함수. 파일 이름이 곧 이름이라 `vars/buildImage.groovy`는 `buildImage()`로 부른다.
- `src/`: Java 패키지 구조의 Groovy 클래스. 여러 파이프라인이 같이 쓰는 상수와 도우미를 둔다.
- `resources/`: Dockerfile, 파드 템플릿 같은 파일. `libraryResource`로 문자열을 읽어 `writeFile`로 workspace에 쓴다.
- 그 밖의 디렉터리는 나중을 위해 예약돼 있다.

두 장면에서 라이브러리를 한 번 고칠 때 어느 서비스까지 바뀌는지 본다.

<figure class="fig" data-figure="jenkins-pipeline-library">
  <figcaption>서비스 Jenkinsfile이 부르는 Shared Library</figcaption>
</figure>

서비스 Jenkinsfile은 함수 이름만 부르고, 빌드 방법은 라이브러리에 한 벌만 있다. 라이브러리를 고치면 다음 빌드부터 모든 서비스에 반영되고, `@v1.2`처럼 버전을 고정한 서비스만 그대로 남는다. 버전에는 브랜치, 태그, 커밋 해시를 쓸 수 있다.

```groovy
// vars/buildImage.groovy
def call(String image) {
  writeFile file: 'Dockerfile', text: libraryResource('docker/python.Dockerfile')
  container('kaniko') {
    sh "/kaniko/executor --context=dir://${env.WORKSPACE} --destination=${image}"
  }
}
```

`src/`의 클래스는 여러 파이프라인이 같이 쓰는 상수를 두기 좋다. 다만 상수일 뿐이라, 실행 중인 파이프라인끼리 값을 주고받는 통로는 아니다. 그 일은 다음 절의 파라미터와 아티팩트가 한다.

```groovy
// src/common/Jobs.groovy
package common
class Jobs {
  static final String DEPLOY = 'deploy/app'
}

// Jenkinsfile
import common.Jobs
build job: Jobs.DEPLOY, wait: false
```

라이브러리 등록은 JCasC로 헬름 values에 둔다. 차트에서는 `controller.JCasC.configScripts` 아래에 넣어야 적용된다.

```yaml
controller:
  JCasC:
    configScripts:
      shared-library: |
        unclassified:
          globalLibraries:
            libraries:
              - name: pipeline-lib
                defaultVersion: main
                retriever:
                  modernSCM:
                    scm:
                      git:
                        remote: https://github.com/example/pipeline-lib
                        credentialsId: git-credential
```

Git 자격증명도 JCasC로 만들 수 있지만, 비밀번호를 values에 평문으로 적지 않는다. 쿠버네티스 Secret에 두고 JCasC에서 `${GIT_TOKEN}`처럼 변수로 읽는다.

Jenkinsfile에는 무엇을 하는지만 두고, 어떻게 하는지는 라이브러리에 둔다.

### Job 연결과 아티팩트

베이스 이미지가 바뀌면 그 위에 올린 앱 이미지를 다시 빌드해야 한다. Job 하나에 다 넣으면 앱이 늘 때마다 파이프라인이 길어진다.

`build` 스텝은 다른 Job을 파라미터와 함께 실행한다. 작은 값(이미지 태그)은 파라미터로 넘기고, 파일은 `archiveArtifacts`로 빌드에 붙여 둔 뒤 받는 쪽이 Copy Artifact 플러그인으로 가져온다.

`wait`은 기본이 `true`라 부른 Job이 끝날 때까지 기다리고, 그 결과를 이어받는다. 모드를 바꿔 가며 베이스 Job이 에이전트를 언제 놓는지 본다.

<figure class="fig" data-figure="jenkins-pipeline-chain">
  <figcaption>베이스 Job이 배포 Job을 부를 때 wait에 따른 에이전트 점유 (시간은 대략값)</figcaption>
</figure>

`wait: true`면 배포 Job 둘이 끝날 때까지 베이스 Job이 파드를 잡고 기다려 70초 동안 에이전트를 쓴다. `wait: false`면 트리거만 하고 31초에 끝난다. 배포 Job이 하는 일은 같고, 베이스 Job이 **기다리며 잡고 있던 에이전트**만 풀린다.

대신 `wait: false`면 베이스 Job은 배포가 실패해도 모른다. 실패 알림은 배포 Job의 post에 둔다.

```groovy
stage('베이스 이미지') {
  steps {
    buildImage("${REGISTRY}/base:${TAG}")
    writeFile file: 'base-image.txt', text: "${REGISTRY}/base:${TAG}"
  }
}
// ...
post {
  success {
    archiveArtifacts artifacts: 'base-image.txt'
    build job: 'apps/order', wait: false, parameters: [
      string(name: 'BASE_IMAGE', value: "${REGISTRY}/base:${TAG}")
    ]
  }
}
```

받는 쪽 Dockerfile은 `ARG BASE_IMAGE`와 `FROM ${BASE_IMAGE}`로 받고, kaniko에 `--build-arg BASE_IMAGE=...`를 넘긴다.

바뀐 파일마다 Job을 하나씩 띄울 때는 비교 범위를 조심한다. `git diff HEAD~1 HEAD`는 마지막 커밋 하나만 봐서, 커밋 여러 개를 한 번에 push하면 앞 커밋의 변경을 놓친다. Git 플러그인이 넣어 주는 `GIT_PREVIOUS_SUCCESSFUL_COMMIT`부터 비교한다.

```groovy
def from = env.GIT_PREVIOUS_SUCCESSFUL_COMMIT ?: 'HEAD~1'   // 첫 빌드에는 값이 없다
def changed = sh(script: "git diff --name-only --diff-filter=d ${from} HEAD -- jobs/", returnStdout: true)
  .trim().split('\n').findAll { it }
changed.each { f ->
  build job: 'deploy/job', wait: false, parameters: [string(name: 'JOB_FILE', value: f)]
}
```

`--diff-filter=d`는 지운 파일을 뺀다. Job 연결은 값은 파라미터로, 파일은 아티팩트로 넘기고, 결과가 필요한 곳에서만 기다린다.

## 이미지와 권한

### 데몬 없는 이미지 빌드

에이전트 파드에서 `docker build`를 부르면 `Cannot connect to the Docker daemon`이 뜬다. 쿠버네티스 1.24에서 dockershim이 빠진 뒤로, 요즘 노드에는 containerd만 있고 dockerd가 없다.

노드의 `docker.sock`을 파드에 마운트하는 우회도 있지만, 그 소켓을 쥔 파드는 노드의 root와 같다. kaniko는 데몬 없이 컨테이너 안에서 이미지를 만든다. Dockerfile 명령을 자기 파일 시스템에서 직접 실행하고, 명령마다 바뀐 파일을 스냅샷으로 떠서 레이어를 만든 뒤 레지스트리로 바로 push한다.

세 장면에서 이미지가 어디서 만들어지고, 한 컨테이너에서 돌 때 무엇이 사라지는지 본다.

<figure class="fig" data-figure="jenkins-pipeline-kaniko">
  <figcaption>docker build, kaniko, 한 컨테이너에서 도는 kaniko</figcaption>
</figure>

kaniko는 레지스트리 인증을 `/kaniko/.docker/config.json`에서 읽는다. 파드 템플릿에서 `dockerconfigjson` Secret을 그 경로에 마운트하면 따로 로그인하지 않아도 된다.

```yaml
containers:
  - name: kaniko
    volumeMounts:
      - name: registry-auth
        mountPath: /kaniko/.docker
volumes:
  - name: registry-auth
    secret:
      secretName: regcred
      items:
        - key: .dockerconfigjson
          path: config.json
```

ECS처럼 에이전트와 kaniko가 한 컨테이너에서 돌면 셋째 장면의 일이 생긴다. 멀티스테이지 빌드에서 다음 `FROM`으로 넘어갈 때 kaniko가 자기 디렉터리 밖의 파일 시스템을 정리해, 에이전트 workspace까지 지우고 `missing workspace` 오류가 난다. 에이전트 경로를 `--ignore-path`로 뺀다.

```bash
/kaniko/executor \
  --context=dir://$WORKSPACE \
  --dockerfile=Dockerfile \
  --destination=$REGISTRY/app:$TAG \
  --ignore-path=/home/jenkins
```

kaniko 원 저장소(GoogleContainerTools/kaniko)는 2025년 6월 3일에 아카이브돼 더 이상 관리되지 않는다. 지금은 Chainguard 포크가 보안 수정을 이어 가고, 커뮤니티 포크(osscontainertools/kaniko)도 있다. 새로 고른다면 포크 kaniko와 함께 rootless BuildKit, Buildah를 같이 견준다.

> **Chainguard 포크의 이미지.** Chainguard는 포크의 소스를 공개하지만 관리되는 컨테이너 이미지는 유료로 낸다. 무료로 쓰려면 소스에서 직접 빌드하거나 커뮤니티 포크의 이미지를 쓴다.
{: .warn}

### 권한

새로 들어온 개발자 계정으로 로그인했더니 운영 배포 Job의 Build 버튼이 보인다. Jenkins 헬름 차트의 기본 권한 설정은 로그인한 사용자에게 모든 권한을 준다.

역할 단위 권한은 Role-based Authorization Strategy 플러그인으로 준다. 역할은 두 종류다.

- 전역 역할: `Overall/Administer`, `Overall/Read`처럼 Jenkins 전체에 걸리는 권한.
- 항목 역할: 정규식 패턴에 맞는 Job과 폴더에만 걸리는 권한. 패턴은 폴더 경로까지 포함한 전체 이름에 맞춘다.

Jenkins 자체 사용자 DB에는 그룹을 만드는 기능이 없다. 그룹은 LDAP나 AD처럼 그룹을 주는 인증(security realm)을 붙였을 때 그쪽에서 받아 오고, 로그인한 모든 사용자가 들어가는 `authenticated`만 기본으로 있다.

두 장면에서 역할 표가 누구에게 무엇을 열어 주는지, 그리고 표 밖에서 열리는 문이 무엇인지 본다.

<figure class="fig" data-figure="jenkins-pipeline-rbac">
  <figcaption>폴더 패턴으로 나눈 역할 표와 그 밖의 권한</figcaption>
</figure>

항목 역할의 패턴은 끝을 막아 쓴다. `DEV.*`는 `DEV` 폴더뿐 아니라 `DEVOPS` 폴더에도 맞는다. 폴더 안 Job을 쓰려면 폴더 자체에도 권한이 있어야 해서, 폴더와 그 안을 같이 고르는 `DEV($|/.*)` 꼴로 쓴다.

```yaml
controller:
  JCasC:
    authorizationStrategy: |-
      roleBased:
        roles:
          global:
            - name: admin
              permissions: ["Overall/Administer"]
              entries:
                - user: admin@example.com
            - name: reader
              permissions: ["Overall/Read"]
              entries:
                - group: authenticated
          items:
            - name: dev
              pattern: "DEV($|/.*)"
              permissions: ["Job/Build", "Job/Cancel", "Job/Read"]
              entries:
                - user: developer@example.com
```

역할 표 밖에도 권한이 있다. 글로벌 Shared Library는 샌드박스 밖에서 돌아서, 공식 문서는 그 저장소에 push할 수 있는 사람이 Jenkins 전체를 다룰 수 있다고 경고한다. 폴더 단위로 등록한 라이브러리는 항상 샌드박스 안에서 돈다.

- 라이브러리 저장소에는 브랜치 보호와 리뷰를 걸고, 서비스는 태그로 버전을 고정한다.
- `Job/Configure`는 파이프라인 정의를 바꿀 수 있는 권한이라, 그 Job이 쓰는 자격증명을 쓸 수 있는 권한과 같다. 운영 폴더에서는 빌드와 설정 권한을 나눈다.
- 자격증명은 전역이 아니라 폴더 단위로 둬서, 운영 kubeconfig가 개발 폴더 Job에 보이지 않게 한다.

권한을 점검할 때는 역할 표보다 라이브러리 저장소의 push 권한부터 본다.

## 정리

| | 하는 일 | 기억할 점 |
|---|---|---|
| 컨트롤러 | webhook 수신, 큐, Jenkinsfile 해석, 기록 | 실행기 0개. Groovy 코드는 여기서 돈다 |
| 파드 에이전트 | 빌드마다 파드, 단계별 컨테이너 | workspace를 같이 쓰고, 끝나면 함께 사라진다 |
| ECS 에이전트 | 무거운 빌드를 Fargate 태스크로 | 컨테이너가 하나라 kaniko를 이미지에 넣는다 |
| Groovy | stage 순서와 조건 | 파일 처리와 반복 계산은 sh로 에이전트에 |
| 따옴표 | 작은따옴표는 String, 큰따옴표는 GString | 자격증명은 작은따옴표로 셸에 맡긴다 |
| post | 끝난 뒤 실행 | 실패해도 돈다. 알림과 정리는 여기 |
| Shared Library | vars, src, resources | 버전을 고정한다. push 권한은 관리자 권한이다 |
| Job 연결 | build 스텝, 파라미터, 아티팩트 | wait false면 결과를 모른다 |
| kaniko | 데몬 없이 이미지 빌드 | 원 저장소는 아카이브. 포크나 BuildKit, Buildah |
| 권한 | 전역 역할, 항목 역할 | 패턴의 끝을 막는다 |

## 참고

- [Jenkins — Pipeline Best Practices](https://www.jenkins.io/doc/book/pipeline/pipeline-best-practices/)
- [Jenkins — Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/)
- [Jenkins — Using a Jenkinsfile](https://www.jenkins.io/doc/book/pipeline/jenkinsfile/)
- [Jenkins — Extending with Shared Libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/)
- [Jenkins — Controller Isolation](https://www.jenkins.io/doc/book/security/controller-isolation/)
- [Jenkins — Pipeline: Build Step](https://www.jenkins.io/doc/pipeline/steps/pipeline-build-step/)
- [Jenkins plugin — Kubernetes](https://plugins.jenkins.io/kubernetes/)
- [Jenkins plugin — Git (environment variables)](https://plugins.jenkins.io/git/)
- [Jenkins plugin — Role-based Authorization Strategy](https://plugins.jenkins.io/role-strategy/)
- [amazon-ecs-plugin #331 — Add support for Sidecars in ECS Template](https://github.com/jenkinsci/amazon-ecs-plugin/issues/331)
- [Jenkins Helm chart — values.yaml](https://github.com/jenkinsci/helm-charts/blob/main/charts/jenkins/values.yaml)
- [Groovy — Syntax (strings)](https://groovy-lang.org/syntax.html#all-strings)
- [AWS — Amazon ECS clusters for Fargate (Fargate Spot)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)
- [Kubernetes — Migrating from dockershim](https://kubernetes.io/docs/tasks/administer-cluster/migrating-from-dockershim/)
- [GoogleContainerTools/kaniko (archived)](https://github.com/GoogleContainerTools/kaniko)
- [kaniko #2509 — Multi-Stage Image builds are failing at Stage 0](https://github.com/GoogleContainerTools/kaniko/issues/2509)
- [Chainguard — Fork yeah: We're bringing kaniko back](https://www.chainguard.dev/unchained/fork-yeah-were-bringing-kaniko-back)
- 원글: [Jenkinsfile 작성법](https://kimjanghyun1010.tistory.com/17), [Jenkins Shared Library (w/ kaniko)](https://kimjanghyun1010.tistory.com/79), [Jenkins Pipeline간 전역변수 사용(w/ Shared Libray)](https://kimjanghyun1010.tistory.com/81), [Jenkins Chain Job, Artifact](https://kimjanghyun1010.tistory.com/80), [Jenkins RBAC(w/ helm chart)](https://kimjanghyun1010.tistory.com/82), [Jenkins ECS slave (w/ kaniko)](https://kimjanghyun1010.tistory.com/83)
