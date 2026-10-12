import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildOpenCodeZenInferenceGuard, wrapOpenCodeHostedInference, OPENCODE_CLI_ROUTE_REQUIRED } from "../src/zen-inference-guard.js";

for (const hook of ["wrapStreamFn", "wrapSimpleCompletionStreamFn"]) {
  test(hook + " refuses hosted inference without invoking inner", () => {
    let calls = 0;
    const inner = () => { calls++; throw new Error("NETWORK MUST NOT RUN"); };
    const guard = buildOpenCodeZenInferenceGuard();
    const ctx = { provider: "opencode", modelId: "big-pickle", model: { provider: "opencode", api: "openai-completions", baseUrl: "https://opencode.ai/zen/v1" }, streamFn: inner };
    const blocked = guard[hook](ctx);
    assert.equal(blocked, guard[hook](ctx), "deterministic wrapper identity");
    for (let i = 0; i < 2; i++) assert.throws(() => blocked(ctx.model, {}, {}), e => e.code === OPENCODE_CLI_ROUTE_REQUIRED && e.name === "OpenCodeInferenceRouteError" && e.retryable === undefined && e.status === undefined);
    assert.equal(calls, 0);
  });
}
test("normalizes provider and supports utility model-only context", () => {
  for (const ctx of [{provider:" OpenCode "}, {model:{provider:"opencode"}}]) assert.throws(() => wrapOpenCodeHostedInference(ctx)(), {code:OPENCODE_CLI_ROUTE_REQUIRED});
});
test("other providers are untouched, including opencode-go", () => {
  const inner = () => "other-provider";
  for (const provider of ["openai", "opencode-go", "kilocode"]) assert.equal(wrapOpenCodeHostedInference({provider,streamFn:inner}),inner);
});
test("no inner is needed to close the OpenCode seam", () => {
  assert.throws(() => wrapOpenCodeHostedInference({provider:"opencode"})(), {code:OPENCODE_CLI_ROUTE_REQUIRED});
});
test("provider owns no catalog, credential, endpoint or config mutation", () => {
  const provider=buildOpenCodeZenInferenceGuard();
  assert.deepEqual(Object.keys(provider).sort(), ["auth","id","label","wrapSimpleCompletionStreamFn","wrapStreamFn"].sort());
  assert.deepEqual(provider.auth, []);
  assert.equal(provider.id,"opencode");
  const config={models:{providers:{opencode:{baseUrl:"https://opencode.ai/zen/v1",models:[{id:"big-pickle"}]}}}};
  const before=JSON.stringify(config);
  provider.wrapStreamFn({provider:"opencode",config});
  assert.equal(JSON.stringify(config),before);
});
test("entrypoint retains CLI registration and adds only canonical guard", () => {
  const src=fs.readFileSync(new URL("../index.js",import.meta.url),"utf8");
  const runnable=src.split("\n").filter(l=>!l.startsWith("import ")).join("\n").replace("export default definePluginEntry(","globalThis.entry=definePluginEntry(");
  const ctx={definePluginEntry:x=>x,buildOpenCodeCliBackend:()=>({id:"opencode-cli"}),buildOpenCodeZenInferenceGuard};
  vm.createContext(ctx);vm.runInContext(runnable,ctx);
  const registered=[];
  ctx.entry.register({registerCliBackend:x=>registered.push(["cli",x.id]),registerProvider:x=>registered.push(["provider",x.id])});
  assert.deepEqual(registered,[["cli","opencode-cli"],["provider","opencode"]]);
  const manifest=JSON.parse(fs.readFileSync(new URL("../openclaw.plugin.json",import.meta.url),"utf8"));
  assert.deepEqual(manifest.providers,["opencode"]);
  assert.deepEqual(manifest.cliBackends,["opencode-cli"]);
});
