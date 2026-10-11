import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildOpenCodeCliBackend } from "./src/cli-backend.js";

export default definePluginEntry({
  id: "opencode-cli",
  name: "OpenCode CLI Backend",
  description: "Routes models from the opencode provider through the local OpenCode CLI, avoiding direct Zen inference calls.",
  register(api) {
    // The model namespace stays opencode/*; this plugin only replaces the
    // inference transport with a local CLI process. Catalog discovery remains
    // owned by models.providers.opencode and ultra-models-skill.
    api.registerCliBackend(buildOpenCodeCliBackend());
  },
});
