# PRD: Data Structure Refactor

## 배경
- 현재 `content`는 `title` 컬럼과 `extra_json` 컬럼으로 값을 이원화해서 저장한다.
- `title`이 시스템 필드처럼 특별 취급되면서 스키마 설계와 콘텐츠 편집 경험이 불필요하게 분리되어 있다.
- 검색은 `content_search_data`에 별도 인덱싱하여 유지하고 있고, 리스팅은 `content_items` 스냅샷에 의존한다.
- 이번 변경은 아직 릴리즈 전 단계이므로, 기존 SQLite 데이터와 migrations를 파괴적으로 초기화해도 된다.

## 목표
- `content`를 `content_json` 단일 저장 구조로 단순화한다.
- `title`을 일반 스키마 필드로 전환하고, 새 스키마에는 기본 필드로 노출한다.
- 리스팅 캐시를 `content_listing`으로 재구성하고, `title`/`description`/`image` 매핑을 스키마에서 제어한다.
- `content_search_data`를 materialized search index로 유지하고, 검색/필터/정렬은 index table을 통해 수행한다.
- `content_search_config`를 `search_config`로 이름 변경하되, stable `fieldId` 기준 설정을 유지한다.
- 단계별 atomic commit을 유지하면서 `test`, `lint`, `typecheck` 검증을 통과시킨다.

## 비목표
- 기존 페이지 편집 기능 자체의 구조 변경
- remote D1 데이터 마이그레이션 수행
- richtext의 전문 검색 기능 유지

## 설계 요약
### Content 저장 구조
- `content.title` 제거
- `content.extra_json` 제거
- `content.content_json` 추가
- 콘텐츠 생성/수정 API payload는 `{ status, content }`로 통일

### Schema 기본 필드
- `title`은 더 이상 system field가 아니다.
- 새 스키마 생성 시 기본 일반 필드로 `{ key: "title", kind: "string", title: "Title" }`를 주입한다.
- system field는 `created_at`, `updated_at`만 유지한다.

### Listing projection
- `content_items`를 `content_listing`으로 교체한다.
- `content_listing`은 아래 필드만 가진다.
  - `content_id`
  - `schema_key`
  - `schema_version`
  - `title`
  - `description`
  - `image`
  - `status`
  - `created_at`
  - `updated_at`
- `content_listing`은 `content_json`은 저장하지 않지만, 목록/위젯 필터 최적화를 위해 `status`는 projection으로 복제한다.

### Listing 설정
- schema AST/registry에 versioned `listing` 설정을 추가한다.
- 설정 필드:
  - `titleFieldKey`
  - `descriptionFieldKey`
  - `imageFieldKey`
- 기본값은 heuristic으로 채우고, schema editor에서 사용자가 수정할 수 있게 한다.
- heuristic:
  - `title`: exact `title`, then first `string`, then first `text`
  - `description`: exact `description`/`summary`/`excerpt`, then first `text`, then first `richtext`
  - `image`: exact `image`/`thumbnail`/`cover`, then first `asset`

### Search
- `content_search_config`는 `search_config`로 rename한다.
- `search_config`는 `(schemaKey, fieldId)` 기준으로 `fieldKey`, `kind`, `searchMode`, `filterable`, `sortable`를 저장한다.
- `content_search_data`는 write-time materialized index로 유지한다.
- `/api/search` 및 Desk content list는 `search_config` + `content_search_data` 기반으로 조회한다.
- richtext는 search/filter/sort 대상에서 제외한다.

## 구현 단계
1. docs
- `feat/refactory-data-structure` 브랜치 생성
- 본 PRD 문서 추가

2. tests
- Vitest 최소 구성 추가
- helper 단위 테스트 작성

3. schema + editor
- schema types/zod/compiler에 `listing` 추가
- default `title` field 도입
- schema editor에 listing mapping UI 추가

4. content json
- `content_json` 기반 저장/조회로 전환
- content CRUD API와 desk content form을 `content` payload 기반으로 변경

5. content listing
- `content_items` 제거
- `content_listing` 도입
- content create/update/delete, schema publish, asset replace/delete, install bootstrap 시 projection 동기화

6. materialized search index
- `content_search_data` 유지
- `search_config` rename 및 sync 유지
- `/api/search`, Desk filters/sorts, curation widget을 materialized search index 기반으로 전환

7. destructive reset
- local SQLite 삭제
- migrations 초기화 후 새 initial migration 생성
- local migrate 재적용

## 커밋 전략
1. `docs: add data structure refactor plan`
2. `test: add minimal vitest coverage for cms helpers`
3. `refactor: add listing config and default title field`
4. `refactor: store content as content json`
5. `refactor: rebuild content_listing projection`
6. `refactor: replace search index with direct json queries`
7. `chore: reset local db and regenerate initial migration`

## 검증 기준
- 각 단계에서 가능한 한 `pnpm test`, `pnpm lint`, `pnpm typecheck` 실행
- 최종 단계에서 `pnpm db:migrate` 실행
- 수동 smoke:
  - 새 schema 생성 후 default `title` field 확인
  - listing mapping 설정 및 publish
  - content 생성/수정/삭제
  - recent/curation widget 확인
  - Desk search/filter/sort 확인

## 파괴적 리셋 범위
- local SQLite file: `.data/halopress.sqlite`
- `server/db/migrations/*`
- `server/db/migrations/meta/*`
- 새 initial migration은 descriptive name으로 생성한다.

## 체크리스트
- [ ] branch 생성
- [ ] PRD 문서 추가 및 커밋
- [ ] Vitest 추가 및 helper tests 작성
- [ ] schema `listing` 설정 추가
- [ ] default `title` field 전환
- [ ] `content.content_json` 전환
- [ ] desk content form/API payload를 `content`로 전환
- [ ] `content_listing` 테이블 도입
- [ ] listing projection sync 전면 수정
- [ ] `content_search_data` materialized index 유지
- [ ] `search_config` rename
- [ ] JSON direct query search 적용
- [ ] local DB 및 migrations 초기화
- [ ] final `db:migrate`
- [ ] final `test`
- [ ] final `lint`
- [ ] final `typecheck`
