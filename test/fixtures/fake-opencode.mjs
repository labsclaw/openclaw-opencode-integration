import fs from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
const mode = process.env.FIXTURE_MODE || "normal";
function trace(record) { if (process.env.FIXTURE_TRACE) fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify(record) + "\n"); }
trace({ args, pid: process.pid, config: JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}"), autoUpdateDisabled: process.env.OPENCODE_DISABLE_AUTOUPDATE });
if (mode === "silent") await new Promise(resolve => setTimeout(resolve, 180));
const emit = (e, newline = true) => process.stdout.write(JSON.stringify(e) + (newline ? "\n" : ""));
const text = (value, extra = {}) => emit({ type: "text", sessionID: "ses_main", part: { text: value }, ...extra });
if (args[0] === "loop") { setInterval(() => {}, 1000); }
else if (args[0] === "agent") {
  if (mode === "agentHang") setInterval(() => {}, 1000);
  else if (mode === "agentListFail") process.exitCode = 9;
  else process.stdout.write(mode === "unknownAgent" ? "build (primary)\n" : mode === "subagent" ? "Sisyphus - ultraworker (subagent)\n" : 'Sisyphus - ultraworker (primary)\n  [{"permission":"*"}]\n');
} else {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const prompt = Buffer.concat(chunks);
  trace({ inputBytes: prompt.length, sha256: createHash("sha256").update(prompt).digest("hex"), cwd: process.cwd(), projectConfigDisabled: process.env.OPENCODE_DISABLE_PROJECT_CONFIG });
  switch (mode) {
    case "error": emit({ type: "error", error: { name: "APIError", data: { message: "authentication denied" } } }); break;
    case "emptyError": emit({ type: "error", error: {} }); break;
    case "partialError": text("partial"); emit({ type: "error", error: "upstream broke" }); break;
    case "quota": text("partial"); emit({ type: "error", error: { data: { message: "Free usage exceeded" } } }); break;
    case "quotaLargeChunk": process.stderr.write("Free usage exceeded " + "x".repeat(70000)); text("partial"); break;
    case "hang": text("partial"); setInterval(() => {}, 1000); break;
    case "splitQuota": process.stderr.write("Free usage ex"); await new Promise(r => setTimeout(r, 30)); process.stderr.write("ceeded"); setInterval(() => {}, 1000); break;
    case "partialExit": text("partial"); process.stderr.write("child failure"); process.exitCode = 7; break;
    case "emptyExit": process.exitCode = 8; break;
    case "empty": break;
    case "truncated": text("partial"); break;
    case "toolFinish": text("partial"); emit({ type: "step_finish", part: { reason: "tool-calls" } }); break;
    case "missingSession": emit({type:"text",part:{text:"no session"}}); emit({type:"step_finish",part:{reason:"stop"}}); break;
    case "malformed": process.stdout.write("not json\n"); break;
    case "invalidUtf8": process.stdout.write(Buffer.from([0xff, 0x0a])); break;
    case "sdk": emit({ type: "message.part.delta", properties: { delta: "bad" } }); break;
    case "largeLine": process.stdout.write("x".repeat(1100000)); break;
    case "largeStderr": process.stderr.write("x".repeat(9 * 1024 * 1024)); break;
    case "stderrTail": process.stderr.write("x".repeat(200000) + "TAIL_DIAGNOSTIC"); process.exitCode = 9; break;
    case "largeStdout": for (let i = 0; i < 20000; i++) emit({ type: "reasoning", part: { text: "x".repeat(900) } }); break;
    case "largeText": for (let i = 0; i < 6; i++) text("x".repeat(800000)); break;
    case "fallback": process.stderr.write('Agent "Sisyphus - ultraworker" not found. Falling back to default agent'); text("build output"); break;
    case "agentMismatch": text("build output", { agent: "build" }); break;
    case "nonmonotonic": text("hello", { part: { id: "p", text: "hello" } }); text("different", { part: { id: "p", text: "different" } }); break;
    case "sessionMismatch": text("secret", { sessionID: "ses_other" }); text("ok"); emit({type:"step_finish",sessionID:"ses_main",part:{reason:"stop"}}); break;
    case "badUsage": text("ok"); emit({ type: "step_finish", part: { tokens: { input: -1 } } }); break;
    case "silentTree":
    case "timeout":
      if (mode === "timeout") text("partial");
      { const desc = spawn(process.execPath, [fileURLToPath(import.meta.url), "loop"], { env: process.env, stdio: "ignore", windowsHide: true }); trace({ descendant: desc.pid }); }
      setInterval(() => {}, 1000); break;
    case "unicode": {
      const bytes = Buffer.from(JSON.stringify({ type: "text", sessionID: "ses_unicode", part: { id: "p", text: "Olá 🧪 漢字" } }) + "\r\n");
      for (const b of bytes) { process.stdout.write(Buffer.from([b])); await new Promise(r => setTimeout(r, 1)); }
      emit({type:"step_finish",sessionID:"ses_unicode",part:{reason:"stop"}});
      break;
    }
    case "lateSession": emit({ type: "text", part: { text: "late" } }); emit({ type: "step_finish", sessionID: "ses_late", part: { tokens: { input: 2, output: 3 } } }, false); break;
    default: {
      emit({ type: "step_start", sessionID: "ses_main", part: { type: "step-start" } });
      emit({ type: "reasoning", sessionID: "ses_main", part: { text: "never expose reasoning" } });
      text("Olá", { part: { id: "p1", messageID: "m1", text: "Olá" } });
      text("Olá", { part: { id: "p1", messageID: "m1", text: "Olá" } });
      text("Olá 🧪", { part: { id: "p1", messageID: "m1", text: "Olá 🧪" } });
      const finish = { type: "step_finish", sessionID: "ses_main", part: { id: "f1", messageID: "m1", tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } }, cost: 0.001 } };
      emit(finish); emit(finish);
      emit({ type: "step_finish", sessionID: "ses_main", part: { id: "f2", messageID: "m1", tokens: { input: 2, output: 4 }, cost: 0.002 } }, false);
    }
  }
}
