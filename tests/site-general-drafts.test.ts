import { describe, expect, it } from 'vitest'

import { applySiteGeneralServerSections } from '../app/utils/site-general-drafts'
import { defaultSitePresentation, type SitePresentation } from '../shared/site-presentation'

function presentation(overrides: {
  siteName: string
  primaryColor: SitePresentation['appearance']['primaryColor']
  copyright: string
}) {
  const value = defaultSitePresentation()
  value.general.siteName = overrides.siteName
  value.appearance.primaryColor = overrides.primaryColor
  value.footer.copyright = overrides.copyright
  return value
}

describe('Site General draft state', () => {
  it('applies only the sections returned by the form that was saved', () => {
    const state = presentation({
      siteName: 'Unsaved identity draft',
      primaryColor: 'blue',
      copyright: 'Unsaved footer draft'
    })
    const server = presentation({
      siteName: 'Saved identity',
      primaryColor: 'red',
      copyright: 'Saved footer'
    })

    applySiteGeneralServerSections(state, server, ['general', 'shell'])

    expect(state.general.siteName).toBe('Saved identity')
    expect(state.appearance.primaryColor).toBe('blue')
    expect(state.footer.copyright).toBe('Unsaved footer draft')
  })

  it('preserves identity and footer drafts after an appearance save', () => {
    const state = presentation({
      siteName: 'Unsaved identity draft',
      primaryColor: 'blue',
      copyright: 'Unsaved footer draft'
    })
    const server = presentation({
      siteName: 'Saved identity',
      primaryColor: 'red',
      copyright: 'Saved footer'
    })

    applySiteGeneralServerSections(state, server, ['appearance'])

    expect(state.general.siteName).toBe('Unsaved identity draft')
    expect(state.appearance.primaryColor).toBe('red')
    expect(state.footer.copyright).toBe('Unsaved footer draft')
  })

  it('preserves identity and appearance drafts after a footer save', () => {
    const state = presentation({
      siteName: 'Unsaved identity draft',
      primaryColor: 'blue',
      copyright: 'Unsaved footer draft'
    })
    const server = presentation({
      siteName: 'Saved identity',
      primaryColor: 'red',
      copyright: 'Saved footer'
    })

    applySiteGeneralServerSections(state, server, ['footer'])

    expect(state.general.siteName).toBe('Unsaved identity draft')
    expect(state.appearance.primaryColor).toBe('blue')
    expect(state.footer.copyright).toBe('Saved footer')
    expect(state.footer).not.toBe(server.footer)
  })

  it('rehydrates every section only when an explicit refresh requests it', () => {
    const state = presentation({
      siteName: 'Unsaved identity draft',
      primaryColor: 'blue',
      copyright: 'Unsaved footer draft'
    })
    const server = presentation({
      siteName: 'Saved identity',
      primaryColor: 'red',
      copyright: 'Saved footer'
    })

    applySiteGeneralServerSections(state, server, ['general', 'shell', 'appearance', 'footer'])

    expect(state.general.siteName).toBe('Saved identity')
    expect(state.appearance.primaryColor).toBe('red')
    expect(state.footer.copyright).toBe('Saved footer')
    expect(state.footer).not.toBe(server.footer)
  })
})
