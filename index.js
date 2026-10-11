import { definePluginEntry } from \"openclaw/plugin-sdk/plugin-entry\";
import { buildOpenCodeCliBackend } from \"./src/cli-backend.js\";

const PROVIDER_ID = \"opencode-cli\";
const PROVIDER_LABEL = \"OpenCode CLI (Zen via CLI)\";

export default definePluginEntry({
  id: \"opencode-cli\",
  name: \"OpenCode CLI Backend + Provider\",
  description: \"Routes OpenClaw inference through OpenCode CLI (no direct API key to Zen free). Also exposes opencode-cli provider with models from config/catalog.\",
  register(api) {
    // Register CLI backend (Rota B)
    api.registerCliBackend(buildOpenCodeCliBackend());

    // Register provider (no auth required - uses local CLI)
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: \"/providers/opencode-cli\",
      envVars: [],
      auth: [],
      catalog: {
        order: \"simple\",
        run: async (ctx) => {
          const providers = ctx.config?.models?.providers || {};
          // Prefer explicit opencode-cli models if defined
          const cliCfg = providers[PROVIDER_ID];
          if (cliCfg?.models && Array.isArray(cliCfg.models) && cliCfg.models.length > 0) {
            return {
              provider: {
                api: \"openai-completions\",
                models: cliCfg.models,
              },
            };
          }
          // Fallback: reuse opencode (Zen) models but route via CLI backend context
          const zenCfg = providers[\"opencode\"] || providers[\"opencode-go\"] || {};
          if (zenCfg?.models && Array.isArray(zenCfg.models)) {
            return {
              provider: {
                api: \"openai-completions\",
                models: zenCfg.models,
              },
            };
          }
          // Minimal safe default set (common Zen free)
          return {
            provider: {
              api: \"openai-completions\",
              models: [
                { id: \"big-pickle\", name: \"Big Pickle\", reasoning: false, input: [\"text\"], contextWindow: 200000, maxTokens: 8192 },
                { id: \"mimo-v2.6-flash-free\", name: \"Mimo v2.6 Flash Free\", reasoning: false, input: [\"text\"], contextWindow: 200000, maxTokens: 8192 },
              ],
            },
          };
        },
      },
    });
  },
});
