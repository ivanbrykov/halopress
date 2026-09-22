import {
  createPortablePageRenderingForStandaloneV2,
  createPortableStructuredContentRenderingForStandaloneV2,
  normalizePortableOrigin
} from '~~/shared/portable-content'
import {
  STANDALONE_DOCUMENT_CONTRACT_VERSION,
  STANDALONE_DOCUMENT_STYLESHEET_PATH,
  type StandaloneDocumentRendering,
  type StandaloneSchemaField,
  type StandaloneStructuredContentRendering
} from '~~/shared/standalone-document'
import type { H3Event } from 'h3'
import { requireTrustedRequestOrigin } from './request-origin'

function standaloneStylesheetUrl(origin: string) {
  return new URL(STANDALONE_DOCUMENT_STYLESHEET_PATH, normalizePortableOrigin(origin)).href
}

function standaloneFragment(html: string) {
  return html
    .replace('data-halo-contract-version="1"', 'data-halo-contract-version="2"')
    .replace(/ data-halo-color-mode="(?:default|light|dark)"/, '')
}

export function createStandalonePageRendering(
  document: unknown,
  options: { origin: string }
): StandaloneDocumentRendering {
  const rendering = createPortablePageRenderingForStandaloneV2(document, { origin: options.origin })
  return {
    contractVersion: STANDALONE_DOCUMENT_CONTRACT_VERSION,
    stylesheets: [standaloneStylesheetUrl(options.origin)],
    html: standaloneFragment(rendering.html),
    outline: rendering.outline
  }
}

export function createStandaloneStructuredContentRendering(
  content: Record<string, unknown>,
  fields: StandaloneSchemaField[],
  options: { origin: string }
): StandaloneStructuredContentRendering {
  const rendering = createPortableStructuredContentRenderingForStandaloneV2(content, fields, { origin: options.origin })
  return {
    contractVersion: STANDALONE_DOCUMENT_CONTRACT_VERSION,
    stylesheets: [standaloneStylesheetUrl(options.origin)],
    fields: Object.fromEntries(Object.entries(rendering.fields).map(([key, field]) => [key, {
      ...field,
      html: standaloneFragment(field.html)
    }])),
    outline: rendering.outline,
    ...(rendering.truncated ? { truncated: true as const } : {})
  }
}

export function createStandalonePageRenderingForEvent(event: H3Event, document: unknown) {
  return createStandalonePageRendering(document, { origin: requireTrustedRequestOrigin(event) })
}

export function createStandaloneStructuredRenderingForEvent(
  event: H3Event,
  content: Record<string, unknown>,
  fields: StandaloneSchemaField[]
) {
  return createStandaloneStructuredContentRendering(content, fields, {
    origin: requireTrustedRequestOrigin(event)
  })
}
