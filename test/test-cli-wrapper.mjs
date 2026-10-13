import test from "node:test";
import { buildOpenCodeCliBackend } from "../src/cli-backend.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const wrapper = path.join(root, "src/opencode-cli-wrapper.js");
const fixture = fileURLToPath(new URL("./fixtures/fake-opencode.mjs", import.meta.url));
const agent = ["--agent", "Sisyphus - ultraworker"];
const scratch = fs.mkdtempSync(path.join(root, ".wrapper-test-"));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
let serial = 0;
function launch(mode = "normal", args = [], input = "question", env = {}, cancel = false) {
  const tracePath = path.join(scratch, String(++serial) + ".jsonl");
  const nodeArgs = cancel ? ["--import", new URL("./fixtures/cancel-bootstrap.mjs", import.meta.url).href, wrapper, ...args] : [wrapper, ...args];
  const child = spawn(process.execPath, nodeArgs, { cwd: root, env: { ...process.env, OPENCODE_BIN: fixture, OPENCODE_CONFIG_CONTENT: "{}", OPENCODE_RUN_TIMEOUT_MS: "5000", FIXTURE_MODE: mode, FIXTURE_TRACE: tracePath, ...env }, windowsHide: true, stdio: cancel ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", c => stdout += c); child.stderr.on("data", c => stderr += c);
  child.stdin.on("error", () => {});
  if (input !== null) child.stdin.end(input);
  const result = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr, records: stdout.trim().split("\n").filter(Boolean).map(JSON.parse), trace: fs.existsSync(tracePath) ? fs.readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] }));
  });
  return { child, result, tracePath };
}
const run = (...args) => launch(...args).result;
const messages = r => r.records.filter(e => e.item?.type === "message");
function assertFailure(r, code) { assert.equal(r.code, code, r.stderr); assert.equal(messages(r).length, 0); assert.equal(r.records.at(-1).type, "error"); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function waitForDescendant(tracePath) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (fs.existsSync(tracePath)) {
      const records = fs.readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
      const row = records.find(r => r.descendant);
      if (row) return row.descendant;
    }
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error("fixture descendant did not start");
}
test("normal: snapshot dedup, no reasoning, aggregate usage and one final message", async () => {
  const r = await run("normal", [...agent, "--thinking", "--model", "mimo-v2.6-flash-free"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(messages(r).length, 1);
  assert.equal(messages(r)[0].item.text, "Olá 🧪");
  assert.equal(messages(r)[0].sessionID, "ses_main");
  assert.deepEqual(messages(r)[0].usage, { input: 12, output: 9, cacheRead: 3, cacheWrite: 1 });
  assert.equal(messages(r)[0].cost, 0.003);
  assert.equal(r.records.filter(e => e.item?.type === "opencode_text_delta").map(e => e.item.text).join(""), "Olá 🧪");
  assert.ok(!r.stdout.includes("never expose reasoning"));
  assert.deepEqual(r.trace.filter(e => e.args).map(e => e.args[0]), ["agent", "run"]);
});
for (const [mode, code] of [["quotaLargeChunk",66],["truncated",67],["toolFinish",67],["missingSession",67],["error",65],["emptyError",65],["partialError",65],["quota",66],["splitQuota",66],["partialExit",69],["emptyExit",69],["empty",67],["malformed",67],["invalidUtf8",67],["sdk",67],["largeLine",67],["largeStderr",67],["largeStdout",67],["largeText",67],["nonmonotonic",67],["badUsage",67]]) {
  test("fail closed: " + mode, async () => assertFailure(await run(mode), code));
}
for (const mode of ["unknownAgent", "subagent", "agentListFail", "fallback", "agentMismatch"]) {
  test("no silent agent fallback: " + mode, async () => {
    const r = await run(mode, agent); assertFailure(r, 68);
    if (["unknownAgent", "subagent", "agentListFail"].includes(mode)) assert.ok(!r.trace.some(e => e.args?.[0] === "run"));
  });
}
test("spawn failure is distinct", async () => assertFailure(await run("normal", [], "question", { OPENCODE_BIN: path.join(root, "definitely-missing.exe") }), 127));
test("Unicode split into single-byte writes survives decoding", async () => {
  const r = await run("unicode"); assert.equal(r.code, 0, r.stderr); assert.equal(messages(r)[0].item.text, "Olá 🧪 漢字");
});
test("late final session and usage, no newline tail", async () => {
  const r = await run("lateSession"); assert.equal(r.code, 0, r.stderr); assert.equal(messages(r)[0].sessionID, "ses_late"); assert.deepEqual(messages(r)[0].usage, { input: 2, output: 3 });
});
test("resume forwards exact session and only current stdin prompt", async () => {
  const r = await run("sessionMismatch", [...agent, "--session", "ses_main"], "second turn");
  assert.equal(r.code, 0, r.stderr); assert.equal(messages(r)[0].item.text, "ok"); assert.ok(!r.stdout.includes("secret"));
  const command = r.trace.find(e => e.args?.[0] === "run").args;
  assert.equal(command[command.indexOf("--session") + 1], "ses_main");
  assert.equal(r.trace.find(e => e.inputBytes).inputBytes, 11); assert.ok(!command.includes("--continue"));
});
test("long Unicode multiline stdin is intact and absent from argv", async () => {
  const prompt = "Linha 🧪 漢字\n".repeat(30000);
  const r = await run("normal", agent, prompt); assert.equal(r.code, 0, r.stderr);
  const capture = r.trace.find(e => e.inputBytes);
  assert.equal(capture.inputBytes, Buffer.byteLength(prompt)); assert.equal(capture.sha256, createHash("sha256").update(prompt).digest("hex"));
  assert.ok(r.trace.find(e => e.args?.[0] === "run").args.every(v => v.length < 100));
});
test("positional prompt is delivered exactly once via stdin (legacy arg extraction regression)", async () => {
  const r = await run("normal", ["question as positional"], "ignored stdin"); assert.equal(r.code, 0, r.stderr);
  assert.equal(r.trace.find(e => e.inputBytes).inputBytes, 22); assert.equal(r.trace.find(e => e.args?.[0] === "run").args.length, 3);
});
for (const [model, expected] of [["mimo-v2.6-flash-free","opencode/mimo-v2.6-flash-free"],["opencode/opencode/foo","opencode/foo"],["opencode/foo","opencode/foo"],["anthropic/claude-model","anthropic/claude-model"],["openrouter/anthropic/claude-model","openrouter/anthropic/claude-model"]]) {
  test("model normalization: " + model, async () => {
    const r = await run("normal", ["--model",model]); assert.equal(r.code, 0, r.stderr);
    const args = r.trace.find(e => e.args?.[0] === "run").args; assert.equal(args[args.indexOf("--model")+1],expected);
  });
}
for (const args of [["--model"],["--model","--agent","build"],["--model","bad//model"],["--model","-m"],["--session","global"],["--attach","http://localhost:4096"],["--continue"],["--model","foo","--model","bar"],["one","two"],["--agent"," padded "],["--variant","high\n--auto"]]) {
  test("invalid args fail pre-spawn: " + JSON.stringify(args), async () => { const r = await run("normal",args); assertFailure(r,2); assert.equal(r.trace.length,0); });
}
for (const value of ["NaN","0","-1","Infinity","1.5"]) test("invalid timeout " + value, async () => { const r = await run("normal",[],"question",{ OPENCODE_RUN_TIMEOUT_MS:value }); assertFailure(r,2); assert.equal(r.trace.length,0); });
test("empty stdin fails instead of false success", async () => assertFailure(await run("normal",[],""),2));
test("NUL stdin fails", async () => assertFailure(await run("normal",[],"bad\0prompt"),2));
test("stderr retains bounded diagnostic tail", async () => { const r = await run("stderrTail"); assertFailure(r,69); assert.match(r.stderr,/TAIL_DIAGNOSTIC/); assert.ok(r.stderr.length < 17000); });
test("timeout kills private tree without killing unrelated sibling", async () => {
  const sibling = spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{ windowsHide:true, stdio:"ignore" });
  try {
    const work = launch("silentTree",[],"question",{OPENCODE_RUN_TIMEOUT_MS:"1000",OPENCODE_HEARTBEAT_INTERVAL_MS:"40"});
    const descendant = await waitForDescendant(work.tracePath); const r = await work.result; assertFailure(r,124);
    assert.match(r.records.at(-1).error, /timed out during inference after 1000ms/);
    assert.ok(r.records.filter(e=>e.item?.type==="opencode_progress").length > 2);
    assert.equal(r.records.filter(e=>e.item?.type==="opencode_text_delta").length,0);
    assert.equal(alive(descendant),false,"owned descendant survived timeout"); assert.equal(alive(sibling.pid),true,"unrelated process was killed");
  } finally { sibling.kill(); }
});
test("agent preflight uses same timeout and cannot run inference", async () => { const r=await run("agentHang",agent,"question",{OPENCODE_RUN_TIMEOUT_MS:"400"}); assertFailure(r,124); assert.ok(!r.trace.some(e=>e.args?.[0]==="run")); });
test("JS cancellation hook reaps private tree on Windows and POSIX", async () => {
  const work = launch("timeout",[],"question",{},true);
  const descendant = await waitForDescendant(work.tracePath);
  work.child.send("cancel");
  const r = await work.result; assertFailure(r,143); assert.equal(alive(descendant),false,"owned descendant survived JS cancellation");
});
test("real POSIX SIGTERM reaps private tree", {skip:process.platform==="win32"}, async () => {
  const work=launch("timeout"); const descendant=await waitForDescendant(work.tracePath); work.child.kill("SIGTERM"); const r=await work.result; assertFailure(r,143); assert.equal(alive(descendant),false);
});
test("installed OpenClaw generic JSONL parser: final text/session/usage exact, no duplicated deltas", {skip:!process.env.OPENCLAW_JSONL_MODULE}, async () => {
  const { m:createParser, p:parseOutput } = await import(pathToFileURL(process.env.OPENCLAW_JSONL_MODULE).href);
  const r = await run("normal",agent); assert.equal(r.code,0,r.stderr);
  const backend = { sessionIdFields:["sessionID","sessionId"] };
  const deltas=[]; const parser=createParser({backend,providerId:"opencode-cli",onAssistantDelta:d=>deltas.push(d)});
  for (const line of r.stdout.split("\n")) parser.push(line+"\n"); parser.finish();
  const output=parser.getOutput(); assert.equal(output.text,"Olá 🧪"); assert.equal(output.sessionId,"ses_main"); assert.deepEqual(output.usage,{input:12,output:9,cacheRead:3,cacheWrite:1,total:undefined});
  assert.equal(deltas.length,0,"generic parser has no OpenCode incremental hook; do not claim channel streaming");
  assert.equal(parseOutput({raw:r.stdout,backend,providerId:"opencode-cli",outputMode:"jsonl"}).text,"Olá 🧪");
});

test("custom official parser streams exact deltas and final result without duplicate text", {skip:!process.env.OPENCLAW_JSONL_MODULE}, async () => {
  const { m:createParser } = await import(pathToFileURL(process.env.OPENCLAW_JSONL_MODULE).href);
  const descriptor=buildOpenCodeCliBackend();
  const r=await run("normal",agent); assert.equal(r.code,0,r.stderr);
  const deltas=[], sessions=[];
  const parser=createParser({backend:descriptor.config,providerId:descriptor.id,parseJsonlEvent:descriptor.parseJsonlEvent,onAssistantDelta:d=>deltas.push(d.delta),onSessionId:id=>sessions.push(id)});
  for (const line of r.stdout.trim().split("\n")) parser.push(line+"\n"); parser.finish();
  assert.deepEqual(deltas,["Olá"," 🧪"]); assert.equal(parser.getOutput().text,"Olá 🧪"); assert.equal(parser.getOutput().sessionId,"ses_main");
  assert.deepEqual(parser.getOutput().usage,{input:12,output:9,cacheRead:3,cacheWrite:1});
  assert.equal(parser.hasTerminalResult(),true); assert.deepEqual(sessions,["ses_main"]);
  for (const mode of ["partialError","partialExit","quota"]) {
    const failed=await run(mode); assert.notEqual(failed.code,0);
    const observed=[];
    const p=createParser({backend:descriptor.config,providerId:descriptor.id,parseJsonlEvent:descriptor.parseJsonlEvent,onAssistantDelta:()=>{},onSessionId:id=>observed.push(id)});
    p.push(failed.stdout); p.finish(); assert.ok(p.getOutput().errorText); assert.deepEqual(observed,[],"failed run published an invalid new resume binding");
  }
});
test("stdin prompt bound rejects oversized payload explicitly", async () => assertFailure(await run("normal",[],"x".repeat(17*1024*1024)),2));

test("cleanup failure is explicit and does not hang the private root", {skip:process.platform!=="win32"}, async () => {
  const work=launch("hang",[],"question",{},true);
  const deadline=Date.now()+4000;
  while ((!fs.existsSync(work.tracePath) || !fs.readFileSync(work.tracePath,"utf8").includes("inputBytes")) && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
  assert.ok(fs.existsSync(work.tracePath),"fixture did not start");
  work.child.send({kind:"breakCleanup",root:path.join(root,"missing-system-root")});
  const r=await work.result;
  assertFailure(r,143); assert.match(r.stderr,/cancelled by SIGTERM; owned tree cleanup failed/);
  assert.equal(alive(r.trace.find(row=>row.args?.[0]==="run").pid),false);
});


test("child-only config merge preserves plugins/persona/provider values in preflight and inference", async () => {
  const config = { snapshot: true, small_model: "opencode/disabled", plugin: ["oh-my-opencode"], agent: { "Sisyphus - ultraworker": { temperature: 0.3 } }, provider: { custom: { options: { apiKey: "synthetic-secret" } } } };
  const r = await run("normal", [...agent,"--model","opencode/opencode/big-pickle"], "question", { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_AUTOUPDATE: "false" });
  assert.equal(r.code,0,r.stderr);
  for (const row of r.trace.filter(e=>e.args)) {
    assert.deepEqual(row.config, { ...config, snapshot:false, small_model:"opencode/big-pickle" });
    assert.equal(row.autoUpdateDisabled,"true");
  }
  assert.deepEqual(r.trace.filter(e=>e.args).map(e=>e.args[0]),["agent","run"]);
  assert.ok(!r.stdout.includes("synthetic-secret")); assert.ok(!r.stderr.includes("synthetic-secret"));
});
test("no --model retains supplied small_model; absent config creates snapshot override only", async () => {
  const r=await run("normal",[],"question",{OPENCODE_CONFIG_CONTENT:JSON.stringify({small_model:"custom/model",plugin:["omo"]})});
  assert.equal(r.code,0,r.stderr); assert.deepEqual(r.trace[0].config,{small_model:"custom/model",plugin:["omo"],snapshot:false});
  const absent=await run("normal",[],"question",{OPENCODE_CONFIG_CONTENT:undefined});
  assert.equal(absent.code,0,absent.stderr); assert.deepEqual(absent.trace[0].config,{snapshot:false});
});
for (const content of ["", "{synthetic-secret-invalid", "null", "[]", "1", "true", JSON.stringify("synthetic-secret")]) {
  test("invalid config fails explicitly before any spawn: " + content, async () => {
    const r=await run("normal",agent,"question",{OPENCODE_CONFIG_CONTENT:content});
    assertFailure(r,2); assert.equal(r.trace.length,0);
    assert.match(r.records.at(-1).error,/OPENCODE_CONFIG_CONTENT must be a valid JSON object/);
    assert.ok(!r.stdout.includes("synthetic-secret")); assert.ok(!r.stderr.includes("synthetic-secret"));
  });
}
for (const value of ["0","-1","60001","NaN","1.5"]) test("invalid heartbeat interval fails pre-spawn: "+value,async()=>{
  const r=await run("normal",[],"question",{OPENCODE_HEARTBEAT_INTERVAL_MS:value}); assertFailure(r,2); assert.equal(r.trace.length,0);
});
test("silent startup/inference emit repeated JSONL heartbeat with no projected text and no timer leak",async()=>{
  const r=await run("silent",agent,"question",{OPENCODE_HEARTBEAT_INTERVAL_MS:"30"});
  assert.equal(r.code,0,r.stderr);
  const beats=r.records.filter(e=>e.item?.type==="opencode_progress");
  const backend=buildOpenCodeCliBackend();
  for (const phase of ["preflight","inference"]) assert.ok(beats.filter(e=>e.item.phase===phase).length>=3);
  for (const beat of beats) {
    assert.deepEqual(Object.keys(beat),["item"]);
    assert.deepEqual(Object.keys(beat.item),["type","phase"]);
    assert.equal(backend.parseJsonlEvent(JSON.stringify(beat)),null);
  }
  assert.equal(r.records.at(-1).item.type,"message","heartbeat leaked after final result");
});
test("silent preflight timeout emits heartbeat, explicit primary error and cleans timers",async()=>{
  const r=await run("agentHang",agent,"question",{OPENCODE_RUN_TIMEOUT_MS:"400",OPENCODE_HEARTBEAT_INTERVAL_MS:"30"});
  assertFailure(r,124); assert.match(r.records.at(-1).error,/timed out during preflight/);
  assert.ok(r.records.filter(e=>e.item?.type==="opencode_progress").length>=3);
  assert.ok(!r.trace.some(e=>e.args?.[0]==="run"));
  assert.equal(alive(r.trace[0].pid),false);
});

test("installed generic/custom JSONL parser ignores heartbeat-only output without terminal success",{skip:!process.env.OPENCLAW_JSONL_MODULE},async()=>{
  const {m:createParser}=await import(pathToFileURL(process.env.OPENCLAW_JSONL_MODULE).href);
  const descriptor=buildOpenCodeCliBackend();
  for(const custom of [false,true]) {
    const deltas=[],sessions=[];
    const parser=createParser({backend:descriptor.config,providerId:descriptor.id,...(custom?{parseJsonlEvent:descriptor.parseJsonlEvent}:{}),onAssistantDelta:d=>deltas.push(d),onSessionId:id=>sessions.push(id)});
    for(const phase of ["preflight","inference"]) parser.push(JSON.stringify({item:{type:"opencode_progress",phase}})+"\n");
    // The installed parser represents wholly ignored output as null, not an empty result.
    parser.finish();assert.equal(parser.getOutput(),null);
    assert.deepEqual(deltas,[]);assert.deepEqual(sessions,[]);assert.equal(parser.hasTerminalResult(),false);
  }
});
