import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildOpenCodeCliBackend } from "./src/cli-backend.js";
import { buildOpenCodeZenInferenceGuard } from "./src/zen-inference-guard.js";

export default definePluginEntry({
  id: "opencode-cli",
  name: "OpenCode CLI Backend",
  description: "Routes models from the opencode provider through the local OpenCode CLI, avoiding direct Zen inference calls.",
  register(api) {
    // The model namespace stays opencode/*; this plugin only replaces the
    // inference transport with a local CLI process. Catalog discovery remains
    // owned by models.providers.opencode and ultra-models-skill.
    api.registerCliBackend(buildOpenCodeCliBackend());
    // Refuse the hosted text-stream route if a session pin bypasses the CLI.
    // This is not a catalog provider and does not change existing Zen models.
    api.registerProvider(buildOpenCodeZenInferenceGuard());
  },
});
