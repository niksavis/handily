import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { environmentWithoutGit } from './git-env.mjs'
import { createScratchFolder, removeScratchFolder } from './scratch.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const hooksSource = join(root, 'mods', 'handily-reply-view', 'hooks')
const usage = 'usage: npm run hint-cost -- [--runs N] [--prompt TEXT] [--model NAME]'
const defaultRuns = 3
const defaultPrompt = 'Answer with the word ok.'
const usageFields = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']

const passRegister = [
  "import type { Register } from 'claude-code'",
  '',
  'export const register: Register = (on) => {',
  "  on('prompt.submit', async (_$, e, next) => next(e))",
  '}',
  '',
].join('\n')

const hintRegister = [
  "import type { Register } from 'claude-code'",
  "import { DIAGRAM_HINT } from './hint'",
  '',
  'export const register: Register = (on) => {',
  "  on('prompt.submit', async (_$, e, next) =>",
  '    next({ ...e, context: [...(e.context ?? []), DIAGRAM_HINT] }),',
  '  )',
  '}',
  '',
].join('\n')

export function inputTokens(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  const usageOf = parsed?.usage
  if (typeof usageOf !== 'object' || usageOf === null) return null
  let total = 0
  for (const field of usageFields) {
    const value = usageOf[field]
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < 0) return null
    total += value
  }
  return total
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function report(without, withHint) {
  const rows = without.map(
    (tokens, at) =>
      `run ${String(at + 1)}  without ${String(tokens)}  with ${String(withHint[at])}`,
  )
  const cost = median(withHint) - median(without)
  return [
    ...rows,
    `median  without ${String(median(without))}  with ${String(median(withHint))}`,
    `the hint costs ${String(cost)} input tokens`,
  ].join('\n')
}

export function readOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      runs: { type: 'string' },
      prompt: { type: 'string' },
      model: { type: 'string' },
    },
  })
  const runs = values.runs === undefined ? defaultRuns : Number(values.runs)
  if (!Number.isInteger(runs) || runs < 1 || runs > 9) {
    throw new Error(
      `hint-cost: --runs takes a whole number from 1 to 9, not ${String(values.runs)}; ${usage}`,
    )
  }
  const prompt = values.prompt ?? defaultPrompt
  if (prompt.trim() === '') throw new Error(`hint-cost: --prompt is empty; ${usage}`)
  return { runs, prompt, model: values.model }
}

function writeProbe(folder, register) {
  const hooks = join(folder, 'hooks')
  mkdirSync(join(folder, '.claude-plugin'), { recursive: true })
  mkdirSync(hooks, { recursive: true })
  for (const name of readdirSync(hooksSource)) {
    if (name.endsWith('.ts') && name !== 'register.ts')
      copyFileSync(join(hooksSource, name), join(hooks, name))
  }
  writeFileSync(join(hooks, 'register.ts'), register)
  writeFileSync(join(hooks, 'hooks.json'), '{ "modules": ["./register.ts"] }\n')
  writeFileSync(
    join(folder, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ name: 'hint-cost-probe', version: '0.0.0', author: { name: 'niksavis' } })}\n`,
  )
}

function measure(probe, workdir, { prompt, model }) {
  const args = ['-p', prompt, '--output-format', 'json', '--plugin-dir', probe]
  if (model !== undefined) args.push('--model', model)
  const run = spawnSync('claude', args, {
    cwd: workdir,
    env: environmentWithoutGit,
    encoding: 'utf8',
    timeout: 180000,
  })
  const tokens = run.status === 0 ? inputTokens(run.stdout) : null
  if (tokens === null) {
    throw new Error(
      `hint-cost: claude -p ended with exit ${String(run.status)} and no usage; run claude -p ${JSON.stringify(prompt)} --output-format json to see why`,
    )
  }
  return tokens
}

function main() {
  const options = readOptions(process.argv.slice(2))
  const scratch = createScratchFolder('hint-cost-')
  try {
    const without = join(scratch, 'without')
    const withHint = join(scratch, 'with')
    const workdir = join(scratch, 'work')
    mkdirSync(workdir)
    writeProbe(without, passRegister)
    writeProbe(withHint, hintRegister)
    const plain = []
    const hinted = []
    for (let at = 0; at < options.runs; at += 1) {
      plain.push(measure(without, workdir, options))
      hinted.push(measure(withHint, workdir, options))
    }
    console.log(report(plain, hinted))
  } finally {
    const problem = removeScratchFolder(scratch)
    if (problem !== undefined) console.error(`hint-cost: ${problem}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
