# @argszero/dsh-human-request-last

Keep the human's words last in the step that carries them.

Every model request the harness builds begins with a batch assembled at the
`agent/pre-step` waterfall, and that batch mixes three kinds of message into one
`role: 'user'` channel:

| contributor | how it joins the batch | what the model sees |
|---|---|---|
| the loop (`agent-loop/src/agent.ts` `preStep`) | `[...claimed, runtime-context]` | the human's request, then a runtime snapshot |
| `time-context`, `session-reference` | `{ prepend: true }`, append in after-next | a clock reading, a session excerpt |
| `tool-skill`, `agent-instructions` | plain push, append | the skill catalog, workspace instructions |

Only `source.kind` tells them apart inside the harness. On the OpenAI-compatible
route in `llm-pi-ai` (`context.ts`, both the text-only and image paths), every
non-assistant message becomes `role: 'user'` without reading `source.kind`, so
what the model receives is four consecutive `user` messages whose *last* one is a
timestamp.

Small local models take the last `user` message as the request. In
[discussion #10080](https://github.com/deepseek-ai/deepseek-harness/discussions/10080)
an Ollama deployment asking to read and edit a file produced no tool call at all:
`gpt-oss:20b` converted the timestamp to UTC, `qwen3:8b` acknowledged the skill
catalog, and the turn ended `completed` with `toolMs: 0`. The same model titled
the session correctly from the same human message, because there it was the only
message it saw.

This plugin moves the injected messages ahead of the human message, keeping each
group's own order, so the request is the last `user` message in the step.

## Why the rewrite is durable

The loop appends `decision.messages` to the session in the order returned
(`agent.ts`, the `for (const message of decision.messages)` commit loop) and then
derives the request from the admitted surface. Reordering at the waterfall
therefore changes what the log records and what every later request derives from
it — it is not a per-request cosmetic change.

## Install

```sh
dsh plugin add @argszero/dsh-human-request-last
```

The package carries a bundle patch (`dsh.bundle.patch`), so adding it mounts it.
To do it by hand, put the row in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: human-request-last
      name: '@argszero/dsh-human-request-last'
```

Mount it **after** the other `agent/pre-step` contributors. Listeners on one
event run outermost-first and `prepend` unshifts, so the last listener registered
runs last — which is where this plugin has to be to see their appends. An id-less
`insert` pushes to the end of the entry list, so the bundled patch gets this
right automatically. Mounted earlier the plugin is still safe — nothing is
dropped or duplicated — but a contributor registered after it keeps its position
at the tail and the request is no longer last.

## Configuration

```yaml
- insert:
    - id: human-request-last
      config:
        mode: reorder            # reorder | report | off
        humanKinds: [user]       # source kinds that mean "the human typed this"
        dropKinds: [time-context] # injected kinds to remove entirely
```

- `mode: reorder` (default) rewrites the batch. `report` computes the same plan,
  logs one line per agent per change, and rewrites nothing — the way to see what a
  deployment would send. `off` installs no listener.
- `humanKinds` widens what counts as the request when a deployment routes input
  another way (for example relaying between agents). A message with no readable
  `source.kind` counts as context, never as the request.
- `dropKinds` removes injected material outright — the workaround a local-model
  deployment needs when a snapshot is intrusive. It never removes a human kind.
  `runtime-context` cannot be dropped this way: the loop appends its fresh
  projection even when the placeholder is gone (`agent.ts`, the
  `contextAdmitted` branch), so dropping only moves where it lands.

## What it guarantees, and what it does not

Guaranteed:

- a batch with at least one human message and at least one injected message comes
  back with every injected message first and every human message last, each group
  in its original order;
- an unchanged batch is returned as the very same object — no copy, no event, no
  token;
- a step with no human message (a wake or continuation step, where the injections
  *are* the input) and a step with no injected message are left alone;
- a planning failure leaves the step untouched and logs one warning: a plugin
  whose own bug fails a turn is a worse failure than the one it answers.

Not guaranteed:

- it does not change what the injected messages *say*; a model that reads a
  catalog as a request will read it as context instead, which is the intended
  difference and not a guarantee about any particular model;
- it is not the upstream fix. Moving the runtime snapshot before the claimed
  input at the source, or sending source-attributed context as
  `system`/`developer` content on routes that support it, are core changes
  ([#4117](https://github.com/deepseek-ai/deepseek-harness/discussions/4117),
  [#4749](https://github.com/deepseek-ai/deepseek-harness/discussions/4749)
  hold the design discussion and the prompt-cache trade-off). Either would retire
  this plugin.

## Verification

- `npm test` — 24 tests: the pure plan (ordering, groups, drops, identity,
  configuration) and a real `@deepseek-ai/cordis` composition that reproduces the
  report (control arm without the plugin, mounted-last arm, mounted-first
  degradation arm, report/off modes, the failure path, and both mount spellings).
- `npm run test:inject` — 16 mutation arms, each a defect this plugin could ship
  (wrong default mode, dropped validation, humans dropped, order inverted,
  listener not prepended, failures thrown instead of contained, …). All 16 are
  caught; none is silent.

## License

MIT © 2026 argszero
