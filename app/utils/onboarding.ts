import type { OnboardingStatus } from '../../shared/types/onboarding'

export type { OnboardingStatus } from '../../shared/types/onboarding'

const CLOUDFLARE_CUSTOM_DOMAIN_URL = 'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/'
const CLOUDFLARE_IMAGE_TRANSFORMATIONS_URL = 'https://developers.cloudflare.com/images/optimization/transformations/overview/'
const NODE_DEPLOYMENT_GUIDE_URL = 'https://github.com/comfuture/halopress/blob/main/docs/deployment.md#node-production'

export type OnboardingItem = {
  key: string
  title: string
  complete: boolean
  to: string
  external?: boolean
}

export function getOnboardingItems(status: OnboardingStatus): OnboardingItem[] {
  const contentLink = status.schemas.firstSchemaKey
    ? `/_desk/content/${encodeURIComponent(status.schemas.firstSchemaKey)}/new`
    : '/_desk/schemas/new'

  const items: OnboardingItem[] = [
    {
      key: 'schema',
      title: 'Create a schema',
      complete: status.schemas.complete,
      to: '/_desk/schemas/new'
    },
    {
      key: 'content',
      title: 'Publish new content',
      complete: status.content.complete,
      to: contentLink
    },
    {
      key: 'site',
      title: 'Enable Site',
      complete: status.site.complete,
      to: '/_desk/site/general#site-features'
    }
  ]

  if (status.deployment.capabilities.domainGuidance === 'cloudflare-custom-domain') {
    items.push({
      key: 'domain',
      title: 'Set up a custom domain',
      complete: status.domain.complete,
      to: CLOUDFLARE_CUSTOM_DOMAIN_URL,
      external: true
    })
  } else if (status.deployment.capabilities.domainGuidance === 'public-origin') {
    items.push({
      key: 'domain',
      title: 'Use a public site URL',
      complete: status.domain.complete,
      to: NODE_DEPLOYMENT_GUIDE_URL,
      external: true
    })
  }

  if (status.deployment.capabilities.imageTransformations) {
    items.push({
      key: 'images',
      title: 'Enable Image Transformations',
      complete: status.imageTransformations.complete,
      to: CLOUDFLARE_IMAGE_TRANSFORMATIONS_URL,
      external: true
    })
  }

  items.push({
    key: 'google',
    title: 'Configure Google OAuth',
    complete: status.googleOAuth.complete,
    to: '/_desk/settings/access#authentication'
  })

  return items
}

export function hasCompletedOnboarding(items: readonly Pick<OnboardingItem, 'complete'>[]) {
  return items.every(item => item.complete)
}

export function getOnboardingProgress(items: readonly Pick<OnboardingItem, 'complete'>[]) {
  return {
    completed: items.filter(item => item.complete).length,
    total: items.length,
    complete: hasCompletedOnboarding(items)
  }
}

export function formatOnboardingProgressLabel() {
  return 'Onboarding progress'
}

export function formatOnboardingProgressValue(value: number, max: number) {
  return `${value} of ${max} setup tasks complete`
}
