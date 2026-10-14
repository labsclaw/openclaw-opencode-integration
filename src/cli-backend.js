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
      defaultModelRef: "opencode/step-5-preview-free",
      defaultImageProbe: false,
      defaultMcpProbe: false,
      docker: {
        binaryName: "opencode",
      },
    },
    // OpenCode owns its tools/permissions; this adapter cannot impose an exact cap.
    // OpenClaw's admission gate must reject disableTools/restricted tool lists.
    nativeToolMode: "always-on",
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
    // Public OpenClaw custom JSONL seam; does not project native tools into OpenClaw.
    parseJsonlEvent(line) {
      const record = JSON.parse(line);
      // Wrapper liveness bytes reset the watchdog, never assistant text/session state.
      if (record.item?.type === "opencode_progress") return null;
      const session = typeof record.sessionID === "string" ? [{ kind: "sessionId", sessionId: record.sessionID }] : [];
      if (record.item?.type === "opencode_text_delta" && typeof record.item.text === "string") {
        return [...session, { kind: "text", text: record.item.text }];
      }
      if (record.item?.type === "message" && typeof record.item.text === "string") {
        return { kind: "result", text: record.item.text, sessionId: record.sessionID, usage: record.usage };
      }
      if (record.type === "error") {
        return { kind: "result", text: "", errorText: typeof record.error === "string" ? record.error : "OpenCode wrapper failed" };
      }
      return null;
    },
    resolveExecutionArgs(ctx) {
      if (ctx.toolAvailability !== undefined || ctx.executionMode === "side-question") {
        throw new Error("OpenCode CLI cannot enforce restricted/side-question tool availability; run not started");
      }
      const level = String(ctx.thinkingLevel ?? "").toLowerCase();
      const off = level === "off";
      const alwaysOn = ["always on", "always-on", "always_on"].includes(level);
      const args = [];
      const baseArgs = [...ctx.baseArgs];
      for (let index = 0; index < baseArgs.length; index += 1) {
        const arg = baseArgs[index];
        if (arg === "--thinking") continue;
        if (arg === "--variant" && (off || alwaysOn)) { index += 1; continue; }
        args.push(arg);
      }
      // --thinking only displays reasoning; it does not guarantee reasoning is disabled
      // by "off". Never infer --variant high from an OpenClaw thinking level: supported
      // variants are provider/model specific. An explicit base variant stays verbatim.
      if (!off && (baseArgs.includes("--thinking") || level)) args.push("--thinking");
      return args;
    },
  };
}
