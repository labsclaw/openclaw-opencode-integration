/**
 * OpenClaw CLI Backend descriptor for OpenCode CLI.
 * Maps opencode run commands, arguments, and session reuse into OpenClaw's text inference runner.
 */
export function buildOpenCodeCliBackend() {
  return {
    id: "opencode-cli",
    modelProvider: "opencode",
    liveTest: {
      defaultModelRef: "opencode-cli/opencode/mimo-v2.5-free",
      defaultImageProbe: false,
      defaultMcpProbe: false,
      docker: {
        binaryName: "opencode",
      },
    },
    config: {
      command: "opencode",
      args: [
        "run",
        "--format",
        "json",
        "--thinking",
        "-m",
        "{model}",
        "{prompt}",
      ],
      resumeArgs: [
        "run",
        "--format",
        "json",
        "--thinking",
        "-s",
        "{sessionId}",
        "-m",
        "{model}",
        "{prompt}",
      ],
      output: "jsonl",
      resumeOutput: "jsonl",
      input: "arg",
      modelArg: "-m",
      sessionArgs: ["-s", "{sessionId}"],
      sessionMode: "existing",
      sessionIdFields: ["sessionID", "sessionId"],
      serialize: true,
    },
  };
}
