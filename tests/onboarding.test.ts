import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  formatOnboardingProgressLabel,
  formatOnboardingProgressValue,
  getOnboardingItems,
  getOnboardingProgress,
  hasCompletedOnboarding,
  type OnboardingStatus
} from '../app/utils/onboarding'
import { isBootstrapSchema } from '../server/utils/bootstrap'
import {
  buildOnboardingStatus,
  getImageTransformationsStatus,
  hasCompletedDomainGuidance,
  hasCustomDomain,
  hasImageTransformations,
  hasPublicOrigin,
  resolveOnboardingDeployment,
  resolveOnboardingDeploymentFromEvent
} from '../server/utils/onboarding'
import type { OnboardingDeployment } from '../shared/types/onboarding'

const projectRoot = join(import.meta.dirname, '..')

const cloudflareDeployment = resolveOnboardingDeployment({
  cloudflareContext: {},
  development: false
})
const nodeDeployment = resolveOnboardingDeployment({ development: false })
const localDeployment = resolveOnboardingDeployment({ development: true })

function onboardingStatus(
  deployment: OnboardingDeployment,
  complete: boolean,
  overrides: Partial<{
    domain: boolean
    images: boolean
    site: boolean
  }> = {}
): OnboardingStatus {
  return buildOnboardingStatus({
    deployment,
    schemasComplete: complete,
    firstSchemaKey: complete ? 'article' : null,
    contentComplete: complete,
    siteComplete: overrides.site ?? complete,
    domainComplete: overrides.domain ?? complete,
    imageTransformationsComplete: overrides.images ?? complete,
    googleOAuthComplete: complete
  })
}

function onboardingEvent(hostname: string, cloudflare = false) {
  return {
    context: cloudflare ? { cloudflare: {} } : {},
    path: '/',
    node: { req: { url: '/', headers: { host: hostname } } }
  }
}

describe('dashboard onboarding', () => {
  it('resolves deployment capabilities from runtime evidence rather than hostname', () => {
    expect(cloudflareDeployment).toEqual({
      runtime: 'cloudflare',
      capabilities: {
        domainGuidance: 'cloudflare-custom-domain',
        imageTransformations: true
      }
    })
    expect(nodeDeployment).toEqual({
      runtime: 'node',
      capabilities: {
        domainGuidance: 'public-origin',
        imageTransformations: false
      }
    })
    expect(localDeployment).toEqual({
      runtime: 'local',
      capabilities: {
        domainGuidance: 'none',
        imageTransformations: false
      }
    })

    expect(resolveOnboardingDeployment({ cloudflareContext: {}, development: true })).toEqual(localDeployment)
  })

  it('uses the same local-runtime classification throughout the installation flow', async () => {
    const cloudflareEvent = onboardingEvent('localhost', true)

    expect(resolveOnboardingDeploymentFromEvent(cloudflareEvent as any, true)).toEqual(localDeployment)
    expect(resolveOnboardingDeploymentFromEvent(cloudflareEvent as any, false)).toEqual(cloudflareDeployment)

    const endpointSources = await Promise.all([
      'server/api/system/install/status.get.ts',
      'server/api/system/install/session.post.ts',
      'server/api/system/install.post.ts'
    ].map(path => readFile(join(projectRoot, path), 'utf8')))
    expect(endpointSources.every(source => source.includes('resolveOnboardingDeploymentFromEvent(event)'))).toBe(true)
  })

  it('distinguishes Cloudflare custom domains and Node public origins from loopback hosts', () => {
    expect(hasCustomDomain('cms.example.com')).toBe(true)
    expect(hasCustomDomain('CMS.EXAMPLE.COM.')).toBe(true)
    expect(hasCustomDomain('site.account.workers.dev')).toBe(false)
    expect(hasCustomDomain('site.pages.dev')).toBe(false)
    expect(hasCustomDomain('localhost')).toBe(false)
    expect(hasCustomDomain('app.localhost')).toBe(false)
    expect(hasCustomDomain('127.42.0.8')).toBe(false)
    expect(hasCustomDomain('[::1]')).toBe(false)

    expect(hasPublicOrigin('cms.example.com')).toBe(true)
    expect(hasPublicOrigin('halopress.onrender.com')).toBe(true)
    expect(hasPublicOrigin('8.8.8.8')).toBe(true)
    expect(hasPublicOrigin('[2001:4860:4860::8888]')).toBe(true)
    expect(hasPublicOrigin('localhost')).toBe(false)
    expect(hasPublicOrigin('127.0.0.1')).toBe(false)
    expect(hasPublicOrigin('::1')).toBe(false)
    expect(hasPublicOrigin('[fc00::1]')).toBe(false)
    expect(hasPublicOrigin('[fd00::1]')).toBe(false)
    expect(hasPublicOrigin('[fe80::1]')).toBe(false)
    expect(hasPublicOrigin('[ff02::1]')).toBe(false)
    expect(hasPublicOrigin('10.0.0.8')).toBe(false)
    expect(hasPublicOrigin('192.168.1.2')).toBe(false)
    expect(hasPublicOrigin('169.254.10.1')).toBe(false)
    expect(hasPublicOrigin('halopress')).toBe(false)
    expect(hasPublicOrigin('halopress.internal')).toBe(false)

    expect(hasCompletedDomainGuidance(cloudflareDeployment, 'site.account.workers.dev')).toBe(false)
    expect(hasCompletedDomainGuidance(cloudflareDeployment, 'cms.example.com')).toBe(true)
    expect(hasCompletedDomainGuidance(nodeDeployment, 'halopress.onrender.com')).toBe(true)
    expect(hasCompletedDomainGuidance(nodeDeployment, 'cms.example.com')).toBe(true)
    expect(hasCompletedDomainGuidance(nodeDeployment, 'localhost')).toBe(false)
    expect(hasCompletedDomainGuidance(nodeDeployment, '10.0.0.8')).toBe(false)
    expect(hasCompletedDomainGuidance(nodeDeployment, 'halopress.internal')).toBe(false)
    expect(hasCompletedDomainGuidance(localDeployment, 'cms.example.com')).toBe(false)
  })

  it('does not grant Cloudflare capabilities from spoofed Cloudflare-looking hosts', async () => {
    const fetcher = vi.fn()
    const spoofedHostEvent = onboardingEvent('spoofed.account.workers.dev')
    const deployment = resolveOnboardingDeployment({
      cloudflareContext: spoofedHostEvent.context.cloudflare,
      development: false
    })

    expect(deployment.runtime).toBe('node')
    expect(deployment.capabilities).toEqual({
      domainGuidance: 'public-origin',
      imageTransformations: false
    })
    await expect(getImageTransformationsStatus(deployment, spoofedHostEvent as any, fetcher as any)).resolves.toBe(false)
    expect(fetcher).not.toHaveBeenCalled()

    const itemUrls = getOnboardingItems(onboardingStatus(deployment, false)).map(item => item.to)
    expect(itemUrls).not.toContain('https://developers.cloudflare.com/images/optimization/transformations/overview/')
    expect(itemUrls.every(url => !url.includes('developers.cloudflare.com'))).toBe(true)
  })

  it('only excludes the exact starter schema from user onboarding progress', () => {
    expect(isBootstrapSchema({ schemaKey: 'article', version: 1, note: 'bootstrap' })).toBe(true)
    expect(isBootstrapSchema({ schemaKey: 'article', version: 2, note: null })).toBe(false)
    expect(isBootstrapSchema({ schemaKey: 'product', version: 1, note: 'bootstrap' })).toBe(false)
  })

  it('derives the visible items and links from the applicable deployment capabilities', () => {
    const cloudflareItems = getOnboardingItems(onboardingStatus(cloudflareDeployment, false))
    const nodeItems = getOnboardingItems(onboardingStatus(nodeDeployment, false))
    const localItems = getOnboardingItems(onboardingStatus(localDeployment, false))

    expect(cloudflareItems.map(item => item.key)).toEqual(['schema', 'content', 'site', 'domain', 'images', 'google'])
    expect(cloudflareItems[2]).toMatchObject({
      key: 'site',
      title: 'Enable Site',
      complete: false,
      to: '/_desk/site/general#site-features'
    })
    expect(cloudflareItems[2]).not.toHaveProperty('external')
    expect(cloudflareItems.find(item => item.key === 'domain')).toMatchObject({
      title: 'Set up a custom domain',
      external: true
    })
    expect(cloudflareItems.find(item => item.key === 'images')?.to).toContain('developers.cloudflare.com/images/')

    expect(nodeItems.map(item => item.key)).toEqual(['schema', 'content', 'site', 'domain', 'google'])
    expect(nodeItems.find(item => item.key === 'domain')).toMatchObject({
      title: 'Use a public site URL',
      external: true
    })
    expect(nodeItems.find(item => item.key === 'domain')?.to).toContain('docs/deployment.md#node-production')
    expect(nodeItems.every(item => !item.to.includes('developers.cloudflare.com'))).toBe(true)

    expect(localItems.map(item => item.key)).toEqual(['schema', 'content', 'site', 'google'])
  })

  it('encodes the first schema key in the content creation link', () => {
    const status = onboardingStatus(localDeployment, false)
    status.schemas.firstSchemaKey = 'press release/한국어'

    expect(getOnboardingItems(status).find(item => item.key === 'content')?.to)
      .toBe('/_desk/content/press%20release%2F%ED%95%9C%EA%B5%AD%EC%96%B4/new')
  })

  it('calculates completion and progress from every applicable item', () => {
    const cloudflareItems = getOnboardingItems(onboardingStatus(cloudflareDeployment, true))
    const nodeItems = getOnboardingItems(onboardingStatus(nodeDeployment, true, { images: false }))
    const localItems = getOnboardingItems(onboardingStatus(localDeployment, true, { domain: false, images: false }))

    expect(getOnboardingProgress(cloudflareItems)).toEqual({ completed: 6, total: 6, complete: true })
    expect(getOnboardingProgress(nodeItems)).toEqual({ completed: 5, total: 5, complete: true })
    expect(getOnboardingProgress(localItems)).toEqual({ completed: 4, total: 4, complete: true })
    expect(hasCompletedOnboarding(cloudflareItems.slice(0, 5))).toBe(true)
    expect(getOnboardingProgress(getOnboardingItems(onboardingStatus(localDeployment, true, { site: false }))))
      .toEqual({ completed: 3, total: 4, complete: false })
    expect(hasCompletedOnboarding([{ complete: true }, { complete: false }])).toBe(false)
    expect(hasCompletedOnboarding([])).toBe(true)
    expect(formatOnboardingProgressLabel()).toBe('Onboarding progress')
    expect(formatOnboardingProgressValue(2, 4)).toBe('2 of 4 setup tasks complete')
  })

  it('returns only the minimal onboarding API response fields', () => {
    const deployment = resolveOnboardingDeployment({
      cloudflareContext: {
        env: {
          DB: 'DB_SENTINEL',
          CONTENT_ASSETS: 'R2_SENTINEL',
          NUXT_AUTH_SECRET: 'SECRET_SENTINEL'
        }
      },
      development: false
    })
    const status = onboardingStatus(deployment, true)

    expect(status).toEqual({
      deployment: {
        runtime: 'cloudflare',
        capabilities: {
          domainGuidance: 'cloudflare-custom-domain',
          imageTransformations: true
        }
      },
      schemas: { complete: true, firstSchemaKey: 'article' },
      content: { complete: true },
      site: { complete: true },
      domain: { complete: true },
      imageTransformations: { complete: true },
      googleOAuth: { complete: true }
    })
    expect(JSON.stringify(status)).not.toMatch(/hostname|env|binding|DB_SENTINEL|R2_SENTINEL|SECRET_SENTINEL|configured|enabled/i)
  })

  it('gates Image Transformations before starting a probe outside Cloudflare', async () => {
    const fetcher = vi.fn()
    const event = onboardingEvent('cms.example.com')

    await expect(getImageTransformationsStatus(nodeDeployment, event as any, fetcher as any)).resolves.toBe(false)
    await expect(getImageTransformationsStatus(localDeployment, event as any, fetcher as any)).resolves.toBe(false)
    await expect(hasImageTransformations(event as any, fetcher as any)).resolves.toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('detects a successful live Cloudflare image response', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'cf-resized': 'orig-size=128'
      }
    }))
    const event = onboardingEvent('cms.example.com', true)

    await expect(getImageTransformationsStatus(cloudflareDeployment, event as any, fetcher as any)).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledWith(
      new URL('http://cms.example.com/cdn-cgi/image/w=32,h=32,fit=cover,f=webp/branding/halopress-mark-256.png'),
      expect.objectContaining({ headers: { accept: 'image/webp,image/*' } })
    )
  })

  it('rejects raw and failed image responses as transformation evidence', async () => {
    const error = new Response('<html>Error</html>', {
      status: 500,
      headers: { 'content-type': 'text/html' }
    })
    const raw = new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    })
    const failed = new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'cf-resized': 'err=9422'
      }
    })
    const errorBodyReader = vi.spyOn(error, 'arrayBuffer')
    const rawBodyReader = vi.spyOn(raw, 'arrayBuffer')
    const failedBodyReader = vi.spyOn(failed, 'arrayBuffer')
    const errorBodyCancel = vi.spyOn(error.body!, 'cancel')
    const rawBodyCancel = vi.spyOn(raw.body!, 'cancel')
    const failedBodyCancel = vi.spyOn(failed.body!, 'cancel')
    const event = onboardingEvent('cms.example.com', true)

    await expect(hasImageTransformations(event as any, vi.fn(async () => error) as any)).resolves.toBe(false)
    await expect(hasImageTransformations(event as any, vi.fn(async () => raw) as any)).resolves.toBe(false)
    await expect(hasImageTransformations(event as any, vi.fn(async () => failed) as any)).resolves.toBe(false)
    expect(errorBodyReader).not.toHaveBeenCalled()
    expect(rawBodyReader).not.toHaveBeenCalled()
    expect(failedBodyReader).not.toHaveBeenCalled()
    expect(errorBodyCancel).toHaveBeenCalledOnce()
    expect(rawBodyCancel).toHaveBeenCalledOnce()
    expect(failedBodyCancel).toHaveBeenCalledOnce()
  })

  it('keeps the dismissible widget behavior while using dynamic progress', async () => {
    const widget = await readFile(join(projectRoot, 'app/components/OnboardingWidget.vue'), 'utf8')
    expect(widget).toContain('<UProgress')
    expect(widget).toContain(':max="itemCount"')
    expect(widget).toContain(':get-value-label="getProgressLabel"')
    expect(widget).toContain(':get-value-text="getProgressValue"')
    expect(widget).toContain('data.value ? progress.value.complete : false')
    expect(widget).toContain('useCookie<boolean>(\'halopress_onboarding_dismissed_v2\'')
    expect(widget).not.toContain('halopress_onboarding_dismissed_v1')
    expect(widget).toContain('immediate: !dismissed.value')
    expect(widget).toContain('server: false')
    expect(widget).toContain('now - lastRefreshAt < 30_000')
    expect(widget).toContain('document.addEventListener(\'visibilitychange\', refreshWhenVisible)')
    expect(widget).toContain('window.addEventListener(\'focus\', refreshWhenVisible)')
    expect(widget).toContain('label="Dismiss"')
    expect(widget).toContain('aria-label="Dismiss onboarding for now"')
    expect(widget).toContain('label="Retry"')
    expect(widget).toContain('item.complete ? \'Complete\' : \'Not complete\'')
    expect(widget).toContain('opens in a new tab')
    expect(widget).toContain(':to="item.to"')
    expect(widget).toContain(':external="item.external"')
    expect(widget).toContain(':target="item.external ? \'_blank\' : undefined"')

    const dashboard = await readFile(join(projectRoot, 'app/pages/_desk/index.vue'), 'utf8')
    const grid = dashboard.slice(dashboard.indexOf('<UPageGrid'), dashboard.indexOf('</UPageGrid>'))
    expect(grid).toContain('<OnboardingWidget class="sm:col-span-2 lg:col-span-1" />')
    expect(grid).toContain('to="/_desk/users"')
    expect(grid).toContain('to="/_desk/schemas"')
    expect(dashboard).toContain('items-start gap-4 sm:gap-6')

    const settings = await readFile(join(projectRoot, 'app/pages/_desk/settings/index.vue'), 'utf8')
    expect(settings).toContain('navigateTo(\'/_desk/settings/preferences\'')
    expect(settings).not.toContain('<SettingsShell')

    const onboarding = await readFile(join(projectRoot, 'app/utils/onboarding.ts'), 'utf8')
    expect(onboarding).toContain('to: \'/_desk/site/general#site-features\'')
    expect(onboarding).toContain('to: \'/_desk/settings/access#authentication\'')

    const statusApi = await readFile(join(projectRoot, 'server/api/settings/onboarding.get.ts'), 'utf8')
    expect(statusApi).toContain('BOOTSTRAP_CONTENT_ID')
    expect(statusApi).toContain('isBootstrapSchema')
    expect(statusApi).toContain('getImageTransformationsStatus(deployment, event)')
    expect(statusApi).toContain('getSiteMode(event)')
    expect(statusApi).toContain('siteComplete: siteMode.enabled')
    expect(statusApi).not.toContain('hostname: requestUrl.hostname')

    const siteGeneral = await readFile(join(projectRoot, 'app/pages/_desk/site/general.vue'), 'utf8')
    expect(siteGeneral).toContain('id="site-features"')
    expect(siteGeneral.match(/v-model="modeState\.enabled"/g)).toHaveLength(1)

    const deploymentGuide = await readFile(join(projectRoot, 'docs/deployment.md'), 'utf8')
    expect(deploymentGuide).toContain('| Node production | Schema, content, Site activation, public site URL, Google OAuth (5 tasks) |')
    expect(deploymentGuide).toContain('A provider-assigned hostname and a custom domain are both valid public')
    expect(deploymentGuide).toMatch(/cannot enable Cloudflare links, probes, or\s+capabilities/)

    const readme = await readFile(join(projectRoot, 'README.md'), 'utf8')
    expect(readme).toContain('[deployment and onboarding guide](docs/deployment.md)')
  })
})
