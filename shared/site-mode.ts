import { z } from 'zod'

export const siteModeSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean()
}).strict()

export const siteModeUpdateSchema = z.object({
  enabled: z.boolean()
}).strict()

export type SiteMode = z.output<typeof siteModeSchema>
export type SiteModeUpdate = z.output<typeof siteModeUpdateSchema>

export function defaultSiteMode(): SiteMode {
  return {
    version: 1,
    enabled: false
  }
}
