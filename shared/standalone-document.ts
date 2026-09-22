import type { AuthoredOutlineEntry, AuthoredSchemaField } from './authored-document'

export const STANDALONE_DOCUMENT_CONTRACT_VERSION = 2 as const
export const STANDALONE_DOCUMENT_STYLESHEET_REVISION = '6d010ca6e3a8523dfa95f6173f8896c6347663a32f85d498273dfa831bfd3fa6'
export const STANDALONE_DOCUMENT_STYLESHEET_PATH = `/_halo/content/v2/${STANDALONE_DOCUMENT_STYLESHEET_REVISION}.css`

export type StandaloneDocumentRendering = {
  contractVersion: typeof STANDALONE_DOCUMENT_CONTRACT_VERSION
  stylesheets: string[]
  html: string
  outline: AuthoredOutlineEntry[]
}

export type StandaloneRichTextFieldRendering = {
  fieldId: string
  fieldKey: string
  html: string
  outline: AuthoredOutlineEntry[]
}

export type StandaloneStructuredContentRendering = {
  contractVersion: typeof STANDALONE_DOCUMENT_CONTRACT_VERSION
  stylesheets: string[]
  fields: Record<string, StandaloneRichTextFieldRendering>
  outline: AuthoredOutlineEntry[]
  truncated?: true
}

export type StandaloneSchemaField = AuthoredSchemaField
