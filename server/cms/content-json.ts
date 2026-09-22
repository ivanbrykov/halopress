export function parseContentJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore invalid json
  }
  return {}
}

export function getContentTitle(content: Record<string, unknown>) {
  const title = content.title
  if (typeof title !== 'string') return null
  const trimmed = title.trim()
  return trimmed.length ? trimmed : null
}
