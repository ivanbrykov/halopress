import type { SitePresentationAdminValue } from '~~/shared/site-presentation'

export type SiteGeneralDraftState = Pick<
  SitePresentationAdminValue,
  'general' | 'shell' | 'appearance' | 'footer'
>

export type SiteGeneralDraftSection = keyof SiteGeneralDraftState

export function applySiteGeneralServerSections(
  target: SiteGeneralDraftState,
  source: SiteGeneralDraftState,
  sections: readonly SiteGeneralDraftSection[]
) {
  if (sections.includes('general')) Object.assign(target.general, source.general)
  if (sections.includes('shell')) Object.assign(target.shell, source.shell)
  if (sections.includes('appearance')) Object.assign(target.appearance, source.appearance)
  if (sections.includes('footer')) Object.assign(target.footer, structuredClone(source.footer))
}
