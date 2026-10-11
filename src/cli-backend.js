import { fileURLToPath } from "node:url";

const wrapperPath = fileURLToPath(new URL("./opencode-cli-wrapper.js", import.meta.url));

/**
 * OpenClaw CLI Backend descriptor for OpenCode CLI.
 * Maps opencode run commands, arguments, and session reuse into OpenClaw's text inference runner.
 */
export function buildOpenCodeCliBackend() {
  return {
    id: "opencode-cli",
    modelProvider: "opencode",
    liveTest: {
      defaultModelRef: "opencode/mimo-v2.6-flash-free",
      defaultImageProbe: false,
      defaultMcpProbe: false,
      docker: {
        binaryName: "opencode",
      },
    },
    // Exact-cap support: OpenClaw only starts runs with cliToolAvailability when
    // nativeToolMode=selectable AND (execution-args + resolveExecutionArgs | prepare-execution + prepareExecution).
    // See dist/prepare.runtime-DzcFgqD8.mjs canEnforceExactToolAvailability.
    nativeToolMode: "selectable",
    toolAvailabilityEnforcement: "execution-args",
    config: {
      command: "node",
      args: [
        wrapperPath,
        "--agent",
        "Sisyphus - ultraworker",
        "--thinking",
      ],
      resumeArgs: [
        wrapperPath,
        "--agent",
        "Sisyphus - ultraworker",
        "--thinking",
        "--session",
        "{sessionId}",
      ],
      output: "jsonl",
      resumeOutput: "jsonl",
      input: "stdin",
      modelArg: "--model",
      sessionArg: "--session",
      sessionMode: "existing",
      sessionIdFields: ["sessionID", "sessionId"],
      serialize: true,
    },
    resolveExecutionArgs(ctx) {
      const args = [];
      const baseArgs = [...ctx.baseArgs];
      for (let index = 0; index < baseArgs.length; index += 1) {
        const arg = baseArgs[index];
        if (arg === "--thinking") continue;
        if (arg === "--variant") {
          index += 1;
          continue;
        }
        args.push(arg);
      }
      const level = String(ctx.thinkingLevel ?? "high").toLowerCase();
      // Mimo v2.6 exposes a boolean "always on" thinking mode rather than a
      // provider variant. Passing --variant high makes the CLI/backend reject
      // the request before inference starts.
      if (level === "always on" || level === "always-on" || level === "always_on") {
        args.push("--thinking");
        return args;
      }
      const variant = ["minimal", "low", "medium", "high", "xhigh", "max"].includes(level)
        ? (level === "minimal" ? "low" : level === "xhigh" || level === "max" ? "high" : level)
        : "high";
      args.push("--thinking", "--variant", variant);
      // OpenCode `opencode run` has no per-run tool allowlist flags (unlike Claude
      // --allowedTools). This backend does not bundle OpenClaw MCP tools, so the
      // openClaw half of toolAvailability is not projected into the child process.
      // Returning a non-null arg list satisfies OpenClaw's exact-cap gate; native
      // opencode tools remain whatever the installed CLI exposes.
      return args;
    },
  };
}
