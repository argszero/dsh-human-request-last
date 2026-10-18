#!/usr/bin/env node
/**
 * Mutation harness: every arm is a real defect this plugin could plausibly ship,
 * applied to a scratch copy of `src/`, rebuilt with `--noEmitOnError`, and run
 * against the suite. An arm the suite still passes is SILENT — a test that does
 * not test what it claims.
 *
 * Usage: npm run test:inject
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = join(root, '.mutants')

/** Each arm: a named defect and the text it rewrites. */
const ARMS = [
  {
    name: 'default mode becomes report instead of reorder',
    file: 'src/config.ts',
    from: "const mode = config.mode ?? 'reorder'",
    to: "const mode = config.mode ?? 'report'",
  },
  {
    name: 'unknown mode is accepted silently',
    file: 'src/config.ts',
    from: "if (mode !== 'reorder' && mode !== 'report' && mode !== 'off') {",
    to: 'if (false) {',
  },
  {
    name: 'humanKinds config is ignored (always the default)',
    file: 'src/config.ts',
    from: 'const humanKinds = Array.isArray(config.humanKinds) ? names(config.humanKinds) : DEFAULT_HUMAN_KINDS',
    to: 'const humanKinds = DEFAULT_HUMAN_KINDS',
  },
  {
    name: 'dropKinds config is ignored',
    file: 'src/config.ts',
    from: 'dropKinds: names(config.dropKinds),',
    to: 'dropKinds: [],',
  },
  {
    name: 'dropKinds also removes the human message',
    file: 'src/plan.ts',
    from: "!settings.humanKinds.includes(kind)) {",
    to: 'true) {',
  },
  {
    name: 'the reorder puts the human message first',
    file: 'src/plan.ts',
    from: 'const candidate = [...context, ...humans]',
    to: 'const candidate = [...humans, ...context]',
  },
  {
    name: 'anything that is not a human message is treated as one',
    file: 'src/plan.ts',
    from: 'else context.push(message)',
    to: 'else humans.push(message)',
  },
  {
    name: 'a batch whose order already matches is still rebuilt',
    file: 'src/plan.ts',
    from: 'if (!sameOrder(kept, candidate)) {',
    to: 'if (true) {',
  },
  {
    name: 'every batch reports a change',
    file: 'src/plan.ts',
    from: 'const changed = dropped > 0 || moved > 0',
    to: 'const changed = true',
  },
  {
    name: 'every message is classified as the human message',
    file: 'src/plan.ts',
    from: "return typeof source?.kind === 'string' ? source.kind : undefined",
    to: "return typeof source?.kind === 'string' ? 'user' : undefined",
  },
  {
    name: 'off mode still installs the listener',
    file: 'src/index.ts',
    from: "if (settings.mode === 'off') return",
    to: 'void 0',
  },
  {
    name: 'report mode injects anyway',
    file: 'src/index.ts',
    from: "        return decision\n      }\n      return { ...decision, messages: [...plan.messages] }",
    to: '      }\n      return { ...decision, messages: [...plan.messages] }',
  },
  {
    name: 'the listener is not prepended, so later appends win',
    file: 'src/index.ts',
    from: '}, { prepend: true })',
    to: '})',
  },
  {
    name: 'a planning failure is thrown instead of contained',
    file: 'src/index.ts',
    from: '      loggerOf(ctx)?.warn?.(`${LOG_PREFIX} leaving this step alone: ${String(error)}`)\n      return decision',
    to: '      throw error',
  },
  {
    name: 'report mode repeats its line on every step',
    file: 'src/index.ts',
    from: 'if (agent === undefined || reported.get(agent) !== digest) {',
    to: 'if (true) {',
  },
  {
    name: 'an unchanged batch is returned as a fresh array',
    file: 'src/index.ts',
    from: '      if (!plan.changed) return decision',
    to: '      if (false) return decision',
  },
]

/** Copy the sources, node_modules aside, into the scratch tree. */
function prepare() {
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  for (const entry of ['src', 'test', 'package.json', 'tsconfig.json']) {
    cpSync(join(root, entry), join(scratch, entry), { recursive: true })
  }
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir')
}

/** Build the scratch tree; returns the compiler's failure text, or undefined. */
function build() {
  const result = spawnSync(join(root, 'node_modules', '.bin', 'tsc'), ['--noEmitOnError'], {
    cwd: scratch,
    encoding: 'utf8',
  })
  return result.status === 0 ? undefined : (result.stdout + result.stderr).trim()
}

/** Run the suite; returns true when every test passed. */
function suite() {
  const result = spawnSync(process.execPath, ['--test', 'test/*.spec.mjs'], { cwd: scratch, encoding: 'utf8' })
  return result.status === 0
}

prepare()
const baseline = build()
if (baseline !== undefined) {
  console.error('baseline does not build:\n' + baseline)
  process.exit(1)
}
if (!suite()) {
  console.error('baseline suite fails; a mutation result would be meaningless')
  process.exit(1)
}
console.log('baseline: build green, suite green')

let silent = 0
let unbuildable = 0
for (const arm of ARMS) {
  prepare()
  const path = join(scratch, arm.file)
  const before = readFileSync(path, 'utf8')
  if (!before.includes(arm.from)) {
    console.error(`UNBUILDABLE  ${arm.name} — the arm's text is not in ${arm.file}`)
    unbuildable += 1
    continue
  }
  writeFileSync(path, before.replace(arm.from, arm.to))
  const failure = build()
  if (failure !== undefined) {
    // A mutation that cannot compile proves nothing about the tests.
    console.error(`UNBUILDABLE  ${arm.name}\n${failure}`)
    unbuildable += 1
    continue
  }
  if (suite()) {
    console.error(`SILENT       ${arm.name} — the suite passed a real defect`)
    silent += 1
    continue
  }
  console.log(`CAUGHT       ${arm.name}`)
}

rmSync(scratch, { recursive: true, force: true })
console.log(`\n${String(ARMS.length)} arm(s): ${String(ARMS.length - silent - unbuildable)} CAUGHT, ${String(silent)} SILENT, ${String(unbuildable)} UNBUILDABLE`)
if (silent > 0 || unbuildable > 0) process.exit(1)
