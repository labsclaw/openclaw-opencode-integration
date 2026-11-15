import fs from "node:fs/promises";
import path from "node:path";

// Presence only, not an inference/account-eligibility claim. The native CLI
// remains the credential consumer. Never return a key/token from its store.
export async function readNativeAuthPresence({ env = process.env, signal, readFile = fs.readFile } = {}) {
  signal?.throwIfAborted();
  const home = process.platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME;
  if (!home && !env.XDG_DATA_HOME) return;
  const authPath = path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode", "auth.json");
  let auth;
  try {
    const raw = await readFile(authPath, { encoding: "utf8", signal });
    if (Buffer.byteLength(raw) > 1024 * 1024) return;
    auth = JSON.parse(raw).opencode;
  } catch {
    signal?.throwIfAborted();
    return;
  }
  signal?.throwIfAborted();
  const present = value => typeof value === "string" && value.trim().length > 0;
  if (auth?.type === "api" && present(auth.key)) return "api-key";
  if (auth?.type === "oauth" && (present(auth.refresh) || (present(auth.access) && Number.isFinite(auth.expires) && auth.expires > Date.now()))) return "oauth";
}

export default {
  // A synthetic CLI auth descriptor, NOT a second model provider/catalog.
  id: "opencode-cli",
  label: "OpenCode CLI native authentication",
  auth: [],
  async prepareSyntheticAuth({ provider, env, signal }) {
    if (provider?.trim().toLowerCase() !== "opencode-cli") return;
    const mode = await readNativeAuthPresence({ env, signal });
    if (!mode) return;
    return {
      apiKey: "opencode-cli-native-auth",
      source: "OpenCode CLI local sign-in (presence only)",
      mode,
      // This marker belongs ONLY to the CLI ref, like claude-cli discovery.
      // Do not set nativeAuth: current CLI admission consumes a string auth
      // mode, whereas nativeAuth produces a harness-only object auth mode.
    };
  },
};
