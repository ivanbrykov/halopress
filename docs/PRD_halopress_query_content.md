# PRD: Halopress Query / Content Composables

## 배경
- 현재 페이지들은 `useFetch`로 직접 `/api/content` 및 `/api/schema`를 호출하고 있음.
- 리스트에서 `extra`를 매번 파싱하면 비용이 커지므로, 콘텐츠 저장 시 스냅샷을 저장하는 구조가 필요.

## 목표
- `useHalopressQuery`와 `useHalopressContent` 컴포저블 제공.
- 스키마 기반 콘텐츠 타입을 런타임에서 `zod-from-json-schema`로 생성.
- 콘텐츠 목록에 표준 필드(`id`, `title`, `description`, `image` 등) 제공.
- 리스트 성능을 위해 `content_items` 스냅샷 테이블 도입.

## 비목표
- 기존 Desk 화면의 UI/UX 개선.
- 기존 `/api/content` 응답 포맷 변경.

## 핵심 사용자 흐름
1. 리스트 조회
   - `const { items, hasPrev, hasNext, reload } = await useHalopressQuery('article', { cursor, pageSize })`
2. 상세 조회
   - `const { content, surroundings } = await useHalopressContent('article/123')`
   - 또는 `useHalopressContent('article', { id: 123 })`

## 데이터 모델
### `content_items` (스냅샷)
- `content_id` (PK)
- `schema_key`, `schema_version`
- `title`, `description`, `image`
- `status`
- `created_at`, `updated_at`

### 스냅샷 생성 규칙
- `description`: 스키마의 `richtext` 필드 중 첫 번째 값을 문자열로 추출 후 200자까지 자름.
- `image`: 스키마의 `asset` 필드 중 첫 번째 값을 `/assets/{id}/raw` URL로 저장.

## API 설계
### Query
- `GET /api/content/:schemaKey`
- Query params: `cursor`, `pageSize`, `order`, `status`, `refField`, `refId`
- Response:
  - `items: HalopressItem[]` (description/image 포함)
  - `nextCursor: string | null`

### Content
- `GET /api/content/:schemaKey/:id`
- Query params: `order`, `status`, `surroundings=1`
- Response:
  - `content` 필드들이 top-level로 반환 (표준 필드 + `extra`)
  - `surroundings` (`prev`, `next`)는 `surroundings=1`일 때만 포함

## 컴포저블 설계
### useHalopressQuery
- 내부에서 `useFetch` 사용
- `cursor`, `pageSize` 등 `MaybeRef` 변경 시 자동 재요청
- 반환값: `items`, `hasPrev`, `hasNext`, `reload` 등

### useHalopressContent
- 내부에서 `useFetch` + `/api/schema/:schemaKey/active`
- `convertJsonSchemaToZod`로 스키마 생성
- `content.extra`를 zod로 검증 후 반환

## 마이그레이션
- 스키마 변경 후 `pnpm db:generate add_content_items_snapshot`
- 적용: `pnpm db:migrate`

## 수용 기준 (Acceptance Criteria)
- [x] `content_items` 테이블 및 인덱스 추가
- [x] 콘텐츠 생성/수정/삭제 시 스냅샷 동기화
- [x] 자산 삭제/교체 시 스냅샷 동기화
- [x] `useHalopressQuery`, `useHalopressContent` 구현
- [x] `zod-from-json-schema` 도입 및 런타임 타입 검증 적용
- [x] 기존 `/api/content` 엔드포인트 확장 (description/image + surroundings 지원)

## 리스크 / 대응
- 기존 데이터는 스냅샷이 없을 수 있음 → 기존 콘텐츠를 재저장하거나 별도 백필 스크립트로 보완 가능.

## 권한 모델 노트
- `admin` 권한은 현재 `read`/`write`와 동일하게 동작하며, 추후 스키마 수정 권한으로 확장 예정.
