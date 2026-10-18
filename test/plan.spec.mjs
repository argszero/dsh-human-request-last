import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_HUMAN_KINDS, normalizeConfig } from '../lib/config.js'
import { kindOf, planMessages } from '../lib/plan.js'

let seq = 0
/** One user message as the loop assembles it; `kind` undefined models a source-less one. */
function message(kind, text = kind ?? 'none') {
  seq += 1
  const base = { role: 'user', id: `m${String(seq)}`, content: [{ type: 'text', text }] }
  return kind === undefined ? base : { ...base, source: { kind } }
}

const kinds = messages => messages.map(kindOf)

test('moves injected context ahead of the human message', () => {
  const human = message('user')
  const runtime = message('runtime-context')
  const skill = message('skill-catalog')
  const time = message('time-context')
  const plan = planMessages([human, runtime, skill, time], normalizeConfig())
  assert.deepEqual(plan.messages, [runtime, skill, time, human])
  assert.deepEqual(kinds(plan.messages), ['runtime-context', 'skill-catalog', 'time-context', 'user'])
  assert.equal(plan.changed, true)
  assert.equal(plan.moved, 3)
  assert.equal(plan.dropped, 0)
  assert.match(plan.describe, /move 3 context message\(s\) ahead of 1 human message\(s\)/)
})

test('returns the very same batch when the human message is already last', () => {
  const messages = [message('runtime-context'), message('time-context'), message('user')]
  const plan = planMessages(messages, normalizeConfig())
  assert.equal(plan.changed, false)
  assert.equal(plan.messages, messages)
  assert.equal(plan.describe, 'nothing to change')
})

test('leaves a step with no human message alone', () => {
  const messages = [message('runtime-context'), message('skill-catalog')]
  const plan = planMessages(messages, normalizeConfig())
  assert.equal(plan.changed, false)
  assert.equal(plan.messages, messages)
})

test('leaves a step with no injected message alone', () => {
  const messages = [message('user')]
  const plan = planMessages(messages, normalizeConfig())
  assert.equal(plan.changed, false)
  assert.equal(plan.messages, messages)
})

test('keeps the relative order inside each group', () => {
  const first = message('user', 'first')
  const second = message('user', 'second')
  const runtime = message('runtime-context')
  const time = message('time-context')
  const plan = planMessages([first, runtime, second, time], normalizeConfig())
  assert.deepEqual(plan.messages, [runtime, time, first, second])
  assert.deepEqual(plan.messages.map(entry => entry.content[0].text), [
    'runtime-context', 'time-context', 'first', 'second',
  ])
})

test('a source-less message counts as context, never as the request', () => {
  const human = message('user')
  const orphan = message(undefined, 'no source')
  const plan = planMessages([human, orphan], normalizeConfig())
  assert.deepEqual(plan.messages, [orphan, human])
})

test('dropKinds removes injected kinds', () => {
  const human = message('user')
  const time = message('time-context')
  const skill = message('skill-catalog')
  const plan = planMessages([human, time, skill], normalizeConfig({ dropKinds: ['time-context'] }))
  assert.deepEqual(plan.messages, [skill, human])
  assert.equal(plan.dropped, 1)
  assert.equal(plan.changed, true)
})

test('dropKinds never removes a human message', () => {
  const human = message('user')
  const time = message('time-context')
  const plan = planMessages([human, time], normalizeConfig({ dropKinds: ['user', 'time-context'] }))
  assert.deepEqual(plan.messages, [human])
  assert.equal(plan.dropped, 1)
})

test('dropKinds alone reports a change without moving anything', () => {
  const human = message('user')
  const time = message('time-context')
  const plan = planMessages([time, human], normalizeConfig({ dropKinds: ['time-context'] }))
  assert.deepEqual(plan.messages, [human])
  assert.equal(plan.dropped, 1)
  assert.equal(plan.moved, 0)
  assert.match(plan.describe, /drop 1 injected message\(s\)/)
})

test('humanKinds widens which kinds count as the request', () => {
  const human = message('user')
  const relay = message('agent')
  const time = message('time-context')
  const plan = planMessages([human, relay, time], normalizeConfig({ humanKinds: ['user', 'agent'] }))
  assert.deepEqual(plan.messages, [time, human, relay])
})

test('an explicit empty humanKinds list means nothing is the request', () => {
  assert.deepEqual(normalizeConfig({ humanKinds: [] }).humanKinds, [])
  const human = message('user')
  const time = message('time-context')
  assert.equal(planMessages([human, time], normalizeConfig({ humanKinds: [] })).changed, false)
})

test('normalizeConfig defaults are the useful thing', () => {
  const settings = normalizeConfig()
  assert.equal(settings.mode, 'reorder')
  assert.deepEqual(settings.humanKinds, DEFAULT_HUMAN_KINDS)
  assert.deepEqual(settings.dropKinds, [])
})

test('normalizeConfig refuses an unknown mode instead of guessing', () => {
  assert.throws(() => normalizeConfig({ mode: 'rewrite' }), /mode must be "reorder", "report" or "off"/)
})

test('normalizeConfig trims, de-duplicates and ignores non-strings', () => {
  const settings = normalizeConfig({ humanKinds: [' user ', 'user', 7, ''], dropKinds: [' time-context '] })
  assert.deepEqual(settings.humanKinds, ['user'])
  assert.deepEqual(settings.dropKinds, ['time-context'])
})
