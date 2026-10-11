import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// OpenCode's JSON event stream is intentionally translated to the generic
// OpenClaw JSONL shape. The CLI still runs with --thinking, while the wrapper
// exposes final text and the provider session id to OpenClaw's parser.
const rawArgs = process.argv.slice(2);
const thinking = rawArgs.includes("--thinking");
const modelIndex = rawArgs.indexOf("--model");
const sessionIndex = rawArgs.indexOf("--session");
const agentIndex = rawArgs.indexOf("--agent");
const requestedModel = modelIndex >= 0 ? rawArgs[modelIndex + 1] : undefined;
const agent = agentIndex >= 0 ? rawArgs[agentIndex + 1] : undefined;
// The OpenClaw CLI backend passes the provider-stripped model name (for
// example `mimo-v2.5-free`) while OpenCode expects its canonical
// `provider/model` form. Keep fully-qualified values unchanged so the
// wrapper remains compatible with direct invocations too.
const model = requestedModel && requestedModel.includes("/")
  ? requestedModel.replace(/^opencode\/opencode\//i, "opencode/")
  : requestedModel
    ? `opencode/${requestedModel}`
    : undefined;
const sessionId = sessionIndex >= 0 ? rawArgs[sessionIndex + 1] : undefined;
const variantIndex = rawArgs.indexOf("--variant");
const variant = variantIndex >= 0 ? rawArgs[variantIndex + 1] : undefined;
const promptArg = rawArgs
  .filter((arg, index) =>
    !["--thinking", "--model", "--session", "--variant", "--agent"].includes(arg) &&
    index !== modelIndex + 1 && index !== sessionIndex + 1 &&
    index !== variantIndex + 1 && index !== agentIndex + 1,
  )
  .at(-1);

let prompt = promptArg;
if (!prompt) {
  prompt = "";
}

if (!prompt && process.stdin.isTTY) {
  console.error("OpenCode CLI wrapper requires a prompt");
  process.exit(2);
}

const cliArgs = ["run", "--format", "json"];
if (thinking) cliArgs.push("--thinking");
if (model) cliArgs.push("--model", model);
if (agent) cliArgs.push("--agent", agent);
if (sessionId) cliArgs.push("--session", sessionId);
if (variant) cliArgs.push("--variant", variant);
if (prompt) cliArgs.push(prompt);

// Spawn the native exe (no shell) to avoid flashing a cmd.exe window on Windows.
const npmRoot = process.env.APPDATA
  ? path.join(process.env.APPDATA, "npm")
  : path.join(process.env.USERPROFILE || "", "AppData", "Roaming", "npm");
const nativeBinary = path.join(npmRoot, "node_modules", "opencode-ai", "bin", "opencode.exe");
const OPENCODE_BIN = process.env.OPENCODE_BIN
  || (process.platform === "win32" && fs.existsSync(nativeBinary) ? nativeBinary : "opencode");
const child = spawn(OPENCODE_BIN, cliArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...(process.platform === "win32" && process.env.USERPROFILE
      ? { HOME: process.env.USERPROFILE }
      : {}),
    OPENCODE_DISABLE_PROJECT_CONFIG: "true",
  },
  shell: false,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});

if (!prompt) {
  process.stdin.pipe(child.stdin);
} else {
  child.stdin.end(prompt);
}

const timeoutMs = Number(process.env.OPENCODE_RUN_TIMEOUT_MS || 240000);
let timedOut = false;
const timeout = timeoutMs > 0 ? setTimeout(() => {
  timedOut = true;
  child.kill();
}, timeoutMs) : null;

let text = "";
let reasoning = "";
let capturedSessionId = sessionId;
let stderr = "";
let buffer = "";
let emittedText = false;

function emit(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event;
  try { event = JSON.parse(trimmed); } catch { return; }
  capturedSessionId ??= event.sessionID ?? event.sessionId;
  const chunk = typeof event.part?.text === "string" ? event.part.text : "";
  if (event.type === "reasoning") reasoning += chunk;
  if (event.type === "text") {
    text += chunk;
    emittedText = true;
    emit({ item: { type: "message", text: chunk }, ...(capturedSessionId ? { sessionID: capturedSessionId } : {}) });
  }
  if (event.type === "error") {
    const errMsg = typeof event.error === "string" ? event.error : event.error?.message || event.message || JSON.stringify(event);
    if (/Free usage exceeded|rate limit|quota exceeded|subscribe to Go/i.test(errMsg)) {
      console.error(`[opencode-cli] Rate limit hit: ${errMsg}`);
      child.kill();
      process.exit(1);
    }
  }
  if (event.type === "step_finish" && event.part?.tokens) {
    emit({ usage: event.part.tokens, ...(capturedSessionId ? { sessionID: capturedSessionId } : {}) });
  }
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) handleLine(line);
});
child.stderr.on("data", (chunk) => {
  const str = chunk.toString();
  stderr += str;
  if (/Free usage exceeded|subscribe to Go|retrying in \d+h/i.test(str)) {
    console.error(`[opencode-cli] ${str.trim()}`);
    child.kill();
    process.exit(1);
  }
});
child.on("error", (error) => { console.error(error.message); process.exit(1); });
child.on("close", (code) => {
  if (timeout) clearTimeout(timeout);
  if (buffer) handleLine(buffer);
  if (timedOut) {
    console.error(`[opencode-cli] timed out after ${timeoutMs}ms`);
    process.exit(124);
    return;
  }
  if (code !== 0 && !text) {
    console.error(stderr.trim() || `opencode exited with code ${code}`);
    process.exit(code || 1);
    return;
  }
  if (!emittedText && text) {
    emit({ item: { type: "message", text }, ...(capturedSessionId ? { sessionID: capturedSessionId } : {}) });
  }
});
