/**
 * Configuration and its normalization.
 *
 * Three knobs, each answering a question an operator actually asks: *may I watch
 * before I trust it* (`mode`), *which source kinds are the human's own words*
 * (`humanKinds`), and *may I silence one injected kind outright* (`dropKinds`).
 *
 * The defaults are "do the useful thing, change nothing else": reorder, treat
 * `kind: 'user'` as the human's words, drop nothing.
 *
 * @module @argszero/dsh-human-request-last/config
 */
/** What the plugin does with each step it sees. */
export type Mode = 'reorder' | 'report' | 'off';
/** The configuration as a profile patch may mount it. */
export interface Config {
    /** `reorder` (default) rewrites the batch, `report` only logs, `off` installs no listener. */
    mode?: Mode;
    /** Source kinds that mean "the human typed this". Defaults to `['user']`. */
    humanKinds?: string[];
    /** Injected source kinds to remove from the step entirely. Defaults to none. */
    dropKinds?: string[];
}
/** The resolved settings the plugin runs with. */
export interface Settings {
    mode: Mode;
    humanKinds: readonly string[];
    dropKinds: readonly string[];
}
/** The source kind a genuinely human message carries (`llm/src/message.ts`). */
export declare const DEFAULT_HUMAN_KINDS: readonly string[];
/**
 * Resolve a user configuration into the settings the plugin runs with.
 * @param config - the configuration as mounted, possibly empty.
 * @returns every setting, with defaults applied.
 * @throws when `mode` is present but is not one of the three known names: a
 *   plugin whose whole purpose is to change message order must not fall back to
 *   guessing which of "rewrite" and "do nothing" an unknown spelling meant.
 */
export declare function normalizeConfig(config?: Config): Settings;
//# sourceMappingURL=config.d.ts.map