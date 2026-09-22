<p align="center">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="./public/branding/halopress-brand-artwork-dark.png"
    >
    <img
      src="./public/branding/halopress-brand-artwork-light.png"
      width="480"
      alt="HaloPress grape and sky paper mark surrounding a transparent star"
    >
  </picture>
</p>

<h1 align="center">HaloPress</h1>

<p align="center">
  <strong>Structured publishing, ready when you are.</strong>
</p>

<p align="center">
  A batteries-included, schema-driven CMS with an editorial Desk, media library,
  access control, public delivery, and local, Node, or Cloudflare runtimes in one
  Nuxt app.
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/comfuture/halopress">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy HaloPress to Cloudflare">
  </a>
</p>

<p align="center">
  <sub>Deploy the app, D1 database, R2 media storage, migrations, and a secure
  authentication secret—then finish setup in your browser.</sub>
</p>

## Publishing should begin with content

Content needs structure, but publishing should not begin with weeks of platform
work. HaloPress treats each schema as a shared contract: editors get a focused
workspace, developers get predictable structured content, and teams can evolve
what they publish deliberately.

The infrastructure is part of the product, not homework. HaloPress brings the
editorial experience, delivery layer, storage, authentication, and guided setup
together so a new site can move from deployment to its first article in one path.

## Batteries included

- **Schema Studio** — draft, validate, and publish versioned content schemas.
- **Editorial Desk** — create structured content and pages with rich-text editing.
- **Media library** — upload, replace, browse, and deliver assets.
- **Search and collections** — index published content and expose public collection
  and detail views.
- **People and permissions** — credentials authentication, optional Google OAuth,
  users, roles, and per-schema access.
- **Guided first run** — create the first administrator and optionally start with
  an editable Article schema and welcome guide.
- **Deployment stack** — SQLite and local files without Cloudflare bindings;
  Cloudflare D1 and R2 in Worker production or local Worker emulation.

## One click. One guided setup.

1. Select **Deploy to Cloudflare** above.
2. Give the Worker, D1 database, and R2 bucket site-specific names.
3. Deploy, then open `https://<worker-name>.<account>.workers.dev/_install`.
4. Create the administrator and choose whether to add the starter Article content.
5. Open the Desk and start publishing.

No authentication secret needs to be entered for the first deployment. HaloPress
generates one securely, applies database migrations before publishing the Worker,
and preserves the secret on later deployments.

## How HaloPress works

1. **Design a schema** for the content your team actually publishes.
2. **Work in the Desk** with schema-driven forms, rich text, assets, and roles.
3. **Publish a version** so structural changes remain explicit and reviewable.
4. **Deliver everywhere** through public collection/detail routes and predictable
   structured content APIs.

The same application owns the editorial workflow and the delivery surface, while
keeping the content contract clear between them.

## Draft-safe publishing and standalone pages

Published content and pages point to immutable revisions. Editors can save a new
working draft, preview it through an authenticated private route, discard it, or
publish it without changing the last good anonymous response in the meantime.
Publishing promotes the working revision and its search, listing, reference, and
asset projections together.

Standalone pages use the same page document renderer in Desk preview and public
delivery. The initial public route is `/p/:id`, backed by the published-only
`/api/delivery/page/:id` endpoint. The singular `p` prefix is reserved for new
standalone-page routes and cannot be selected for a new schema. On upgraded sites
that already have a schema named `p`, `/p/:id` resolves a published standalone
page first and falls back to a readable published legacy schema item only when no
standalone page exists. Custom paths and public slugs are not part of this initial
ID-based contract, and `/p` itself is not a public page listing. On upgraded sites
with a readable legacy schema named `p`, `/p` remains that schema's collection
index; otherwise the bare prefix returns 404.

Page blocks come from a curated registry. Stored unknown or retired blocks remain
in the document and render a safe fallback, while arbitrary Vue components,
scripts, classes, attributes, and unsafe URLs are never taken from stored data.
The [page pattern guide](docs/page-patterns.md) documents the reviewed starter
library, compatibility metadata, copy-on-insert upgrades, and visual fixtures.

Published Page and rich-text detail APIs also expose a versioned standalone HTML
projection alongside their canonical JSON. The transparent, color-mode-independent
projection is rendered and sanitized on the server and can be consumed without Vue,
Nuxt UI, Tailwind, the editor runtime, or the HaloPress application bundle. HaloPress
Site pages render the JSON natively through Vue SSR and hydration instead of injecting
that standalone projection. See the [standalone authored-document guide](docs/portable-content.md)
and its [plain HTML consumer](examples/portable-content/index.html).

## Project status

HaloPress is under active development. The complete schema-to-publishing path is
implemented, while validation, empty states, relation editing, and other product
polish continue to evolve. See the [MVP checklist](docs/MVP_CHECKLIST.md) for the
current scope.

## Develop locally

```bash
git clone https://github.com/comfuture/halopress.git
cd halopress
pnpm install
pnpm dev
```

Open `http://localhost:3000/_install` and follow the guided setup. Local development
uses SQLite and `.data/r2/**`; the install flow applies the local migrations before
creating the administrator.

### Environment variables

HaloPress includes local-only runtime defaults for the auth origin and secret.
Override them when you need explicit local values:

```bash
export NUXT_AUTH_ORIGIN="http://localhost:3000/api/auth"
export NUXT_AUTH_SECRET="dev-secret-change-me"
```

Optional Google OAuth configuration:

```bash
export NUXT_OAUTH_SETTINGS_SOURCE="env+db"
export NUXT_OAUTH_PROVIDERS="google"
export NUXT_OAUTH_CREDENTIALS_ENABLED="true"
export NUXT_OAUTH_GOOGLE_ENABLED="true"
export NUXT_OAUTH_GOOGLE_CLIENT_ID="..."
export NUXT_OAUTH_GOOGLE_CLIENT_SECRET="..."
export NUXT_OAUTH_GOOGLE_ENCRYPTION_KEY="..." # optional provider-specific encryption key
export NUXT_SECRET_KEY="..." # encryption key for encrypted settings
```

OAuth can also be configured through global database settings:

- `auth.oauth.google.enabled` (boolean)
- `auth.oauth.google.clientId` (string)
- `auth.oauth.google.clientSecret` (string, encrypted)
- `auth.oauth.credentials.enabled` (boolean)

## Deployment and Desk onboarding

The Desk setup checklist adapts to local development, production Node servers,
and Cloudflare Workers. See the [deployment and onboarding guide](docs/deployment.md)
for the environment matrix, Node build and persistent-storage requirements,
public-origin behavior, and Cloudflare-specific checks.

Production Node servers must set the origin-only
`NUXT_CANONICAL_ORIGIN=https://cms.example.com`. Portable content and the public
Theme manifest use this server-only authority for deterministic absolute URLs;
they do not trust a syntactically valid request Host by itself.

## Database migrations

Drizzle migrations are stored in `server/db/migrations`.

Generate a migration with a descriptive name:

```bash
pnpm db:generate add_user_field
```

Apply migrations to local SQLite:

```bash
pnpm db:migrate
```

Development-only database commands:

```bash
pnpm db:push   # Push schema directly, bypassing migrations
pnpm db:studio # Open Drizzle Studio
```

## Cloudflare deployment details

HaloPress runs as a Cloudflare Worker with:

- D1 binding: `DB`
- R2 binding: `CONTENT_ASSETS`
- Queue producer: `SEARCH_INDEX_QUEUE`
- Queue consumer and five-minute scheduled reconciler
- SQLite-backed Durable Object: `SEARCH_ANALYZER_DO`
- Static assets: `.output/public`
- Code-owned Worker entry composing Nitro `fetch`, `queue`, and `scheduled`
- Automatically managed Worker secret: `NUXT_AUTH_SECRET`

Korean full-text indexing and raw-query tokenization run in a same-script
`AnalyzerDurableObject`. The model and compiled Wasm are immutable deploy-time
modules; D1 remains authoritative for outbox jobs, leases, checkpoints,
generations, and the search index. See the [full-text search operations
guide](docs/full-text-search.md) for topology, recovery, quotas, costs, and D1
smoke tests.

Local development uses Nuxt Image's `ipx` provider and proxies dynamic
`/assets` URLs through the local application. Workers Builds automatically use
the Cloudflare provider, as do terminal deployments started through Wrangler.
The Cloudflare provider serves optimized thumbnails through `/cdn-cgi/image/`.
Enable **Images > Transformations** for custom domains. When transformations are
unavailable (including a `workers.dev` host without URL transformations), asset
previews fall back to their same-origin R2-backed raw URL instead of displaying a
broken thumbnail. The default Wrangler configuration also enables
`global_fetch_strictly_public` so Cloudflare's image service can fetch an original
asset from the same Worker without error 1042.

The Nuxt build may already have run before the deploy script in Workers Builds,
while terminal deployments build during `wrangler deploy`. Both paths preserve the
same publishing guarantee:

1. resolve or create the configured D1 database;
2. apply all remote D1 migrations;
3. create or reuse the search Queue;
4. deploy, invoke, and delete an isolated real-Garu Durable Object probe;
5. publish the main Worker and pass its same-script analyzer activation gate;
6. remove the historical auxiliary search Worker after activation succeeds.

The first public Worker version therefore never runs against an unmigrated
database.

### One-click deployment notes

In **Set up your application**:

- use a new, site-specific project name;
- create an isolated D1 database and R2 bucket for a new site;
- reuse existing resources only when redeploying that same site;
- verify **Build command** is `pnpm build` and **Deploy command** is
  `pnpm run deploy` if Cloudflare leaves either field blank.

Cloudflare creates a Git repository in your account and connects it to Workers
Builds. When deployment completes, open the generated `/_install` URL. Start with
email/password enabled and create the password administrator first; Google OAuth
can be added afterward.

The defaults are `halopress` for D1 and `halopress-content-assets` for R2. The
deployment wrapper derives the Queue name from the effective main Worker name
selected in the generated Wrangler configuration, by `--name`, or by `--env`.
Long derived names are shortened deterministically to Cloudflare's 63-character
resource-name limit. Give D1 and R2 site-specific names when one account hosts
multiple HaloPress installations.

### Deploy from a terminal

Use different `database_name` and `bucket_name` values in `wrangler.jsonc` before
the first deploy if the Cloudflare account already hosts another HaloPress site.
Then authenticate and deploy:

```bash
pnpm wrangler login
pnpm wrangler whoami
pnpm deploy:cf
```

The first deployment creates `NUXT_AUTH_SECRET` automatically without printing it.
The D1 preparation step may write the resolved account-specific `database_id` to
your local `wrangler.jsonc`; keep that value in a private fork and do not contribute
it back to the upstream template.

For later deployments, either command works:

```bash
pnpm deploy
pnpm deploy:cf
```

Use `deploy:cf` to forward Wrangler configuration and environment options to both
D1 preparation and Worker deployment:

```bash
pnpm deploy:cf -- --env staging --config wrangler.staging.jsonc
```

An explicit `--name` is authoritative for the main Worker. Set
`HALOPRESS_SEARCH_QUEUE_NAME` only to adopt an existing Queue. During the
one-time migration, `HALOPRESS_LEGACY_SEARCH_WORKER_NAME` identifies a
historically customized Worker to delete after activation. Ordinary build
environment variables do not override the main Worker identity.

Custom Wrangler configuration files passed to `deploy:cf` must use JSON or JSONC.
TOML cannot be safely normalized by the deployment preparation step; convert an
older `wrangler.toml` to `wrangler.jsonc` before deploying.
Named environments must declare their own D1 and R2 bindings because Wrangler
bindings are not inherited.

Validate the build and configuration without creating resources or applying
migrations:

```bash
pnpm deploy:cf -- --dry-run
```

Dry-run topology changes are temporary: the Wrangler file is restored
byte-for-byte when the command exits, including after a failed dry-run.

Run the preparation step independently for diagnostics:

```bash
node scripts/prepare-cloudflare-d1.mjs DB --dry-run
```

### Connect an existing Git repository

When importing a repository from **Workers & Pages → Create application**, use:

- Production branch: your intended release branch
- Build command: `pnpm build`
- Deploy command: `pnpm run deploy`

Workers Builds installs dependencies from `pnpm-lock.yaml` automatically. The
deploy command creates the auth secret on the first deployment and preserves it
thereafter. A custom API token needs permission to inspect Worker secrets, deploy
Workers, and manage the declared D1/R2 resources.

Cloudflare does not write provisioned IDs back to the connected source repository.
The deployment preparation script adopts a same-name D1 database or creates it,
patches the ephemeral build checkout, applies migrations, and then runs
`wrangler deploy`.

### Secrets and custom domains

`NUXT_AUTH_SECRET` is intentionally absent from the Deploy Button form and
`wrangler.jsonc`. Before a non-dry-run deployment, the wrapper checks the target
Worker with `wrangler secret list`. Existing secrets remain unchanged; new Workers
receive a generated 32-byte secret through a mode-0600 temporary file that is
deleted even when deployment fails. Authentication and network errors fail closed
before migrations.

To provide the initial value yourself, copy `.dev.vars.example` to `.dev.vars`,
uncomment `NUXT_AUTH_SECRET`, and pass `--secrets-file .dev.vars`. The value must be
at least 24 UTF-8 bytes; 32 random bytes are recommended:

```bash
openssl rand -hex 32
```

Weak supplied values are rejected before migrations or other remote changes. For
a new Worker or one missing the secret, the supplied file must contain that strong
`NUXT_AUTH_SECRET`; the wrapper never adds a second conflicting secrets file.
Supplying it for an existing Worker intentionally replaces the current secret.

The Worker infers the NuxtAuth origin from each incoming request, so
`NUXT_AUTH_ORIGIN` is optional for workers.dev and standard custom-domain
deployments. Set it only when forcing a specific auth base URL, including
`/api/auth`:

```bash
pnpm wrangler secret put NUXT_AUTH_ORIGIN
# Example: https://cms.example.com/api/auth
```

Portable content can likewise use the Cloudflare Request URL as its canonical
authority. Set `NUXT_CANONICAL_ORIGIN` only when a deployment must require one
specific custom-domain origin and reject alternate workers.dev authority.

To add Google OAuth, register
`https://<worker-host>/api/auth/callback/google` as an authorized redirect URI,
then configure the encryption key and provider credentials:

```bash
pnpm wrangler secret put NUXT_SECRET_KEY
pnpm wrangler secret put NUXT_OAUTH_GOOGLE_ENCRYPTION_KEY
pnpm wrangler secret put NUXT_OAUTH_GOOGLE_CLIENT_ID
pnpm wrangler secret put NUXT_OAUTH_GOOGLE_CLIENT_SECRET
```

Enable Google in HaloPress authentication settings after adding the secrets. The
Google account email must match the existing administrator email.

### Verify a deployment

```bash
pnpm wrangler d1 migrations list DB --remote
pnpm wrangler deployments list
```

Then confirm `/_install` reports a ready database, complete the wizard, sign in as
the administrator, and upload one asset to verify the `CONTENT_ASSETS` R2 binding.
Schema migrations belong to the deploy step; the installation wizard claims the
installation, creates the administrator, and optionally seeds starter content.

## License

[MIT](LICENSE)
