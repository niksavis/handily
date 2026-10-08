import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { changedTimestamps, differences } from './install-gate.mjs'

const INSTALLED_AT = '2026-10-08T21:35:07.613Z'
const LATER = '2026-10-08T22:00:00.000Z'

function plugin(overrides = {}) {
  return {
    id: 'workitems@handily',
    version: '0.4.0',
    enabled: true,
    installedAt: INSTALLED_AT,
    lastUpdated: INSTALLED_AT,
    cacheVersions: ['0.4.0'],
    ...overrides,
  }
}

function state(...entries) {
  return Object.fromEntries(entries.map((entry) => [entry.id, entry]))
}

describe('differences', () => {
  test('two equal states have no difference', () => {
    assert.deepEqual(differences(state(plugin()), state(plugin())), [])
  })

  test('a changed version names the plugin id and the version field', () => {
    const before = state(plugin())
    const after = state(plugin({ version: '0.4.1' }))
    assert.deepEqual(differences(before, after), [{ id: 'workitems@handily', field: 'version' }])
  })

  test('a changed enabled flag names the enabled field', () => {
    const before = state(plugin())
    const after = state(plugin({ enabled: false }))
    assert.deepEqual(differences(before, after), [{ id: 'workitems@handily', field: 'enabled' }])
  })

  test('a new version folder in the cache names the cacheVersions field', () => {
    const before = state(plugin())
    const after = state(plugin({ cacheVersions: ['0.4.0', '0.4.1'] }))
    assert.deepEqual(differences(before, after), [
      { id: 'workitems@handily', field: 'cacheVersions' },
    ])
  })

  test('a plugin present on one side only names the installed field', () => {
    const extra = plugin({ id: 'quiet-items@handily' })
    assert.deepEqual(differences(state(plugin()), state(plugin(), extra)), [
      { id: 'quiet-items@handily', field: 'installed' },
    ])
    assert.deepEqual(differences(state(plugin(), extra), state(plugin())), [
      { id: 'quiet-items@handily', field: 'installed' },
    ])
  })

  test('a field present on one side only is a difference', () => {
    const before = state(plugin())
    const after = state(plugin({ errors: ['Dependency is disabled'] }))
    assert.deepEqual(differences(before, after), [{ id: 'workitems@handily', field: 'errors' }])
  })

  test('a changed timestamp field is ignored', () => {
    const before = state(plugin())
    const after = state(plugin({ installedAt: LATER, lastUpdated: LATER }))
    assert.deepEqual(differences(before, after), [])
  })

  test('a timestamp field that holds no timestamp is compared', () => {
    const before = state(plugin())
    const after = state(plugin({ lastUpdated: 'never' }))
    assert.deepEqual(differences(before, after), [
      { id: 'workitems@handily', field: 'lastUpdated' },
    ])
  })

  test('a field outside the ignored set is compared even when it holds a timestamp', () => {
    const before = state(plugin({ syncedAt: INSTALLED_AT }))
    const after = state(plugin({ syncedAt: LATER }))
    assert.deepEqual(differences(before, after), [{ id: 'workitems@handily', field: 'syncedAt' }])
  })

  test('an empty ignored set compares the timestamp fields too', () => {
    const before = state(plugin())
    const after = state(plugin({ lastUpdated: LATER }))
    assert.deepEqual(differences(before, after, new Set()), [
      { id: 'workitems@handily', field: 'lastUpdated' },
    ])
  })
})

describe('changedTimestamps', () => {
  test('names each timestamp field that changed', () => {
    const before = state(plugin())
    const after = state(plugin({ lastUpdated: LATER }))
    assert.deepEqual(changedTimestamps(before, after), ['lastUpdated'])
  })

  test('names no field when no timestamp changed', () => {
    assert.deepEqual(changedTimestamps(state(plugin()), state(plugin())), [])
  })
})
