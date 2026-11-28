---
title: Terraform과 IaC
description: Terraform이 코드, state, 실제 자원을 어떻게 견주는지에서 출발해 plan과 자원 주소, 의존성 그래프와 교체 순서, state 잠금, 그리고 Terraform이 보지 못하는 서버 안쪽을 맡는 Packer와 Ansible까지 따라간다.
date: 2026-11-06 12:00:00 +0900
series: CI/CD와 IaC
tags: [terraform, iac, packer, ansible]
scripts: [figures/terraform-iac.js]
---

## 코드, state, 실제 자원

Terraform 코드 한 줄은 실행할 명령이 아니라 있어야 할 모습의 선언이다. Terraform은 이 선언을 지금 있는 것과 견주고 차이만큼만 클라우드 API를 부르는데, 견주는 대상은 세 곳에 나뉘어 있다.

- 코드(`.tf`): 있어야 할 모습. HCL이라는 설정 언어로 적는다.
- state(`terraform.tfstate`): Terraform이 만든 자원의 목록과 마지막으로 읽은 속성
- 실제 자원: 클라우드에 지금 떠 있는 것

```hcl
resource "google_compute_instance" "web" {
  name         = "web"
  machine_type = "e2-small"
  zone         = "asia-northeast3-a"
  # boot_disk, network_interface 생략
}
```

`google_compute_instance.web`은 Terraform 안에서만 쓰는 주소이고, 클라우드는 자원을 만들 때 자기 ID를 붙인다. 둘을 잇는 것이 state다. 아래 그림처럼 apply가 VM을 만들면 클라우드가 돌려준 ID를 주소와 짝지어 state에 적고, 다음 실행은 그 ID로 실제 VM을 찾아간다.

<figure class="fig" data-figure="terraform-iac-state">
  <figcaption>apply 한 번으로 코드, state, 클라우드가 이어지는 순서</figcaption>
</figure>

state는 JSON 파일이다. 줄이면 이렇게 생겼다.

```json
{
  "version": 4,
  "serial": 12,
  "lineage": "3f1c9a52-...",
  "resources": [{
    "type": "google_compute_instance",
    "name": "web",
    "instances": [{
      "attributes": {
        "id": "projects/my-project/zones/asia-northeast3-a/instances/web",
        "machine_type": "e2-small"
      },
      "dependencies": ["google_compute_subnetwork.app"]
    }]
  }]
}
```

- `serial`: state가 바뀌어 저장될 때마다 오르는 번호
- `lineage`: state를 처음 만들 때 정해지는 ID. 다른 state와 섞이지 않게 한다.
- `attributes`: 마지막으로 읽은 속성 값의 캐시
- `dependencies`: 이 자원이 참조한 자원. 코드에서 자원을 지운 뒤에도 지울 순서를 알려고 남긴다.

Terraform은 원격 객체 하나가 자원 인스턴스 하나에만 묶인다고 가정한다. state를 잃으면 대응이 끊겨 이미 있는 web을 처음부터 새로 만들려 하고, 같은 VM을 두 state가 가리키면 한쪽의 apply가 다른 쪽에는 바깥 변경으로 보인다.

state에는 속성이 평문으로 들어간다. `sensitive = true`로 표시한 비밀 값도 화면에서만 가려지고 state에는 그대로 남으므로, state는 git이 아니라 접근을 제한한 원격 저장소에 둔다.

## refresh와 plan

`terraform plan`은 기본으로 세 단계를 거친다.

1. refresh: state에 적힌 ID로 실제 자원을 읽어 state를 최신으로 맞춘다.
2. 비교: 코드와 refresh한 state를 견준다.
3. 제안: 실제 자원을 코드에 맞추는 변경 목록을 낸다.

provider는 클라우드 API를 감싼 플러그인이다. Terraform 본체는 provider에게 자원을 읽어 달라(ReadResource), 변경을 예측해 달라(PlanResourceChange), 적용해 달라(ApplyResourceChange)고 요청한다. 아래 그림의 세 장면은 바뀐 곳이 각각 코드, 클라우드, 코드의 삭제인 경우다.

<figure class="fig" data-figure="terraform-iac-plan">
  <figcaption>plan이 코드, state, 클라우드를 견주는 방식</figcaption>
</figure>

실제 상태가 기록과 어긋나는 것을 드리프트(drift)라고 한다. 콘솔에서 바꾼 값은 refresh로 state에 들어오고, 코드와 다르니 코드 쪽으로 되돌리는 plan이 나온다. Terraform은 코드를 정답으로 보므로, 콘솔에서 바꾼 값을 살려야 한다면 apply 전에 코드를 먼저 고친다.

refresh가 모든 바깥 변경을 잡지는 못한다. 쓰기만 되고 읽을 수 없는 속성(write-only)은 지금 값을 알 길이 없고, provider 버전이 모르는 새 API 기능도 보이지 않는다.

plan의 동작은 옵션으로 바꾼다.

- `-refresh-only`: 코드와 견주지 않고 실제 값을 state에 반영하는 plan만 낸다. 드리프트를 확인할 때 쓴다.
- `-refresh=false`: refresh를 건너뛰고 state의 캐시 값을 그대로 믿는다. API 호출이 줄어 빠르지만 바깥 변경을 놓친다.
- `-detailed-exitcode`: 변경이 없으면 0, 오류면 1, 변경이 있으면 2로 끝난다. CI에서 주기적으로 돌려 드리프트를 감지한다.
- `-out=tfplan`: plan을 파일로 저장한다. `terraform apply tfplan`은 확인한 그 plan만 실행한다. 파일에 변수 값이 평문으로 들어 있어 state처럼 다룬다.

plan 출력은 줄 앞의 기호로 읽는다.

```text
  + create
  ~ update in-place
  - destroy
-/+ destroy and then create replacement
+/- create replacement and then destroy

Plan: 0 to add, 1 to change, 0 to destroy.
```

### 자원 주소

plan은 코드와 state를 주소로 짝지어 견준다. 주소가 같으면 같은 자원으로 보고 속성을 비교하고, 코드에만 있으면 create, state에만 있으면 destroy다. 같은 모양의 자원 여러 개를 만들 때는 주소를 붙이는 방식이 둘이다.

- `count`: 순번으로 부른다. `user[0]`, `user[1]`, `user[2]`
- `for_each`: map(키와 값을 짝지은 묶음)의 키로 부른다. `user["a"]`, `user["b"]`, `user["c"]`

모드를 바꿔 가며 가운데 b를 빼고, plan에 자원이 몇 개 걸리는지 비교한다.

<figure class="fig" data-figure="terraform-iac-foreach">
  <figcaption>목록에서 b를 뺄 때 count와 for_each의 plan</figcaption>
</figure>

count에서는 b가 빠지면 c가 1번으로 당겨진다. state의 `user[1]`은 b인데 코드의 `user[1]`은 c가 되어 1번을 c로 바꾸고, 코드에 없는 2번을 지우는 plan이 나온다. for_each는 키로 짝지으니 `user["b"]`만 state에 남고 그것만 지운다. 두 모드 모두 코드에서 뺀 것은 하나인데, count는 순번이 곧 주소라서 b 뒤의 자원까지 plan에 끌려 들어온다.

이미 count로 만든 자원은 `moved` 블록(Terraform 1.1부터)으로 주소만 옮긴다. state 안의 이름만 바뀌고 실제 자원은 지우지 않는다.

```hcl
moved {
  from = google_compute_instance.web[0]
  to   = google_compute_instance.web["a"]
}
```

## 의존성 그래프

### 그래프와 병렬 실행

plan이 낸 변경은 위에서부터 한 줄씩 실행되지 않는다. Terraform은 자원을 점(node)으로, 의존을 선(edge)으로 이은 그래프를 만들고 그 그래프로 순서를 정한다. 선은 두 곳에서 나온다.

- 참조: 한 자원의 인자가 다른 자원의 속성을 쓰면 선이 생긴다.
- `depends_on`: 참조는 없지만 순서가 필요한 숨은 의존을 직접 적는다.

```hcl
# 필수 인자 일부 생략
resource "google_compute_subnetwork" "app" {
  network = google_compute_network.vpc.id
}

resource "google_compute_instance" "web" {
  network_interface {
    subnetwork = google_compute_subnetwork.app.id
  }
}

resource "google_dns_record_set" "web" {
  rrdatas = [google_compute_instance.web.network_interface[0].network_ip]
}
```

공식 문서는 `depends_on`을 마지막 수단으로 쓰라고 한다. 무엇에 기대는지 Terraform이 알 수 없어서 plan이 보수적으로 변하고, 필요보다 많은 자원을 교체하거나 값을 모름(unknown)으로 둘 수 있다.

Terraform은 그래프를 걸으며(walk) 의존하는 점이 모두 끝난 점을 바로 실행한다. 동시에 처리하는 점은 기본 10개이고 `-parallelism=n`으로 바꾼다. 아래 그림처럼 VPC가 끝나는 순간 VPC만 참조하는 서브넷과 방화벽이 함께 출발한다.

<figure class="fig" data-figure="terraform-iac-graph">
  <figcaption>apply 때 그래프를 따라 자원이 생기는 순서 (시간은 대략값)</figcaption>
</figure>

DNS 레코드에 들어갈 IP는 VM이 생기기 전에는 알 수 없다. 그래서 plan에는 이 값이 `(known after apply)`로 나오고, apply 중에 VM이 만들어진 뒤에야 정해진다.

지울 때는 순서가 거꾸로다. DNS 레코드, VM, 서브넷, VPC 순으로 내려간다. 코드에서 자원 블록을 지운 뒤에도 이 순서를 지키는 것은 state의 `dependencies`에 의존이 남아 있어서다.

### 교체와 create_before_destroy

속성을 그 자리에서 고칠 수 있는지는 provider가 정한다. 클라우드 API가 그 속성의 수정을 지원하지 않으면 provider가 plan에 교체를 표시하고, 출력에 `-/+`가 붙는다. google provider의 VM은 이렇다.

- `name`, 부트 디스크의 `image`: 바꾸면 새 VM을 만든다(forces a new resource).
- `machine_type`: 그 자리에서 바꾸지만 VM을 멈춰야 해서 `allow_stopping_for_update = true`가 있어야 한다.

교체의 기본 순서는 옛 자원을 먼저 지우고 새 자원을 만드는 것이다. `lifecycle`에 `create_before_destroy`를 켜면 순서가 뒤집혀 새 자원을 먼저 만들고 옛 자원을 지우며, plan 기호도 `+/-`로 바뀐다. 아래 그림이 두 순서의 차이다.

```hcl
resource "google_compute_instance" "web" {
  lifecycle {
    create_before_destroy = true
  }
}
```

<figure class="fig" data-figure="terraform-iac-replace">
  <figcaption>VM 교체의 두 순서 (시간은 대략값)</figcaption>
</figure>

기본 순서는 옛 VM을 지운 뒤 새 VM이 뜰 때까지 서비스가 끊기고, create_before_destroy는 새 VM이 먼저 떠 있어 끊기지 않는다. 그런데도 기본값이 아닌 이유는 두 자원이 잠시 함께 있어야 해서다. 이름이 겹치면 안 되는 자원이 많아서, `name = "web"`처럼 이름을 고정한 VM은 새 VM을 만드는 단계에서 실패한다. 이름에 접미사를 붙여 겹치지 않게 한 뒤에 켠다. 이 설정은 그 자원이 의존하는 자원에도 함께 적용된다.

교체를 막는 설정도 `lifecycle`에 있다.

- `prevent_destroy = true`: 이 자원을 지우거나 교체하는 plan을 오류로 막는다. 코드에서 자원 블록을 통째로 지우면 막지 못한다.
- `ignore_changes = [machine_type]`: 적은 속성을 만든 뒤의 비교에서 뺀다. 다른 시스템이 고치는 값이 드리프트로 잡히지 않는다.

VM이나 DB 줄에 `-/+`가 보이면 디스크와 IP가 바뀔 수 있으니 apply 전에 멈춘다.

## 원격 state와 잠금

팀은 state를 노트북이 아니라 원격 저장소(backend)에 둔다. 그러면 두 사람이 같은 state로 동시에 apply하는 일이 생긴다. apply는 state를 읽고, 클라우드를 바꾸고, 새 state를 쓴다. 둘이 같은 state를 읽어 놓고 각자 쓰면 나중에 쓴 쪽이 앞의 결과를 덮는다.

모드를 바꿔 A와 B가 몇 초 차이로 apply를 시작하게 하고, 맨 아래 state 줄에 무엇이 남는지 비교한다.

<figure class="fig" data-figure="terraform-iac-lock">
  <figcaption>두 사람이 같은 state에 동시에 apply할 때 (시간은 대략값)</figcaption>
</figure>

잠금이 없으면 B가 VM a가 빠진 state를 써서, VM a는 클라우드에 있는데 state에서 사라진다. Terraform이 모르는 자원이 되어 다음 plan에도 나오지 않는다. 잠금이 있으면 B는 A가 끝날 때까지 기다렸다가 A가 쓴 state를 읽고 시작한다. 잠금이 B의 읽기를 A의 쓰기 뒤로 미루기 때문에, **B가 기다리는 25초**를 내주고 두 VM이 모두 state에 남는다.

Terraform은 state를 쓸 수 있는 명령마다 자동으로 잠금을 건다. 잠금을 얻지 못하면 멈추는데, `-lock-timeout`의 기본값이 `0s`라 기다리지 않고 바로 실패한다. 그림처럼 기다리게 하려면 `-lock-timeout=5m`처럼 시간을 준다.

잠금은 저장소가 제공하는 "없을 때만 만들기" 기능으로 구현한다. 두 사람이 동시에 시도해도 저장소가 한쪽만 성공시킨다.

- gcs: state 옆에 `<워크스페이스>.tflock` 객체를 "존재하지 않을 때만" 조건으로 쓴다. 객체의 세대(generation) 번호가 잠금 ID다.
- azurerm: state blob에 기한 없는 임대(lease)를 건다. 임대가 걸린 blob은 그 임대 ID 없이는 쓸 수 없다.
- s3: `use_lockfile = true`면 `.tflock` 객체를 `If-None-Match: *` 조건으로 쓴다. 기본값은 false이고, 예전의 `dynamodb_table` 잠금은 폐기 예정이다.

```hcl
terraform {
  backend "gcs" {
    bucket = "tf-state-prod"
    prefix = "network"
  }
}
```

잠금은 동시에 쓰는 것만 막는다. 잘못 고친 state를 쓰거나 지우는 사고는 막지 못해서, GCS backend 문서는 버킷의 객체 버전 관리를 켜 두라고 권한다.

state를 손으로 올리는 `terraform state push`는 lineage가 다르거나 원격 state의 serial이 더 크면 거절한다. 그림의 v5, v6처럼 serial은 state가 바뀔 때마다 오르므로, 오래된 state로 새 state를 덮는 실수가 여기서 걸린다.

잠금이 풀리지 않고 남으면 `terraform force-unlock <잠금 ID>`로 푼다. 다른 사람이 잡은 잠금을 풀면 둘이 동시에 쓰게 되니, 자기가 건 잠금이 자동으로 풀리지 않았을 때만 쓴다.

## Terraform 밖의 층

### 세 층과 세 도구

Terraform이 견주는 것은 provider가 API로 읽을 수 있는 속성뿐이다. VM의 크기, 디스크, 방화벽 규칙은 보이지만, VM 안에 설치된 패키지나 설정 파일은 클라우드 API에 없어서 state에도 plan에도 나오지 않는다. VM 한 대에는 손이 가는 층이 셋이고 층마다 맡는 도구가 다르다.

- 클라우드 자원(VPC, 서브넷, 방화벽, VM): Terraform이 API로 만든다.
- OS 이미지(OS, 패키지, 에이전트): Packer가 빌드 때 굽는다.
- 서버 설정(설정 파일, 서비스, 계정): Ansible이 서버가 뜬 뒤 맞춘다.

아래 그림처럼 Packer, Terraform, Ansible 순서로 VM 한 대가 완성된다.

<figure class="fig" data-figure="terraform-iac-layers">
  <figcaption>세 도구가 맡는 층</figcaption>
</figure>

### Packer 이미지

Packer는 기본 이미지로 임시 VM을 띄우고, 그 안에서 provisioner(스크립트, 파일 복사)를 실행한 뒤, 디스크를 새 이미지로 저장하고 임시 VM을 지운다.

구운 이미지는 서버 안쪽의 변경을 Terraform이 볼 수 있는 값으로 바꾼다. 부트 디스크의 `image`가 새 버전을 가리키면 plan에 교체(`-/+`)로 나오고, 앞 절의 create_before_destroy로 중단 없이 갈아 끼운다. 패키지 설치를 부팅 뒤로 미루면 서버를 늘릴 때마다 설치 시간이 붙고, 설치하는 날의 저장소 상태에 따라 서버마다 버전이 달라진다.

### Ansible 멱등성

떠 있는 서버의 설정 한 줄을 바로 고쳐야 할 때는 Ansible을 쓴다. 제어 노드에서 SSH(Windows는 원격 관리 프로토콜인 WinRM)로 서버에 접속해 플레이북(playbook)의 작업을 차례로 실행하고, 서버에 에이전트를 깔지 않는다.

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

모듈은 대부분 "이 상태여야 한다"를 적는다. 실행할 때 서버의 지금 상태와 견줘 이미 같으면 ok, 바꿨으면 changed를 낸다. 여러 번 돌려도 결과가 같은 이 성질을 멱등성(idempotency)이라고 하며, 아래 그림은 같은 플레이북을 두 번 돌린 결과다.

<figure class="fig" data-figure="terraform-iac-ansible">
  <figcaption>같은 플레이북을 두 번 실행한 결과</figcaption>
</figure>

Terraform은 state라는 기록과 견주지만 Ansible은 기록 없이 매번 서버를 직접 확인한다. state를 잃을 걱정은 없는 대신, 플레이북에서 작업을 지워도 서버에 깔린 것은 그대로 남는다. 지우려면 `state: absent`로 없어야 할 상태를 적는다.

Terraform의 plan에 해당하는 것은 check 모드다. `--check`는 서버를 바꾸지 않고 바뀔 작업만 보고하고, `--diff`를 더하면 파일의 바뀔 줄까지 보여 준다. 모의 실행이라 한계가 있다.

- check 모드를 지원하지 않는 모듈은 아무것도 보고하지 않고 아무것도 하지 않는다.
- 앞 작업의 결과(`register`)에 기대는 조건부 작업은 앞 작업이 실제로 돌지 않아 결과가 나오지 않는다.

## 정리

- Terraform은 코드, state, 실제 자원을 견준다. state는 코드의 주소와 클라우드 ID를 잇는 대응표이고, serial과 lineage로 어느 state인지 가린다.
- plan은 refresh로 state를 실제에 맞춘 뒤 코드와 주소별로 견준다. 콘솔 변경은 드리프트로 잡혀 되돌려지고, 바뀌는 목록은 for_each의 키로 주소를 붙인다.
- apply는 참조로 만든 그래프를 따라 의존이 끝난 자원부터 기본 10개씩 병렬로 실행하고, 지울 때는 역순으로 간다.
- 그 자리에서 못 고치는 속성은 교체(`-/+`)가 되고 기본은 지우고 만들기다. 중단이 안 되는 자원은 겹치지 않는 이름과 create_before_destroy로 바꾼다.
- 원격 state는 저장소의 "없을 때만 만들기"로 잠그고, 사고는 객체 버전 관리로 되돌린다.
- API로 보이지 않는 서버 안쪽은 Packer 이미지와 Ansible의 멱등한 작업이 맡고, check 모드가 Ansible의 plan이다.

## 참고

- [Terraform: State](https://developer.hashicorp.com/terraform/language/state), [Purpose of state](https://developer.hashicorp.com/terraform/language/state/purpose)
- [Terraform: State locking](https://developer.hashicorp.com/terraform/language/state/locking)
- [Terraform: terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform: terraform state push](https://developer.hashicorp.com/terraform/cli/commands/state/push)
- [Terraform: Resource graph](https://developer.hashicorp.com/terraform/internals/graph)
- [Terraform: depends_on](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on), [lifecycle](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle), [for_each](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)
- [Terraform: Refactoring (moved)](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [Terraform: Resource instance change lifecycle](https://github.com/hashicorp/terraform/blob/main/docs/resource-instance-change-lifecycle.md)
- [Terraform 소스: gcs, azure, s3 backend 잠금 구현](https://github.com/hashicorp/terraform/tree/main/internal/backend/remote-state)
- [Terraform: Backend gcs](https://developer.hashicorp.com/terraform/language/backend/gcs), [azurerm](https://developer.hashicorp.com/terraform/language/backend/azurerm), [s3](https://developer.hashicorp.com/terraform/language/backend/s3)
- [Google provider: google_compute_instance](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_instance)
- [Packer: Introduction](https://developer.hashicorp.com/packer/docs/intro)
- [Ansible: Desired state and idempotency](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_intro.html)
- [Ansible: Check mode and diff mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html)
- [Ansible: command module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/command_module.html), [Controlling playbook execution](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_strategies.html)
- 원글: [Terraform 시작하기 (GCP)](https://kimjanghyun1010.tistory.com/33), [Terraform Variable](https://kimjanghyun1010.tistory.com/34), [Terraform (Azure)](https://kimjanghyun1010.tistory.com/59), [Terraform GitOps(/w Atlantis)](https://kimjanghyun1010.tistory.com/93), [Packer](https://kimjanghyun1010.tistory.com/51), [ansible](https://kimjanghyun1010.tistory.com/57)
