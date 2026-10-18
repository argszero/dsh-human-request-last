/**
 * The pure planning half: given the batch a step proposes, decide what the step
 * should carry instead.
 *
 * Kept apart from the listener so every rule can be tested without a context, a
 * session or a model: the listener's only job is to call this and hand back the
 * result.
 *
 * @module @argszero/dsh-human-request-last/plan
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Settings } from './config.js'

/** What one step's batch should become. */
export interface Plan {
  /** The messages the step should carry; the input array itself when nothing changes. */
  messages: readonly UserMessage[]
  /** Whether {@link Plan.messages} differs from the input array. */
  changed: boolean
  /** How many messages {@link Settings.dropKinds} removed. */
  dropped: number
  /** How many context messages were moved ahead of the human's words. */
  moved: number
  /** One-line description of the change, for `report` mode. */
  describe: string
}

/** The source kind of one message, when it declares a readable one. */
export function kindOf(message: UserMessage): string | undefined {
  const source = (message as { source?: { kind?: unknown } }).source
  return typeof source?.kind === 'string' ? source.kind : undefined
}

/**
 * Whether two batches carry the same messages in the same order.
 * @param left - one batch.
 * @param right - another batch of the same length.
 * @returns true when every position holds the same object.
 */
function sameOrder(left: readonly UserMessage[], right: readonly UserMessage[]): boolean {
  if (left.length !== right.length) return false
  return left.every((message, index) => message === right[index])
}

/**
 * Plan one step's batch.
 *
 * The rule the plugin exists for: a human's words are the step's *request*, and
 * whatever the harness injected around them is context about that request. Small
 * local models take the last `user`-role message as the request (discussion
 * #10080), so a trailing `time-context` or `skill-catalog` snapshot becomes the
 * thing they answer. The plan therefore moves every injected message ahead of
 * every human message, keeping each group's own order.
 *
 * Nothing is moved when the step has no human message (a wake or continuation
 * step, where the injections *are* the input) or no injected message (nothing to
 * move).
 *
 * @param messages - the batch the waterfall produced.
 * @param settings - the resolved configuration.
 * @returns the batch to use, and what changed.
 */
export function planMessages(messages: readonly UserMessage[], settings: Settings): Plan {
  const humans: UserMessage[] = []
  const context: UserMessage[] = []
  const kept: UserMessage[] = []
  let dropped = 0

  for (const message of messages) {
    const kind = kindOf(message)
    // A human message is never dropped, whatever the drop list says: the drop half
    // exists to silence injected material, and removing the request would leave the
    // step with nothing to answer.
    if (kind !== undefined && settings.dropKinds.includes(kind) && !settings.humanKinds.includes(kind)) {
      dropped += 1
      continue
    }
    kept.push(message)
    if (kind !== undefined && settings.humanKinds.includes(kind)) humans.push(message)
    else context.push(message)
  }

  let ordered: readonly UserMessage[] = kept
  let moved = 0
  if (humans.length > 0 && context.length > 0) {
    // Context first, the human's words last: the request is what the model must
    // answer, and it is the single ordering fact this plugin guarantees.
    const candidate = [...context, ...humans]
    if (!sameOrder(kept, candidate)) {
      ordered = candidate
      moved = context.length
    }
  }

  const changed = dropped > 0 || moved > 0
  if (!changed) {
    return { messages, changed, dropped, moved, describe: 'nothing to change' }
  }

  const parts: string[] = []
  if (dropped > 0) parts.push(`drop ${String(dropped)} injected message(s)`)
  if (moved > 0) parts.push(`move ${String(moved)} context message(s) ahead of ${String(humans.length)} human message(s)`)
  return { messages: ordered, changed, dropped, moved, describe: parts.join(' and ') }
}
