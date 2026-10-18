/**
 * Keep the human's words last in the step that carries them.
 *
 * ## What goes wrong
 *
 * Every step's batch is assembled at the `agent/pre-step` waterfall. The loop's
 * own base returns the claimed input followed by the runtime-context snapshot
 * (`agent-loop/src/agent.ts`), `time-context` and `session-reference` prepend
 * their own `user`-role messages, and `tool-skill` appends the skill catalog —
 * all of them `role: 'user'`, distinguished only by `source.kind`. For a provider
 * route that maps every non-assistant message to `role: 'user'` without reading
 * `source.kind` (the OpenAI-compatible route in `llm-pi-ai` does exactly that),
 * the model receives four consecutive `user` messages with the real request
 * first and a timestamp last.
 *
 * Small local models answer the last one. Discussion #10080 is that report: with
 * Ollama and `gpt-oss:20b` or `qwen3:8b`, a file-editing request produces no tool
 * call at all — the model explains the timestamp, or acknowledges the skill
 * catalog, and the turn ends `completed`. The same model titles the session
 * correctly from the same human message, because there it is the only message it
 * sees.
 *
 * ## What this plugin does
 *
 * At `agent/pre-step`, registered with `{ prepend: true }` so its after-next runs
 * last and it reads the fully composed batch, it moves every injected message
 * ahead of every human message, preserving each group's order. The request is
 * then the step's last `user` message, which is the position a model treats as
 * the thing to answer.
 *
 * The rewrite is durable, not cosmetic: the loop appends `decision.messages` to
 * the session in the order returned, so the reordered batch is what the log
 * records and what every later request derives from.
 *
 * It is inert where it would be wrong: a step with no human message (a wake or
 * continuation step, where the injections *are* the input) is left alone, a step
 * with no injected message is left alone, and an unchanged batch is returned as
 * the very same object.
 *
 * ## What it is not
 *
 * It is not the fix. Moving the runtime-context snapshot before the claimed input
 * at the source, or sending source-attributed context as `system`/`developer`
 * content on routes that support it, are changes in core packages, and either
 * would retire this plugin. Until then it is the workaround a deployment can
 * install, and it changes no core package.
 *
 * @module @argszero/dsh-human-request-last
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "human-request-last";
/**
 * Install the plugin.
 * @param ctx - the plugin context; the listener is disposed with it.
 * @param config - the configuration as mounted, possibly empty. Defaults live in
 *   `normalizeConfig` rather than in an exported `Config` object, because a plain
 *   object under that name is read as a schema by the Loader and makes the plugin
 *   unmountable.
 * @throws when `mode` names no known behaviour — see `normalizeConfig`.
 */
export declare function apply(ctx: Context, config?: Config): void;
declare const _default: {
    name: string;
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map