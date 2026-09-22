import { spawn } from "node:child_process";

// OpenCode's JSON event stream is intentionally translated to the generic
// OpenClaw JSONL shape. The CLI still runs with --thinking, while the wrapper
// exposes final text and the provider session id to OpenClaw's parser.
const rawArgs = process.argv.slice(2);
const thinking = rawArgs.includes("--thinking");
const modelIndex = rawArgs.indexOf("--model");
const sessionIndex = rawArgs.indexOf("--session");
const requestedModel = modelIndex >= 0 ? rawArgs[modelIndex + 1] : undefined;
// The OpenClaw CLI backend passes the provider-stripped model name (for
// example `mimo-v2.5-free`) while OpenCode expects its canonical
// `provider/model` form. Keep fully-qualified values unchanged so the
// wrapper remains compatible with direct invocations too.
const model = requestedModel && requestedModel.includes("/")
  ? requestedModel
  : requestedModel
    ? `opencode/${requestedModel}`
    : undefined;
const sessionId = sessionIndex >= 0 ? rawArgs[sessionIndex + 1] : undefined;
const variantIndex = rawArgs.indexOf("--variant");
const variant = variantIndex >= 0 ? rawArgs[variantIndex + 1] : undefined;
const prompt = rawArgs
  .filter((arg, index) =>
    !["--thinking", "--model", "--session", "--variant"].includes(arg) &&
    index !== modelIndex + 1 && index !== sessionIndex + 1 && index !== variantIndex + 1,
  )
  .at(-1);

if (!prompt) {
  console.error("OpenCode CLI wrapper requires a prompt");
  process.exit(2);
}

const cliArgs = ["run", "--format", "json"];
if (thinking) cliArgs.push("--thinking");
if (model) cliArgs.push("--model", model);
if (sessionId) cliArgs.push("--session", sessionId);
if (variant) cliArgs.push("--variant", variant);
cliArgs.push(prompt);

const child = spawn("opencode.cmd", cliArgs, {
  cwd: process.cwd(),
  env: { ...process.env },
  shell: process.platform === "win32",
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let text = "";
let reasoning = "";
let capturedSessionId = sessionId;
let stderr = "";
let buffer = "";

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
  if (buffer) handleLine(buffer);
  if (code !== 0 && !text) {
    console.error(stderr.trim() || `opencode exited with code ${code}`);
    process.exit(code || 1);
    return;
  }
  emit({ item: { type: "message", text }, ...(capturedSessionId ? { sessionID: capturedSessionId } : {}) });
});
