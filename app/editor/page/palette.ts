import type { PageLibraryEntryModel, PagePatternKey } from '~~/shared/page-patterns'
import type { PageBlockComponentKey } from './types'

export type PagePaletteItem =
  | { model: 'configured-block'; source: 'block'; key: PageBlockComponentKey }
  | { model: PageLibraryEntryModel; source: 'pattern'; key: PagePatternKey }
