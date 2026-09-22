const MAX_PLAIN_TEXT_BYTES = 1024 * 1024

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

export function extractSearchPlainText(value: unknown, maxBytes = MAX_PLAIN_TEXT_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_PLAIN_TEXT_BYTES) {
    throw new RangeError(`Plain-text limit must be between 0 and ${MAX_PLAIN_TEXT_BYTES} bytes`)
  }

  const parts: string[] = []
  let bytes = 0
  let truncated = false
  const legacyHtmlText = (text: string) => text
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(?:nbsp|#160);/giu, ' ')
    .replace(/&(?:amp|#38);/giu, '&')
    .replace(/&(?:lt|#60);/giu, '<')
    .replace(/&(?:gt|#62);/giu, '>')
    .replace(/&(?:quot|#34);/giu, '"')
  const append = (text: string) => {
    const normalized = text.normalize('NFC').replace(/\s+/gu, ' ').trim()
    if (!normalized || truncated) return
    const separator = parts.length ? ' ' : ''
    const candidate = separator + normalized
    if (bytes + utf8Bytes(candidate) <= maxBytes) {
      parts.push(normalized)
      bytes += utf8Bytes(candidate)
      return
    }
    let partial = ''
    for (const symbol of normalized) {
      if (bytes + utf8Bytes(separator + partial + symbol) > maxBytes) break
      partial += symbol
    }
    if (partial) {
      parts.push(partial)
      bytes += utf8Bytes(separator + partial)
    }
    truncated = true
  }

  const visit = (node: unknown, depth: number) => {
    if (truncated || depth > 64 || node == null) return
    if (typeof node === 'string') {
      append(legacyHtmlText(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (typeof record.text === 'string') append(record.text)
    if (Array.isArray(record.content)) visit(record.content, depth + 1)
  }

  visit(value, 0)
  return { text: parts.join(' '), truncated, bytes }
}
