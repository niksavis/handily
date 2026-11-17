import { describe, expect, test } from 'claude-code/testing'
import { expectEngineRow, expectNoEngineRow } from './fixtures/engine-row'

describe('the engine row check', () => {
  test('passes for an engine row of ref 0 and of ref 1', () => {
    expectEngineRow({ type: 'engine', ref: 0 })
    expectEngineRow({ type: 'engine', ref: 1 })
    expectNoEngineRow({ type: 'Box', ref: 0 })
  })

  test('fails for a row of another type and for a ref that is not an integer of 0 or more', () => {
    expect(() => {
      expectEngineRow({ type: 'Box', ref: 0 })
    }).toThrow()
    expect(() => {
      expectEngineRow({ type: 'engine', ref: -1 })
    }).toThrow()
    expect(() => {
      expectEngineRow({ type: 'engine', ref: 1.5 })
    }).toThrow()
    expect(() => {
      expectEngineRow({ type: 'engine' })
    }).toThrow()
    expect(() => {
      expectNoEngineRow({ type: 'engine', ref: 1 })
    }).toThrow()
  })
})
