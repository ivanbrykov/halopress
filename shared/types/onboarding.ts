export type OnboardingRuntime = 'cloudflare' | 'node' | 'local'

export type OnboardingDomainGuidance = 'cloudflare-custom-domain' | 'public-origin' | 'none'

export type OnboardingDeployment = {
  runtime: OnboardingRuntime
  capabilities: {
    domainGuidance: OnboardingDomainGuidance
    imageTransformations: boolean
  }
}

export type OnboardingStatus = {
  deployment: OnboardingDeployment
  schemas: {
    complete: boolean
    firstSchemaKey: string | null
  }
  content: {
    complete: boolean
  }
  site: {
    complete: boolean
  }
  domain: {
    complete: boolean
  }
  imageTransformations: {
    complete: boolean
  }
  googleOAuth: {
    complete: boolean
  }
}
