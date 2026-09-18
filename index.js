import { buildOpenCodeCliBackend } from "./src/cli-backend.js";

export default {
  id: "opencode-cli",
  name: "OpenCode CLI Backend",
  description: "Text inference fallback and thinking capture via OpenCode CLI",
  register(api) {
    if (typeof api.registerCliBackend === "function") {
      api.registerCliBackend(buildOpenCodeCliBackend());
    }
  },
};
