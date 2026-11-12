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
import * as gate from './install-gate.mjs'

const INSTALLED_AT = '2026-10-08T21:35:07.613Z'
const LATER = '2026-10-08T22:00:00.000Z'

function plugin(overrides = {}) {
  return {
    id: 'handily-workitems@niksavis',
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
const marketplacePlugin = { id: 'handily-workitems@niksavis', version: '0.4.0' }

describe('differences', () => {
  test('two equal states have no difference', () => {
    assert.deepEqual(differences(state(plugin()), state(plugin())), [])
  })

  test('a changed version names the plugin id and the version field', () => {
    const before = state(plugin())
    const after = state(plugin({ version: '0.4.1' }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@niksavis', field: 'version' },
    ])
  })

  test('a changed enabled flag names the enabled field', () => {
    const before = state(plugin())
    const after = state(plugin({ enabled: false }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@niksavis', field: 'enabled' },
    ])
  })

  test('a new version folder in the cache names the cacheVersions field', () => {
    const before = state(plugin())
    const after = state(plugin({ cacheVersions: ['0.4.0', '0.4.1'] }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@niksavis', field: 'cacheVersions' },
    ])
  })

  test('a plugin present on one side only names the installed field', () => {
    const extra = plugin({ id: 'handily-quiet-items@niksavis' })
    assert.deepEqual(differences(state(plugin()), state(plugin(), extra)), [
      { id: 'handily-quiet-items@niksavis', field: 'installed' },
    ])
    assert.deepEqual(differences(state(plugin(), extra), state(plugin())), [
      { id: 'handily-quiet-items@niksavis', field: 'installed' },
    ])
  })

  test('a field present on one side only is a difference', () => {
    const before = state(plugin())
    const after = state(plugin({ errors: ['Dependency is disabled'] }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@niksavis', field: 'errors' },
    ])
  })

  test('a changed timestamp field is a difference when no measurement names it', () => {
    const before = state(plugin())
    const after = state(plugin({ installedAt: LATER, lastUpdated: LATER }))
    assert.deepEqual(differences(before, after), [
      { id: 'handily-workitems@niksavis', field: 'installedAt' },
      { id: 'handily-workitems@niksavis', field: 'lastUpdated' },
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
      { id: 'handily-workitems@niksavis', field: 'lastUpdated' },
    ])
  })

  test('a field outside the timestamp fields is compared even when it is named as ignored', () => {
    const before = state(plugin({ syncedAt: INSTALLED_AT }))
    const after = state(plugin({ syncedAt: LATER }))
    assert.deepEqual(differences(before, after, new Set(['syncedAt'])), [
      { id: 'handily-workitems@niksavis', field: 'syncedAt' },
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
      { id: 'handily-workitems@niksavis', field: 'version' },
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
      'handily-workitems@niksavis: cacheVersions is [] after install; expected it to include 0.4.0',
    ])
  })

  test('a cache without the plugin version names the plugin id and the cacheVersions field', () => {
    const failures = expectedStateFailures(install, state(plugin({ cacheVersions: ['0.3.0'] })), [
      marketplacePlugin,
    ])
    assert.deepEqual(failures, [
      'handily-workitems@niksavis: cacheVersions is [0.3.0] after install; expected it to include 0.4.0',
    ])
  })

  test('a cache that keeps an old version folder beside the plugin version has no failure', () => {
    const entry = plugin({ cacheVersions: ['0.3.0', '0.4.0'] })
    assert.deepEqual(expectedStateFailures(install, state(entry), [marketplacePlugin]), [])
  })

  test('a missing plugin names the installed field', () => {
    assert.deepEqual(expectedStateFailures(install, {}, [marketplacePlugin]), [
      'handily-workitems@niksavis: installed is false after install; expected true',
    ])
  })
})

describe('restoredBundleFailures', () => {
  test('a bundle without errorDetails has no failure', () => {
    const bundle = plugin({ id: 'handily@niksavis' })
    assert.deepEqual(
      restoredBundleFailures(state(bundle), 'handily@niksavis', 'handily-board@niksavis'),
      [],
    )
  })

  test('a missing bundle entry names the installed field', () => {
    assert.deepEqual(restoredBundleFailures({}, 'handily@niksavis', 'handily-board@niksavis'), [
      'handily@niksavis: installed is false after handily-board@niksavis is enabled again; expected true',
    ])
  })

  test('a bundle with errorDetails names the errorDetails field', () => {
    const bundle = plugin({ id: 'handily@niksavis', errorDetails: [] })
    assert.deepEqual(
      restoredBundleFailures(state(bundle), 'handily@niksavis', 'handily-board@niksavis'),
      ['handily@niksavis: errorDetails remain after handily-board@niksavis is enabled again'],
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

const BOARD_SHA = '8bb149378a646b04a26b3f3c9400b5f16ee28ab8'
const WORKITEMS_SHA = '1d51809d2d210c4c52581df85fe2668898a13a61'

function pinnedPlugin(name, version, sha) {
  return {
    name,
    source: {
      source: 'git-subdir',
      url: 'niksavis/handily',
      path: `mods/${name}`,
      ref: `${name}--v${version}`,
      sha,
    },
    description: `${name} description`,
  }
}

function pinnedMarketplace(...plugins) {
  return { name: 'niksavis', owner: { name: 'niksavis' }, plugins }
}

const board = pinnedPlugin('handily-board', '0.23.0', BOARD_SHA)
const workitems = pinnedPlugin('handily-workitems', '0.8.0', WORKITEMS_SHA)

function installedRecord(name, version, sha) {
  return {
    scope: 'user',
    installPath: join('cache', 'niksavis', name, version),
    version,
    installedAt: INSTALLED_AT,
    lastUpdated: INSTALLED_AT,
    gitCommitSha: sha,
  }
}

function installedPlugins(entries) {
  return { version: 2, plugins: entries }
}

function generatorRun(marketplace) {
  return {
    status: 0,
    stdout: `marketplace: 2 mod(s): handily-board, handily-workitems\n${JSON.stringify(marketplace, null, 2)}\nmarketplace: passed\n`,
    stderr: '',
  }
}

describe('localSourcePath', () => {
  test('a relative source is the folder of the mod', () => {
    assert.equal(
      gate.localSourcePath({ name: 'handily-board', source: './mods/handily-board' }),
      './mods/handily-board',
    )
  })

  test('a git-subdir source is the path of its subfolder and does not throw', () => {
    assert.equal(gate.localSourcePath(board), 'mods/handily-board')
  })
})

describe('generatedMarketplace', () => {
  test('reads the marketplace between the first and the last line of the generator output', () => {
    const marketplace = pinnedMarketplace(board, workitems)
    assert.deepEqual(gate.generatedMarketplace(generatorRun(marketplace)), {
      marketplace,
      failures: [],
    })
  })

  test('a missing release tag names the mod and prints no marketplace', () => {
    const run = {
      status: 1,
      stdout: 'marketplace: 2 mod(s): handily-board, handily-workitems\n',
      stderr:
        'FAIL handily-board: the release tag handily-board--v0.24.0 does not exist; create it with `claude plugin tag mods/handily-board`, then run `npm run marketplace -- --pin handily-board`\nmarketplace: 1 failure(s)\n',
    }
    assert.deepEqual(gate.generatedMarketplace(run), {
      failures: [
        'handily-board: the release tag handily-board--v0.24.0 does not exist; create it with `claude plugin tag mods/handily-board`, then run `npm run marketplace -- --pin handily-board`',
      ],
    })
  })

  test('a failed generator run that names no failure reports its exit code', () => {
    assert.deepEqual(gate.generatedMarketplace({ status: 2, stdout: '', stderr: 'usage' }), {
      failures: ['the marketplace generator exited 2'],
    })
  })

  test('a generator run that prints no marketplace is a failure', () => {
    const run = { status: 0, stdout: 'marketplace: passed\n', stderr: '' }
    assert.deepEqual(gate.generatedMarketplace(run), {
      failures: ['the marketplace generator printed no marketplace'],
    })
  })
})

describe('pinnedEntryFailures', () => {
  test('every mod with an entry at its release tag has no failure', () => {
    const marketplace = pinnedMarketplace(board, workitems)
    assert.deepEqual(
      gate.pinnedEntryFailures(['handily-board', 'handily-workitems'], marketplace),
      [],
    )
  })

  test('a mod with no entry is named', () => {
    assert.deepEqual(
      gate.pinnedEntryFailures(['handily-board', 'handily-workitems'], pinnedMarketplace(board)),
      ['handily-workitems: the pinned marketplace has no entry for it'],
    )
  })

  test('a mod with a relative source is named', () => {
    const relative = {
      name: 'handily-workitems',
      source: './mods/handily-workitems',
      version: '0.8.0',
    }
    assert.deepEqual(
      gate.pinnedEntryFailures(
        ['handily-board', 'handily-workitems'],
        pinnedMarketplace(board, relative),
      ),
      ['handily-workitems: the entry is not a git-subdir source with a ref and a sha'],
    )
  })

  test('a git-subdir entry with no sha is named', () => {
    const unpinned = pinnedPlugin('handily-workitems', '0.8.0', undefined)
    assert.deepEqual(
      gate.pinnedEntryFailures(
        ['handily-board', 'handily-workitems'],
        pinnedMarketplace(board, unpinned),
      ),
      ['handily-workitems: the entry is not a git-subdir source with a ref and a sha'],
    )
  })
})

describe('notInstalledLines', () => {
  test('finds the dependency warning inside an install message that reports ok', () => {
    const message =
      'Successfully installed plugin: handily-board@niksavis (scope: user). Warning: dependency "handily-workitems@niksavis" was not installed (no marketplace you have added lists it). "handily-board" will not load without it\n3 userConfig options not yet set — run /plugin configure handily-board@niksavis in Claude Code, or pass --config KEY=VALUE.'
    assert.deepEqual(gate.notInstalledLines([message, '']), [
      'Successfully installed plugin: handily-board@niksavis (scope: user). Warning: dependency "handily-workitems@niksavis" was not installed (no marketplace you have added lists it). "handily-board" will not load without it',
    ])
  })

  test('an install message with no dependency warning has no line', () => {
    const message =
      'Successfully installed plugin: handily-workitems@niksavis (scope: user)\n3 userConfig options not yet set.'
    assert.deepEqual(gate.notInstalledLines([message, '']), [])
  })

  test('finds the warning on the error output', () => {
    assert.deepEqual(
      gate.notInstalledLines(['', 'Warning: dependency "x@niksavis" was not installed\n']),
      ['Warning: dependency "x@niksavis" was not installed'],
    )
  })
})

describe('installedShaFailures', () => {
  test('each installed gitCommitSha that equals the sha of its entry has no failure', () => {
    const installed = installedPlugins({
      'handily-board@niksavis': [installedRecord('handily-board', '0.23.0', BOARD_SHA)],
      'handily-workitems@niksavis': [installedRecord('handily-workitems', '0.8.0', WORKITEMS_SHA)],
    })
    assert.deepEqual(gate.installedShaFailures(installed, pinnedMarketplace(board, workitems)), [])
  })

  test('a gitCommitSha that differs from the sha of its entry names both', () => {
    const installed = installedPlugins({
      'handily-board@niksavis': [installedRecord('handily-board', '0.24.0', WORKITEMS_SHA)],
    })
    assert.deepEqual(gate.installedShaFailures(installed, pinnedMarketplace(board)), [
      `handily-board@niksavis: gitCommitSha is ${WORKITEMS_SHA} after install; expected ${BOARD_SHA}, the sha of its entry`,
    ])
  })

  test('a plugin that is missing from installed_plugins.json is named', () => {
    const installed = installedPlugins({
      'handily-board@niksavis': [installedRecord('handily-board', '0.23.0', BOARD_SHA)],
    })
    assert.deepEqual(gate.installedShaFailures(installed, pinnedMarketplace(board, workitems)), [
      'handily-workitems@niksavis: installed is false after install; expected true',
    ])
  })

  test('a plugin with an empty install list is named', () => {
    const installed = installedPlugins({ 'handily-board@niksavis': [] })
    assert.deepEqual(gate.installedShaFailures(installed, pinnedMarketplace(board)), [
      'handily-board@niksavis: installed is false after install; expected true',
    ])
  })

  test('an installed_plugins.json with no plugins names every plugin', () => {
    assert.deepEqual(gate.installedShaFailures({}, pinnedMarketplace(board, workitems)), [
      'handily-board@niksavis: installed is false after install; expected true',
      'handily-workitems@niksavis: installed is false after install; expected true',
    ])
  })
})
