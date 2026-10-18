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
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { Settings } from './config.js';
/** What one step's batch should become. */
export interface Plan {
    /** The messages the step should carry; the input array itself when nothing changes. */
    messages: readonly UserMessage[];
    /** Whether {@link Plan.messages} differs from the input array. */
    changed: boolean;
    /** How many messages {@link Settings.dropKinds} removed. */
    dropped: number;
    /** How many context messages were moved ahead of the human's words. */
    moved: number;
    /** One-line description of the change, for `report` mode. */
    describe: string;
}
/** The source kind of one message, when it declares a readable one. */
export declare function kindOf(message: UserMessage): string | undefined;
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
export declare function planMessages(messages: readonly UserMessage[], settings: Settings): Plan;
//# sourceMappingURL=plan.d.ts.map