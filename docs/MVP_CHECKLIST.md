# Halopress MVP Checklist

## 0. Local setup
- [ ] Set env: `NUXT_AUTH_ORIGIN`, `NUXT_AUTH_SECRET`
- [ ] `pnpm install`
- [ ] `pnpm dev`

## 1. DB (SQLite / D1-compatible)
- [x] Idempotent init migration (`server/db/migrations/0001_init.sql`)
- [x] Drizzle schema definitions (`server/db/schema.ts`)
- [x] DB adapter (local `node:sqlite` + Cloudflare D1 binding hook) (`server/db/db.ts`)

## 2. Auth (Desk)
- [x] Admin login (NuxtAuth credentials)
- [x] Session strategy (JWT)
- [x] Desk route guard (`app/middleware/desk-auth.global.ts`)
- [ ] Replace env-login with OAuth (better-auth) (post-MVP)

## 3. Schema management
- [x] Draft save/load (`/api/schema/:schemaKey/draft`)
- [x] Publish version (`/api/schema/:schemaKey/publish`) → `schema` + `schema_active`
- [x] Compiler: AST → JSON Schema + registry (`server/cms/compiler.ts`)
- [ ] Diff events (real structural diff) (post-MVP)

## 4. Content management
- [x] CRUD APIs (`/api/content/:schemaKey/**`)
- [x] Simple relation sync (`server/cms/ref-sync.ts`) (MVP: top-level only)
- [x] Schema-driven editor (Nuxt UI + `u-editor`)
- [x] Searchable EAV table (`content_search_data`) + `content_search_config` metadata
- [x] Search/filter/sort toggles in schema editor field dialog
- [x] Content write indexing + publish-time reindex for search toggles
- [x] Search API (`/api/search`) with EXISTS-based filters + range support
- [x] Shared rich-text/page editor profiles with fresh Tiptap extension instances
- [x] Immutable published revisions with independent working projections
- [x] Draft preview, discard, republish, and unpublish transitions
- [x] Published/draft asset retention and published-only anonymous delivery
- [ ] Nested object/array fields (post-MVP)

## 5. Assets (local / R2)
- [x] Upload API (multipart → local filesystem, or R2 when bound)
- [x] Asset serving endpoint (`/assets/:assetId/raw`)
- [x] Add Nuxt Image module + presets (avatar/card/content) for thumbnails
- [x] Replace asset preview `<img>` tags with `<NuxtImg>` (preset-driven)
- [x] Use IPX locally and Cloudflare provider when deployed (env/detect)
- [x] Remove unused `asset_variant` table with migration
- [ ] Direct-to-R2 presigned uploads (post-MVP)
- [ ] Variants/thumb pipeline (Cloudflare Images) (post-MVP)

## 6. Standalone pages
- [x] Page editor with ordinary Tiptap content and curated page blocks
- [x] Shared Desk/SSR/client page document renderer
- [x] Published-only page resolver and `/p/:id` public route
- [x] Authenticated private/noindex draft preview
- [x] Safe fallback for unknown, retired, or malformed page blocks
- [x] One active validated Site Theme plus a separate transparent standalone document v2 artifact
- [ ] Public slugs and custom paths (post-MVP)
- [ ] Multiple themes, marketplace, and expanded block catalog (post-MVP)

## 7. UI
- [x] Viewer: home / collection / detail pages
- [x] Desk: dashboard / schemas / content / assets
- [ ] Polishing: validations, empty states, better relation picker (iterative)
