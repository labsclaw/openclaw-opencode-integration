import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { StringDecoder } from "node:string_decoder";

// Flat opencode run --format json events, not SDK/SSE. See docs/cli-wrapper.md.
const EXIT = { args: 2, event: 65, quota: 66, protocol: 67, agent: 68, child: 69, cleanup: 70, timeout: 124, spawn: 127 };
const LIMIT = { line: 1024 * 1024, stdout: 16 * 1024 * 1024, stderr: 8 * 1024 * 1024, tail: 16384, text: 4 * 1024 * 1024, prompt: 16 * 1024 * 1024, parts: 4096, events: 100000 };
const quota = /free usage exceeded|rate.?limit|quota exceeded|subscribe to Go|retrying in \d+h/i;
const fallback = /agent[^\r\n]*(?:not found|unknown|does not exist|not a primary)|fall(?:ing)? back[^\r\n]*(?:agent|build)/i;
function fail(code, message) { const e = new Error(message); e.exitCode = code; return e; }
function emit(record) { process.stdout.write(JSON.stringify(record) + "\n"); }
function parseArgs(raw) {
  const options = {};
  let prompt;
  let positional = false;
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (!positional && arg === "--") { positional = true; continue; }
    if (!positional && arg === "--thinking") {
      if (options.thinking) throw fail(EXIT.args, "duplicate --thinking");
      options.thinking = true; continue;
    }
    if (!positional && arg.startsWith("-")) {
      if (!["--model", "--session", "--agent", "--variant"].includes(arg)) throw fail(EXIT.args, "unsupported option: " + arg);
      const key = arg.slice(2);
      const value = raw[++i];
      if (options[key] !== undefined || !value || value.startsWith("-") || /[\x00-\x1f\x7f]/.test(value)) throw fail(EXIT.args, "invalid/duplicate " + arg);
      options[key] = value;
    } else {
      if (prompt !== undefined) throw fail(EXIT.args, "only one positional prompt is supported");
      prompt = arg;
    }
  }
  if (options.model) {
    // Only the known doubled integration namespace is collapsed; other providers stay intact.
    options.model = options.model.replace(/^opencode\/opencode\//i, "opencode/");
    if (!options.model.includes("/")) options.model = "opencode/" + options.model;
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(options.model) || options.model.includes("//") || options.model.endsWith("/") || options.model.split("/").some(segment => [".", ".."].includes(segment))) throw fail(EXIT.args, "model must be provider/model");
  }
  if (options.session && !/^ses_[A-Za-z0-9_-]+$/.test(options.session)) throw fail(EXIT.args, "invalid session ID");
  if (options.variant && !/^[A-Za-z0-9._-]{1,64}$/.test(options.variant)) throw fail(EXIT.args, "invalid variant");
  if (options.agent && (options.agent.length > 256 || options.agent !== options.agent.trim())) throw fail(EXIT.args, "invalid agent");
  if (prompt !== undefined && (!prompt.trim() || Buffer.byteLength(prompt) > LIMIT.prompt || prompt.includes("\0"))) throw fail(EXIT.args, "invalid prompt");
  return { ...options, prompt };
}
const npmRoot = process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : path.join(process.env.USERPROFILE || "", "AppData", "Roaming", "npm");
const nativeBinary = path.join(npmRoot, "node_modules", "opencode-ai", "bin", "opencode.exe");
const binary = process.env.OPENCODE_BIN || (process.platform === "win32" && fs.existsSync(nativeBinary) ? nativeBinary : "opencode");
// .js/.mjs/.cjs is an explicit shell-free executable seam for offline Node fixtures.
const script = /\.(?:mjs|cjs|js)$/i.test(binary);
const env = { ...process.env, ...(process.platform === "win32" && process.env.USERPROFILE ? { HOME: process.env.USERPROFILE } : {}), OPENCODE_DISABLE_PROJECT_CONFIG: "true" };
if (process.platform === "win32") { delete env.PWD; delete env.OLDPWD; }
let active;
let terminal;
let timer;
let cleanupPromise = Promise.resolve();
let stdinListener;
let inputBytes = 0;
let hasInput = false;
function stopInput() {
  if (stdinListener) process.stdin.removeListener("data", stdinListener);
  process.stdin.pause();
}
function killTree(child) {
  if (!child?.pid) return Promise.resolve();
  // On Windows an exited root is no longer a safe ownership handle (PID reuse).
  if (process.platform === "win32" && (child.exitCode !== null || child.signalCode !== null)) return Promise.resolve();
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") return Promise.reject(e); }
    return Promise.resolve();
  }
  // Never use /IM: only the tree rooted at the private CLI PID. No --attach is allowed.
  return new Promise((resolve, reject) => {
    const killer = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false });
    const deadline = setTimeout(() => { killer.kill(); reject(new Error("owned tree cleanup timed out")); }, 6000);
    killer.on("error", (error) => { clearTimeout(deadline); reject(error); });
    killer.on("close", (code) => {
      clearTimeout(deadline);
      if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
      else reject(new Error("taskkill could not terminate owned process tree (" + code + ")"));
    });
  });
}
function abort(error) {
  if (terminal) return;
  terminal = error;
  stopInput();
  if (active) {
    const owned = active;
    owned.stdin.destroy();
    cleanupPromise = killTree(owned).catch((e) => {
      terminal = fail(EXIT.cleanup, "owned tree cleanup failed: " + e.message);
      // Root-only last resort, never process-name/shared-server kill. Report failure,
      // not a claim that descendants were reaped when OS tree cleanup was unavailable.
      owned.kill("SIGKILL"); owned.stdout.destroy(); owned.stderr.destroy();
    });
  }
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) process.on(signal, () => abort(fail(code, "cancelled by " + signal)));
process.stdout.on("error", () => abort(fail(143, "output consumer disconnected")));

function execute(args, onLine, { preflight = false, prompt = "" } = {}) {
  return new Promise((resolve, reject) => {
    if (terminal) { reject(terminal); return; }
    const child = spawn(script ? process.execPath : binary, script ? [binary, ...args] : args, { cwd: process.cwd(), env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    active = child;
    let buffer = "", stderr = "", outBytes = 0, errBytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const errDecoder = new StringDecoder("utf8");
    function stderrChunk(str) {
      const scan = stderr + str;
      stderr = scan.slice(-LIMIT.tail);
      if (quota.test(scan)) abort(fail(EXIT.quota, "OpenCode quota/rate limit: " + stderr.trim()));
      else if (fallback.test(scan)) abort(fail(EXIT.agent, "OpenCode agent fallback rejected: " + stderr.trim()));
    }
    function consume(str) {
      buffer += str;
      let end;
      while (!terminal && (end = buffer.indexOf("\n")) !== -1) {
        if (end > LIMIT.line) throw fail(EXIT.protocol, "JSONL line limit exceeded");
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (line) onLine(line);
      }
      if (buffer.length > LIMIT.line) throw fail(EXIT.protocol, "JSONL line limit exceeded");
    }
    child.stdout.on("data", (chunk) => {
      if (terminal) return;
      outBytes += chunk.length;
      if (outBytes > (preflight ? LIMIT.line : LIMIT.stdout)) { abort(fail(EXIT.protocol, "stdout limit exceeded")); return; }
      try { consume(decoder.decode(chunk, { stream: true })); } catch (e) { abort(e.exitCode ? e : fail(EXIT.protocol, "invalid UTF-8/JSONL: " + e.message)); }
    });
    child.stderr.on("data", (chunk) => {
      errBytes += chunk.length;
      if (errBytes > LIMIT.stderr) abort(fail(EXIT.protocol, "stderr limit exceeded"));
      stderrChunk(errDecoder.write(chunk));
    });
    child.stdin.on("error", (e) => { if (!terminal && e.code !== "EPIPE") abort(fail(EXIT.child, "stdin failed: " + e.message)); });
    child.on("error", (e) => abort(fail(EXIT.spawn, "cannot spawn OpenCode: " + e.message)));
    child.on("close", async (code, signal) => {
      stopInput();
      try {
        if (!terminal) { consume(decoder.decode()); if (buffer.trim()) onLine(buffer.trim()); }
        stderrChunk(errDecoder.end());
      } catch (e) { abort(e.exitCode ? e : fail(EXIT.protocol, "invalid final event: " + e.message)); }
      await cleanupPromise;
      active = undefined;
      if (terminal) { reject(terminal); return; }
      if (code !== 0) { reject(fail(preflight ? EXIT.agent : EXIT.child, "OpenCode exited " + (signal || code) + (stderr.trim() ? ": " + stderr.trim() : ""))); return; }
      resolve();
    });
    if (preflight) {
      child.stdin.end();
    } else {
      child.stdin.end(prompt);
    }
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const timeoutMs = Number(process.env.OPENCODE_RUN_TIMEOUT_MS ?? 240000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw fail(EXIT.args, "invalid OPENCODE_RUN_TIMEOUT_MS");
  if (!script && /\.(cmd|bat|ps1)$/i.test(binary)) throw fail(EXIT.args, "OPENCODE_BIN must be native (no shell shim)");

  let prompt = options.prompt;
  if (prompt === undefined) {
    if (process.stdin.isTTY) throw fail(EXIT.args, "requires a prompt on stdin");
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of process.stdin) {
      totalBytes += chunk.length;
      if (totalBytes > LIMIT.prompt || chunk.includes(0)) throw fail(EXIT.args, "stdin prompt limit exceeded or NUL byte");
      chunks.push(chunk);
    }
    prompt = Buffer.concat(chunks).toString("utf8");
    if (!prompt.trim()) throw fail(EXIT.args, "requires a nonempty prompt");
  }

  timer = setTimeout(() => abort(fail(EXIT.timeout, "timed out after " + timeoutMs + "ms")), timeoutMs);
  if (options.agent) {
    let found = false;
    await execute(["agent", "list"], (line) => { if (line === options.agent + " (primary)" || line === options.agent + " (all)") found = true; }, { preflight: true });
    if (!found) throw fail(EXIT.agent, "requested primary agent is not listed: " + options.agent);
  }
  const cliArgs = ["run", "--format", "json"];
  for (const key of ["model", "agent", "session", "variant"]) if (options[key]) cliArgs.push("--" + key, options[key]);
  if (options.thinking) cliArgs.push("--thinking");
  // Always stdin, never argv plus stdin. Long/multiline prompts don't hit Windows argv limits.
  let session = options.session, text = "", events = 0, cost, finished = false;
  const snapshots = new Map(), finishes = new Set();
  const usage = {};
  function onLine(line) {
    if (++events > LIMIT.events) throw fail(EXIT.protocol, "event count limit exceeded");
    let event;
    try { event = JSON.parse(line); } catch { throw fail(EXIT.protocol, "malformed JSON event"); }
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") throw fail(EXIT.protocol, "invalid event envelope");
    if (event.type === "error") {
      const message = typeof event.error === "string" ? event.error : event.error?.data?.message || event.error?.message || event.message || "OpenCode error event";
      throw fail(quota.test(message) ? EXIT.quota : EXIT.event, String(message).slice(0, LIMIT.tail));
    }
    if (event.type.startsWith("message.part.")) throw fail(EXIT.protocol, "SDK/SSE events are not flat CLI events");
    const id = event.sessionID ?? event.sessionId ?? event.part?.sessionID;
    if (id !== undefined && (typeof id !== "string" || !/^ses_[A-Za-z0-9_-]+$/.test(id))) throw fail(EXIT.protocol, "invalid event session ID");
    // Never mix a resumed conversation with unrelated/subagent output.
    session ??= id;
    if (id && session && id !== session) return;
    if (event.agent && options.agent && event.agent !== options.agent) throw fail(EXIT.agent, "reported agent differs from request");
    if (event.type === "step_start") finished = false;
    if (event.type === "text") {
      if (typeof event.part?.text !== "string") throw fail(EXIT.protocol, "text event has no part.text");
      let delta = event.part.text;
      if (event.part.id) {
        const key = event.part.messageID + ":" + event.part.id;
        const previous = snapshots.get(key) || "";
        if (!delta.startsWith(previous)) throw fail(EXIT.protocol, "non-monotonic text snapshot");
        snapshots.set(key, delta);
        if (snapshots.size > LIMIT.parts) throw fail(EXIT.protocol, "part count limit exceeded");
        delta = delta.slice(previous.length);
      }
      if (!delta) return;
      finished = false;
      if (Buffer.byteLength(text) + Buffer.byteLength(delta) > LIMIT.text) throw fail(EXIT.protocol, "assistant text limit exceeded");
      text += delta;
      // Generic JSONL joins message items with newlines. The descriptor custom parser
      // projects these deltas; generic readers see only the single final message.
      // Do not publish a new resume binding until the run actually succeeds.
      emit({ item: { type: "opencode_text_delta", text: delta } });
    }
    if (event.type === "step_finish") {
      if (!event.part || typeof event.part !== "object" || Array.isArray(event.part)) throw fail(EXIT.protocol, "step_finish has no part");
      finished = event.part?.reason === undefined || ["stop", "length"].includes(event.part.reason);
    }
    if (event.type === "step_finish" && event.part?.tokens) {
      const key = event.part.id && event.part.messageID + ":" + event.part.id;
      if (key && finishes.has(key)) return;
      if (key) finishes.add(key);
      if (finishes.size > LIMIT.parts) throw fail(EXIT.protocol, "step count limit exceeded");
      const t = event.part.tokens;
      const values = { input: t.input, output: t.output, cacheRead: t.cache?.read, cacheWrite: t.cache?.write };
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger((usage[key] || 0) + value)) throw fail(EXIT.protocol, "invalid usage");
        usage[key] = (usage[key] || 0) + value;
      }
      if (typeof event.part.cost === "number" && Number.isFinite(event.part.cost) && event.part.cost >= 0) cost = (cost || 0) + event.part.cost;
    }
  }
  await execute(cliArgs, onLine, { prompt });
  if (!text.trim()) throw fail(EXIT.protocol, "OpenCode returned no assistant text");
  if (!finished) throw fail(EXIT.protocol, "OpenCode ended without a terminal step_finish");
  if (!session) throw fail(EXIT.protocol, "OpenCode returned no session ID");
  emit({ item: { type: "message", text }, ...(session ? { sessionID: session } : {}), ...(Object.keys(usage).length ? { usage } : {}), ...(cost !== undefined ? { cost } : {}) });
}
try { await main(); } catch (e) {
  const code = e.exitCode || EXIT.child;
  const fullMessage = String(e.message);
  const message = fullMessage.length <= LIMIT.tail ? fullMessage : fullMessage.slice(0, 256) + " ... " + fullMessage.slice(-(LIMIT.tail - 261));
  emit({ type: "error", error: message, exitCode: code });
  console.error("[opencode-cli] " + message);
  process.exitCode = code;
} finally { if (timer) clearTimeout(timer); stopInput(); }
