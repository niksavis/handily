import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  changedTimestamps,
  childEnv,
  differences,
  expectedStateFailures,
  isEntryScript,
  personalConfigPaths,
  restoredBundleFailures,
  scratchGlobalConfigFailures,
} from './install-gate.mjs'

const INSTALLED_AT = '2026-10-08T21:35:07.613Z'
const LATER = '2026-10-08T22:00:00.000Z'

function plugin(overrides = {}) {
  return {
    id: 'handily-workitems@handily',
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

const install = { name: 'install', enabled: true }
const marketplacePlugin = { id: 'handily-workitems@handily', version: '0.4.0' }

describe('differences', () => {
  test('two equal states have no difference', () => {
    assert.deepEqual(differences(state(plugin()), state(plugin())), [])
  })

  test('a changed version names the plugin id and the version field', () => {
    const before = state(plugin())
    const after = state(plugin({ version: '0.4.1' }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@handily', field: 'version' },
    ])
  })

  test('a changed enabled flag names the enabled field', () => {
    const before = state(plugin())
    const after = state(plugin({ enabled: false }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@handily', field: 'enabled' },
    ])
  })

  test('a new version folder in the cache names the cacheVersions field', () => {
    const before = state(plugin())
    const after = state(plugin({ cacheVersions: ['0.4.0', '0.4.1'] }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@handily', field: 'cacheVersions' },
    ])
  })

  test('a plugin present on one side only names the installed field', () => {
    const extra = plugin({ id: 'handily-quiet-items@handily' })
    assert.deepEqual(differences(state(plugin()), state(plugin(), extra)), [
      { id: 'handily-quiet-items@handily', field: 'installed' },
    ])
    assert.deepEqual(differences(state(plugin(), extra), state(plugin())), [
      { id: 'handily-quiet-items@handily', field: 'installed' },
    ])
  })

  test('a field present on one side only is a difference', () => {
    const before = state(plugin())
    const after = state(plugin({ errors: ['Dependency is disabled'] }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@handily', field: 'errors' },
    ])
  })

  test('a changed timestamp field is a difference when no measurement names it', () => {
    const before = state(plugin())
    const after = state(plugin({ installedAt: LATER, lastUpdated: LATER }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@handily', field: 'installedAt' },
      { id: 'handily-workitems@handily', field: 'lastUpdated' },
    ])
  })

  test('a changed timestamp field is ignored when the measurement names it', () => {
    const before = state(plugin())
    const after = state(plugin({ installedAt: LATER, lastUpdated: LATER }))
    assert.deepEqual(differences(before, after, new Set(['installedAt', 'lastUpdated'])), [])
  })

  test('a measured timestamp field that holds no timestamp is compared', () => {
    const before = state(plugin())
    const after = state(plugin({ lastUpdated: 'never' }))
    assert.deepEqual(differences(before, after, new Set(['lastUpdated'])), [
      { id: 'handily-workitems@handily', field: 'lastUpdated' },
    ])
  })

  test('a field outside the timestamp fields is compared even when it is named as ignored', () => {
    const before = state(plugin({ syncedAt: INSTALLED_AT }))
    const after = state(plugin({ syncedAt: LATER }))
    assert.deepEqual(differences(before, after, new Set(['syncedAt'])), [
      { id: 'handily-workitems@handily', field: 'syncedAt' },
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

  test('names no field when a timestamp field changed to a value that is no timestamp', () => {
    const before = state(plugin())
    const after = state(plugin({ lastUpdated: 'never' }))
    assert.deepEqual(changedTimestamps(before, after), [])
  })

  test('the measured fields are exactly the timestamps that the comparison then ignores', () => {
    const before = state(plugin())
    const after = state(plugin({ lastUpdated: LATER, version: '0.4.1' }))
    const measured = new Set(changedTimestamps(before, after))
    assert.deepEqual(differences(before, after, measured), [
      { id: 'handily-workitems@handily', field: 'version' },
    ])
  })
})

describe('expectedStateFailures', () => {
  test('an installed plugin with its version in the cache has no failure', () => {
    assert.deepEqual(expectedStateFailures(install, state(plugin()), [marketplacePlugin]), [])
  })

  test('an empty cache version list names the plugin id and the cacheVersions field', () => {
    const failures = expectedStateFailures(install, state(plugin({ cacheVersions: [] })), [
      marketplacePlugin,
    ])
    assert.deepEqual(failures, [
      'handily-workitems@handily: cacheVersions is [] after install; expected it to include 0.4.0',
    ])
  })

  test('a cache without the plugin version names the plugin id and the cacheVersions field', () => {
    const failures = expectedStateFailures(install, state(plugin({ cacheVersions: ['0.3.0'] })), [
      marketplacePlugin,
    ])
    assert.deepEqual(failures, [
      'handily-workitems@handily: cacheVersions is [0.3.0] after install; expected it to include 0.4.0',
    ])
  })

  test('a cache that keeps an old version folder beside the plugin version has no failure', () => {
    const entry = plugin({ cacheVersions: ['0.3.0', '0.4.0'] })
    assert.deepEqual(expectedStateFailures(install, state(entry), [marketplacePlugin]), [])
  })

  test('a missing plugin names the installed field', () => {
    assert.deepEqual(expectedStateFailures(install, {}, [marketplacePlugin]), [
      'handily-workitems@handily: installed is false after install; expected true',
    ])
  })
})

describe('restoredBundleFailures', () => {
  test('a bundle without errorDetails has no failure', () => {
    const bundle = plugin({ id: 'handily@handily' })
    assert.deepEqual(
      restoredBundleFailures(state(bundle), 'handily@handily', 'handily-agent-board@handily'),
      [],
    )
  })

  test('a missing bundle entry names the installed field', () => {
    assert.deepEqual(restoredBundleFailures({}, 'handily@handily', 'handily-agent-board@handily'), [
      'handily@handily: installed is false after handily-agent-board@handily is enabled again; expected true',
    ])
  })

  test('a bundle with errorDetails names the errorDetails field', () => {
    const bundle = plugin({ id: 'handily@handily', errorDetails: [] })
    assert.deepEqual(
      restoredBundleFailures(state(bundle), 'handily@handily', 'handily-agent-board@handily'),
      ['handily@handily: errorDetails remain after handily-agent-board@handily is enabled again'],
    )
  })
})

describe('personalConfigPaths', () => {
  const home = join('home', 'person')

  test('without CLAUDE_CONFIG_DIR it watches the config files in the home folder', () => {
    assert.deepEqual(personalConfigPaths({}, home), [
      join(home, '.claude', 'settings.json'),
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      join(home, '.claude', 'plugins', 'known_marketplaces.json'),
    ])
  })

  test('with CLAUDE_CONFIG_DIR it watches the config files in that folder', () => {
    const dir = join('elsewhere', 'claude')
    assert.deepEqual(personalConfigPaths({ CLAUDE_CONFIG_DIR: dir }, home), [
      join(dir, 'settings.json'),
      join(dir, 'plugins', 'installed_plugins.json'),
      join(dir, 'plugins', 'known_marketplaces.json'),
    ])
  })
})

describe('scratchGlobalConfigFailures', () => {
  test('a scratch config folder without a global config file is a failure', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'install-gate-config-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    assert.deepEqual(scratchGlobalConfigFailures(dir), [
      "claude wrote no .claude.json into the scratch config folder; it may have written the person's global config instead",
    ])
  })

  test('a scratch config folder with a global config file has no failure', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'install-gate-config-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, '.claude.json'), '{}')
    assert.deepEqual(scratchGlobalConfigFailures(dir), [])
  })
})

describe('childEnv', () => {
  test('drops every variable that a parent Claude session sets and points at the scratch config', () => {
    const parent = {
      PATH: 'bin',
      HOME: 'home',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'session',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_PLUGIN_DATA: 'data',
      CLAUDE_PLUGIN_ROOT: 'root',
      CLAUDE_CONFIG_DIR: 'personal',
      ANTHROPIC_API_KEY: 'key',
    }
    assert.deepEqual(childEnv(parent, 'scratch'), {
      PATH: 'bin',
      HOME: 'home',
      CLAUDE_CONFIG_DIR: 'scratch',
      ANTHROPIC_API_KEY: '',
    })
  })
})

describe('isEntryScript', () => {
  test('is true when the script is reached through a symlink', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'install-gate-entry-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const script = join(dir, 'gate.mjs')
    const link = join(dir, 'gate-link.mjs')
    writeFileSync(script, '')
    symlinkSync(script, link)
    assert.equal(isEntryScript(link, pathToFileURL(script).href), true)
  })

  test('is true when the script is run by its own path', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'install-gate-entry-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const script = join(dir, 'gate.mjs')
    writeFileSync(script, '')
    assert.equal(isEntryScript(script, pathToFileURL(script).href), true)
  })

  test('is false when another script is the entry', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'install-gate-entry-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const script = join(dir, 'gate.mjs')
    const other = join(dir, 'other.test.mjs')
    writeFileSync(script, '')
    writeFileSync(other, '')
    assert.equal(isEntryScript(other, pathToFileURL(script).href), false)
  })

  test('is false when node runs without an entry script', () => {
    assert.equal(isEntryScript(undefined, import.meta.url), false)
  })
})
