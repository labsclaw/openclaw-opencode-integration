# OpenCode CLI wrapper contract

## Native login availability (2026-10-24)

The manifest advertises `syntheticAuthRefs: ["opencode-cli"]`. Its lightweight
`providerCatalogEntry` checks the existing CLI auth store for API/OAuth login
presence and publishes a native-runtime-only marker, never a real credential.
This is required by current OpenClaw admission: an executable responding directly
does not itself populate prepared runtime auth modes. The `opencode/*` namespace,
existing CLI-owned login, and hosted-inference guard are unchanged. Presence is
not proof of account eligibility or successful inference. A fresh Gateway canary
after plugin reload is still required. No new model provider config is created.

## Invocation and authority

The descriptor defaults to mode=native, agent=build in cold and resume argv. mode=omo explicitly requests Sisyphus - ultraworker; an optional agent config overrides the requested id/name. V1 uses `agent list` and requires the exact primary/all name. V2 uses `debug agents` JSON, resolves a unique id or exact display name to its id, and requires mode primary/all. Missing, subagent-only, ambiguous or malformed listings fail before inference. Version, timeout and quota failures are never swallowed as reasons to switch persona.

Native V1 passes `--pure` to listing and run so global OMO hooks are not loaded. Native V2 requests plugins=[] plus a final plugin.use deny policy in the child-only CLI config overlay; run uses `--standalone` so a shared service cannot ignore the overlay. This is a plugin request, not a tool sandbox or an override of higher-priority managed policy. Other policies/config remain. OMO leaves plugins enabled and fails if the requested agent is absent. Change profile only with a new session; do not reuse an OMO session as if it were a fresh native session.

Preflight is **availability evidence**, not effective-persona evidence: flat run events need not report agent/model identity. A configuration change between preflight and run remains a TOCTOU boundary. Real Sisyphus behavior/tools/hooks require a separate controlled CLI execution, not these fixtures.

Supported wrapper flags: --mode native|omo, --thinking, --model, --agent, --session, --variant, and one positional prompt (or stdin). Unknown/duplicate flags, missing values, invalid/control-character values, --attach, --continue, --auto and shell shims are rejected. This adapter never attaches to a shared server. Omitting both mode and agent retains legacy CLI defaults for direct wrapper callers (not the supported configured backend path); the OpenClaw descriptor always supplies a mode and agent. Version detection accepts v1/v2 and fails closed for other/unknown majors. V1 and V2 use different configuration keys; fixture success is not proof of all releases or plugin-policy enforcement.

Bare model names receive opencode/; the known doubled opencode/opencode/ prefix is collapsed once. Other qualified providers, including nested model IDs such as openrouter/anthropic/model, remain unchanged. Syntax validation does not promise catalog availability or authentication. CLI errors remain terminal. Variants are provider-specific: explicit variants are preserved, never clamped from max/minimal to high. No variant is guessed from OpenClaw thinking levels. Off removes --thinking display and --variant, but cannot promise the provider internally stops reasoning; --thinking means display blocks. Always-on thinking mode drops an explicit variant.

## Per-child configuration and liveness

The wrapper parses `OPENCODE_CONFIG_CONTENT` as a JSON object before any spawn. Invalid JSON, null, arrays and scalars fail with code 2 without logging content. V1 forces snapshot:false and an explicit --model pins small_model to the same model. After version detection V2 merges OPENCODE_CLI_CONFIG_CONTENT, forces snapshots:false and pins both small_model and agents.title.model to the requested model, preserving other title fields/agents. This prevents title generation from silently selecting a separate paid helper. Existing small-model settings remain when --model is omitted. Native mode additionally bypasses plugins as described above; OMO preserves plugin configuration. Other settings remain; overrides affect only subprocess environment, never global files. OPENCODE_DISABLE_AUTOUPDATE=true prevents startup updates.

Every preflight/inference spawn emits `item.type=opencode_progress` with only its phase, immediately and every 15 seconds. `OPENCODE_HEARTBEAT_INTERVAL_MS` may set a validated 1..60000 ms interval. These JSONL bytes keep the no-output watchdog alive; the descriptor and generic JSONL parser ignore them (no assistant text, usage or session binding). Heartbeats are liveness, not evidence of model progress. Timers stop on child close, abort and wrapper completion. The independent `OPENCODE_RUN_TIMEOUT_MS` deadline (default 240000 ms, including preflight) still terminates genuinely stuck calls with code 124 and a phase-specific error.

## Input and sessions

Both positional and streamed prompts are delivered **once via stdin**, never repeated in argv. Long Unicode/multiline input is forwarded byte-for-byte with backpressure and a 16 MiB bound. No temporary prompt files. Resume forwards only the caller's supplied payload and exact ses_* session ID; no global continue or wrapper-generated transcript replay. The caller remains responsible for passing a delta rather than replaying history. Mocks prove argv/input forwarding, not live two-turn continuity.

The requested/first main session is retained; unrelated-session text/usage is ignored. Every error event, including an unrelated-session error, is terminal. A new session binding is emitted only in a successful final record, never with partial progress. Existing resumed session side effects cannot be rolled back by this wrapper.

## Output

Input is strict flat run NDJSON: text/reasoning/step_start/step_finish/tool_use/error envelopes with part data. SDK/SSE message.part.* streams are explicitly unsupported. Malformed JSON, invalid UTF-8, invalid metadata and protocol limits fail closed rather than being silently discarded. UTF-8 decoding preserves code points split across chunks. Part-ID snapshots are monotonic/deduplicated; reasoning is not exposed as assistant text. Stream limits: 1 MiB pending line (UTF-16 character cap), 16 MiB stdout bytes, 8 MiB stderr bytes, 16 KiB stderr diagnostic tail, 4 MiB assistant-text bytes, 4096 part/step IDs, 100000 events. Exceeding a bound is an error, not truncation-as-success.

Progress records have item.type=opencode_text_delta. The public descriptor parseJsonlEvent hook projects them into OpenClaw kind=text events. Final output is one message item plus final sessionID and reported usage; the hook projects it as kind=result without replaying the deltas. Without this hook, OpenClaw's generic JSONL parser ignores progress and reads just the one final message (avoids newline insertion and duplication). Raw progress plus raw final text is intentionally redundant for different readers; consumers must not concatenate both.

A successful run requires exit 0, nonempty assistant text, a session ID and terminal step_finish. Stop/length are accepted; a reasonless legacy finish is accepted, while final tool-calls is not completion. EOF+exit0+text without finish fails. Length does not mean all requested work was completed. Input/output/cache usage is summed over distinct step IDs; absent metrics remain absent, not fabricated zero. Raw wrapper cost is preserved when reported, but the OpenClaw JSONL result schema does not expose cost or separate reasoning tokens. No fabricated finish_reason/total/cost.

## Exit codes and cleanup

| Code | Meaning |
|---|---|
| 2 | Argument/input/config/heartbeat/timeout-setting validation |
| 65 | Any generic OpenCode error event |
| 66 | Quota/rate-limit event or stderr diagnostic |
| 67 | Malformed/empty/truncated/oversized protocol output |
| 68 | Agent preflight/fallback/identity mismatch |
| 69 | Child nonzero/signal, even after partial text; original status is in diagnostic |
| 124 | Deadline, including preflight |
| 127 | Executable spawn failure |
| 129/130/143 | Delivered SIGHUP/SIGINT/SIGTERM cancellation/disconnected consumer |

No failure emits a successful final message. Partial progress may already have been streamed, and native tools may already have acted; never treat a failed run as completed or automatically retry non-idempotent work.

POSIX creates a private process group and kills that group. Windows uses taskkill /PID <private-cli-pid> /T /F, never /IM or a shared-server PID. Cancellation/timeout await child closure and tree cleanup; taskkill has a six-second cleanup deadline. Exit 128/255 is benign only when the owned root has exited; a bounded 250 ms grace handles delayed root-exit delivery without probing or retrying its PID. Cleanup failure is appended to the original diagnostic and preserves its exit code (including timeout/cancellation/protocol errors). A still-owned live root is terminated as a last resort, not a claim of descendant cleanup. Aborted pipes are closed after cleanup so inherited pipes cannot indefinitely hold wrapper EOF. Windows process.kill(SIGTERM) force-kills a process without delivering JS handlers: external supervisors must kill the wrapper's tree (or own a Job Object). Tests distinguish injected JS signal delivery from real POSIX signals. Windows forced-wrapper termination, detached descendants escaping ownership, a root exiting before taskkill can identify its tree, and shared-server session abort are **not universally guaranteed** here. No shared-server abort is implemented.

## Tools: honest boundary

nativeToolMode=always-on; no toolAvailabilityEnforcement claim. The installed OpenClaw admission gate rejects disableTools and restricted/empty cliToolAvailability **before spawning**. The descriptor also rejects explicit caps and side-question execution. This intentionally blocks legitimate tool-free probes; do not bypass the gate to make them green. No exact tool list or OpenClaw MCP bridge is implemented. Native OpenCode/OMO permissions and approvals are not inherited OpenClaw permissions.

## Offline verification

Do not run npm test for offline checks: test-adapter.js calls live inference. Use:

    node --test test/*.mjs

OPENCODE_BIN points to the shell-free fake-opencode.mjs fixture; .js/.mjs/.cjs overrides execute using the current Node binary. Tests never invoke the real inference CLI. Optional OPENCLAW_JSONL_MODULE and OPENCLAW_PREPARE_MODULE paths enable read-only installed-parser and actual-admission-source-seam tests. Their hashed dist exports are version-specific: re-inspect if names change, do not guess. Assertions prove wrapper/descriptor behavior and a core gate seam, **not picker/main-session/E2E/harness correctness**.
