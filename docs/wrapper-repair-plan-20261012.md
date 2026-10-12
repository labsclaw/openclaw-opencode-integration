# Bounded wrapper repair — 2026-10-12

GOAL: Fail-closed, bounded, Unicode-safe OpenCode run JSONL adapter with stdin/resume compatibility and privately owned process cleanup.

EVIDENCE: Worktree HEAD and origin/main are 955cd780cb22aba2c73d726de74393c378ad36d3, fix/opencode-routing-20261012, clean before edits; canonical origin unchanged. Existing wrapper ignores generic error events, accepts partial output plus nonzero, unbounded buffers, decodes chunks independently, forwards positional prompt twice. npm test invokes live inference and is excluded. Local opencode-ai 1.18.35 run --help confirms stdin-compatible run and agent/session/model/variant flags. Installed OpenClaw cli-live-session-registry-rd4F7Su_.mjs exports generic JSONL parser (m) and output parser (p): message item text, sessionID, normalized usage. graphify query unavailable because this worktree has no graphify-out/graph.json; do not invent structural edges.

UNKNOWNS: Resolve exact primary agent availability through bounded read-only agent list preflight using the same executable/environment/cwd. Effective harness identity is not present in flat run events; document preflight versus execution proof. Validate generic OpenClaw parser against fixtures through read-only import when explicitly supplied. OS process-tree cleanup: verify timeout with owned descendant fixture on Windows; OS signal delivery on Windows needs separate distinction from JS cancellation hooks. Upstream source fetch returned 404; use local help and explicit flat fixture contract rather than claiming uninspected versions.

SUCCESS CRITERIA: Dedicated offline node --test suite proves every error, quota, partial nonzero, malformed/oversized output, spawn failure, stdin/long prompt, resume, model normalization, arg rejection, Unicode, snapshot dedup, final session/usage, timeout/tree isolation and cancellation. node --check and git diff --check pass. Tests with installed generic parser prove no duplicate streaming or lost metadata. No live inference, external deps, transport/config/core changes.

STEPS:
1. Strict allowlisted wrapper args and validated timeout/model/session/agent; preflight explicit primary agent (no fallback).
2. Incremental bounded UTF-8 decoding and flat-event normalization; explicit terminal failures and parser-compatible final metadata.
3. Owned run/preflight process trees, bounded stdin flow and timeout/cancellation cleanup; reject attach/continue or shell shims.
4. Add offline fake executable and regressions, documenting exit codes and proof limits.
5. Run offline verification, inspect diff, record evidence and outstanding boundaries.

EVIDENCED REFINEMENT: Installed OpenClaw generic parser joins message items with newlines and does not stream them. Public CliBackendParseJsonlEvent supports kind=text/sessionId/result (d.ts 49705–49735); projectCliBackendEvent appends text deltas and projects result without replay. Add a minimal descriptor parseJsonlEvent hook for the wrapper-only progress/final/error records, tested with the actual installed parser. Keep a baseline generic-parser test to prove backward-readable final record. Require step_finish before success (CLI emission confirmed in pinned upstream noninteractive.ts:514); EOF+exit0+partial text is not a completed run. No SDK/SSE adaptation.

SCOPE UPDATE (requester 2026-10-12): audit tmp/opencode-routing-audit-20261012.md proves fictitious exact-cap and thinking off -> high. Include src/cli-backend.js: declare always-on, remove toolAvailabilityEnforcement; throw before spawn for any explicit toolAvailability / executionMode restricted. Preserve provider-specific variant verbatim only when explicitly provided; do not invent model-compatible reasoning variants. off removes display-thinking and variant. Prove restricted core gate using actual installed canEnforceExactToolAvailability/gate functions read-only plus descriptor tests. No selectable support claimed. This legitimately blocks disableTools probes.

OUT OF SCOPE: picker, core mutations, index.js/manifest/provider guard, deployment, push/PR, config, restart, credentials, external libraries, live Sisyphus claim. Exact OpenClaw tool availability remains unimplemented, honestly rejected rather than emulated.

ROLLBACK: Worktree-only changes can be reverted by named files; main dirty checkout is untouched. No running service changes.
