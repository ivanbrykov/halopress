## Nuxt UI usage

- Use the nuxt-ui MCP to learn the API and implement components and code correctly.

## Public Layout resource boundary

- HaloPress Site Layouts are persisted public rendering contracts. They are not Nuxt application layouts in `app/layouts/**`; never use Nuxt layouts as the resource store or registry, and never add a Vue file under `app/layouts/` for a persisted Layout.
- Persisted/API Layout documents contain only validated semantic element types, stable instance IDs, finite placement data, and typed properties. They must never contain or resolve Nuxt layout selectors (including `default`, `desk`, or `blank` as Nuxt names), Desk/Vue component IDs, import paths, dynamic component keys, Tailwind classes, Nuxt UI `ui` payloads, slots/templates, arbitrary HTML/CSS/JavaScript, or executable/runtime lookup data.
- Runtime rendering must map validated semantic element types through a code-owned registry. Never dynamically import or resolve a component from a database/API string.
- Use `LayoutDocument`, `LayoutResource`, `LayoutElement`, `LayoutPreset`, and later `LayoutRenderer` as the internal/domain vocabulary. A `site/layouts` file or API namespace is acceptable for collision clarity; do not introduce `SiteWorkspaceShell` or exported `SiteLayout*` domain model names.

## PR authoring

- When writing PR bodies, do not leave literal `\n` sequences in the text; use real line breaks instead.

## Nuxt runtimeConfig notes

- For Nuxt runtimeConfig defaults, do not read `process.env.*` in `nuxt.config.ts`; set only safe defaults and rely on runtime `NUXT_*` env overrides.
- Reviewers may suggest restoring `process.env.AUTH_ORIGIN` fallbacks; we intentionally avoid that to align with Nuxt runtimeConfig guidance (build-time env reads can break at runtime).
- Nitro's `cloudflare-module` passes the authoritative Worker `Request` through `event.context.cloudflare.request` when it bridges into `localFetch`; it is not guaranteed to populate `event.web.request`. Public-origin validation must compare headers with that platform Request URL and must not replace it with a Host-only production fallback.

## Nuxt 4 `useFetch` and AsyncData behavior

- In Nuxt 4, `useFetch` returns reactive `AsyncData` fields on a Promise/thenable. Calling it without `await` starts the request and exposes `data`, `pending`, `status`, and `error` synchronously. SSR still waits through Nuxt's server-prefetch lifecycle and transfers the result in the hydration payload; omitting `await` primarily avoids suspending client setup and navigation.
- Choose the contract intentionally. Read-only status, shell, and dashboard surfaces that render loading/error states should normally use a synchronous wrapper. Mutable editors may intentionally await their initial payload when rendering default form state early could overwrite persisted values.
- A synchronous custom wrapper must return the required AsyncData fields explicitly. Do not spread the raw unawaited `useFetch` result because its enumerable `then`, `catch`, and `finally` methods would make the wrapper thenable and can discard custom fields when awaited.
- Treat this as a wrapper return-shape contract, not a projection-cache concern; keep cache-key and refresh decisions separate from whether AsyncData Promise methods are exposed.
- Do not add or remove top-level `await` merely to match neighboring code. Confirm whether the caller needs navigation-blocking initialization or immediate reactive refs, and ensure every non-blocking caller has an explicit pending state that cannot flash false defaults or enabled content.

# DB Migration
Generate migration from schema changes

<!> IMPORTANT: Always provide a descriptive name for the migration

pnpm db:generate <name>  # Example: pnpm db:generate add_user_field

# Apply migrations to database
pnpm db:migrate

# Push schema changes directly to database (development only, bypasses migrations)
pnpm db:push

# Open Drizzle Studio (GUI for database)
pnpm db:studio
