import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { removeScratchFolder } from './scratch.mjs'

function scratchFolders(t) {
  const root = mkdtempSync(join(tmpdir(), 'install-gate-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'install-gate-outside-'))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })
  writeFileSync(join(outside, 'kept.txt'), 'kept')
  return { root, outside }
}

describe('removeScratchFolder', () => {
  test('removes a folder that this run created under the temporary root', (t) => {
    const { root } = scratchFolders(t)
    const scratch = join(root, 'scratch')
    mkdirSync(scratch)
    const created = new Set([scratch])
    assert.equal(removeScratchFolder(scratch, { temporaryRoot: root, created }), undefined)
    assert.equal(existsSync(scratch), false)
  })

  test('refuses a folder outside the temporary root, names both and removes nothing', (t) => {
    const { root, outside } = scratchFolders(t)
    const created = new Set([outside])
    assert.equal(
      removeScratchFolder(outside, { temporaryRoot: root, created }),
      `the scratch folder ${outside} is not under the temporary root ${root}; the gate did not remove it`,
    )
    assert.equal(existsSync(join(outside, 'kept.txt')), true)
  })

  test('refuses a folder under the temporary root that this run did not create and removes nothing', (t) => {
    const { root } = scratchFolders(t)
    const scratch = join(root, 'scratch')
    mkdirSync(scratch)
    writeFileSync(join(scratch, 'kept.txt'), 'kept')
    assert.equal(
      removeScratchFolder(scratch, { temporaryRoot: root, created: new Set() }),
      `the scratch folder ${scratch} was not created by this run of the gate; the gate did not remove it`,
    )
    assert.equal(existsSync(join(scratch, 'kept.txt')), true)
  })

  test('refuses the temporary root itself and removes nothing', (t) => {
    const { root } = scratchFolders(t)
    writeFileSync(join(root, 'kept.txt'), 'kept')
    const created = new Set([root])
    assert.equal(
      removeScratchFolder(root, { temporaryRoot: root, created }),
      `the scratch folder ${root} is not under the temporary root ${root}; the gate did not remove it`,
    )
    assert.equal(existsSync(join(root, 'kept.txt')), true)
  })

  test('refuses a link under the temporary root that resolves outside it and removes nothing', (t) => {
    const { root, outside } = scratchFolders(t)
    const link = join(root, 'link')
    symlinkSync(outside, link)
    const created = new Set([link])
    assert.equal(
      removeScratchFolder(link, { temporaryRoot: root, created }),
      `the scratch folder ${link} is not under the temporary root ${root}; the gate did not remove it`,
    )
    assert.equal(existsSync(join(outside, 'kept.txt')), true)
  })

  test('refuses a sibling folder whose name starts with the name of the temporary root', (t) => {
    const { root } = scratchFolders(t)
    const sibling = `${root}-evil`
    mkdirSync(sibling)
    t.after(() => rmSync(sibling, { recursive: true, force: true }))
    writeFileSync(join(sibling, 'kept.txt'), 'kept')
    const created = new Set([sibling])
    assert.equal(
      removeScratchFolder(sibling, { temporaryRoot: root, created }),
      `the scratch folder ${sibling} is not under the temporary root ${root}; the gate did not remove it`,
    )
    assert.equal(existsSync(join(sibling, 'kept.txt')), true)
  })
})
