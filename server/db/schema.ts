import { sql } from 'drizzle-orm'
import { foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const userRole = sqliteTable('user_role', {
  roleKey: text('role_key').notNull(),
  title: text('title'),
  level: integer('level').notNull().default(50)
}, t => ({
  pk: primaryKey({ columns: [t.roleKey] })
}))

export const user = sqliteTable('user', {
  id: text('id').notNull(),
  email: text('email').notNull(),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp' }),
  name: text('name'),
  accountType: text('account_type').notNull().default('staff'),
  roleKey: text('role_key').notNull().default('user').references(() => userRole.roleKey),
  passwordHash: text('password_hash'),
  passwordSalt: text('password_salt'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  emailUnique: uniqueIndex('idx_user_email_unique').on(t.email)
}))

export const externalIdentity = sqliteTable('external_identity', {
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  emailAtLink: text('email_at_link'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.provider, t.subject] }),
  providerPerUser: uniqueIndex('idx_external_identity_user_provider').on(t.userId, t.provider),
  byUser: index('idx_external_identity_user').on(t.userId)
}))

export const membershipInvitation = sqliteTable('membership_invitation', {
  id: text('id').notNull(),
  tokenHash: text('token_hash').notNull(),
  email: text('email').notNull(),
  roleKey: text('role_key').notNull().references(() => userRole.roleKey),
  status: text('status').notNull().default('pending'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedBy: text('used_by').references(() => user.id, { onDelete: 'set null' }),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  tokenUnique: uniqueIndex('idx_membership_invitation_token').on(t.tokenHash),
  byEmailStatus: index('idx_membership_invitation_email_status').on(t.email, t.status, t.expiresAt)
}))

export const registrationRateLimit = sqliteTable('registration_rate_limit', {
  bucketKey: text('bucket_key').notNull(),
  attemptCount: integer('attempt_count').notNull().default(1),
  resetAt: integer('reset_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.bucketKey] }),
  byReset: index('idx_registration_rate_limit_reset').on(t.resetAt)
}))

export const settings = sqliteTable('settings', {
  scope: text('scope').notNull().default('global'),
  key: text('key').notNull(),
  value: text('value').notNull(),
  valueType: text('value_type').notNull().default('string'),
  isEncrypted: integer('is_encrypted', { mode: 'boolean' }).notNull().default(false),
  groupKey: text('group_key'),
  updatedBy: text('updated_by'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  note: text('note')
}, t => ({
  pk: primaryKey({ columns: [t.scope, t.key] }),
  byKey: index('idx_settings_key').on(t.key),
  byGroup: index('idx_settings_group').on(t.groupKey)
}))

export const siteMenuSet = sqliteTable('site_menu_set', {
  id: text('id').notNull(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  documentJson: text('document_json').notNull(),
  bootstrapOwned: integer('bootstrap_owned', { mode: 'boolean' }).notNull().default(false),
  bootstrapSourceUpdatedAt: integer('bootstrap_source_updated_at', { mode: 'timestamp' }),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  nameUnique: uniqueIndex('idx_site_menu_set_name_unique').on(t.nameKey),
  byUpdatedAt: index('idx_site_menu_set_updated_at').on(t.updatedAt)
}))

// Normalized references are the deletion-integrity seam for public Site
// resources. Layouts can add rows without changing Menu storage, and
// the restrictive FK closes the usage-check/delete race.
export const siteMenuReference = sqliteTable('site_menu_reference', {
  ownerType: text('owner_type').notNull(),
  ownerId: text('owner_id').notNull(),
  slot: text('slot').notNull(),
  menuSetId: text('menu_set_id').notNull().references(() => siteMenuSet.id, { onDelete: 'restrict' }),
  label: text('label').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.ownerType, t.ownerId, t.slot] }),
  byMenu: index('idx_site_menu_reference_menu').on(t.menuSetId)
}))

// A Layout resource owns the stable identity and current-save pointer. The
// JSON column is a validated, framework-independent public rendering contract;
// it must never contain Nuxt layout/component/runtime lookup data. Immutable
// history is recorded through document_revision(document_kind='layout').
export const layoutResource = sqliteTable('site_layout_resource', {
  id: text('id').notNull(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  documentJson: text('document_json').notNull(),
  currentRevision: integer('current_revision').notNull().default(1),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  nameUnique: uniqueIndex('idx_site_layout_resource_name_unique').on(t.nameKey),
  byUpdatedAt: index('idx_site_layout_resource_updated_at').on(t.updatedAt)
}))

// #72 writes normalized Site/Schema/Page assignments here. The restrictive FK
// is the final authority for assignment/Layout deletion races; behavior records
// the explicit missing-resource policy consumed by the later resolver.
export const layoutReference = sqliteTable('site_layout_reference', {
  ownerType: text('owner_type').notNull(),
  ownerId: text('owner_id').notNull(),
  slot: text('slot').notNull(),
  layoutId: text('layout_id').notNull().references(() => layoutResource.id, { onDelete: 'restrict' }),
  label: text('label').notNull(),
  behavior: text('behavior').notNull().default('use-current'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.ownerType, t.ownerId, t.slot] }),
  byLayout: index('idx_site_layout_reference_layout').on(t.layoutId)
}))

export const installation = sqliteTable('installation', {
  key: text('key').notNull(),
  state: text('state').notNull().default('pending'),
  owner: text('owner'),
  setupSessionHash: text('setup_session_hash'),
  setupSessionExpiresAt: integer('setup_session_expires_at', { mode: 'timestamp' }),
  leaseToken: text('lease_token'),
  leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  lastError: text('last_error')
}, t => ({
  pk: primaryKey({ columns: [t.key] })
}))

export const schema = sqliteTable('schema', {
  schemaKey: text('schema_key').notNull(),
  version: integer('version').notNull(),
  title: text('title'),
  astJson: text('ast_json').notNull(), // JSON string
  jsonSchema: text('json_schema').notNull(), // JSON string
  uiSchema: text('ui_schema'),
  registryJson: text('registry_json'),
  diffJson: text('diff_json'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  note: text('note')
}, t => ({
  pk: primaryKey({ columns: [t.schemaKey, t.version] }),
  byCreatedAt: index('idx_schema_created_at').on(t.createdAt)
}))

export const schemaActive = sqliteTable('schema_active', {
  schemaKey: text('schema_key').notNull(),
  activeVersion: integer('active_version').notNull(),
  status: text('status').notNull().default('active'),
  deactivatedAt: integer('deactivated_at', { mode: 'timestamp' }),
  deactivatedBy: text('deactivated_by'),
  reactivatedAt: integer('reactivated_at', { mode: 'timestamp' }),
  reactivatedBy: text('reactivated_by'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.schemaKey] }),
  byStatus: index('idx_schema_active_status').on(t.status, t.schemaKey)
}))

export const schemaRole = sqliteTable('schema_role', {
  schemaKey: text('schema_key').notNull(),
  roleKey: text('role_key').notNull().references(() => userRole.roleKey),
  canRead: integer('can_read', { mode: 'boolean' }).notNull().default(false),
  canWrite: integer('can_write', { mode: 'boolean' }).notNull().default(false),
  canPublish: integer('can_publish', { mode: 'boolean' }).notNull().default(false),
  canArchive: integer('can_archive', { mode: 'boolean' }).notNull().default(false),
  canDelete: integer('can_delete', { mode: 'boolean' }).notNull().default(false),
  canAdmin: integer('can_admin', { mode: 'boolean' }).notNull().default(false)
}, t => ({
  pk: primaryKey({ columns: [t.schemaKey, t.roleKey] }),
  bySchema: index('idx_schema_role_schema').on(t.schemaKey),
  byRole: index('idx_schema_role_role').on(t.roleKey)
}))

export const schemaDraft = sqliteTable('schema_draft', {
  schemaKey: text('schema_key').notNull(),
  title: text('title'),
  astJson: text('ast_json').notNull(),
  currentRevision: integer('current_revision').notNull().default(1),
  updatedBy: text('updated_by'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  lockedBy: text('locked_by'),
  lockExpiresAt: integer('lock_expires_at', { mode: 'timestamp' })
}, t => ({
  pk: primaryKey({ columns: [t.schemaKey] })
}))

export const content = sqliteTable('content', {
  id: text('id').notNull(),
  schemaKey: text('schema_key').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  status: text('status').notNull(),
  contentJson: text('content_json').notNull(),
  publicPath: text('public_path'),
  seoJson: text('seo_json'),
  currentRevision: integer('current_revision').notNull().default(1),
  publishedRevisionId: text('published_revision_id'),
  firstPublishedAt: integer('first_published_at', { mode: 'timestamp' }),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  publishedBy: text('published_by'),
  transitionAt: integer('transition_at', { mode: 'timestamp' }),
  transitionBy: text('transition_by'),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  deletedBy: text('deleted_by'),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  bySchemaUpdated: index('idx_content_schema_updated').on(t.schemaKey, t.updatedAt),
  byStatus: index('idx_content_status').on(t.schemaKey, t.status, t.updatedAt)
}))

export const page = sqliteTable('page', {
  id: text('id').notNull(),
  title: text('title'),
  status: text('status').notNull().default('draft'),
  contentJson: text('content_json').notNull(),
  publicPath: text('public_path'),
  seoJson: text('seo_json'),
  // Historical/public Layout metadata deliberately has no direct FK. The
  // normalized site_layout_reference rows are the restrictive deletion and
  // assignment/delete race authority.
  layoutId: text('layout_id'),
  currentRevision: integer('current_revision').notNull().default(1),
  publishedRevisionId: text('published_revision_id'),
  firstPublishedAt: integer('first_published_at', { mode: 'timestamp' }),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  publishedBy: text('published_by'),
  transitionAt: integer('transition_at', { mode: 'timestamp' }),
  transitionBy: text('transition_by'),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  deletedBy: text('deleted_by'),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  byStatus: index('idx_page_status').on(t.status, t.updatedAt),
  byUpdatedAt: index('idx_page_updated_at').on(t.updatedAt)
}))

export const publicRoute = sqliteTable('public_route', {
  path: text('path').notNull(),
  routeKind: text('route_kind').notNull(),
  documentKind: text('document_kind').notNull(),
  documentId: text('document_id').notNull(),
  schemaKey: text('schema_key'),
  seoJson: text('seo_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.path] }),
  canonicalDocumentUnique: uniqueIndex('idx_public_route_canonical_document')
    .on(t.documentKind, t.documentId)
    .where(sql`${t.routeKind} = 'canonical'`),
  byDocument: index('idx_public_route_document').on(t.documentKind, t.documentId, t.routeKind),
  bySchema: index('idx_public_route_schema').on(t.schemaKey, t.routeKind, t.path)
}))

export const publicationRevision = sqliteTable('publication_revision', {
  id: text('id').notNull(),
  documentKind: text('document_kind').notNull(), // content|page
  documentId: text('document_id').notNull(),
  schemaKey: text('schema_key'),
  schemaVersion: integer('schema_version'),
  title: text('title'),
  contentJson: text('content_json').notNull(),
  layoutId: text('layout_id'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  byDocument: index('idx_publication_revision_document').on(t.documentKind, t.documentId, t.createdAt)
}))

export const documentRevision = sqliteTable('document_revision', {
  id: text('id').notNull(),
  documentKind: text('document_kind').notNull(), // content|page|schema-draft|layout
  documentId: text('document_id').notNull(),
  schemaKey: text('schema_key'),
  revision: integer('revision').notNull(),
  action: text('action').notNull(),
  status: text('status'),
  title: text('title'),
  schemaVersion: integer('schema_version'),
  snapshotJson: text('snapshot_json').notNull(),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  revisionUnique: uniqueIndex('idx_document_revision_unique').on(t.documentKind, t.documentId, t.revision),
  byDocument: index('idx_document_revision_document').on(t.documentKind, t.documentId, t.revision),
  byCreatedAt: index('idx_document_revision_created_at').on(t.createdAt)
}))

export const contentListing = sqliteTable('content_listing', {
  contentId: text('content_id').notNull(),
  projectionScope: text('projection_scope').notNull().default('working'),
  schemaKey: text('schema_key').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  title: text('title'),
  description: text('description'),
  image: text('image'),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.contentId, t.projectionScope] }),
  bySchemaUpdated: index('idx_content_listing_schema_updated').on(t.projectionScope, t.schemaKey, t.updatedAt),
  byStatusUpdated: index('idx_content_listing_status_updated').on(t.projectionScope, t.schemaKey, t.status, t.updatedAt),
  byStatusCreated: index('idx_content_listing_status_created').on(t.projectionScope, t.schemaKey, t.status, t.createdAt),
  byContent: index('idx_content_listing_content').on(t.contentId, t.projectionScope),
  contentFk: foreignKey({
    columns: [t.contentId],
    foreignColumns: [content.id],
    name: 'fk_content_listing_content'
  }),
  schemaFk: foreignKey({
    columns: [t.schemaKey, t.schemaVersion],
    foreignColumns: [schema.schemaKey, schema.version],
    name: 'fk_content_listing_schema'
  })
}))

export const searchConfig = sqliteTable('search_config', {
  schemaKey: text('schema_key').notNull(),
  fieldId: text('field_id').notNull(),
  fieldKey: text('field_key').notNull(),
  kind: text('kind').notNull(),
  searchMode: text('search_mode').notNull().default('off'),
  filterable: integer('filterable', { mode: 'boolean' }).notNull().default(false),
  sortable: integer('sortable', { mode: 'boolean' }).notNull().default(false),
  fullText: integer('full_text', { mode: 'boolean' }).notNull().default(false)
}, t => ({
  pk: primaryKey({ columns: [t.schemaKey, t.fieldId] }),
  bySchema: index('idx_search_config_schema').on(t.schemaKey),
  byFieldKey: index('idx_search_config_key').on(t.schemaKey, t.fieldKey)
}))

export const contentSearchData = sqliteTable('content_search_data', {
  contentId: text('content_id').notNull(),
  projectionScope: text('projection_scope').notNull().default('working'),
  fieldId: text('field_id').notNull(),
  dataType: text('data_type').notNull(),
  text: text('text'),
  value: real('value')
}, t => ({
  pk: primaryKey({ columns: [t.contentId, t.projectionScope, t.fieldId] }),
  idxFilterText: index('idx_filter_content_search_text').on(t.projectionScope, t.fieldId, t.dataType, t.text, t.contentId),
  idxFilterValue: index('idx_filter_content_search_value').on(t.projectionScope, t.fieldId, t.dataType, t.value, t.contentId)
}))

// Durable outbox and retry state for same-script Queue/DO search indexing.
// Queue delivery is only a wake-up mechanism; this row remains authoritative.
export const fullTextJob = sqliteTable('full_text_job', {
  id: text('id').notNull(),
  identityKey: text('identity_key').notNull(),
  operation: text('operation').notNull(), // index|remove|schema-sync|reindex
  documentKind: text('document_kind').notNull().default('content'),
  documentId: text('document_id').notNull(),
  schemaKey: text('schema_key'),
  schemaVersion: integer('schema_version'),
  fieldId: text('field_id').notNull().default('*'),
  targetRevisionId: text('target_revision_id'),
  tokenizerGeneration: text('tokenizer_generation').notNull(),
  indexGeneration: text('index_generation').notNull(),
  status: text('status').notNull().default('pending'),
  checkpoint: integer('checkpoint').notNull().default(0),
  totalChunks: integer('total_chunks'),
  attemptCount: integer('attempt_count').notNull().default(0),
  availableAt: integer('available_at', { mode: 'timestamp' }).notNull(),
  leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' })
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  identityUnique: uniqueIndex('idx_full_text_job_identity').on(t.identityKey),
  byDispatch: index('idx_full_text_job_dispatch').on(t.status, t.availableAt, t.leaseExpiresAt),
  byDocument: index('idx_full_text_job_document').on(t.documentKind, t.documentId, t.createdAt),
  bySchema: index('idx_full_text_job_schema').on(t.schemaKey, t.status, t.createdAt)
}))

// One active complete generation per content field. Staging chunks stay
// invisible until the indexer updates this pointer after a revision recheck.
export const fullTextIndexState = sqliteTable('full_text_index_state', {
  contentId: text('content_id').notNull(),
  schemaKey: text('schema_key').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  fieldId: text('field_id').notNull(),
  publishedRevisionId: text('published_revision_id').notNull(),
  tokenizerGeneration: text('tokenizer_generation').notNull(),
  activeIndexGeneration: text('active_index_generation'),
  buildingIndexGeneration: text('building_index_generation'),
  status: text('status').notNull().default('pending'),
  indexedChunks: integer('indexed_chunks').notNull().default(0),
  totalChunks: integer('total_chunks'),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastError: text('last_error'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  activatedAt: integer('activated_at', { mode: 'timestamp' })
}, t => ({
  pk: primaryKey({ columns: [t.contentId, t.fieldId] }),
  bySchemaStatus: index('idx_full_text_state_schema_status').on(t.schemaKey, t.status, t.updatedAt),
  byRevision: index('idx_full_text_state_revision').on(t.publishedRevisionId, t.tokenizerGeneration)
}))

// Tokenized chunks are ordinary derived rows so incomplete work cannot affect
// FTS5 document frequencies or ranking. Activation copies one complete
// generation into the virtual table and flips the state pointer in one batch.
export const fullTextChunk = sqliteTable('full_text_chunk', {
  indexGeneration: text('index_generation').notNull(),
  contentId: text('content_id').notNull(),
  schemaKey: text('schema_key').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  fieldId: text('field_id').notNull(),
  publishedRevisionId: text('published_revision_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  rawText: text('raw_text').notNull(),
  morphText: text('morph_text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.indexGeneration, t.chunkIndex] }),
  byContent: index('idx_full_text_chunk_content').on(t.contentId, t.fieldId, t.indexGeneration)
}))

export const fullTextControl = sqliteTable('full_text_control', {
  key: text('key').notNull().default('singleton'),
  tokenizerGeneration: text('tokenizer_generation').notNull(),
  queryEpoch: integer('query_epoch').notNull().default(1),
  status: text('status').notNull().default('available'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.key] })
}))

// Drizzle describes the query surface while migration 0011 creates the actual
// FTS5 virtual table with these columns and unicode61 over pre-tokenized text.
export const fullTextFts = sqliteTable('full_text_fts', {
  indexGeneration: text('index_generation').notNull(),
  contentId: text('content_id').notNull(),
  schemaKey: text('schema_key').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  fieldId: text('field_id').notNull(),
  publishedRevisionId: text('published_revision_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  rawText: text('raw_text').notNull(),
  morphText: text('morph_text').notNull()
})

export const contentRef = sqliteTable('content_ref', {
  contentId: text('content_id').notNull(),
  projectionScope: text('projection_scope').notNull().default('working'),
  fieldPath: text('field_path').notNull(),
  targetKind: text('target_kind').notNull(), // content|user|asset
  targetSchemaKey: text('target_schema_key'),
  targetId: text('target_id').notNull()
}, t => ({
  pk: primaryKey({ columns: [t.contentId, t.projectionScope, t.fieldPath, t.targetKind, t.targetId] }),
  byTarget: index('idx_content_ref_target').on(t.projectionScope, t.targetKind, t.targetId),
  byContent: index('idx_content_ref_content').on(t.contentId, t.projectionScope)
}))

export const contentRefList = sqliteTable('content_ref_list', {
  ownerContentId: text('owner_content_id').notNull(),
  projectionScope: text('projection_scope').notNull().default('working'),
  fieldKey: text('field_key').notNull(),
  position: integer('position').notNull(),
  itemKind: text('item_kind').notNull(), // content|user|asset
  itemSchemaKey: text('item_schema_key'),
  itemId: text('item_id'),
  assetId: text('asset_id'),
  metaJson: text('meta_json')
}, t => ({
  pk: primaryKey({ columns: [t.ownerContentId, t.projectionScope, t.fieldKey, t.position] }),
  byOwner: index('idx_content_ref_list_owner').on(t.ownerContentId, t.projectionScope, t.fieldKey)
}))

export const documentAssetRef = sqliteTable('document_asset_ref', {
  documentKind: text('document_kind').notNull(),
  documentId: text('document_id').notNull(),
  projectionScope: text('projection_scope').notNull(),
  assetId: text('asset_id').notNull()
}, t => ({
  pk: primaryKey({ columns: [t.documentKind, t.documentId, t.projectionScope, t.assetId] }),
  byAsset: index('idx_document_asset_ref_asset').on(t.assetId, t.projectionScope)
}))

export const asset = sqliteTable('asset', {
  id: text('id').notNull(),
  kind: text('kind').notNull(), // image|file|video
  status: text('status').notNull(), // uploading|ready
  objectKey: text('object_key').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256'),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, t => ({
  pk: primaryKey({ columns: [t.id] }),
  byCreatedAt: index('idx_asset_created_at').on(t.createdAt)
}))
