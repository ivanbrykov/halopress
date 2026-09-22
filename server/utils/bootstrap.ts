export const BOOTSTRAP_SCHEMA_KEY = 'article'
export const BOOTSTRAP_SCHEMA_VERSION = 1
export const BOOTSTRAP_SCHEMA_NOTE = 'bootstrap'
export const BOOTSTRAP_CONTENT_ID = 'halopress-welcome-guide'
export const BOOTSTRAP_PUBLICATION_REVISION_ID = 'halopress-welcome-guide-publication'

export function isBootstrapSchema(value: {
  schemaKey: string
  version: number
  note: string | null
}) {
  return value.schemaKey === BOOTSTRAP_SCHEMA_KEY
    && value.version === BOOTSTRAP_SCHEMA_VERSION
    && value.note === BOOTSTRAP_SCHEMA_NOTE
}
