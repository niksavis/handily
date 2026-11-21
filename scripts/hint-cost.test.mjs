import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { inputTokens, median, readOptions, report } from './hint-cost.mjs'

describe('hint-cost', () => {
  test('sums the three input fields of the usage', () => {
    const stdout = JSON.stringify({
      usage: {
        input_tokens: 5,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 22340,
        output_tokens: 3,
      },
    })
    assert.equal(inputTokens(stdout), 22445)
  })

  test('reads no tokens from output that is not JSON or has no usage', () => {
    assert.equal(inputTokens('Error: not logged in'), null)
    assert.equal(inputTokens(JSON.stringify({ result: 'ok' })), null)
    assert.equal(inputTokens(JSON.stringify({ usage: { input_tokens: -1 } })), null)
  })

  test('takes the middle value of an odd and an even count', () => {
    assert.equal(median([22970, 22660, 22660]), 22660)
    assert.equal(median([1, 4, 2, 3]), 2.5)
  })

  test('prints each run, both medians and the difference', () => {
    assert.equal(
      report([22445, 22445, 22445], [22660, 22660, 22970]),
      [
        'run 1  without 22445  with 22660',
        'run 2  without 22445  with 22660',
        'run 3  without 22445  with 22970',
        'median  without 22445  with 22660',
        'the hint costs 215 input tokens',
      ].join('\n'),
    )
  })

  test('runs three times by default and refuses a count outside 1 to 9 by name', () => {
    assert.deepEqual(readOptions([]), {
      runs: 3,
      prompt: 'Answer with the word ok.',
      model: undefined,
    })
    assert.throws(
      () => readOptions(['--runs', '0']),
      /--runs takes a whole number from 1 to 9, not 0/,
    )
    assert.throws(() => readOptions(['--runs', 'two']), /not two/)
    assert.throws(() => readOptions(['--prompt', ' ']), /--prompt is empty/)
  })
})
