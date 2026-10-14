import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildOpenCodeCliBackend } from "../src/cli-backend.js";
const backend = buildOpenCodeCliBackend();
test("live-test default targets the Hermes-proven step-5 route", () => {
  assert.equal(backend.liveTest.defaultModelRef,"opencode/step-5-preview-free");
});
test("descriptor is honest always-on and has no exact-cap enforcement declaration", () => {
  assert.equal(backend.nativeToolMode,"always-on");
  assert.equal(Object.hasOwn(backend,"toolAvailabilityEnforcement"),false);
  for (const args of [backend.config.args,backend.config.resumeArgs]) assert.equal(args[args.indexOf("--agent")+1],"Sisyphus - ultraworker");
});
for (const baseArgs of [backend.config.args,backend.config.resumeArgs]) {
  test("cold/resume: explicit empty or restricted tools throw before execution", () => {
    for (const toolAvailability of [{native:[],openClaw:[]},{native:["read"],openClaw:[]},{native:[],openClaw:["read"]}]) {
      assert.throws(()=>backend.resolveExecutionArgs({baseArgs,toolAvailability,executionMode:"agent"}),/cannot enforce/);
    }
    assert.throws(()=>backend.resolveExecutionArgs({baseArgs,executionMode:"side-question"}),/run not started/);
  });
  test("cold/resume: off removes thinking display and variant without mutating base args", () => {
    const original=[...baseArgs,"--variant","high"];
    const r=backend.resolveExecutionArgs({baseArgs:original,thinkingLevel:"off"});
    assert.ok(!r.includes("--thinking")); assert.ok(!r.includes("--variant")); assert.ok(!r.includes("high"));
    assert.equal(original.at(-1),"high");
  });
}
test("no provider-agnostic variant guessing for any thinking level", () => {
  for (const thinkingLevel of [undefined,"low","medium","high","max","minimal","xhigh","always on"]) {
    const r=backend.resolveExecutionArgs({baseArgs:backend.config.args,thinkingLevel});
    assert.ok(!r.includes("--variant")); assert.equal(r.filter(v=>v==="--thinking").length,1);
  }
});
test("explicit provider variants remain verbatim, not clamped to high", () => {
  for (const variant of ["minimal","max","xhigh","provider-specific"]) {
    const r=backend.resolveExecutionArgs({baseArgs:[...backend.config.args,"--variant",variant],thinkingLevel:"high"});
    assert.equal(r[r.indexOf("--variant")+1],variant);
  }
});
test("always-on model drops incompatible base variant", () => {
  const r=backend.resolveExecutionArgs({baseArgs:[...backend.config.args,"--variant","high"],thinkingLevel:"always on"});
  assert.ok(!r.includes("--variant")); assert.ok(!r.includes("high")); assert.ok(r.includes("--thinking"));
});
test("installed OpenClaw admission gate rejects disableTools and caps before spawn (source seam)", {skip:!process.env.OPENCLAW_PREPARE_MODULE}, () => {
  const source=fs.readFileSync(process.env.OPENCLAW_PREPARE_MODULE,"utf8");
  const capability=source.match(/const canEnforceExactToolAvailability = backendResolved.nativeToolMode[^\n]+;/)?.[0];
  const start=source.indexOf('if (params.cliToolAvailability !== void 0 && !canEnforceExactToolAvailability)');
  const end=source.indexOf('const { sessionAgentId }',start);
  assert.ok(capability && start!==-1 && end>start,"installed core seam changed: re-inspect rather than guessing");
  const gate=source.slice(start,end);
  for (const params of [{disableTools:true},{cliToolAvailability:{native:[],openClaw:[]}},{cliToolAvailability:{native:["read"],openClaw:["read"]}}]) {
    const sandbox={backendResolved:backend,params,isSideQuestion:false,spawnCount:0};
    assert.throws(()=>vm.runInNewContext(capability+"\n"+gate+"\nspawnCount++;",sandbox),/cannot enforce|cannot run with tools disabled/);
    assert.equal(sandbox.spawnCount,0);
  }
  const unrestricted={backendResolved:backend,params:{},isSideQuestion:false,spawnCount:0};
  vm.runInNewContext(capability+"\n"+gate+"\nspawnCount++;",unrestricted); assert.equal(unrestricted.spawnCount,1);
});
