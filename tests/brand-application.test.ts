import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('approved HaloPress brand application', () => {
  it('publishes the approved favicon and artwork family', () => {
    for (const path of [
      'public/favicon.ico',
      'public/favicon.png',
      'public/apple-touch-icon.png',
      'public/branding/halopress-mark-256.png',
      'public/branding/halopress-brand-artwork-light.png',
      'public/branding/halopress-brand-artwork-dark.png',
      'public/branding/halopress-social-card.png',
      'public/branding/halopress-install-wizard-journey.png'
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(true)
    }
  })

  it('uses the approved light and dark artwork in the README', () => {
    const readme = source('README.md')
    expect(readme).toContain('./public/branding/halopress-brand-artwork-light.png')
    expect(readme).toContain('./public/branding/halopress-brand-artwork-dark.png')
    expect(readme).not.toContain('halopress-mark-3d-final')
  })

  it('provides app-wide favicon links and the approved public social fallback', () => {
    const brandHead = source('app/composables/useHaloPressBrandHead.ts')
    const blankLayout = source('app/layouts/blank.vue')
    const deskLayout = source('app/layouts/desk.vue')
    const presentation = source('shared/site-presentation.ts')
    const builtInLayout = source('app/components/layout-renderer/BuiltInLayoutRenderer.vue')

    expect(brandHead).toContain('href: \'/favicon.ico\'')
    expect(brandHead).toContain('href: \'/favicon.png\'')
    expect(brandHead).toContain('href: \'/apple-touch-icon.png\'')
    expect(blankLayout).toContain('useHaloPressBrandHead()')
    expect(deskLayout).toContain('useHaloPressBrandHead()')
    expect(presentation).toContain('\'/branding/halopress-social-card.png\'')
    expect(builtInLayout).toContain('presentation.value.general.socialImageUrl')
  })

  it('uses the approved artwork and mark across public, auth, install, and Desk surfaces', () => {
    const artwork = source('app/components/AppBrandArtwork.vue')
    const home = source('app/pages/index.vue')
    const desk = source('app/pages/_desk/index.vue')

    expect(artwork).toContain('/branding/halopress-brand-artwork-light.png')
    expect(artwork).toContain('/branding/halopress-brand-artwork-dark.png')
    expect(home).toContain('<AppBrandArtwork')
    expect(desk).toContain('<AppBrandArtwork')
    expect(desk).toContain('<AppLogo')
    expect(source('app/pages/login.vue')).toContain('<AppLogo')
    expect(source('app/pages/signup.vue')).toContain('<AppLogo')
    expect(source('app/pages/_install.vue')).toContain('/branding/halopress-install-wizard-journey.png')
  })
})
