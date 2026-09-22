import { describe, expect, it } from 'vitest'
import { validateContentJson } from '../server/cms/content-validation'

const jsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    score: { type: 'number' }
  },
  required: ['title'],
  additionalProperties: false
}

describe('validateContentJson', () => {
  it('returns valid content', () => {
    expect(validateContentJson(jsonSchema, { title: 'Hello', score: 1 })).toEqual({
      title: 'Hello',
      score: 1
    })
  })

  it('rejects invalid content', () => {
    expect(() => validateContentJson(jsonSchema, { score: 1 })).toThrow('Invalid content')
  })
})
