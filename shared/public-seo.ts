import { z } from 'zod'

export const SAFE_STRUCTURED_DATA_TYPES = ['WebPage', 'Article', 'BlogPosting', 'NewsArticle', 'Product'] as const
export const PUBLIC_SEO_TITLE_MAX_LENGTH = 120

export const publicSeoOverridesSchema = z.object({
  title: z.string().trim().max(PUBLIC_SEO_TITLE_MAX_LENGTH).optional(),
  description: z.string().trim().max(320).optional(),
  imageAssetId: z.string().trim().max(128).nullable().optional(),
  structuredDataType: z.enum(SAFE_STRUCTURED_DATA_TYPES).optional()
}).strict()

export type PublicSeoOverrides = z.output<typeof publicSeoOverridesSchema>

export function derivePublicSeoTitle(value: string): string | undefined {
  return value.trim().slice(0, PUBLIC_SEO_TITLE_MAX_LENGTH) || undefined
}

export function normalizePublicSeoOverrides(value: unknown): PublicSeoOverrides | null {
  if (value == null) return null
  const parsed = publicSeoOverridesSchema.safeParse(value)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Invalid SEO metadata')
  const normalized = {
    ...parsed.data,
    title: parsed.data.title || undefined,
    description: parsed.data.description || undefined
  }
  return Object.values(normalized).some(item => item != null) ? normalized : null
}

export function parsePublicSeoJson(value: unknown): PublicSeoOverrides | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = publicSeoOverridesSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
