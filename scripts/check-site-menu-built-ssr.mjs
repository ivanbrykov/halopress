#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { EncryptJWT } from 'jose'

const projectRoot = resolve(import.meta.dirname, '..')
const wranglerConfig = join(projectRoot, 'wrangler.jsonc')
const workerEntry = join(projectRoot, 'workers/search/src/main-entry.ts')
const publicAssets = join(projectRoot, '.output/public')
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const readyTimeoutMs = 30_000
const authSecret = 'halopress-built-ssr-smoke-secret'

async function authenticatedCookie(tenantKey) {
  const encoder = new TextEncoder()
  const sourceKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(authSecret),
    'HKDF',
    false,
    ['deriveBits']
  )
  const bits = await globalThis.crypto.subtle.deriveBits({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: encoder.encode('NextAuth.js Generated Encryption Key')
  }, sourceKey, 256)
  const token = await new EncryptJWT({
    id: 'built-admin',
    email: 'built-admin@example.com',
    name: 'Built Admin',
    role: 'admin',
    accountType: 'staff',
    tenantKey
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .setJti(globalThis.crypto.randomUUID())
    .encrypt(new Uint8Array(bits))
  return `next-auth.session-token=${token}`
}

function sqlString(value) {
  return `'${String(value).replaceAll('\'', '\'\'')}'`
}

function persistedTheme(colorMode) {
  return {
    version: 1,
    colorMode,
    colors: {
      light: {
        primary: '#ad46ff', secondary: '#2b7fff', neutral: '#71717b',
        background: '#ffffff', text: '#3f3f46', success: '#00c16a',
        info: '#2b7fff', warning: '#f0b100', error: '#fb2c36'
      },
      dark: {
        primary: '#c27aff', secondary: '#51a2ff', neutral: '#9f9fa9',
        background: '#18181b', text: '#e4e4e7', success: '#00dc82',
        info: '#51a2ff', warning: '#fdc700', error: '#ff6467'
      }
    },
    radii: { control: 0.25, sm: 0.25, md: 0.375, lg: 0.5 },
    typography: {
      bodyFontFamily: 'system-mono',
      headingFontFamily: 'system-serif',
      fontSizeBase: 1,
      lineHeightBody: 1.6,
      lineHeightHeading: 1.3
    },
    spacing: { block: 1.25, inline: 0.75 },
    content: { maxWidth: 72, textWidth: 48 }
  }
}

function persistedActiveTheme(colorMode) {
  return JSON.stringify({
    version: 1,
    bootstrapOwned: false,
    bootstrapSourceUpdatedAt: null,
    bootstrapSourceRevision: null,
    bootstrapSourceIdentity: null,
    mutationToken: null,
    theme: persistedTheme(colorMode)
  })
}

async function runWrangler(args, stateDirectory) {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(packageManager, ['exec', 'wrangler', ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CI: '1',
        HALOPRESS_SKIP_WRANGLER_BUILD: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', code => resolveResult({ code: code ?? 1, stdout, stderr }))
  })

  if (result.code !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`Wrangler ${args[0]} failed for ${stateDirectory}:\n${details}`)
  }
  return result
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string', 'Could not reserve a local port')
  const port = address.port
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return port
}

async function waitForWorker(child, logs) {
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Wrangler did not become ready within ${readyTimeoutMs}ms:\n${logs.text}`))
    }, readyTimeoutMs)
    const onData = (chunk) => {
      logs.text += chunk
      if (!/Ready on http:\/\//.test(logs.text)) return
      clearTimeout(timeout)
      resolveReady()
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Wrangler exited before becoming ready (${code ?? 1}):\n${logs.text}`))
    })
  })
}

async function stopWorker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  const close = new Promise(resolveClose => child.once('close', resolveClose))
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  } catch {
    // The process may have exited between the state check and the signal.
  }
  const stopped = await Promise.race([
    close.then(() => true),
    new Promise(resolveTimeout => setTimeout(() => resolveTimeout(false), 5_000))
  ])
  if (stopped) return

  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
    else child.kill('SIGKILL')
  } catch {
    // The process exited while the timeout elapsed.
  }
  await close
}

function seedSql() {
  const document = JSON.stringify({
    version: 1,
    items: [{
      id: 'ssr-parent',
      label: 'Built SSR Parent',
      destination: {
        type: 'external',
        url: 'https://example.com/built-ssr-parent',
        newWindow: false
      },
      value: 'built-ssr-parent',
      children: [{
        id: 'ssr-home-child',
        label: 'Built SSR Home Child',
        destination: { type: 'home' },
        value: 'built-ssr-home-child'
      }, {
        kind: 'dynamic',
        id: 'ssr-fixed-pages',
        source: {
          version: 1,
          type: 'pagePrefix',
          scope: { type: 'fixed', prefix: '/menu-pages' },
          sort: 'path',
          limit: 12,
          badge: 'Page'
        }
      }]
    }, {
      id: 'ssr-external',
      label: 'Built SSR External',
      destination: {
        type: 'external',
        url: 'https://example.com/built-ssr-external',
        newWindow: true
      },
      value: 'built-ssr-external',
      children: []
    }, {
      kind: 'dynamic',
      id: 'ssr-recent-articles',
      source: {
        version: 1,
        type: 'schemaQuery',
        schemaKey: 'article',
        filters: [],
        sort: { type: 'system', field: 'createdAt', direction: 'desc' },
        label: { type: 'systemTitle' },
        limit: 3,
        badge: 'Recent'
      }
    }, {
      kind: 'dynamic',
      id: 'ssr-tagged-articles',
      source: {
        version: 1,
        type: 'schemaQuery',
        schemaKey: 'article',
        filters: [{ fieldId: 'tag-id', operator: 'exactSet', values: ['a', 'b'] }],
        sort: { type: 'system', field: 'createdAt', direction: 'desc' },
        label: { type: 'systemTitle' },
        limit: 2,
        badge: 'Tagged'
      }
    }, {
      kind: 'dynamic',
      id: 'ssr-contextual-pages',
      source: {
        version: 1,
        type: 'pagePrefix',
        scope: { type: 'currentParent' },
        sort: 'path',
        limit: 12,
        badge: 'Sibling'
      }
    }, {
      kind: 'dynamic',
      id: 'ssr-empty-pages',
      source: {
        version: 1,
        type: 'pagePrefix',
        scope: { type: 'fixed', prefix: '/empty-menu-pages' },
        sort: 'path',
        limit: 1
      }
    }]
  })
  const pageDocument = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Built native heading' }]
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Built standalone delivery' }]
      },
      {
        type: 'pageHero',
        attrs: { orientation: 'horizontal', reverse: false },
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Built structural hero' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Structural hero body' }] }
        ]
      },
      {
        type: 'image',
        attrs: { src: 'https://tracker.example/pixel.png', alt: 'Blocked external image' }
      },
      {
        type: 'image',
        attrs: { src: '/api/private/image', alt: 'Blocked private image' }
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bare list item must fall back' }] }]
      },
      {
        type: 'pageBlock',
        attrs: {
          component: 'pageHero',
          props: { title: 'Built tracked block' },
          media: { url: 'https://tracker.example/block.png', alt: 'Blocked block media' }
        }
      },
      {
        type: 'pageBlock',
        attrs: {
          component: 'pageLogos',
          props: { title: 'Built private logos', items: [{ name: 'Private logo', src: '/api/private/logo' }] },
          media: {}
        }
      }
    ]
  })
  const layoutPageWorkingDocument = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, id: 'stored-working-heading-must-not-survive' },
        content: [{ type: 'text', text: 'Working Page outline' }]
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Working Page marker' }] }
    ]
  })
  const layoutPagePublishedDocument = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, id: 'stored-heading-must-not-survive' },
        content: [{ type: 'text', text: 'Runtime outline' }]
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Published Page marker' }] }
    ]
  })
  const layoutDocument = JSON.stringify({
    version: 1,
    layoutId: 'built-runtime-layout',
    name: 'Built Runtime Layout',
    grid: {
      maxWidth: 'wide',
      gap: 'comfortable',
      columns: { mobile: 4, tablet: 8, desktop: 12 },
      regions: [
        {
          id: 'header',
          flow: 'start',
          placement: {
            mobile: { row: 1, column: 1, span: 4, visibility: 'visible' },
            tablet: { row: 1, column: 1, span: 8, visibility: 'visible' },
            desktop: { row: 1, column: 1, span: 12, visibility: 'visible' }
          }
        },
        {
          id: 'content',
          flow: 'start',
          placement: {
            mobile: { row: 2, column: 1, span: 4, visibility: 'visible' },
            tablet: { row: 2, column: 1, span: 5, visibility: 'visible' },
            desktop: { row: 2, column: 1, span: 8, visibility: 'visible' }
          }
        },
        {
          id: 'right-sidebar',
          flow: 'start',
          placement: {
            mobile: { row: 3, column: 1, span: 4, visibility: 'visible' },
            tablet: { row: 2, column: 6, span: 3, visibility: 'visible' },
            desktop: { row: 2, column: 9, span: 4, visibility: 'visible' }
          }
        },
        {
          id: 'footer',
          flow: 'start',
          placement: {
            mobile: { row: 4, column: 1, span: 4, visibility: 'visible' },
            tablet: { row: 3, column: 1, span: 8, visibility: 'visible' },
            desktop: { row: 3, column: 1, span: 12, visibility: 'visible' }
          }
        }
      ]
    },
    elements: [
      { id: 'logo-header', type: 'site-logo', region: 'header', order: 0, props: { size: 'small', link: 'home' } },
      { id: 'title-header', type: 'site-title', region: 'header', order: 1, props: { emphasis: 'strong', link: 'home' } },
      { id: 'menu-header', type: 'menu', region: 'header', order: 2, props: { menuSetId: 'global-navigation', orientation: 'horizontal' } },
      { id: 'page-content', type: 'page-content', region: 'content', order: 0, props: {} },
      { id: 'page-list', type: 'page-list', region: 'right-sidebar', order: 0, props: { scope: 'all-pages', sort: 'title-ascending', limit: 10 } },
      { id: 'toc', type: 'table-of-contents', region: 'right-sidebar', order: 1, props: { maxDepth: 3, marker: 'ordered' } },
      { id: 'copyright', type: 'copyright', region: 'footer', order: 0, props: { format: 'year-site', startYear: 2025 } }
    ]
  })
  const articleAst = {
    schemaKey: 'article',
    title: 'Built Articles',
    fields: [
      { id: 'title-id', key: 'title', kind: 'string', title: 'Title', required: true },
      { id: 'tag-id', key: 'tag', kind: 'string', title: 'Tag', search: { mode: 'exact_set', filterable: true, sortable: true } },
      { id: 'body-id', key: 'body', kind: 'richtext', title: 'Body' }
    ],
    presentation: {
      contractVersion: 1,
      preset: 'article',
      collectionTemplate: 'list',
      detailTemplate: 'article',
      slugFieldId: 'title-id',
      structuredDataType: 'Article',
      layoutId: 'built-runtime-layout',
      slots: { title: 'title-id', body: 'body-id' }
    }
  }
  const articleJsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    title: 'Built Articles',
    properties: {
      title: { title: 'Title', type: 'string' },
      tag: { title: 'Tag', type: 'string' },
      body: { title: 'Body', type: ['object', 'array', 'string', 'null'], 'x-ui': { widget: 'u-editor' } }
    },
    required: ['title'],
    additionalProperties: false
  }
  const articleRegistry = {
    schemaKey: 'article',
    version: 1,
    title: 'Built Articles',
    listing: { titleFieldKey: 'title', descriptionFieldKey: 'body', imageFieldKey: null },
    presentation: {
      contractVersion: 1,
      schemaVersion: 1,
      preset: 'article',
      collectionTemplate: 'list',
      detailTemplate: 'article',
      slugFieldId: 'title-id',
      slugField: { fieldId: 'title-id', fieldKey: 'title' },
      structuredDataType: 'Article',
      slots: {
        title: { fieldId: 'title-id', fieldKey: 'title' },
        body: { fieldId: 'body-id', fieldKey: 'body' }
      },
      fields: [
        { fieldId: 'title-id', fieldKey: 'title', kind: 'string', renderer: 'text', title: 'Title' },
        { fieldId: 'body-id', fieldKey: 'body', kind: 'richtext', renderer: 'rich_text', title: 'Body' }
      ]
    },
    fields: [
      { fieldId: 'title-id', key: 'title', kind: 'string', title: 'Title', required: true },
      { fieldId: 'tag-id', key: 'tag', kind: 'string', title: 'Tag', search: { mode: 'exact_set', filterable: true, sortable: true } },
      { fieldId: 'body-id', key: 'body', kind: 'richtext', title: 'Body' }
    ],
    relations: []
  }
  const contentWorkingDocument = JSON.stringify({
    title: 'Working Content Detail',
    body: {
      type: 'doc',
      content: [{
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Working Content marker' }]
      }]
    }
  })
  const contentPublishedDocument = JSON.stringify({
    title: 'Published Content Detail',
    body: {
      type: 'doc',
      content: [{
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Published Content marker' }]
      }]
    }
  })

  return `
INSERT INTO installation (
  key, state, owner, setup_session_hash, setup_session_expires_at,
  lease_token, lease_expires_at, completed_at, updated_at, last_error
) VALUES (
  'singleton', 'complete', 'test:built-ssr', NULL, NULL,
  NULL, NULL, unixepoch(), unixepoch(), NULL
) ON CONFLICT(key) DO UPDATE SET
  state = 'complete', owner = 'test:built-ssr', completed_at = unixepoch(),
  updated_at = unixepoch(), last_error = NULL;

INSERT INTO settings (
  scope, key, value, value_type, is_encrypted, group_key,
  updated_by, updated_at, note
) VALUES (
  'global', 'site.mode', '{"version":1,"enabled":true}', 'json', 0,
  'site.mode', 'test:built-ssr', unixepoch(), 'Enable Site Theme built SSR fixture'
);

INSERT INTO settings (
  scope, key, value, value_type, is_encrypted, group_key,
  updated_by, updated_at, note
) VALUES (
  'global', 'site.theme.active', ${sqlString(persistedActiveTheme('dark'))}, 'json', 0,
  'site.theme', 'test:built-ssr', unixepoch(), 'Persist dark Theme for SSR fixture'
);

INSERT INTO user_role (role_key, title, level) VALUES
  ('anonymous', 'Anonymous', 0),
  ('admin', 'Administrator', 100);

INSERT INTO user (
  id, email, name, account_type, role_key, status, created_at
) VALUES (
  'built-admin', 'built-admin@example.com', 'Built Admin', 'staff', 'admin', 'active', unixepoch()
);

INSERT INTO site_layout_resource (
  id, name, name_key, document_json, current_revision,
  created_by, updated_by, created_at, updated_at
) VALUES (
  'built-runtime-layout', 'Built Runtime Layout', 'built runtime layout', ${sqlString(layoutDocument)}, 1,
  'test:built-ssr', 'test:built-ssr', unixepoch(), unixepoch()
);

INSERT INTO page (
  id, title, status, content_json, current_revision, published_revision_id,
  first_published_at, published_at, created_by, updated_by, created_at, updated_at
) VALUES (
  'built-theme-page', 'Built Theme Page', 'published', ${sqlString(pageDocument)}, 1,
  'built-theme-page-revision', unixepoch(), unixepoch(),
  'test:built-ssr', 'test:built-ssr', unixepoch(), unixepoch()
);

INSERT INTO publication_revision (
  id, document_kind, document_id, title, content_json, created_by, created_at
) VALUES (
  'built-theme-page-revision', 'page', 'built-theme-page', 'Built Theme Page',
  ${sqlString(pageDocument)}, 'test:built-ssr', unixepoch()
);

INSERT INTO public_route (
  path, route_kind, document_kind, document_id, schema_key, seo_json,
  created_at, updated_at
) VALUES (
  '/built-theme-page', 'canonical', 'page', 'built-theme-page', NULL, NULL,
  unixepoch(), unixepoch()
);

INSERT INTO page (
  id, title, status, content_json, public_path, layout_id, current_revision,
  published_revision_id, first_published_at, published_at,
  created_by, updated_by, created_at, updated_at
) VALUES (
  'built-layout-page', 'Built Layout Page', 'published', ${sqlString(layoutPageWorkingDocument)},
  '/built-layout-page', 'built-runtime-layout', 1, 'built-layout-page-revision',
  unixepoch(), unixepoch(), 'test:built-ssr', 'test:built-ssr', unixepoch(), unixepoch()
);

INSERT INTO publication_revision (
  id, document_kind, document_id, title, content_json, layout_id, created_by, created_at
) VALUES (
  'built-layout-page-revision', 'page', 'built-layout-page', 'Built Layout Page',
  ${sqlString(layoutPagePublishedDocument)}, 'built-runtime-layout', 'test:built-ssr', unixepoch()
);

INSERT INTO public_route (
  path, route_kind, document_kind, document_id, schema_key, seo_json, created_at, updated_at
) VALUES
  ('/built-layout-page', 'canonical', 'page', 'built-layout-page', NULL,
   '{"title":"Built Layout Route Title","description":"Built Layout route description"}', unixepoch(), unixepoch()),
  ('/built-layout-alias', 'alias', 'page', 'built-layout-page', NULL, NULL, unixepoch(), unixepoch());

INSERT INTO page (
  id, title, status, content_json, public_path, current_revision,
  published_revision_id, first_published_at, published_at,
  created_by, updated_by, created_at, updated_at
) VALUES
  ('built-menu-page-alpha', 'Working Menu Alpha', 'published', '{}', '/menu-pages/alpha', 1,
   'built-menu-page-alpha-revision', unixepoch(), unixepoch(),
   'test:built-ssr', 'test:built-ssr', unixepoch(), unixepoch()),
  ('built-menu-page-beta', 'Working Menu Beta', 'published', '{}', '/menu-pages/beta', 1,
   'built-menu-page-beta-revision', unixepoch(), unixepoch(),
   'test:built-ssr', 'test:built-ssr', unixepoch(), unixepoch()),
  ('built-menu-page-deep', 'Working Menu Deep', 'published', '{}', '/menu-pages/deep/hidden', 1,
   'built-menu-page-deep-revision', unixepoch(), unixepoch(),
   'test:built-ssr', 'test:built-ssr', unixepoch(), unixepoch());

INSERT INTO publication_revision (
  id, document_kind, document_id, title, content_json, created_by, created_at
) VALUES
  ('built-menu-page-alpha-revision', 'page', 'built-menu-page-alpha', 'Published Menu Alpha', '{}', 'test:built-ssr', unixepoch()),
  ('built-menu-page-beta-revision', 'page', 'built-menu-page-beta', 'Published Menu Beta', '{}', 'test:built-ssr', unixepoch()),
  ('built-menu-page-deep-revision', 'page', 'built-menu-page-deep', 'Published Menu Deep', '{}', 'test:built-ssr', unixepoch());

INSERT INTO public_route (
  path, route_kind, document_kind, document_id, schema_key, seo_json, created_at, updated_at
) VALUES
  ('/menu-pages/alpha', 'canonical', 'page', 'built-menu-page-alpha', NULL, NULL, unixepoch(), unixepoch()),
  ('/menu-pages/beta', 'canonical', 'page', 'built-menu-page-beta', NULL, NULL, unixepoch(), unixepoch()),
  ('/menu-pages/deep/hidden', 'canonical', 'page', 'built-menu-page-deep', NULL, NULL, unixepoch(), unixepoch());

INSERT INTO schema (
  schema_key, version, title, ast_json, json_schema, ui_schema, registry_json,
  created_by, created_at, note
) VALUES (
  'article', 1, 'Built Articles', ${sqlString(JSON.stringify(articleAst))},
  ${sqlString(JSON.stringify(articleJsonSchema))}, '{"x-ui":{"schemaKey":"article"}}',
  ${sqlString(JSON.stringify(articleRegistry))}, 'test:built-ssr', unixepoch(), 'Built SSR fixture'
);

INSERT INTO schema_active (schema_key, active_version, status, updated_at)
VALUES ('article', 1, 'active', unixepoch());

INSERT INTO schema_role (
  schema_key, role_key, can_read, can_write, can_publish, can_archive, can_delete, can_admin
) VALUES ('article', 'anonymous', 1, 0, 0, 0, 0, 0);

INSERT INTO search_config (
  schema_key, field_id, field_key, kind, search_mode, filterable, sortable
) VALUES ('article', 'tag-id', 'tag', 'string', 'exact_set', 1, 1);

INSERT INTO content (
  id, schema_key, schema_version, status, content_json, public_path, current_revision,
  published_revision_id, first_published_at, published_at,
  created_by, updated_by, created_at, updated_at
) VALUES
  ('built-content-newest', 'article', 1, 'published', ${sqlString(contentWorkingDocument)},
   '/article/built-content-newest', 1, 'built-content-newest-revision',
   unixepoch('2026-07-18 03:00:00'), unixepoch('2026-07-18 03:00:00'),
   'test:built-ssr', 'test:built-ssr', unixepoch('2026-07-18 03:00:00'), unixepoch('2026-07-18 03:00:00')),
  ('built-content', 'article', 1, 'published', ${sqlString(contentWorkingDocument)},
   '/article/built-content', 1, 'built-content-revision',
   unixepoch('2026-07-18 02:00:00'), unixepoch('2026-07-18 02:00:00'),
   'test:built-ssr', 'test:built-ssr', unixepoch('2026-07-18 02:00:00'), unixepoch('2026-07-18 02:00:00')),
  ('built-content-oldest', 'article', 1, 'published', ${sqlString(contentWorkingDocument)},
   '/article/built-content-oldest', 1, 'built-content-oldest-revision',
   unixepoch('2026-07-18 01:00:00'), unixepoch('2026-07-18 01:00:00'),
   'test:built-ssr', 'test:built-ssr', unixepoch('2026-07-18 01:00:00'), unixepoch('2026-07-18 01:00:00'));

INSERT INTO publication_revision (
  id, document_kind, document_id, schema_key, schema_version, title, content_json,
  created_by, created_at
) VALUES
  ('built-content-newest-revision', 'content', 'built-content-newest', 'article', 1,
   'Published Recent Newest', ${sqlString(contentPublishedDocument)}, 'test:built-ssr', unixepoch('2026-07-18 03:00:00')),
  ('built-content-revision', 'content', 'built-content', 'article', 1,
   'Published Content Detail', ${sqlString(contentPublishedDocument)}, 'test:built-ssr', unixepoch('2026-07-18 02:00:00')),
  ('built-content-oldest-revision', 'content', 'built-content-oldest', 'article', 1,
   'Published Tagged Oldest', ${sqlString(contentPublishedDocument)}, 'test:built-ssr', unixepoch('2026-07-18 01:00:00'));

INSERT INTO content_listing (
  content_id, projection_scope, schema_key, schema_version, title, description,
  image, status, created_at, updated_at
) VALUES
  ('built-content-newest', 'published', 'article', 1, 'Published Recent Newest', 'Published newest description', NULL, 'published', unixepoch('2026-07-18 03:00:00'), unixepoch('2026-07-18 03:00:00')),
  ('built-content', 'working', 'article', 1, 'Working Content Detail', 'Working content description', NULL, 'published', unixepoch('2026-07-18 02:00:00'), unixepoch('2026-07-18 02:00:00')),
  ('built-content', 'published', 'article', 1, 'Published Content Detail', 'Published content description', NULL, 'published', unixepoch('2026-07-18 02:00:00'), unixepoch('2026-07-18 02:00:00')),
  ('built-content-oldest', 'published', 'article', 1, 'Published Tagged Oldest', 'Published oldest description', NULL, 'published', unixepoch('2026-07-18 01:00:00'), unixepoch('2026-07-18 01:00:00'));

INSERT INTO content_search_data (
  content_id, projection_scope, field_id, data_type, text, value
) VALUES
  ('built-content-newest', 'published', 'tag-id', 'text', 'c', NULL),
  ('built-content', 'published', 'tag-id', 'text', 'b', NULL),
  ('built-content-oldest', 'published', 'tag-id', 'text', 'a', NULL);

INSERT INTO public_route (
  path, route_kind, document_kind, document_id, schema_key, seo_json, created_at, updated_at
) VALUES
  ('/article', 'canonical', 'schema', 'article', 'article', NULL, unixepoch(), unixepoch()),
  ('/article/built-content-newest', 'canonical', 'content', 'built-content-newest', 'article', NULL, unixepoch(), unixepoch()),
  ('/article/built-content', 'canonical', 'content', 'built-content', 'article', NULL, unixepoch(), unixepoch()),
  ('/article/built-content-oldest', 'canonical', 'content', 'built-content-oldest', 'article', NULL, unixepoch(), unixepoch());

INSERT INTO site_menu_set (
  id, name, name_key, document_json, bootstrap_owned,
  bootstrap_source_updated_at, created_by, updated_by, created_at, updated_at
) VALUES (
  'global-navigation', 'Global navigation', 'global navigation', ${sqlString(document)}, 0,
  NULL, 'test:built-ssr', 'test:built-ssr', unixepoch(), unixepoch()
);

INSERT INTO site_menu_reference (
  owner_type, owner_id, slot, menu_set_id, label, created_at, updated_at
) VALUES (
  'public-site-shell', 'default-public-site', 'global-navigation',
  'global-navigation', 'Built-in public Site navigation', unixepoch(), unixepoch()
);

INSERT INTO site_menu_reference (
  owner_type, owner_id, slot, menu_set_id, label, created_at, updated_at
) VALUES (
  'site-layout', 'built-runtime-layout', 'menu-header',
  'global-navigation', 'Built Runtime Layout menu', unixepoch(), unixepoch()
);

INSERT INTO site_layout_reference (
  owner_type, owner_id, slot, layout_id, label, behavior, created_at, updated_at
) VALUES
  ('page', 'built-layout-page', 'working', 'built-runtime-layout', 'Built Layout Page working Layout', 'use-current', unixepoch(), unixepoch()),
  ('page', 'built-layout-page', 'published', 'built-runtime-layout', 'Built Layout Page published Layout', 'use-current', unixepoch(), unixepoch()),
  ('schema', 'article', 'published:1', 'built-runtime-layout', 'article v1 Layout', 'use-current', unixepoch(), unixepoch());
`.trim()
}

async function assertThemeDelivery(origin, stateDirectory, stateArgs) {
  const manifestResponse = await fetch(`${origin}/api/delivery/site-theme`)
  assert.equal(manifestResponse.status, 200, 'Expected the public Theme manifest')
  assert.equal(manifestResponse.headers.get('cache-control'), 'public, max-age=0, must-revalidate')
  assert.equal(manifestResponse.headers.get('access-control-allow-origin'), '*')
  assert.equal(manifestResponse.headers.get('cross-origin-resource-policy'), 'cross-origin')
  assert.equal(manifestResponse.headers.get('x-content-type-options'), 'nosniff')
  const manifestEtag = manifestResponse.headers.get('etag')
  assert.ok(manifestEtag, 'Expected a strong Theme manifest ETag')
  const manifest = await manifestResponse.json()
  assert.equal(manifest.contractVersion, 1)
  assert.equal(manifest.siteModeEnabled, true)
  assert.equal(manifest.colorMode, 'dark')
  assert.match(manifest.revision, /^[0-9a-f]{64}$/)
  assert.match(manifest.stylesheetRevision, /^[0-9a-f]{64}$/)
  assert.equal(manifest.stylesheetUrl, `${origin}/_halo/theme/v1/${manifest.stylesheetRevision}.css`)

  const manifest304 = await fetch(`${origin}/api/delivery/site-theme`, {
    headers: { 'If-None-Match': manifestEtag }
  })
  assert.equal(manifest304.status, 304, 'Expected Theme manifest conditional revalidation')

  const cssResponse = await fetch(manifest.stylesheetUrl)
  const cssResponseBody = await cssResponse.clone().text()
  const artifactDebug = cssResponse.status === 200
    ? ''
    : (await runWrangler([
        'd1', 'execute', 'DB',
        '--command', 'SELECT key, value_type, is_encrypted, length(value) AS value_length FROM settings WHERE key LIKE \'site.theme.artifact.%\'',
        ...stateArgs
      ], stateDirectory)).stdout
  assert.equal(
    cssResponse.status,
    200,
    `Expected the immutable Theme CSS at ${manifest.stylesheetUrl}: ${cssResponseBody}\n${artifactDebug}`
  )
  assert.match(cssResponse.headers.get('content-type') ?? '', /^text\/css/)
  assert.equal(cssResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(cssResponse.headers.get('access-control-allow-origin'), '*')
  const cssEtag = cssResponse.headers.get('etag')
  const css = await cssResponse.text()
  assert.ok(css.includes('--halo-color-primary'), 'Expected canonical Halo Theme variables')
  assert.ok(!css.includes('--ui-'), 'Public Theme CSS must not contain Nuxt UI variables')
  const css304 = await fetch(manifest.stylesheetUrl, { headers: { 'If-None-Match': cssEtag } })
  assert.equal(css304.status, 304, 'Expected Theme CSS conditional revalidation')

  for (const path of [
    `/_halo/theme/v1/${'f'.repeat(64)}.css`,
    '/_halo/theme/v1/not-a-digest.css'
  ]) {
    const missingCss = await fetch(`${origin}${path}`)
    assert.equal(missingCss.status, 404, `Expected a Theme CSS miss for ${path}`)
    assert.equal(missingCss.headers.get('cache-control'), 'no-store')
  }

  const pageResponse = await fetch(`${origin}/api/delivery/page/built-theme-page`)
  assert.equal(pageResponse.status, 200, 'Expected the built standalone Page envelope')
  const page = await pageResponse.json()
  assert.equal(page.rendering.contractVersion, 2)
  assert.deepEqual(page.rendering.stylesheets, [
    `${origin}/_halo/content/v2/6d010ca6e3a8523dfa95f6173f8896c6347663a32f85d498273dfa831bfd3fa6.css`
  ])
  assert.ok(page.rendering.html.includes('Built standalone delivery'))
  assert.ok(page.rendering.html.includes('data-halo-contract-version="2"'))
  assert.ok(!page.rendering.html.includes('data-halo-color-mode'))
  assert.ok(!page.rendering.html.includes('tracker.example'))
  assert.ok(!page.rendering.html.includes('/api/private/image'))
  assert.ok(!page.rendering.html.includes('/api/private/logo'))
  assert.ok(
    !/<li(?:\s|>)[\s\S]*Bare list item must fall back/.test(page.rendering.html),
    'Standalone v2 must not emit the rejected bare list item'
  )
  assert.ok(!page.rendering.html.includes('Bare list item must fall back'))
  assert.equal(page.content.content[1].content[0].text, 'Built standalone delivery')
  assert.equal(page.content.content[2].type, 'pageHero')
  assert.equal(page.content.content[6].attrs.media.url, 'https://tracker.example/block.png')
  assert.equal(page.content.content[7].attrs.props.items[0].src, '/api/private/logo')
  return manifest
}

async function assertThemeArtifactPreview(origin, themeManifest) {
  const cookie = await authenticatedCookie('127.0.0.1')
  const anonymous = await fetch(`${origin}/api/preview/site-theme-artifact`)
  assert.ok([401, 403].includes(anonymous.status), 'Anonymous Theme artifact preview must not resolve')

  const response = await fetch(`${origin}/api/preview/site-theme-artifact`, {
    headers: { Cookie: cookie, Accept: 'text/html' }
  })
  const html = await response.text()
  assert.equal(response.status, 200, 'Expected authenticated published Theme artifact preview')
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.match(response.headers.get('vary') ?? '', /Cookie/i)
  assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/i)
  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/)
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('data-halo-contract-version="1"'))
  assert.ok(html.includes('data-halo-color-mode="dark"'))
  assert.ok(html.includes('/_halo/content/v1/'))
  assert.ok(html.includes(new URL(themeManifest.stylesheetUrl).pathname))
  assert.ok(html.includes('A portable HaloPress page'))
  assert.ok(!html.includes('<script'))

  const themesResponse = await fetch(`${origin}/_desk/site/themes`, { headers: { Cookie: cookie } })
  const themesHtml = await themesResponse.text()
  assert.equal(themesResponse.status, 200, 'Expected authenticated Themes editor SSR')
  assert.ok(themesHtml.includes('src="/api/preview/site-theme-artifact"'))
  assert.ok(themesHtml.includes('data-site-theme-artifact-preview'))
}

async function setPersistedThemeMode(stateDirectory, stateArgs, colorMode) {
  const value = sqlString(persistedActiveTheme(colorMode))
  await runWrangler([
    'd1', 'execute', 'DB',
    '--command', `UPDATE settings SET value = ${value}, updated_at = unixepoch() WHERE scope = 'global' AND key = 'site.theme.active'`,
    ...stateArgs
  ], stateDirectory)
}

async function assertBuiltPageMode(origin, expectedMode) {
  const response = await fetch(`${origin}/built-theme-page`)
  const html = await response.text()
  assert.equal(response.status, 200, `Expected built Page SSR for ${expectedMode}, received ${response.status}`)
  assert.ok(html.includes('data-site-document-renderer'), 'Expected built Page SSR to use the native Site document renderer')
  assert.ok(html.includes('Built standalone delivery'), 'Expected the native Site renderer to render raw Page JSON')
  assert.ok(!/<img[^>]+src="https:\/\/tracker\.example\/pixel\.png"/.test(html), 'Native Site SSR must reject external authored image sources')
  assert.ok(!/<img[^>]+src="\/api\/private\/image"/.test(html), 'Native Site SSR must reject non-asset authored image paths')
  assert.ok(!/<img[^>]+src="\/api\/private\/logo"/.test(html), 'Native Site SSR must reject non-asset Page-block logos')
  assert.ok(!/<img[^>]+src="https:\/\/tracker\.example\/block\.png"/.test(html), 'Native Site SSR must reject external Page-block media')
  assert.ok(html.includes('[Unsupported content: listItem]'), 'Native Site SSR must replace a bare list item')
  assert.ok(!/<li[\s\S]{0,300}Bare list item must fall back/.test(html), 'Native Site SSR must not emit a rejected list item')
  assert.ok(html.includes('Built tracked block'), 'Native Site SSR must preserve the safe Page-block content')
  assert.ok(html.includes('Private logo'), 'Native Site SSR must preserve the safe Page-block logo label')
  assert.ok(!html.includes('data-halo-contract-version="2"'), 'Site SSR must not inject the standalone HTML artifact')
  const modeAttribute = `data-halo-color-mode="${expectedMode}"`
  assert.match(
    html,
    new RegExp(`<body(?=[^>]*data-halo-theme-enabled="true")(?=[^>]*${modeAttribute})[^>]*>`),
    `Expected built SSR body to serialize the ${expectedMode} Site Theme mode`
  )
  assert.ok(!html.includes('[object Object]'), 'Expected Unhead to serialize object-form body styles')
  assert.ok(
    html.includes('--ui-primary:var(--halo-site-color-primary'),
    'Expected built SSR body to serialize the Site Theme UI custom properties'
  )
  assert.match(
    html,
    new RegExp(`<div(?=[^>]*class="site-shell")(?=[^>]*${modeAttribute})[^>]*>`),
    `Expected built SSR shell to serialize the ${expectedMode} Site Theme mode`
  )
  const expectedPreference = expectedMode === 'default' ? 'system' : expectedMode
  const bridgePosition = html.indexOf('id="halo-public-color-mode-bridge"')
  const nuxtColorModePosition = html.indexOf('getStorageValue("localStorage","nuxt-color-mode")')
  assert.ok(bridgePosition >= 0, 'Expected the server-resolved public color-mode bridge in the head')
  assert.ok(
    nuxtColorModePosition >= 0 && nuxtColorModePosition < bridgePosition,
    'Expected the public color-mode bridge after the Nuxt pre-paint helper'
  )
  assert.ok(
    html.includes(`var p="${expectedPreference}"`),
    `Expected the pre-paint bridge to serialize the ${expectedPreference} preference`
  )
  if (expectedMode === 'dark' || expectedMode === 'light') {
    assert.match(
      html,
      new RegExp(`<html(?=[^>]*class="[^"]*${expectedMode}[^"]*")(?=[^>]*style="[^"]*color-scheme:\\s*${expectedMode}[^"]*")[^>]*>`),
      `Expected explicit ${expectedMode} SSR class and native color scheme`
    )
  }
  const expectedToggleLabel = expectedMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  assert.ok(
    html.includes(`aria-label="${expectedToggleLabel}"`),
    `Expected the ${expectedMode} SSR color-mode button to say ${expectedToggleLabel}`
  )
  return html
}

function assertReadyLayoutMarkup(html, label) {
  assert.ok(html.includes('data-layout-renderer'), `Expected ${label} to use the persisted Layout renderer`)
  assert.ok(html.includes('data-layout-id="built-runtime-layout"'), `Expected ${label} to use the assigned Layout ID`)
  for (const type of [
    'site-logo',
    'site-title',
    'menu',
    'page-content',
    'page-list',
    'table-of-contents',
    'copyright'
  ]) {
    assert.ok(html.includes(`data-layout-element="${type}"`), `Expected ${label} to render ${type}`)
  }
  assert.ok(!html.includes('data-built-in-layout-renderer'), `Expected ${label} to avoid the built-in fallback shell`)
  assert.ok(!html.includes('HaloPress Desk'), `Expected ${label} to avoid Desk structure`)
  assert.ok(
    html.includes('--ui-primary:var(--halo-site-color-primary'),
    `Expected ${label} to serialize the code-owned Halo to Nuxt UI adapter`
  )
}

async function setSiteMode(origin, cookie, enabled) {
  const response = await fetch(`${origin}/api/settings/site-mode`, {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ enabled })
  })
  const body = await response.text()
  assert.equal(response.status, 200, `Expected authenticated Site mode ${enabled ? 'enable' : 'disable'} update: ${body}`)
  assert.equal(JSON.parse(body).value.enabled, enabled)
}

async function assertLayoutRouteDelivery(origin) {
  const path = encodeURIComponent('/built-layout-page')
  const headlessResponse = await fetch(`${origin}/api/delivery/route?path=${path}`)
  assert.equal(headlessResponse.status, 200, 'Expected default route delivery to succeed')
  const headless = await headlessResponse.json()
  assert.ok(!Object.hasOwn(headless, 'layout'), 'Headless route delivery must remain Layout-free by default')

  const response = await fetch(`${origin}/api/delivery/route?path=${path}&includeLayout=1`)
  assert.equal(response.status, 200, 'Expected opt-in Layout route delivery to succeed')
  const etag = response.headers.get('etag')
  assert.ok(etag, 'Expected opt-in Layout route delivery to have a strong ETag')
  const route = await response.json()
  assert.equal(route.layout.status, 'ready')
  assert.equal(route.layout.layoutId, 'built-runtime-layout')
  assert.match(route.layout.revision, /^[0-9a-f]{64}$/)
  assert.equal(route.layout.elements.length, 7)
  const resolvedMenu = route.layout.elements.find(element => element.type === 'menu')?.props.menu
  assert.equal(resolvedMenu?.status, 'ready')
  assert.deepEqual(
    resolvedMenu.document.items
      .filter(item => item.badge === 'Recent')
      .map(item => ({ label: item.label, to: item.to })),
    [
      { label: 'Published Recent Newest', to: '/article/built-content-newest' },
      { label: 'Published Content Detail', to: '/article/built-content' },
      { label: 'Published Tagged Oldest', to: '/article/built-content-oldest' }
    ],
    'Expected recent Schema source results in exact descending created-at order'
  )
  assert.deepEqual(
    resolvedMenu.document.items
      .filter(item => item.badge === 'Tagged')
      .map(item => ({ label: item.label, to: item.to })),
    [
      { label: 'Published Content Detail', to: '/article/built-content' },
      { label: 'Published Tagged Oldest', to: '/article/built-content-oldest' }
    ],
    'Expected exact-set Schema source to include tags a/b, exclude tag c, and preserve descending order'
  )
  assert.equal(route.layout.elements.find(element => element.type === 'table-of-contents')?.props.items[0]?.text, 'Runtime outline')

  const stable = await fetch(`${origin}/api/delivery/route?path=${path}&includeLayout=1`, {
    headers: { 'If-None-Match': etag }
  })
  assert.equal(stable.status, 304, 'Expected stable Layout route projection conditional revalidation')

  const alias = await fetch(`${origin}/api/delivery/route?path=${encodeURIComponent('/built-layout-alias')}&includeLayout=1`)
  assert.equal(alias.status, 200, 'Expected alias delivery to resolve')
  const aliasRoute = await alias.json()
  assert.equal(aliasRoute.routeKind, 'alias')
  assert.ok(!Object.hasOwn(aliasRoute, 'layout'), 'Alias route delivery must never carry composition')
}

async function assertPersistedLayoutSurfaces(origin) {
  const pageResponse = await fetch(`${origin}/built-layout-page`)
  const pageHtml = await pageResponse.text()
  assert.equal(pageResponse.status, 200, 'Expected persisted Layout Page SSR')
  assertReadyLayoutMarkup(pageHtml, 'public Page')
  assert.ok(pageHtml.includes('id="halo-heading-runtime-outline"'), 'Expected deterministic SSR heading ID')
  assert.ok(pageHtml.includes('href="#halo-heading-runtime-outline"'), 'Expected TOC to link to the SSR heading ID')
  assert.ok(!pageHtml.includes('id="stored-heading-must-not-survive"'), 'Stored heading IDs must not become DOM anchors')
  assert.match(pageHtml, /<html[^>]+lang="[^"]+"/, 'Expected ready Layout SSR to preserve html lang')
  assert.match(pageHtml, /<link[^>]+rel="icon"/, 'Expected ready Layout SSR to preserve a favicon')
  assert.ok(pageHtml.includes('<title>Built Layout Route Title</title>'), 'Expected route SEO to override baseline Site title')
  assert.ok(pageHtml.includes('target="_blank"') && pageHtml.includes('rel="noopener noreferrer"'), 'Expected safe external Menu attributes')
  assert.ok(pageHtml.includes('Published Page marker'), 'Expected public Page SSR to use the exact published revision')
  assert.ok(!pageHtml.includes('Working Page marker'), 'Public Page SSR must not expose working Page content')
  assert.ok(pageHtml.includes('Sibling'), 'Expected contextual current-parent Page results in persisted Layout SSR')
  assert.ok(pageHtml.includes('Built Theme Page'), 'Expected the contextual root sibling Page in persisted Layout SSR')

  for (const [path, label, expected] of [
    ['/article', 'public collection', 'Published Content Detail'],
    ['/article/built-content', 'public detail', 'Published Content marker']
  ]) {
    const response = await fetch(`${origin}${path}`)
    const html = await response.text()
    assert.equal(response.status, 200, `Expected ${label} SSR`)
    assertReadyLayoutMarkup(html, label)
    assert.ok(html.includes(expected), `Expected ${label} semantic content`)
    assert.ok(!html.includes('Working Content marker'), `${label} must not expose working content`)
    if (path === '/article/built-content') {
      assert.ok(html.includes('data-site-richtext-renderer'), 'Expected public content SSR to use the native rich-text renderer')
      assert.ok(
        html.includes('id="halo-heading-body-07028ec7724f3d23-published-content-marker"'),
        'Expected the authored content body to own the Layout TOC heading anchor'
      )
    }
  }

  const cookie = await authenticatedCookie('127.0.0.1')
  for (const [path, label, expected] of [
    ['/_preview/pages/built-layout-page', 'full Page preview', 'Working Page marker'],
    ['/_preview/content/article/built-content', 'full content preview', 'Working Content marker']
  ]) {
    const response = await fetch(`${origin}${path}`, { headers: { Cookie: cookie } })
    const html = await response.text()
    assert.equal(response.status, 200, `Expected authenticated ${label} SSR: ${html.slice(0, 1_000)}`)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.match(response.headers.get('vary') ?? '', /Cookie/i)
    assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/i)
    assertReadyLayoutMarkup(html, label)
    assert.ok(html.includes(expected), `Expected ${label} content`)
    assert.ok(!html.includes('Published Page marker') && !html.includes('Published Content marker'), `${label} must not mix published authored content`)

    const anonymous = await fetch(`${origin}${path}`)
    const anonymousHtml = await anonymous.text()
    assert.equal(anonymous.status, 404, `Expected anonymous ${label} to remain non-enumerating`)
    assert.ok(!anonymousHtml.includes(expected), `Anonymous ${label} must not expose private working content`)
  }

  const editor = await fetch(`${origin}/_desk/pages/built-layout-page`, { headers: { Cookie: cookie } })
  const editorHtml = await editor.text()
  assert.equal(editor.status, 200, 'Expected authenticated internal Page editor SSR')
  assert.ok(editorHtml.includes('HaloPress Desk'), 'Expected the internal Page editor to retain the Desk shell')
  assert.ok(!editorHtml.includes('data-layout-renderer'), 'Internal Page editor must remain persisted-Layout-free')
  assert.ok(!editorHtml.includes('data-layout-canvas'), 'Page editor preview must not link the Layout editor canvas')
  assert.ok(editorHtml.includes('data-site-document-renderer'), 'Expected the Page editor preview to use the native renderer')
  assert.ok(editorHtml.includes('Working Page marker'), 'Expected the native editor preview to render working Page content')
  assert.ok(!editorHtml.includes('<iframe'), 'Page editor preview must not inject a serialized standalone document')

  await setSiteMode(origin, cookie, false)
  try {
    const disabledPublic = await fetch(`${origin}/built-layout-page`)
    const disabledPublicHtml = await disabledPublic.text()
    assert.equal(disabledPublic.status, 200, 'Expected assigned public Page to remain rendered while Sites mode is disabled')
    assert.ok(disabledPublicHtml.includes('Published Page marker'), 'Disabled public Page must retain published content')
    assert.ok(!disabledPublicHtml.includes('data-layout-renderer'), 'Disabled public Page must not render persisted Layout')

    for (const [path, label, expected] of [
      ['/_preview/pages/built-layout-page', 'disabled full Page preview', 'Working Page marker'],
      ['/_preview/content/article/built-content', 'disabled full content preview', 'Working Content marker']
    ]) {
      const response = await fetch(`${origin}${path}`, { headers: { Cookie: cookie } })
      const html = await response.text()
      assert.equal(response.status, 200, `Expected ${label} to remain rendered`)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.ok(html.includes(expected), `Expected ${label} working content`)
      assert.ok(!html.includes('data-layout-renderer'), `${label} must not render persisted Layout`)
    }
  } finally {
    await setSiteMode(origin, cookie, true)
  }

  const reenabled = await fetch(`${origin}/built-layout-page`)
  const reenabledHtml = await reenabled.text()
  assert.equal(reenabled.status, 200, 'Expected public Page after re-enabling Sites mode')
  assertReadyLayoutMarkup(reenabledHtml, 're-enabled public Page')

  return pageHtml
}

async function assertDynamicMenuPreview(origin) {
  const cookie = await authenticatedCookie('127.0.0.1')
  const menuResponse = await fetch(`${origin}/api/site/menus`, { headers: { Cookie: cookie } })
  assert.equal(menuResponse.status, 200, 'Expected authenticated Menu resources for preview smoke')
  const menus = await menuResponse.json()
  const globalMenu = menus.items.find(menu => menu.id === 'global-navigation')
  assert.ok(globalMenu, 'Expected seeded Global Menu for preview smoke')

  const previewResponse = await fetch(`${origin}/api/site/menus/global-navigation/preview`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: globalMenu.document, examplePageId: 'built-layout-page' })
  })
  assert.equal(previewResponse.status, 200, 'Expected authenticated contextual Menu preview')
  assert.equal(previewResponse.headers.get('cache-control'), 'private, no-store')
  assert.match(previewResponse.headers.get('vary') ?? '', /Cookie/i)
  assert.match(previewResponse.headers.get('x-robots-tag') ?? '', /noindex/i)
  const preview = await previewResponse.json()
  assert.deepEqual(preview.context, { pageId: 'built-layout-page', canonicalPath: '/built-layout-page' })
  assert.match(preview.digest, /^[0-9a-f]{64}$/)
  const previewJson = JSON.stringify(preview.menu.document)
  for (const marker of ['Recent', 'Tagged', 'Page', 'Sibling']) {
    assert.ok(previewJson.includes(marker), `Expected ${marker} dynamic source output in authenticated preview`)
  }
  assert.ok(previewJson.includes('/menu-pages/alpha') && previewJson.includes('/menu-pages/beta'))
  assert.ok(!previewJson.includes('/menu-pages/deep/hidden'), 'Fixed Page prefix must exclude deeper descendants')
  assert.ok(previewJson.includes('/built-theme-page'), 'Contextual Page source must include root siblings')
  assert.ok(
    preview.diagnostics.filter(item => item.sourceId !== 'ssr-empty-pages').every(item => item.status === 'ready'),
    'Expected every populated seeded dynamic source to resolve'
  )
  assert.ok(
    preview.diagnostics.some(item => item.sourceId === 'ssr-empty-pages' && item.status === 'empty'),
    'Expected an isolated empty dynamic source result'
  )

  const anonymous = await fetch(`${origin}/api/site/menus/global-navigation/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: globalMenu.document, examplePageId: 'built-layout-page' })
  })
  assert.ok([401, 403, 404].includes(anonymous.status), 'Anonymous Menu preview must not resolve')
  assert.equal(anonymous.headers.get('cache-control'), 'private, no-store')
}

async function assertCompiledSiteThemeAdapter(origin, html) {
  const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(match => match[1])
  const stylesheets = await Promise.all(hrefs.map(async href => fetch(new URL(href, origin)).then(response => response.text())))
  const css = stylesheets.join('\n')
  assert.match(
    css,
    /body\.site-theme-adapter\[data-halo-theme-enabled=(?:true|"true")\]\[data-halo-color-mode=(?:dark|"dark")\]/,
    'Expected the compiled app adapter to contain an explicit dark body selector'
  )
  assert.match(
    css,
    /@media\s*\(prefers-color-scheme:dark\)[\s\S]*data-halo-color-mode=(?:default|"default")/,
    'Expected the built app adapter to retain the system dark media selector'
  )
  assert.ok(
    css.includes('--halo-site-color-primary:var(--halo-color-primary-dark)'),
    'Expected the built dark adapter to map the actual Halo primary token path'
  )
  assert.ok(
    css.includes('--ui-text-inverted:var(--halo-site-color-on-warning)'),
    'Expected the built adapter to use the warning-specific solid foreground'
  )
  assert.ok(css.includes('color-scheme:dark'), 'Expected explicit and system dark native color-scheme coverage')
  assert.ok(
    css.includes('font-family:var(--halo-font-family-heading)')
    && css.includes('line-height:var(--halo-line-height-heading)'),
    'Expected the built public shell to consume the distinct heading typography tokens'
  )
  assert.match(
    css,
    /body\.site-theme-adapter\[data-halo-theme-enabled=(?:true|"true")\][^{]*\{[^}]*font-family:var\(--halo-font-family-body\)[^}]*font-size:var\(--halo-font-size-base\)[^}]*line-height:var\(--halo-line-height-body\)/,
    'Expected body-level public teleports to inherit the Theme body typography tokens'
  )
}

async function assertCompiledLayoutRenderer(origin, html) {
  const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(match => match[1])
  const stylesheets = await Promise.all(hrefs.map(async href => fetch(new URL(href, origin)).then(response => response.text())))
  const css = stylesheets.join('\n')
  assert.ok(css.includes('.layout-runtime-grid'), 'Expected built responsive Layout renderer CSS')
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/, 'Expected the mobile four-column Layout grid')
  assert.match(css, /@media\s*\((?:min-width:640px|width>=640px)\)/, 'Expected the source-owned tablet breakpoint')
  assert.match(css, /grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/, 'Expected the tablet eight-column Layout grid')
  assert.match(css, /@media\s*\((?:min-width:1024px|width>=1024px)\)/, 'Expected the source-owned desktop breakpoint')
  assert.match(css, /grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/, 'Expected the desktop twelve-column Layout grid')
}

function assertRenderedMenu(html) {
  const horizontalRoot = /<[^>]+(?=[^>]*data-slot="root")(?=[^>]*data-orientation="horizontal")[^>]*>/
  assert.ok(horizontalRoot.test(html), 'Expected real horizontal Nuxt UI navigation SSR markup')
  assert.ok(html.includes('data-menu-item'), 'Expected Nuxt UI menu item SSR markers')
  assert.ok(
    html.includes('href="https://example.com/built-ssr-external"'),
    'Expected the seeded external target in rendered navigation markup'
  )

  const externalLabels = html.match(/data-slot="linkLabel"[^>]*>[\s\S]{0,400}?Built SSR External/g) ?? []
  assert.ok(
    externalLabels.length >= 1,
    'Expected the seeded external label in horizontal Nuxt UI navigation'
  )
  assert.ok(
    /data-slot="linkLabel"[^>]*>[\s\S]{0,400}?Built SSR Parent/.test(html),
    'Expected the child-bearing parent label in horizontal Nuxt UI navigation'
  )
  assert.ok(
    /<button(?=[^>]*data-navigation-menu-trigger)(?=[^>]*aria-expanded="false")[^>]*>[\s\S]{0,800}?Built SSR Parent/.test(html),
    'Expected the child-bearing item to SSR as a closed horizontal Nuxt UI trigger'
  )
  assert.ok(html.includes('Recent'), 'Expected recent Schema source output in built SSR')
  assert.ok(html.includes('Tagged'), 'Expected exact-set/tag Schema source output in built SSR')
  assert.ok(html.includes('Published Content Detail'), 'Expected canonical published Schema result label in built SSR')
  assert.ok(!html.includes('Published Menu Deep'), 'Fixed Page source must not leak deeper descendants')
}

function assertRenderedNuxtFixture(html) {
  const horizontalStart = html.indexOf('<section data-site-menu-horizontal-fixture')
  const horizontalEnd = html.indexOf('</section>', horizontalStart)
  assert.ok(horizontalStart >= 0 && horizontalEnd > horizontalStart, 'Expected the build-only horizontal Site menu fixture')
  const horizontalFixture = html.slice(horizontalStart, horizontalEnd + '</section>'.length)

  assert.ok(horizontalFixture.includes('data-parent-value="built-ssr-parent"'), 'Expected the stable horizontal parent value')
  assert.ok(horizontalFixture.includes('data-child-value="built-ssr-home-child"'), 'Expected the stable horizontal child value')
  const horizontalRoot = /<[^>]+(?=[^>]*data-slot="root")(?=[^>]*data-orientation="horizontal")[^>]*>/
  assert.ok(horizontalRoot.test(horizontalFixture), 'Expected real horizontal Nuxt UI fixture markup')
  assert.ok(
    /<button(?=[^>]*data-navigation-menu-trigger)(?=[^>]*aria-expanded="true")(?=[^>]*data-state="open")(?=[^>]*site-menu-horizontal-fixture-link)[^>]*>[\s\S]{0,800}?Built SSR Parent/.test(horizontalFixture),
    'Expected Nuxt UI defaultValue to SSR the horizontal parent trigger open'
  )
  const childMarker = 'site-menu-horizontal-fixture-child-link'
  // Prefer the fixture section when the renderer keeps content inline. Reka
  // portals NavigationMenuContent outside that section in the current SSR
  // build, so the fallback is bound to this fixture by a unique Nuxt UI
  // childLink class rather than by a label shared with the public layout.
  const horizontalContent = horizontalFixture.includes(childMarker) ? horizontalFixture : html
  if (horizontalContent === html) {
    assert.ok(html.includes(childMarker), 'Expected fixture-owned teleported horizontal child content')
  }
  assert.ok(
    /<a(?=[^>]*href="\/")(?=[^>]*data-slot="childLink")(?=[^>]*site-menu-horizontal-fixture-child-link)[^>]*>[\s\S]{0,1200}?Built SSR Home Child/.test(horizontalContent),
    'Expected the fixture-owned child link in open teleported horizontal Nuxt UI content'
  )
  assert.ok(horizontalContent.includes('/menu-pages/alpha'), 'Expected fixed-prefix Page Alpha in the open horizontal source')
  assert.ok(horizontalContent.includes('/menu-pages/beta'), 'Expected fixed-prefix Page Beta in the open horizontal source')
  assert.ok(!horizontalContent.includes('/menu-pages/deep/hidden'), 'Expected fixed-prefix Page source to keep direct-child depth')

  const start = html.indexOf('<section data-site-menu-vertical-fixture')
  const end = html.indexOf('</section>', start)
  assert.ok(start >= 0 && end > start, 'Expected the build-only vertical Site menu fixture')
  const fixture = html.slice(start, end + '</section>'.length)

  assert.ok(fixture.includes('data-parent-value="built-ssr-parent"'), 'Expected the stable parent value')
  assert.ok(fixture.includes('data-child-value="built-ssr-home-child"'), 'Expected the stable child value')
  assert.ok(fixture.includes('data-parent-open="true"'), 'Expected the adapter to request the active parent open')

  const verticalRoot = /<[^>]+(?=[^>]*data-slot="root")(?=[^>]*data-orientation="vertical")[^>]*>/
  assert.ok(verticalRoot.test(fixture), 'Expected real vertical Nuxt UI navigation SSR markup')
  assert.ok(
    /<button(?=[^>]*aria-expanded="true")(?=[^>]*data-state="open")[^>]*>[\s\S]{0,800}?Built SSR Parent/.test(fixture),
    'Expected Nuxt UI to SSR the active vertical Accordion parent open'
  )
  assert.ok(
    !fixture.includes('href="https://example.com/built-ssr-parent"'),
    'Expected a child-bearing vertical item to remain a trigger instead of rendering its saved parent target'
  )
  assert.ok(
    /<a(?=[^>]*href="\/")(?=[^>]*data-slot="link")[^>]*>[\s\S]{0,800}?Built SSR Home Child/.test(fixture),
    'Expected the active child link inside the open vertical Accordion'
  )
  assert.ok(
    /<a(?=[^>]*href="\/menu-pages\/alpha")(?=[^>]*data-slot="link")[^>]*>[\s\S]{0,800}?Published Menu Alpha/.test(fixture),
    'Expected fixed-prefix Page Alpha as a dynamic child in vertical Nuxt UI navigation'
  )
  assert.ok(
    /<a(?=[^>]*href="\/menu-pages\/beta")(?=[^>]*data-slot="link")[^>]*>[\s\S]{0,800}?Published Menu Beta/.test(fixture),
    'Expected fixed-prefix Page Beta as a dynamic child in vertical Nuxt UI navigation'
  )
  assert.ok(
    !fixture.includes('/menu-pages/deep/hidden'),
    'Expected vertical fixed-prefix Page source to keep direct-child depth'
  )
}

async function main() {
  await Promise.all([access(workerEntry), access(publicAssets)])
  const stateDirectory = await mkdtemp(join(tmpdir(), 'halopress-site-menu-built-ssr-'))
  let worker = null
  try {
    const stateArgs = ['--local', '--persist-to', stateDirectory, '--config', wranglerConfig]
    await runWrangler(['d1', 'migrations', 'apply', 'DB', ...stateArgs], stateDirectory)
    await runWrangler(['d1', 'execute', 'DB', '--command', seedSql(), ...stateArgs], stateDirectory)

    const port = await reservePort()
    const origin = `http://127.0.0.1:${port}`
    const logs = { text: '' }
    worker = spawn(packageManager, [
      'exec', 'wrangler', 'dev', workerEntry,
      '--assets', publicAssets,
      '--ip', '127.0.0.1',
      '--port', String(port),
      '--persist-to', stateDirectory,
      '--config', wranglerConfig,
      '--var', `NUXT_AUTH_SECRET:${authSecret}`,
      '--var', `NUXT_CANONICAL_ORIGIN:${origin}`
    ], {
      cwd: projectRoot,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        CI: '1',
        HALOPRESS_SKIP_WRANGLER_BUILD: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    await waitForWorker(worker, logs)

    const themeManifest = await assertThemeDelivery(origin, stateDirectory, stateArgs)
    await assertThemeArtifactPreview(origin, themeManifest)

    const response = await fetch(`${origin}/`)
    const html = await response.text()
    assert.equal(response.status, 200, `Expected public route SSR to succeed, received ${response.status}`)
    assert.equal(response.headers.get('x-powered-by'), 'Nuxt')
    assertRenderedMenu(html)
    assert.ok(html.includes('data-halo-theme-enabled="true"'), 'Expected anonymous SSR to enable the Theme shell adapter')
    const themeHref = new URL(themeManifest.stylesheetUrl).pathname
    assert.ok(html.includes(themeHref), 'Expected anonymous SSR to load the exact Theme digest CSS')
    assert.ok(!html.includes('/_halo/content/v1/'), 'Native Site SSR must not load the portable v1 stylesheet')
    assert.ok(!html.includes('/_halo/content/v2/'), 'Native Site SSR must not load the standalone v2 stylesheet')
    const serializedColorModes = html.match(/data-halo-color-mode(?:=|%3D)[^\s>]*/g) ?? []
    assert.ok(
      html.includes('data-halo-color-mode="dark"'),
      `Expected the saved dark Theme mode in anonymous shell SSR: ${serializedColorModes.join(', ')}`
    )
    assert.ok(html.includes('--ui-primary:var(--halo-site-color-primary'), 'Expected the live Halo to Nuxt UI adapter path')
    await assertCompiledSiteThemeAdapter(origin, html)

    await assertLayoutRouteDelivery(origin)
    await assertDynamicMenuPreview(origin)

    await assertBuiltPageMode(origin, 'dark')
    await setPersistedThemeMode(stateDirectory, stateArgs, 'light')
    await assertBuiltPageMode(origin, 'light')
    await setPersistedThemeMode(stateDirectory, stateArgs, 'system')
    await assertBuiltPageMode(origin, 'default')
    await setPersistedThemeMode(stateDirectory, stateArgs, 'dark')

    const layoutPageHtml = await assertPersistedLayoutSurfaces(origin)
    await assertCompiledLayoutRenderer(origin, layoutPageHtml)

    const verticalResponse = await fetch(`http://127.0.0.1:${port}/_site-menu-ssr-fixture`)
    const verticalHtml = await verticalResponse.text()
    assert.equal(verticalResponse.status, 200, `Expected vertical fixture SSR to succeed, received ${verticalResponse.status}`)
    assertRenderedNuxtFixture(verticalHtml)
    console.log('Built Site/Layout/Theme SSR smoke passed: typed recent/tag/fixed/contextual Menus, both orientations, private previews, ready/fallback public routes, collection/detail, isolated Page editor, responsive CSS, ETags, immutable CSS, root modes, and Nuxt menus rendered correctly.')
    if (process.env.HALOPRESS_SITE_MENU_BROWSER_HOLD === '1') {
      console.log(`Browser acceptance fixture ready at ${origin}`)
      await new Promise(resolveStop => {
        process.once('SIGINT', resolveStop)
        process.once('SIGTERM', resolveStop)
      })
    }
  } finally {
    if (worker) await stopWorker(worker)
    await rm(stateDirectory, { recursive: true, force: true })
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
}
