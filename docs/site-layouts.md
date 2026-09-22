# Layout resource contract

HaloPress Layouts are named, persisted public rendering contracts. They describe finite responsive regions and semantic Site elements around one required Page-content slot. They are not Nuxt application layouts, Vue templates, or a component registry. The `site/layouts` API and `site_layout_*` database names exist only to avoid namespace collisions; exported domain vocabulary uses `LayoutDocument`, `LayoutResource`, `LayoutElement`, `LayoutPreset`, and later `LayoutRenderer`.

## Version 1 document

Every current document contains:

- `version: 1`;
- the stable `layoutId` and current resource `name`;
- a grid with an allowlisted maximum width and gap;
- fixed mobile, tablet, and desktop column counts;
- unique named regions with bounded row, column, span, visibility, and flow tokens; and
- at most 64 ordered semantic element instances with stable IDs and strictly typed properties.

The validator requires one visible `content` region and exactly one `page-content` element in that region. All viewport geometry is bounded even when a region is hidden, regions cannot overlap when visible, element IDs and per-region orders are unique, and every element must use a region permitted by its descriptor.

Documents never contain Nuxt layout selectors, component names or keys, import paths, Vue files, classes, Tailwind tokens, Nuxt UI `ui` payloads, slots, templates, HTML, CSS, JavaScript, prototype keys, callbacks, or runtime lookup data. A recursive forbidden-data scan runs before strict schema parsing at every persistence boundary. Malformed or forbidden stored JSON returns `repair-required`; it is never replaced with a renderable fallback and never reaches a renderer.

## Semantic elements

The source-controlled descriptor registry defines safe labels, inspector fields, default properties, allowed regions, reference policy, and deletion policy for:

- Page content;
- Site logo;
- Site title;
- Menu set;
- Page list;
- Table of contents; and
- Copyright.

Menu elements persist only a stable `menuSetId` and `horizontal | vertical` orientation. They do not copy navigation items. Their descriptor declares live resolution and restrictive deletion. `site_menu_reference` rows use `owner_type='site-layout'`, the Layout ID as `owner_id`, and the stable element ID as `slot`; moving a Menu element therefore does not change its reference identity.

The eventual renderer must define an exhaustive code-owned `LayoutRendererRegistry` keyed by the already validated semantic `LayoutElement.type`. This registry is a compile-time/runtime application dependency only. It is not present in descriptor API responses, Layout documents, admin resources, or resolved projections, and no database/API value may select an import or component.

## Presets and editor helpers

The source registry contains Blank, Grid, header/footer, header/right-sidebar, header/two-sidebar, and justified variants. Blank still contains the required Page-content slot; it means no Site chrome, not no content. Menu-bearing presets initially reference the stable Global navigation ID.

Preset definitions and nested descriptor metadata are recursively frozen. Creation validates and deep-clones a preset, assigns the new Layout ID/name and independent element IDs, and persists that copy at revision 1. Mutating a returned document or metadata response cannot modify the source registry or an existing Layout.

Pure shared helpers insert, move, reorder, duplicate, and delete semantic elements for #71. Callers supply stable IDs. Helpers normalize order, validate the complete result, do not mutate the source document, and refuse to duplicate/delete the required Page-content element or place an element in a disallowed region.

## Persistence and current-save semantics

`site_layout_resource` owns stable identity, normalized unique name, current document JSON, current revision, and audit metadata. Generic immutable `document_revision` history uses `document_kind='layout'`; Layout saves opt out of ordinary save-history pruning. Create records revision 1. Whole-document save and dedicated rename require the caller's current revision and append `save` or `rename` history. Delete appends a final `delete` audit revision and retains history after removing the active resource.

Strict parsing also canonicalizes serialization: regions follow the fixed Layout region vocabulary and elements follow region, authoritative relative `order`, then stable ID. Element orders are renumbered contiguously per region and schema-defined object key order is rebuilt before persistence and resolved projection, so semantically identical documents produce identical JSON and revision snapshots regardless of incoming array order or sparse order values.

A stable Layout ID always means its current active revision. Intentional edits therefore propagate to every assignment; Desk describes this as “follows current Layout revision.” Assignments never pin a Layout revision.

SQLite transactions and Cloudflare D1 atomic batches update the current resource, append history, and replace Menu references together. The revision uniqueness guard turns competing stale writes into `409 Conflict`. Menu foreign keys decide Menu-delete/Layout-save races: if Menu deletion commits first, the Layout batch rolls back; if the Layout reference commits first, Menu deletion is blocked with actionable usage.

`site_layout_reference` is the normalized deletion-integrity seam for Site, Schema, and Page assignments. Its restrictive foreign key closes assignment/deletion races and its finite behavior token records current-revision behavior.

## Assignment and publication contract

Migration `0010_add_site_layout_assignments` adds nullable `page.layout_id` working metadata and nullable `publication_revision.layout_id` snapshots. These historical columns intentionally have no direct foreign key. Current normalized references are the deletion/race authority:

- the typed `site.layout.default` setting and `site/default/default` reference are the immediately active Site default;
- Schema drafts use `schema/<schemaKey>/working`, while each immutable published version retains `schema/<schemaKey>/published:<version>` until Schema purge;
- Page working metadata uses `page/<pageId>/working`, while only the current publication uses `page/<pageId>/published`. Old publication rows do not permanently block Layout deletion.

Absent assignment input preserves the current value, `null` clears it, and a string must identify a strictly valid, ready Layout. General Page and Schema saves remain allowed while Site mode is disabled when the assignment is unchanged; an actual assignment change or clear returns `403`. Disabling Site mode never deletes settings, metadata, or normalized references.

Page create/save updates the working assignment. Publish stores it in the immutable publication revision and updates the current published reference. Discard restores working metadata from that publication; unpublish and soft delete remove only the published reference; soft delete preserves working metadata. Restoring an authored Page content revision deliberately preserves current Layout metadata.

Schema publication validates the draft assignment and commits the immutable version, active pointer, anonymous role, canonical collection route, and `published:<version>` reference in one SQLite transaction or D1 batch. A Layout-delete race therefore cannot leave a partially published Schema. Schema draft-history restore updates the working reference, and Schema purge removes its working and historical published references atomically with the Schema data.

Public resolution is deterministic:

1. a standalone Page's published assignment;
2. the publication's exact Schema-version presentation assignment for collection/structured-content delivery;
3. the Site default; and
4. the code-owned built-in shell fallback.

Standalone Page routes never consult a Schema assignment. Content detail uses the publication revision's exact `schemaVersion`, not the Schema's current active version. The first explicit assignment is authoritative: if it is invalid, missing, retired, or repair-required, diagnostics retain that source and resolution uses the built-in fallback instead of silently inheriting a lower assignment. Site mode disabled returns the disabled fallback before rendering consumes assignments. Each successful resolution reads the current Layout resource revision, so later valid Layout edits propagate live.

## Admin API

Reads require an active administrator and remain available while Site mode is disabled for overview and repair. Mutations additionally require Site mode to be enabled.

- `GET /api/site/layouts` — list resources plus safe preset and element descriptors.
- `POST /api/site/layouts` — create from `{ name, presetKey }`.
- `GET /api/site/layouts/:layoutId` — read current management state.
- `PUT /api/site/layouts/:layoutId` — save `{ revision, document }`; it cannot rename.
- `PATCH /api/site/layouts/:layoutId` — rename with `{ revision, name }`.
- `POST /api/site/layouts/:layoutId/duplicate` — deep-clone the current valid document into an independent resource.
- `GET /api/site/layouts/:layoutId/usage` — list actionable normalized references.
- `DELETE /api/site/layouts/:layoutId?revision=:revision` — guarded delete. Exactly one positive integer revision is required. Nitro 2.13's Cloudflare preset forwards request bodies only for POST, PUT, and PATCH, so the DELETE precondition is intentionally carried in the query instead of a JSON body.
- `GET|PUT /api/settings/site-layout` — read or replace the typed Site default assignment.
- `GET /api/site/layout-assignments/options` — minimal ready/repair option metadata for Desk selectors.

Assignment APIs are administrator-only. Page and Schema assignment metadata is returned only through their existing private Desk endpoints. Anonymous delivery APIs do not expose Site, Schema, or Page assignment state; the internal resolver supplies only the composition decision needed by the later renderer.

Validation failures return structured `400` issues, missing resources return `404`, stale/name/reference conflicts return `409`, and a rolling deploy without migration `0009_add_site_layout_documents` returns `503`. Admin and resolved repair projections never echo raw unsafe stored JSON.

Other existing DELETE endpoints that still read JSON bodies need a separate framework-level follow-up; #70 does not change their contracts.

## Scope boundaries

#72 does not implement the visual Layout editor (#71), public/full-preview composition (#73), or dynamic Menu sources (#74). Nuxt files under `app/layouts/` continue to own only application shells and must never be serialized, selected, or exposed as Layout resources.
