# Typed settings sections

HaloPress settings are feature-owned contracts, not a public or administrator-facing key/value editor.

Desk navigation follows the same ownership boundary. `/_desk/settings/**` contains only HaloPress administrator behavior: browser-local Desk preferences and the combined authentication-and-membership workflow. Everything that affects the public website belongs to `/_desk/site/**`, including Site enablement, identity, branding, the default HaloPress Layout, Themes, Menus, and preserved built-in-renderer compatibility values. The main Desk sidebar is the only Settings navigation surface; empty speculative destinations are not registered.

Desk color mode is stored as a browser cookie and applied through Nuxt color mode when the Desk layout mounts. It never reads or writes `site.presentation`, Theme documents, Layouts, Menus, or portable rendering artifacts. Public Site color-mode ownership remains with the active Theme or preserved built-in presentation contract.

The shared section registry in `shared/settings-sections.ts` owns only implemented Desk routes. Each implemented server section must:

1. define a strict, versioned schema and safe defaults in `shared/`;
2. expose an administrator endpoint that calls `requireAdmin` before reading a body or database state;
3. store audit metadata (`groupKey`, `updatedBy`, `updatedAt`, and a descriptive note);
4. return management state instead of raw setting rows;
5. redact secrets and mark environment-managed values read-only; and
6. build any public response from an explicit projection rather than enumerating the settings table.

Site presentation is the reference implementation. `site.presentation` stores one atomic JSON document for General, Appearance, Shell, the legacy Navigation snapshot, and Footer. The update endpoint accepts complete typed General, Appearance, Shell, and Footer patches, validates the merged document, and retains referenced branding assets. Navigation writes have moved to named Site menu resources; an old Navigation patch is rejected with the stable Global menu ID and its Desk location. The public delivery endpoint returns only resolved presentation values and fallbacks, with a revision-backed ETag computed from the final canonicalized projection so SSR and hydration use the same current contract.

Site feature availability is a separate administrator-owned contract. `site.mode` stores the strict versioned `{ version: 1, enabled: boolean }` document and defaults to disabled when the row is missing or malformed. Site General remains reachable while disabled so administrators can enable it or manage preserved built-in fallbacks. Enabled-only Theme, Layout, and Menu tools remain gated, and disabling Site never deletes `site.presentation`, content, pages, Theme artifacts, Layout resources, or menus. There is intentionally no public `site.mode` endpoint. The minimal enabled flag is projected through the public Theme manifest so anonymous Site SSR can gate only its shell adapter without reading an administrator endpoint.

## Active Site Theme

`site.theme.active` stores one strict Theme v1 document plus bootstrap ownership, source identity, audit metadata, and the last mutation token. Before the first Theme save, public resolution deterministically adapts the canonical `site.presentation.appearance` values but never establishes or mutates active bootstrap ownership; a first advertisement may append the exact immutable CSS artifact once before returning its digest URL. The administrator editor establishes/reconciles a bootstrap-owned snapshot, and its first save atomically verifies the exact legacy source row, appends the currently advertised and next CSS artifacts, then transfers ownership with a compare-and-swap. If an old Worker races an Appearance write, the Theme save detects the changed source and returns a revision conflict instead of silently losing data. Competing Theme editors are likewise fenced. After ownership transfers, new-code enabled-mode Appearance writes are rejected with the `/_desk/site/themes` location; the legacy value remains compatibility metadata. Disabling Site mode restores Appearance as the built-in shell writer without deleting the canonical Theme or its artifacts.

Immutable CSS bytes are stored append-only under `site.theme.artifact.<css-sha256>`. The active Theme document revision hashes normalized editable data, while the stylesheet revision hashes exact compiled bytes. The stable public `/api/delivery/site-theme` projection contains the trusted absolute digest URL and the Site-mode shell flag; digest routes never reconstruct customized historical artifacts from only the current row. The built-in v1 default has a pinned source-controlled digest for missing-table install requests. A malformed active value falls back visibly and safely for rendering but is not overwritten by a GET; a conflicting artifact row fails closed.

Theme v1 supports semantic colors, ordered radii, Site spacing/width tokens, base type size, body/heading line heights, and predefined local/system font stacks only. The allowlisted Public Sans stack uses the installed face in HaloPress and falls through to `ui-sans-serif`/system fonts without making a network request. Raw CSS, remote URLs, credentials, arbitrary font names/files, nonfinite numbers, and unknown fields are rejected. Contrast and surface-separation findings are returned as nonblocking warnings. The Nuxt Site shell maps published `--halo-*` tokens into Nuxt UI variables in app-only infrastructure when Site mode is enabled; `--ui-*` is never stored or published. Standalone document v2 delivery is a separate transparent, color-mode-independent contract and does not advertise the Theme stylesheet.

Bootstrap adaptation retains the legacy primary, neutral, status, radius, and type-scale choices with Halo-owned sRGB equivalents of the source-controlled OKLCH palettes. This preserves the standard sRGB rendering path; it is not a claim of bit-identical output on wide-gamut displays.

## Site menu resources

Named menus are stored as whole, versioned documents in `site_menu_set`. Every set has a stable resource ID, a case-insensitively unique name, audit timestamps/actors, and an ordered tree limited to one child level. Persisted items use HaloPress-owned typed destinations plus an allowlisted icon, scalar badge, optional stable value, and immutable item ID; Nuxt UI runtime callbacks, router objects, classes, slots, and UI state are never stored.

Migration `0008_add_site_menu_sets` creates only the menu and normalized-reference tables. New installations establish **Global navigation** and its built-in public-shell reference before installation is marked complete; upgraded installations create them on the first new-code presentation or menu request. The resource uses the stable ID `global-navigation` and remains bootstrap-owned through rolling deployment. While that ownership remains, every new-code resolution compares the stored source timestamp and document with the current `site.presentation.navigation.items`, reconciles a newer old-Worker save with a checked update, and repeats the source read until it is stable. This closes the migration-before-deploy and read-to-commit interleavings without copying a stale value in SQL. The first successful named-menu save clears bootstrap ownership in the same checked menu update; from that atomic cutover onward, Global is the sole writable navigation source and later legacy writes are intentionally ignored. The old value then remains only as a missing-table rolling-deploy fallback. Normal public rendering and the legacy presentation GET project Global navigation, while all new writes go through `/_desk/site/menus` and `/api/site/menus`.

Menu saves replace the name and full document in one checked database update, so validation failures cannot partially apply a reorder. `site_menu_reference` stores public-resource usage with an `ON DELETE RESTRICT` foreign key. Deletion uses a single conditional statement and verifies the affected row, while the FK remains authoritative if a future Layout adds a reference concurrently. Persisted Layout-owned rows use the storage namespace `owner_type='site-layout'`; they never point at Nuxt `app/layouts/*.vue` files.

### Typed dynamic menu sources

Menu document version 1 also accepts dynamic items alongside static items, either at the top level or in one static parent's `children`. A dynamic item has a stable source ID and exactly one strict, versioned source object. It is declarative data, not a textual query language: there is no parser for pseudo-code, SQL, JavaScript, regular expressions, component names, imports, class names, HTML, URLs to data APIs, or Nuxt application-layout selectors.

The supported source shapes are:

```json
{
  "kind": "dynamic",
  "id": "recent-articles",
  "source": {
    "version": 1,
    "type": "schemaQuery",
    "schemaKey": "article",
    "filters": [],
    "sort": { "type": "system", "field": "createdAt", "direction": "desc" },
    "label": { "type": "systemTitle" },
    "limit": 10
  }
}
```

```json
{
  "kind": "dynamic",
  "id": "tagged-articles",
  "source": {
    "version": 1,
    "type": "schemaQuery",
    "schemaKey": "article",
    "filters": [
      { "fieldId": "article-tags-field-id", "operator": "exactSet", "values": ["a", "b"] }
    ],
    "sort": { "type": "system", "field": "createdAt", "direction": "desc" },
    "label": { "type": "systemTitle" },
    "limit": 10
  }
}
```

```json
{
  "kind": "dynamic",
  "id": "foo-pages",
  "source": {
    "version": 1,
    "type": "pagePrefix",
    "scope": { "type": "fixed", "prefix": "/foo" },
    "sort": "path",
    "limit": 12
  }
}
```

```json
{
  "kind": "dynamic",
  "id": "sibling-pages",
  "source": {
    "version": 1,
    "type": "pagePrefix",
    "scope": { "type": "currentParent" },
    "sort": "title",
    "limit": 12
  }
}
```

The first two documents are the typed equivalents of “recent Articles” and “Articles tagged `a` or `b`.” A Schema source selects the exact active Schema by stable key and fields by stable field ID. Save validation permits only active, anonymously readable Schemas; exact or exact-set filters supported by the published search configuration; `createdAt`, `updatedAt`, or configured sortable fields; and the system title or one validated scalar field for labels. Exact-set is an OR over the listed scalar values. Scalar filter values are always bound query parameters. Results require the published projection, a canonical public route, and anonymous read access; the document-ID tie-break makes ordering deterministic.

A fixed Page prefix of `/foo` means canonical published standalone Pages whose paths are direct children of `/foo`; `/foo/bar` matches and `/foo/bar/baz` does not. `currentParent` is structural and performs no placeholder substitution. For the canonical Page `/foo/bar`, it resolves direct children of `/foo`, so siblings include the current Page. For a root-level Page such as `/foo`, the scope is `/` and resolves root direct Pages. Alias requests use the normalized canonical Page context supplied by public Layout resolution. Collection/detail routes, missing context, and non-Page context return an empty result. Page labels come from the publication revision, never the working title.

Menus allow at most eight dynamic sources, four filters per Schema source, ten values per exact-set, and one through twelve requested results per source. The existing final limits of twelve top-level items, eight children, and one child level still apply after expansion. Generated item IDs and values are deterministic hashes namespaced by source ID and document identity. Metadata is prepared in bounded D1-safe chunks and source queries share a concurrency gate and render deadline; a failure or timeout omits only that source, leaving static siblings and the surrounding public Layout/page intact. When a distributed cache binding exists, every request re-reads its distributed scope revision before reusing source results. Without that binding, dynamic source results are deliberately resolved fresh instead of relying on isolate-local TTLs. Schema/content/anonymous-role changes invalidate the Schema scope, while Page publication, removal, and canonical-route changes invalidate the public Page-route scope. The final Layout/Menu digest includes the fully expanded public document and canonical Page context for contextual sources.

## Layout resources

`Layout` is the HaloPress domain name for a persisted public page-layout resource and rendering contract. It is not a Nuxt application layout. The boundary is intentional:

- `LayoutDocument`, `LayoutResource`, `LayoutElement`, `LayoutPreset`, and later `LayoutRenderer` describe public page regions, semantic elements, and composition.
- `SiteAdmin*` components and `/_desk/site/**` routes are administrator UI only.
- `app/layouts/*.vue` remains Nuxt application infrastructure and must never be selected, serialized, or exposed as a persisted Layout resource.
- Public rendering may consume only an explicit, validated Layout projection. It must never import Desk components, Desk routes, Nuxt layout files, component IDs, classes, templates, or runtime lookup keys as Site content.

Migration `0009_add_site_layout_documents` creates `site_layout_resource` for stable identity/current-save metadata and `site_layout_reference` for future Site/Schema/Page assignments. Every create/save appends immutable `document_revision` history with `document_kind='layout'`; a stable Layout ID always resolves its current active revision. Layout-owned Menu references are replaced in the same SQLite transaction or D1 batch, and both restrictive foreign keys remain authoritative for concurrent deletion races.

`LayoutDocument` v1 stores only finite responsive grid placement, named regions, stable semantic element IDs, and strictly typed properties. It requires exactly one Page content element. Menu elements store a live `menuSetId` and orientation rather than copied navigation items. Source-controlled presets are deep-frozen, validated, and deep-cloned only at creation time, so later code or returned-object changes cannot mutate an existing Layout. Strict parsing canonicalizes regions and elements before persistence and projection, making document JSON deterministic even when an input array arrives shuffled.

The admin APIs under `/api/site/layouts` provide list/read/create/save/rename/duplicate/delete/usage operations with optimistic revision preconditions. Malformed stored JSON produces an explicit `repair-required` management and resolver state; raw malformed data is never projected into a renderer. #73 must provide an exhaustive code-owned `LayoutRendererRegistry` keyed only by a validated semantic element `type`. That registry is not serialized or returned by the API, and runtime code must never import or resolve a component from a database string.

The Theme integration does not create or select a Layout. The separate typed `site.layout.default` setting stores the stable Site default Layout ID and updates its restrictive normalized reference in the same SQLite transaction or D1 batch. Page working metadata is snapshotted into the current publication, while Schema presentation assignments are retained per exact published Schema version. Resolution uses Page override, exact Schema-version assignment, Site default, then the built-in shell. A broken highest explicit assignment reports its source and uses the built-in fallback instead of inheriting lower; disabled Site mode preserves every assignment while returning a disabled fallback. Anonymous APIs do not expose the private assignment metadata.

See [Layout resource contract](./site-layouts.md) for the complete document, preset, revision, API, reference, and renderer-extension rules.

Membership uses the same typed-section pattern with one atomic `auth.membership.policy` JSON value. It controls disabled, open, invitation-only, and approval-required admission separately from provider credentials. Invitation codes are email-bound, expiring, single-use values whose hashes are stored in the database. See [Public membership and authentication](./AUTH_MEMBERSHIP.md) for canonical-email migration behavior, stable Google identity linking, rate limits, session enforcement, and recovery limitations.

Future Publishing, Integrations, and Operations features may add a Settings child only after a typed, actionable administrator UI exists. They must not reserve empty user-facing routes or add fields to the site-presentation document unless those fields are part of the public shell contract.
