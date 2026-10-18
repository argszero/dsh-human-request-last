import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import plugin, { apply, name } from '../lib/index.js'

let seq = 0
/** One user message as the loop assembles it. */
function message(kind, text = kind) {
  seq += 1
  return { role: 'user', id: `m${String(seq)}`, content: [{ type: 'text', text }], source: { kind } }
}

const kinds = messages => messages.map(entry => entry.source?.kind)

/**
 * Collect every log record this composition emits.
 *
 * A logger's default threshold admits `info` (level 1) and not `warn` (level 2),
 * so observing a warning needs an exporter that says so — `levels` is keyed by
 * logger name, with `default` covering the unnamed facades this plugin uses.
 */
function collector(ctx) {
  const rows = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => rows.push(message) })
  return { rows, of: type => rows.filter(entry => entry.type === type) }
}

/** A skill-catalog-style contributor: plain push, appends in after-next. */
function skillCatalog(ctx) {
  ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    return { ...decision, messages: [...decision.messages, message('skill-catalog')] }
  })
}

/** A time-context-style contributor: prepended, appends in after-next. */
function timeContext(ctx) {
  ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    return { ...decision, messages: [...decision.messages, message('time-context')] }
  }, { prepend: true })
}

/**
 * The shipped composition: the in-tree contributors are mounted by the profile,
 * and this plugin's bundle patch `insert`s it after them (an id-less `insert`
 * pushes to the end of the entry list), so its prepended listener is outermost
 * and its after-next runs last.
 */
async function harness({ mount = 'last', config } = {}) {
  const ctx = new Context()
  const logs = collector(ctx)
  if (mount === 'first') await ctx.plugin(plugin, config)
  skillCatalog(ctx)
  timeContext(ctx)
  if (mount === 'last') await ctx.plugin(plugin, config)

  const agent = { id: 'agent-1' }
  const claimed = [message('user', 'read test.md and edit it')]
  const runtime = message('runtime-context')
  const base = () => ({ kind: 'enter', messages: [...claimed, runtime] })
  const dispatch = () => ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1, messages: claimed }, base)
  return { ctx, logs, agent, claimed, runtime, dispatch }
}

test('the control arm reproduces the report: injections trail the human message', async () => {
  const h = await harness({ mount: false })
  const decision = await h.dispatch()
  assert.deepEqual(kinds(decision.messages), ['user', 'runtime-context', 'skill-catalog', 'time-context'])
})

test('mounted after the contributors, the human message is the batch\'s last message', async () => {
  const h = await harness()
  const decision = await h.dispatch()
  assert.deepEqual(kinds(decision.messages), ['runtime-context', 'skill-catalog', 'time-context', 'user'])
  assert.equal(decision.messages.at(-1).content[0].text, 'read test.md and edit it')
  assert.deepEqual(h.logs.of('warn'), [])
})

test('mounted before the contributors, the step is still safe, only the guarantee is weaker', async () => {
  const h = await harness({ mount: 'first' })
  const decision = await h.dispatch()
  // Nothing is lost and nothing is duplicated; an outer contributor that appends
  // after this plugin's after-next keeps its own position at the tail.
  assert.deepEqual([...kinds(decision.messages)].sort(), ['runtime-context', 'skill-catalog', 'time-context', 'user'])
  assert.equal(decision.messages.length, 4)
  assert.deepEqual(h.logs.of('warn'), [])
})

test('the batch keeps identity when nothing needs to move', async () => {
  const ctx = new Context()
  await ctx.plugin(plugin)
  const human = message('user')
  const runtime = message('runtime-context')
  const batch = [runtime, human]
  const base = () => ({ kind: 'enter', messages: batch })
  const decision = await ctx.waterfall('agent/pre-step', { agent: { id: 'a' }, turn: 1, step: 1, messages: [human] }, base)
  assert.deepEqual(kinds(decision.messages), ['runtime-context', 'user'])
  // Identity, not just equality: an unchanged batch must not be copied either.
  assert.equal(decision.messages, batch)
})

test('reject decisions pass through untouched', async () => {
  const ctx = new Context()
  await ctx.plugin(plugin)
  const decision = await ctx.waterfall(
    'agent/pre-step',
    { agent: { id: 'a' }, turn: 1, step: 1, messages: [] },
    () => ({ kind: 'reject' }),
  )
  assert.deepEqual(decision, { kind: 'reject' })
})

test('report mode logs what it would do and changes nothing', async () => {
  const h = await harness({ config: { mode: 'report' } })
  const first = await h.dispatch()
  assert.deepEqual(kinds(first.messages), ['user', 'runtime-context', 'skill-catalog', 'time-context'])
  const second = await h.dispatch()
  assert.deepEqual(kinds(second.messages), ['user', 'runtime-context', 'skill-catalog', 'time-context'])
  // One line per agent per digest, not one per step.
  const said = h.logs.of('info').map(entry => entry.args[0])
  assert.equal(said.length, 1)
  assert.match(said[0], /human-request-last: would move 3 context message\(s\) ahead of 1 human message\(s\)/)
})

test('off mode installs no listener at all', async () => {
  const h = await harness({ config: { mode: 'off' } })
  const decision = await h.dispatch()
  assert.deepEqual(kinds(decision.messages), ['user', 'runtime-context', 'skill-catalog', 'time-context'])
  assert.deepEqual(h.logs.rows, [])
})

test('an unusable configuration fails the mount instead of guessing', async () => {
  const ctx = new Context()
  await assert.rejects(async () => { await ctx.plugin(plugin, { mode: 'rewrite' }) }, /mode must be "reorder", "report" or "off"/)
})

test('a message that explodes while planning leaves the step alone and warns', async () => {
  const ctx = new Context()
  const logs = collector(ctx)
  await ctx.plugin(plugin)
  const poisoned = { role: 'user', id: 'poison', content: [], get source() { throw new Error('boom') } }
  const human = message('user')
  const base = () => ({ kind: 'enter', messages: [human, poisoned] })
  const decision = await ctx.waterfall('agent/pre-step', { agent: { id: 'a' }, turn: 1, step: 1, messages: [] }, base)
  assert.equal(decision.messages.length, 2)
  assert.equal(decision.messages[0], human)
  const warned = logs.of('warn').map(entry => entry.args[0])
  assert.equal(warned.length, 1)
  assert.match(warned[0], /human-request-last: leaving this step alone: Error: boom/)
})

test('the plain-object mount spelling behaves the same as the namespace spelling', async () => {
  const namespaced = await harness()
  const plain = new Context()
  skillCatalog(plain)
  timeContext(plain)
  await plain.plugin({ name, apply })
  const claimed = [message('user')]
  const fromPlain = await plain.waterfall(
    'agent/pre-step',
    { agent: { id: 'p' }, turn: 1, step: 1, messages: claimed },
    () => ({ kind: 'enter', messages: [...claimed, message('runtime-context')] }),
  )
  const fromNamespace = await namespaced.dispatch()
  assert.deepEqual(kinds(fromPlain.messages), kinds(fromNamespace.messages))
  assert.deepEqual(kinds(fromPlain.messages), ['runtime-context', 'skill-catalog', 'time-context', 'user'])
})
