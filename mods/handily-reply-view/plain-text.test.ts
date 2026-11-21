import { describe, expect, test } from 'claude-code/testing'
import { RULE_SAMPLES } from './fixtures/plain-text'
import { structuredMarkdown } from './hooks/plain-text'

function sample(rule: string): string {
  const found = RULE_SAMPLES.find((one) => one.rule === rule)
  if (found === undefined) throw new Error(`no sample for ${rule}`)
  return found.text
}

function structured(rule: string): string | null {
  return structuredMarkdown(sample(rule).split('\n'))
}

describe('plain text in the message tab', () => {
  test('a message with markdown goes to the reply parser as written', () => {
    expect(structured('markdown')).toBe(sample('markdown'))
  })

  test('a message whose lines look like a log stays verbatim', () => {
    expect(structured('log')).toBeNull()
  })

  test('each line of the message stays its own paragraph', () => {
    expect(structured('lines')).toBe('The next window opens at 16:00 UTC.\n\nAsk before you push.')
  })

  test('a sentence that starts a new instruction starts a new paragraph', () => {
    expect(structured('groups')).toBe('The build passed.\n\nThen push main and wait for CI.')
  })

  test('inline numbered items become a numbered list under their bold lead', () => {
    expect(structured('items')).toBe(
      '**Ask the owner:**\n\n1. a screenshot of the rows\n2. which session it was.',
    )
  })

  test('a short label with a colon draws bold', () => {
    expect(structured('label')).toBe('**Cause:** seven test files had no stored time.')
  })

  test('a sentence that says stop or never draws in a warning container', () => {
    expect(structured('warning')).toBe(
      '> [!WARNING]\n> **On any red run:** stop and report; never move a pushed tag.',
    )
  })

  test('a recommendation draws in a note container', () => {
    expect(structured('note')).toBe('> [!NOTE]\n> **Recommended:** go on the whole sequence.')
  })

  test('record ids, tags and commits draw as code and a URL as a link', () => {
    expect(structured('tokens')).toBe(
      'Tag `handily-reply-view--v0.30.0` on `ba5a82b` closes `handily-15iquz`, see [https://example.com/run/1](https://example.com/run/1).',
    )
  })

  test('a markdown mark in plain text is escaped and stays text', () => {
    expect(structured('escapes')).toBe('Keep \\*stars\\*, \\_lines\\_ and a \\# mark as text.')
  })

  test('an empty message draws as it is', () => {
    expect(structuredMarkdown(['', ' '])).toBeNull()
  })
})
