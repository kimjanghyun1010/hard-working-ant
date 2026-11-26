---
title: Terraform과 IaC
description: 콘솔에서 손으로 만든 인프라가 기록과 어긋나는 문제부터 Packer, Terraform, Ansible이 맡는 층, state와 잠금, Atlantis로 PR에서 plan과 apply를 돌리는 법까지 정리했다.
date: 2026-11-06 12:00:00 +0900
series: CI/CD와 IaC
tags: [terraform, iac, packer, ansible, atlantis, opentofu]
scripts: [figures/terraform-iac.js]
---

## 수작업 인프라와 드리프트

반년 전 콘솔에서 만든 VM과 똑같은 것을 하나 더 만들어 달라는 요청이 온다. 위키에 VM 크기와 디스크, 방화벽 규칙이 적혀 있지만, 그 사이 누가 콘솔에서 무엇을 바꿨는지는 아무도 모른다.

손으로 만든 인프라는 두 가지가 어렵다.

- 다시 만들기: 클릭 순서와 입력값이 사람 기억에만 남는다.
- 기록 맞추기: 콘솔에서 바꾼 값은 문서에 저절로 반영되지 않는다.

실제 상태가 기록과 어긋나는 것을 드리프트(drift)라고 한다. 아래 그림에서 변경이 들어올 때마다 가운데 표시가 `=`에서 `≠`로 바뀌는지 본다.

<figure class="fig" data-figure="terraform-iac-drift">
  <figcaption>기록과 실제 클라우드가 어긋나는 과정</figcaption>
</figure>

콘솔에서 바꾸면 실제 값만 바뀌고 기록은 그대로라 어긋난 곳이 쌓인다. 코드로 바꾸면 코드를 먼저 고치고 그 코드를 클라우드에 적용하니, 코드가 그대로 기록이 된다.

IaC(Infrastructure as Code)는 인프라를 코드로 적고 그 코드로만 바꾸는 방식이다. 같은 구성을 몇 번이든 다시 만들 수 있고, 무엇을 언제 바꿨는지가 git 이력으로 남는다. 코드를 도입했다면 콘솔의 쓰기 권한부터 줄여야 드리프트가 다시 생기지 않는다.

## 도구별 담당 층

VM 한 대가 서비스를 받기까지 손이 가는 곳은 세 층이다.

- 클라우드 자원: 네트워크, 방화벽, VM, 디스크처럼 클라우드 API로 만드는 것
- 이미지: VM 디스크에 미리 깔린 OS와 패키지, 에이전트
- 서버 안 구성: 떠 있는 서버 안의 설정 파일, 서비스, 배포한 앱

층마다 바뀌는 주기와 다루는 방법이 달라서 도구도 갈린다. 아래 그림에서 세 도구가 VM의 어느 층에 손을 대는지 차례로 본다.

<figure class="fig" data-figure="terraform-iac-layers">
  <figcaption>세 도구가 맡는 층</figcaption>
</figure>

- Packer: 이미지를 빌드할 때 한 번 굽는다.
- Terraform: 클라우드 자원을 선언하고, 만들고, 바꾼다.
- Ansible: 떠 있는 서버에 접속해 설정을 맞춘다.

경계가 딱 잘리지는 않는다. Terraform도 VM 시작 스크립트로 서버 안을 건드릴 수 있고, Ansible도 클라우드 모듈로 자원을 만들 수 있다. 한 층을 두 도구가 같이 고치면 어느 쪽 코드가 기록인지 다시 흐려지므로, 층마다 맡을 도구를 하나로 정한다.

## 이미지 굽기

### Packer 빌드

새 VM을 띄울 때마다 패키지를 설치하면 띄우는 시간이 길고, 설치하는 날의 저장소 상태에 따라 서버마다 버전이 달라진다. Packer는 설치까지 끝낸 상태를 이미지로 만들어 두고, VM은 그 이미지로 띄우게 한다.

Packer는 HCL로 적은 빌드 파일을 읽고 아래 순서로 이미지를 만든다.

1. 기본 이미지로 임시 VM을 띄운다.
2. 임시 VM에 접속해 provisioner(스크립트, 파일 복사)를 실행한다.
3. VM을 멈추고 디스크를 새 이미지로 저장한다.
4. 임시 VM과 딸린 자원을 지운다.

아래 그림에서 갤러리의 v1.0.0이 임시 VM을 거쳐 v1.1.0으로 나오는 흐름을 따라가 보자.

<figure class="fig" data-figure="terraform-iac-packer">
  <figcaption>기본 이미지에서 임시 VM을 거쳐 새 이미지가 나오는 과정</figcaption>
</figure>

임시 VM은 빌드가 끝나면 사라지고, 남는 것은 버전이 붙은 이미지 하나다. Azure 이미지 갤러리에서 Windows 이미지를 굽는 빌드 파일은 이렇게 줄일 수 있다.

```hcl
source "azure-arm" "win" {
  os_type      = "Windows"
  vm_size      = "Standard_F4s_v2"
  communicator = "winrm"

  shared_image_gallery {
    gallery_name  = var.gallery
    image_name    = var.image
    image_version = var.base_version   # 1.0.0
  }
  shared_image_gallery_destination {
    gallery_name  = var.gallery
    image_name    = var.image
    image_version = var.new_version    # 1.1.0
  }
}

build {
  sources = ["source.azure-arm.win"]
  provisioner "powershell" {
    script = "./init.ps1"
  }
}
```

Windows는 마지막에 sysprep으로 일반화해야 이미지로 쓸 수 있다. 컴퓨터 이름, SID처럼 그 VM에만 있는 값을 지워야 같은 이미지로 여러 대를 띄울 수 있다.

```powershell
& $Env:SystemRoot\System32\Sysprep\Sysprep.exe /oobe /generalize /shutdown
```

이미지 버전에는 빌드 번호나 빌드 시각을 붙여 겹치지 않게 한다. 버전이 남아 있으면 문제가 생긴 새 이미지 대신 직전 버전으로 VM을 다시 띄울 수 있다.

### 구운 이미지와 부팅 후 설치

트래픽이 몰려 서버를 세 대 늘렸는데, 새 서버가 트래픽을 받기까지 몇 분씩 걸린다. 부팅한 뒤에 패키지를 설치하는 구성이면 설치 시간이 그대로 서버를 늘리는 시간에 붙는다.

모드를 바꿔 가며 서버 세 대를 늘리고, 세 대가 모두 준비되는 시각을 지켜본다.

<figure class="fig" data-figure="terraform-iac-bake">
  <figcaption>서버 세 대를 늘릴 때 준비되는 시각 (시간은 모양을 보여 주는 대략값)</figcaption>
</figure>

부팅 후 설치는 세 대가 각자 5분 안팎을 설치에 쓰고 6분이 지나서야 다 준비된다. 구운 이미지는 부팅과 설정 몇 줄만 남아 1분 반이면 된다. 설치에 드는 시간은 같고, 그 시간을 **빌드 때 한 번 내느냐 서버를 늘릴 때마다 내느냐**만 다르다.

부팅할 때 설치하면 설치하는 시점마다 패키지 버전이 달라질 수도 있다. 자동 확장을 쓰는 서버라면 늘리는 데 걸리는 시간부터 재 보고, 길면 설치 단계를 이미지로 옮긴다.

## Terraform 자원 선언

Terraform은 클라우드 자원을 HCL로 선언하고, 선언과 실제를 맞추는 도구다. provider가 클라우드 API를 감싸고 있어서 GCP, Azure, AWS를 같은 문법으로 다룬다.

라이선스는 2023년에 바뀌었다.

- Terraform: 1.6.0부터 BSL(Business Source License) 1.1이다. 회사 안에서 쓰는 데는 제약이 없고, Terraform과 경쟁하는 유료 서비스로 남에게 제공하는 것만 막는다. 라이선스 보유자는 지금 IBM이고, 2026년 11월 기준 최신은 1.17.2다.
- OpenTofu: 라이선스 변경 전 코드에서 갈라져 나온 MPL 2.0 프로젝트다. Linux Foundation 아래 있고 2025년 4월 CNCF 샌드박스 프로젝트가 됐다. 명령은 `terraform` 대신 `tofu`이고, 최신은 1.13 계열이다.

state, plan, 변수, 모듈의 동작은 두 도구가 같다. 버전 번호는 갈라진 뒤 따로 매긴다.

### 코드와 state

Terraform이 자원을 하나 만들면, 코드의 이름과 클라우드가 붙인 ID를 짝지어 state에 적는다. 다음 실행 때 같은 이름의 자원을 또 만들지 않고 그 ID의 자원을 찾아가는 것이 이 짝 덕분이다.

```hcl
resource "google_compute_instance" "web" {
  name         = "web"
  machine_type = "e2-small"
  zone         = "asia-northeast3-a"
  # boot_disk, network_interface 생략
}
```

Terraform은 세 곳을 오간다.

- 코드(`.tf`): 원하는 모습
- state(`terraform.tfstate`): Terraform이 만든 자원의 ID와 마지막으로 본 속성
- 클라우드: 실제 자원

apply 한 번이 세 곳을 어떻게 잇는지 따라가 보자.

<figure class="fig" data-figure="terraform-iac-state">
  <figcaption>apply 한 번으로 코드, state, 클라우드가 이어지는 순서</figcaption>
</figure>

state는 코드와 클라우드 사이의 대응표다. 이 파일을 잃으면 Terraform은 자기가 만든 자원을 알아보지 못하고 처음부터 새로 만들려 한다.

state에는 자원 속성이 평문 JSON으로 들어간다. DB 비밀번호 같은 값도 들어가므로 git에 올리지 않고, 접근을 제한한 원격 저장소에 둔다.

### plan과 apply

apply 전에 무엇이 바뀔지 보는 단계가 plan이다. plan은 먼저 state에 적힌 ID로 클라우드를 읽어 state를 최신으로 맞추고(refresh), 그 state를 코드와 견줘 차이를 낸다.

세 장면은 바뀐 곳이 각각 코드, 클라우드, 코드의 삭제다. 장면마다 refresh가 무엇을 고치고, plan이 어느 줄을 내놓는지 본다.

<figure class="fig" data-figure="terraform-iac-plan">
  <figcaption>plan이 코드, state, 클라우드를 견주는 방식</figcaption>
</figure>

- 코드를 고치면 코드와 state가 달라져 그만큼 바꾸는 plan이 나온다.
- 콘솔에서 누가 바꾸면 refresh가 state를 실제 값으로 고치고, 코드와 다르니 코드 쪽으로 되돌리는 plan이 나온다.
- 코드에서 자원을 지우면 state에만 남은 자원을 지우는 plan이 나온다.

두 번째 장면이 드리프트를 잡는 방법이다. Terraform은 코드를 정답으로 보고 콘솔 변경을 되돌린다. 콘솔에서 바꾼 값을 살려야 한다면 apply 전에 코드를 먼저 고친다.

plan 출력은 줄 앞의 기호로 읽는다.

```text
  + create
  ~ update in-place
  - destroy
-/+ destroy and then create replacement

Plan: 0 to add, 1 to change, 0 to destroy.
```

`-/+`는 그 자리에서 못 고치는 속성이라 지우고 다시 만든다는 뜻이다. VM이나 DB에서 이 기호가 보이면 데이터와 IP가 바뀔 수 있으니 apply 전에 멈춘다.

plan을 파일로 저장해 두면 apply가 그 plan만 그대로 실행한다. 확인한 것과 다른 변경이 끼어들지 않는다.

```bash
terraform plan -out=tfplan
terraform apply tfplan
```

드리프트만 확인하고 아무것도 바꾸지 않을 때는 `terraform plan -refresh-only`를 쓴다. 콘솔에서 이미 만든 자원은 `import` 블록으로 state에 들여와 코드 관리로 옮긴다.

plan을 받으면 `-/+`와 `destroy` 줄부터 본다.

### 변수

dev와 prod가 VM 크기만 다르고 구성은 같은데, 폴더를 복사해 두 벌로 관리하면 한쪽만 고치는 실수가 생긴다. 다른 값만 변수로 빼면 코드는 한 벌로 둔다.

```hcl
variable "machine_type" {
  type    = string
  default = "e2-small"
}

resource "google_compute_instance" "web" {
  machine_type = var.machine_type
}
```

```hcl
# prod.tfvars
machine_type = "e2-standard-4"
disk_size    = 100
```

값은 실행할 때 파일로 넣는다(`terraform apply -var-file=prod.tfvars`). 같은 코드에 넣는 파일만 바꿔 dev와 prod를 만드는 모습을 보자.

<figure class="fig" data-figure="terraform-iac-vars">
  <figcaption>같은 코드에 tfvars 파일만 바꿔 넣은 두 환경</figcaption>
</figure>

코드는 한 벌이고 환경마다 다른 것은 tfvars 파일 한 장이다. 다만 state 하나에 두 환경을 번갈아 적용하면, prod 파일로 돌린 plan이 dev 자원을 prod 값으로 바꾸려 한다. 환경마다 디렉터리나 backend의 state 경로를 따로 둔다.

값이 여러 곳에서 오면 우선순위가 높은 쪽이 이긴다. 높은 쪽부터 이렇다.

1. 명령줄의 `-var`, `-var-file`
2. `*.auto.tfvars` (파일 이름순)
3. `terraform.tfvars.json`, `terraform.tfvars`
4. 환경 변수 `TF_VAR_이름`
5. 변수의 `default`

비밀 값에는 `sensitive = true`를 준다. 이 표시는 plan과 apply 화면에서 값을 가릴 뿐이고 state에는 그대로 남는다. state와 plan 파일에도 남기지 않으려면 `ephemeral` 변수로 받는다.

예전 문법 `"${var.project}"`는 0.12부터 `var.project`로 바로 쓴다. 문자열 안에 끼워 넣을 때만 `"instance-${var.environment}"`처럼 `${}`를 쓴다.

### 모듈과 반복

같은 모양의 자원 묶음은 모듈로 뺀다. 디렉터리 하나가 모듈 하나이고, 값만 바꿔 여러 번 부른다.

```hcl
module "network" {
  source   = "./modules/network"
  location = var.location
}
```

이름만 다른 자원 여러 개는 `count`나 `for_each`로 만든다. 둘은 state에서 자원을 부르는 주소가 다르다.

- count: 순번으로 부른다. `user[0]`, `user[1]`, `user[2]`
- for_each: map의 키로 부른다. `user["a"]`, `user["b"]`, `user["c"]`

차이는 목록 가운데 하나를 뺄 때 드러난다. 모드를 바꿔 가며 b를 빼 보고, plan에 자원이 몇 개 걸리는지 지켜본다.

<figure class="fig" data-figure="terraform-iac-foreach">
  <figcaption>목록에서 b를 뺄 때 count와 for_each의 plan</figcaption>
</figure>

count는 b가 빠지면 c가 1번으로 당겨져서, 1번 자원을 c로 바꾸고 2번을 지우는 plan이 나온다. for_each는 b만 지운다. 목록에서 뺀 것은 하나로 같고, 남은 자원의 주소가 당겨지느냐 그대로냐만 다르다.

```hcl
variable "users" {
  type    = map(string)
  default = { a = "alice", b = "bob", c = "carol" }
}

resource "azuread_invitation" "user" {
  for_each           = var.users
  user_display_name  = each.key
  user_email_address = "${each.value}@example.com"
  redirect_url       = "https://portal.azure.com"
}
```

`each.key`에 map의 키가, `each.value`에 값이 들어온다. 목록이 바뀔 수 있는 자원은 for_each로 만든다.

### provider 인증

예전 예시는 서비스 계정 키 JSON을 내려받아 provider에 경로를 적었다. 키 파일은 만료가 없어서, 노트북이나 저장소에 복사본이 하나 새면 누가 지울 때까지 그대로 쓸 수 있다.

지금 provider 문서가 권하는 방식은 실행 위치마다 다르다.

- GCP, 내 컴퓨터: `gcloud auth application-default login`으로 만든 ADC(Application Default Credentials). 서비스 계정 권한이 필요하면 키 대신 `impersonate_service_account`로 빌린다.
- GCP, 클라우드 밖의 CI: OIDC 기반 워크로드 아이덴티티 제휴(Workload Identity Federation)로 만든 자격 구성 파일
- GCP 안의 VM이나 클러스터: 거기 붙은 서비스 계정
- Azure, 내 컴퓨터: Azure CLI 로그인(`az login`)
- Azure, CI: 서비스 주체(service principal)나 관리 ID(managed identity). OIDC로 붙이면 비밀 값을 저장하지 않는다.

두 방식이 자격을 얼마나 오래 들고 있는지 견줘 보자.

<figure class="fig" data-figure="terraform-iac-auth">
  <figcaption>키 파일과 짧은 토큰의 유효 기간</figcaption>
</figure>

키 파일은 Terraform 실행이 끝나도 유효하고, 복사본도 똑같이 유효하다. OIDC 방식은 실행할 때마다 CI가 받은 ID 토큰을 짧은 토큰으로 바꿔 쓰고, 그 토큰은 시간이 지나면 저절로 만료된다.

```hcl
provider "google" {
  project = "my-project"
  region  = "asia-northeast3"
  # credentials를 적지 않으면 ADC를 쓴다
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}
```

azurerm은 plan과 apply에 구독 ID가 꼭 있어야 한다. provider에 적거나 환경 변수 `ARM_SUBSCRIPTION_ID`로 준다.

다른 테넌트의 자원을 같이 다룰 때는 같은 provider를 하나 더 두고 `alias`로 이름을 붙인다. 리소스에 `provider = azurerm.old`라고 적으면 그 자격으로 만들고, 안 적으면 기본 provider가 붙는다.

```hcl
provider "azurerm" {
  alias           = "old"
  features {}
  tenant_id       = var.old_tenant_id
  subscription_id = var.old_subscription_id
}
```

키 파일을 쓰고 있다면 ADC나 OIDC로 옮긴 뒤 키를 지운다.

## Ansible 서버 구성

### 플레이북과 멱등성

떠 있는 서버 30대의 설정 파일 한 줄을 오늘 바꿔야 한다. 이미지를 다시 굽고 서버를 갈아 끼우는 길도 있지만, 바로 고쳐야 할 때는 Ansible을 쓴다. 제어 노드에서 SSH(Windows는 WinRM)로 서버에 접속해, 플레이북(playbook)에 적은 작업을 차례로 실행한다. 서버에 에이전트를 깔 필요가 없다.

Ansible 모듈은 대부분 "이 상태여야 한다"를 적는다. 이미 그 상태면 아무것도 하지 않고 ok를, 바꿨으면 changed를 낸다. 여러 번 돌려도 결과가 같은 이 성질을 멱등성(idempotency)이라고 한다.

```yaml
- hosts: web
  tasks:
    - name: nginx 설치
      ansible.builtin.package:
        name: nginx
        state: present
    - name: 설정 파일
      ansible.builtin.template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
    - name: 서비스 시작
      ansible.builtin.service:
        name: nginx
        state: started
```

같은 플레이북을 두 번 돌리면서 작업 칸의 색이 어떻게 달라지는지 본다.

<figure class="fig" data-figure="terraform-iac-ansible">
  <figcaption>같은 플레이북을 두 번 실행한 결과</figcaption>
</figure>

첫 실행은 세 대 모두 changed이고, 두 번째는 전부 ok다. 다시 돌려도 상태가 그대로라 안전하다. 실제로 돌리기 전에는 `--check --diff`로 바뀔 내용만 먼저 본다.

모든 모듈이 멱등하지는 않다. `command`와 `shell`은 매번 실행되고 매번 changed를 내므로, `creates`나 `when`으로 이미 했는지를 직접 가린다.

### 실패 처리

수십 대에 한꺼번에 돌리면 몇 대는 꺼져 있거나 네트워크가 막혀 있다. 그런 서버 하나 때문에 전체를 다시 돌리지 않으려면, 실패를 서버 단위로 잡아 알린다.

Ansible은 `block`, `rescue`, `always`로 작업을 묶는다.

- block: 묶은 작업을 차례로 실행한다.
- rescue: block 안에서 작업 하나라도 실패하면 실행한다. 실패한 결과는 `ansible_failed_result`에 들어 있다.
- always: 성공이든 실패든 마지막에 실행한다.

원글의 플레이북은 이 묶음으로 접속을 재시도하고, 끝내 실패하면 Slack으로 알렸다.

{% raw %}
```yaml
- hosts: all
  gather_facts: false
  tasks:
    - block:
        - name: 접속 확인
          ansible.builtin.wait_for:
            host: "{{ ansible_host }}"
            port: 5986
            timeout: 10
          register: reach
          until: reach is succeeded
          retries: 15
          delay: 3
          delegate_to: localhost
        - ansible.builtin.include_tasks: deploy.yaml
      rescue:
        - name: Slack 실패 알림
          ansible.builtin.uri:
            url: "{{ slack_webhook }}"
            method: POST
            body_format: json
            body:
              text: "{{ inventory_hostname }} 실패: {{ ansible_failed_result.msg }}"
          delegate_to: localhost
```
{% endraw %}

- `delegate_to: localhost`: 대상 서버 대신 제어 노드에서 실행한다. 접속 확인과 Slack 호출이 그렇다.
- `until`, `retries`, `delay`: 조건이 맞을 때까지 정해진 횟수만큼 다시 실행한다.

아래 그림은 세 대 중 web-3만 꺼져 있을 때다. web-3의 재시도가 끝나는 순간 Slack 줄에 무엇이 생기는지 본다.

<figure class="fig" data-figure="terraform-iac-rescue">
  <figcaption>한 대가 응답하지 않을 때 재시도와 rescue (시간은 대략값)</figcaption>
</figure>

web-1과 web-2는 배포를 끝내고, web-3만 재시도 15번 끝에 rescue로 넘어가 알림을 보낸다. 실패한 서버만 다시 돌릴 때는 `--limit web-3`을 준다.

원글은 이 플레이북을 쿠버네티스 Job으로 돌렸다. Ansible이 든 이미지에 플레이북을 ConfigMap으로 넣고, Helm 값으로 대상 서버와 동시 실행 수(`-f`)를 바꿔 가며 Job을 띄운다. 누가 어디서 돌렸는지가 Job 로그로 남는다.

원글의 `include`는 ansible-core 2.16에서 빠졌다. 실행 중에 불러오는 `include_tasks`나 미리 펼쳐 두는 `import_tasks`로 바꾼다.

## 공동 작업 구성

### 원격 state와 잠금

state를 노트북에 두면 그 노트북에서만 apply할 수 있다. 원격 backend에 두면 모두가 같은 state를 보지만, 이번에는 두 사람이 동시에 apply하는 일이 생긴다.

apply는 state를 읽고, 클라우드를 바꾸고, 새 state를 쓴다. 두 사람이 같은 state를 읽어 놓고 각자 쓰면 나중에 쓴 쪽이 앞의 결과를 덮어쓸 수 있다. state 잠금(locking)은 state를 쓰는 작업이 도는 동안 다른 작업이 잠금을 얻지 못하게 막는다.

모드를 바꿔 가며 A와 B가 몇 초 차이로 apply를 시작하게 하고, 맨 아래 state 줄이 어떻게 남는지 지켜본다.

<figure class="fig" data-figure="terraform-iac-lock">
  <figcaption>두 사람이 같은 state에 동시에 apply할 때 (시간은 대략값)</figcaption>
</figure>

잠금이 없으면 B가 VM a가 없는 state를 써서, VM a는 클라우드에 있는데 state에서 사라진다. Terraform이 모르는 자원이 되어 다음 plan에도 나오지 않는다. 잠금이 있으면 B는 A가 끝날 때까지 기다렸다가 A가 쓴 state를 읽고 시작한다. 클라우드에 생기는 변경은 같고, **B가 기다리는 시간**만 생긴다.

잠금은 state를 쓸 수 있는 명령마다 자동으로 걸린다. 잠금을 못 얻으면 Terraform은 멈추고, 기본값으로는 기다리지 않고 바로 실패한다. 그림처럼 기다리게 하려면 `-lock-timeout=5m`처럼 기다릴 시간을 준다.

```hcl
terraform {
  backend "gcs" {
    bucket = "tf-state-prod"
    prefix = "network"
  }
}
```

잠금 방식은 backend마다 다르다.

- gcs: 따로 설정하지 않아도 잠근다.
- azurerm: Blob Storage 기능으로 잠근다. 따로 설정할 것이 없다.
- s3: `use_lockfile = true`를 줘야 잠근다. 기본값은 false이고, 예전의 DynamoDB 잠금은 폐기 예정이다.

잠금이 있어도 state를 잘못 고치거나 지우는 사고는 막지 못한다. 원글은 apply마다 `null_resource`와 `timestamp()`로 state blob을 복사해 뒀는데, 저장소의 버전 관리를 켜는 편이 간단하다. GCS backend 문서도 state 복구를 위해 객체 버전 관리를 켜 두라고 권한다. Azure는 Blob 버전 관리나 일시 삭제(soft delete)를 켠다.

잠금이 풀리지 않고 남으면 `terraform force-unlock <잠금 ID>`로 푼다. 자기가 건 잠금이 자동으로 안 풀린 경우에만 쓴다.

### Atlantis PR 워크플로

원격 state와 잠금이 있어도 apply는 여전히 누군가의 터미널에서 돈다. 무엇을 보고 apply했는지 남지 않고, 리뷰 없이 바로 적용할 수도 있다. Atlantis는 plan과 apply를 PR 안으로 옮긴다.

- PR을 열거나 커밋을 올리면 바뀐 디렉터리의 plan을 돌려 결과를 댓글로 단다.
- 리뷰어가 plan을 보고 승인하면 `atlantis apply` 댓글로 적용한다.
- plan을 돌린 디렉터리와 워크스페이스는 PR이 머지되거나 닫힐 때까지 잠긴다.

두 장면에서 PR 하나가 머지되기까지의 흐름과, 같은 디렉터리를 고친 두 번째 PR이 어떻게 되는지 본다.

<figure class="fig" data-figure="terraform-iac-atlantis">
  <figcaption>PR 댓글로 도는 plan과 apply, 디렉터리 잠금</figcaption>
</figure>

Atlantis의 잠금은 Terraform의 state 잠금보다 한 층 위에 있다. state 잠금은 apply 하나가 도는 동안만 막고, Atlantis 잠금은 plan을 본 뒤 apply와 머지까지 다른 PR이 끼어들지 못하게 막는다.

환경을 디렉터리로 나누고 저장소 루트의 `atlantis.yaml`에 프로젝트로 적으면, 바뀐 디렉터리의 프로젝트만 plan이 돈다.

```yaml
version: 3
projects:
  - name: live-appgw
    dir: infrastructure/live/appgw
  - name: test-appgw
    dir: infrastructure/test/appgw
```

댓글에서 프로젝트를 이름으로 고른다.

```text
atlantis plan -p test-appgw
atlantis apply -p test-appgw
```

기본으로는 PR에 댓글을 달 수 있는 사람이면 누구나 apply할 수 있다. 서버 쪽 저장소 설정에서 승인과 머지 가능 조건을 건다.

```yaml
repos:
  - id: /.*/
    apply_requirements: [approved, mergeable]
```

plan 출력이 댓글 크기 한도를 넘으면 Atlantis가 여러 댓글로 나눠 단다. 댓글 수는 `--max-comments-per-command`(기본 100)로 묶이고, 넘치면 출력 앞부분부터 잘린다.

Atlantis는 2024년 6월 CNCF 샌드박스 프로젝트가 됐다. 버전은 아직 0.x이고 2026년 11월 기준 최신은 0.50.0이다. Atlantis를 붙였다면 사람 계정의 apply 권한은 빼고, 클라우드 쓰기 권한을 Atlantis 서버의 자격 하나로 모은다.

## 정리

| 층 | 도구 | 기억할 점 |
|---|---|---|
| 이미지 | Packer | 빌드 때 한 번 굽는다. 서버를 늘릴 때 설치 시간이 빠진다 |
| 클라우드 자원 | Terraform, OpenTofu | plan은 refresh한 state와 코드를 견준다. 콘솔 변경은 되돌린다 |
| 변수와 반복 | tfvars, for_each | 코드는 한 벌, 환경마다 state는 따로. 바뀌는 목록은 키로 |
| 인증 | provider | 키 파일 대신 ADC, OIDC, 관리 ID |
| 서버 안 구성 | Ansible | 멱등한 모듈로 적는다. 실패는 rescue로 서버 단위로 잡는다 |
| 공동 작업 | 원격 backend, Atlantis | state 잠금은 apply 하나, Atlantis 잠금은 PR 하나를 지킨다 |

## 참고

- [Terraform — State](https://developer.hashicorp.com/terraform/language/state)
- [Terraform — State locking](https://developer.hashicorp.com/terraform/language/state/locking)
- [Terraform — terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform — Input variables](https://developer.hashicorp.com/terraform/language/values/variables)
- [Terraform — for_each](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)
- [Terraform — Import existing resources](https://developer.hashicorp.com/terraform/language/import)
- [Terraform — Provisioners](https://developer.hashicorp.com/terraform/language/resources/provisioners/syntax)
- [Terraform — Backend gcs](https://developer.hashicorp.com/terraform/language/backend/gcs), [azurerm](https://developer.hashicorp.com/terraform/language/backend/azurerm), [s3](https://developer.hashicorp.com/terraform/language/backend/s3)
- [Terraform LICENSE (BSL 1.1)](https://github.com/hashicorp/terraform/blob/main/LICENSE), [HashiCorp license FAQ](https://www.hashicorp.com/en/license-faq)
- [Terraform releases](https://github.com/hashicorp/terraform/releases)
- [OpenTofu](https://opentofu.org/), [CNCF — OpenTofu](https://www.cncf.io/projects/opentofu/), [OpenTofu releases](https://github.com/opentofu/opentofu/releases)
- [Google provider — Authentication](https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/provider_reference)
- [AzureRM provider — Authentication](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs)
- [Packer — Introduction](https://developer.hashicorp.com/packer/docs/intro), [Packer LICENSE](https://github.com/hashicorp/packer/blob/main/LICENSE)
- [Ansible — Desired state and idempotency](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_intro.html)
- [Ansible — Blocks](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_blocks.html)
- [ansible-core 2.16 changelog](https://github.com/ansible/ansible/blob/stable-2.16/changelogs/CHANGELOG-v2.16.rst)
- [Atlantis — Locking](https://www.runatlantis.io/docs/locking), [Command requirements](https://www.runatlantis.io/docs/command-requirements), [Server configuration](https://www.runatlantis.io/docs/server-configuration)
- [CNCF — Atlantis](https://www.cncf.io/projects/atlantis/), [Atlantis releases](https://github.com/runatlantis/atlantis/releases)
- 원글: [Terraform 시작하기 (GCP)](https://kimjanghyun1010.tistory.com/33), [Terraform Variable](https://kimjanghyun1010.tistory.com/34), [Terraform (Azure)](https://kimjanghyun1010.tistory.com/59), [Terraform GitOps(/w Atlantis)](https://kimjanghyun1010.tistory.com/93), [Packer](https://kimjanghyun1010.tistory.com/51), [ansible](https://kimjanghyun1010.tistory.com/57)
