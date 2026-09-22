import { and, eq, ne, sql } from 'drizzle-orm'
import { getRequestURL } from 'h3'

import { getDb } from '../../db/db'
import { content as contentTable, schema as schemaTable, schemaActive as schemaActiveTable } from '../../db/schema'
import { requireAdmin } from '../../utils/auth'
import { BOOTSTRAP_CONTENT_ID, isBootstrapSchema } from '../../utils/bootstrap'
import { getGoogleAuthenticationSettings } from '../../utils/google-authentication-settings'
import { getSiteMode } from '../../utils/site-mode-settings'
import {
  buildOnboardingStatus,
  getImageTransformationsStatus,
  hasCompletedDomainGuidance,
  resolveOnboardingDeployment
} from '../../utils/onboarding'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = await getDb(event)
  const requestUrl = getRequestURL(event)
  const deployment = resolveOnboardingDeployment({
    cloudflareContext: (event as any).context?.cloudflare,
    development: import.meta.dev
  })

  const [activeSchemas, publishedContent, googleOAuth, imageTransformations, siteMode] = await Promise.all([
    db
      .select({
        schemaKey: schemaActiveTable.schemaKey,
        version: schemaActiveTable.activeVersion,
        note: schemaTable.note
      })
      .from(schemaActiveTable)
      .innerJoin(schemaTable, and(
        eq(schemaTable.schemaKey, schemaActiveTable.schemaKey),
        eq(schemaTable.version, schemaActiveTable.activeVersion)
      ))
      .where(eq(schemaActiveTable.status, 'active'))
      .orderBy(schemaActiveTable.schemaKey),
    db
      .select({ total: sql<number>`count(1)` })
      .from(contentTable)
      .innerJoin(schemaActiveTable, and(
        eq(schemaActiveTable.schemaKey, contentTable.schemaKey),
        eq(schemaActiveTable.status, 'active')
      ))
      .where(and(eq(contentTable.status, 'published'), ne(contentTable.id, BOOTSTRAP_CONTENT_ID)))
      .get(),
    getGoogleAuthenticationSettings(event),
    getImageTransformationsStatus(deployment, event),
    getSiteMode(event)
  ])

  const customSchemas = activeSchemas.filter((schema: { schemaKey: string, version: number, note: string | null }) => !isBootstrapSchema(schema))
  const publishedContentCount = Number(publishedContent?.total ?? 0)

  return buildOnboardingStatus({
    deployment,
    schemasComplete: customSchemas.length > 0,
    firstSchemaKey: customSchemas[0]?.schemaKey ?? null,
    contentComplete: publishedContentCount > 0,
    siteComplete: siteMode.enabled,
    domainComplete: hasCompletedDomainGuidance(deployment, requestUrl.hostname),
    imageTransformationsComplete: imageTransformations,
    googleOAuthComplete: googleOAuth.configured && googleOAuth.enabled
  })
})
