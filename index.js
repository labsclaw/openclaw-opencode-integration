import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildOpenCodeCliBackend } from "./src/cli-backend.js";

export default definePluginEntry({
  id: "opencode-cli",
  name: "OpenCode CLI Backend",
  description: "Routes OpenClaw inference through the installed OpenCode CLI with native thinking output.",
  register(api) {
    api.registerCliBackend(buildOpenCodeCliBackend());
  },
});
