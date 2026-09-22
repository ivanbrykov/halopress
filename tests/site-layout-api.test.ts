import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { layoutHttpError, parseLayoutRevisionQuery } from '../server/utils/site-layout-http'
import {
  LayoutInUseError,
  LayoutNameConflictError,
  LayoutNotFoundError,
  LayoutStorageUnavailableError,
  LayoutValidationError
} from '../server/utils/site-layouts'

const root = resolve(import.meta.dirname, '..')

describe('Layout admin API', () => {
  it('guards every read with administrator authorization and every mutation before body access', async () => {
    const reads = [
      'server/api/site/layouts/index.get.ts',
      'server/api/site/layouts/[layoutId].get.ts',
      'server/api/site/layouts/[layoutId]/usage.get.ts'
    ]
    const mutations = [
      'server/api/site/layouts/index.post.ts',
      'server/api/site/layouts/[layoutId].put.ts',
      'server/api/site/layouts/[layoutId].patch.ts',
      'server/api/site/layouts/[layoutId].delete.ts',
      'server/api/site/layouts/[layoutId]/duplicate.post.ts'
    ]

    for (const path of reads) {
      const source = await readFile(resolve(root, path), 'utf8')
      expect(source).toContain('requireAdmin(event)')
      expect(source).not.toContain('requireSiteLayoutsEnabled(event)')
    }
    for (const path of mutations) {
      const source = await readFile(resolve(root, path), 'utf8')
      const admin = source.indexOf('requireAdmin(event)')
      const enabled = source.indexOf('requireSiteLayoutsEnabled(event)')
      expect(admin).toBeGreaterThan(-1)
      expect(enabled).toBeGreaterThan(admin)
      if (source.includes('readBody(event)')) expect(source.indexOf('readBody(event)')).toBeGreaterThan(enabled)
    }

    const deletion = await readFile(resolve(root, 'server/api/site/layouts/[layoutId].delete.ts'), 'utf8')
    expect(deletion).toContain('parseLayoutRevisionQuery(getQuery(event).revision)')
    expect(deletion).toContain('deleteLayout(event, layoutId, { revision }, actorId)')
    expect(deletion).not.toContain('readBody')
  })

  it('accepts exactly one positive integer revision query value for deletion', () => {
    expect(parseLayoutRevisionQuery('1')).toBe(1)
    expect(parseLayoutRevisionQuery('42')).toBe(42)
    for (const invalid of [undefined, '', '0', '-1', '01', '1.0', '1e2', ['1'], ['1', '2'], String(Number.MAX_SAFE_INTEGER + 1)]) {
      expect(() => parseLayoutRevisionQuery(invalid)).toThrow(LayoutValidationError)
    }
  })

  it('maps validation, lookup, conflict, usage, and migration failures to typed HTTP responses', () => {
    expect(layoutHttpError(new LayoutValidationError('Invalid document'))).toMatchObject({
      statusCode: 400,
      data: { issues: [expect.objectContaining({ message: 'Invalid document' })] }
    })
    expect(layoutHttpError(new LayoutNotFoundError())).toMatchObject({ statusCode: 404 })
    expect(layoutHttpError(new LayoutNameConflictError())).toMatchObject({ statusCode: 409 })
    expect(layoutHttpError(new LayoutInUseError([{
      resourceType: 'schema',
      resourceId: 'article',
      label: 'Article Layout',
      behavior: 'use-current'
    }]))).toMatchObject({
      statusCode: 409,
      data: { usage: [expect.objectContaining({ resourceType: 'schema', resourceId: 'article' })] }
    })
    expect(layoutHttpError(new LayoutStorageUnavailableError())).toMatchObject({ statusCode: 503 })
  })
})
