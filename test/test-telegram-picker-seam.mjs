// Installed-code seam tests with explicit dependency stubs. NOT Telegram E2E.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { buildOpenCodeZenInferenceGuard } from "../src/zen-inference-guard.js";
const dist=process.env.OPENCLAW_DIST || "C:/Users/ClawLabs/AppData/Roaming/npm/node_modules/openclaw/dist";
const handlerPath=path.join(dist,"transport-status-D5EbAgHL.mjs");
const available=fs.existsSync(handlerPath);

test("actual provider-owner lookup seam selects loaded guard; absence is unguarded", {skip:!available}, () => {
  const ownerCode=fs.readFileSync(path.join(dist,"provider-owner-index-DC0jvNkI.mjs"),"utf8").split("\n").filter(l=>!l.startsWith("import ")&&!l.startsWith("export ")).join("\n");
  const source=fs.readFileSync(path.join(dist,"model-ref-shared-DNbjvLQv.mjs"),"utf8");
  const lookupCode=source.slice(source.indexOf("const indexes ="),source.indexOf("//#region src/agents/provider-model-normalization.runtime.ts"));
  const manifest=JSON.parse(fs.readFileSync(new URL("../openclaw.plugin.json",import.meta.url),"utf8"));
  const ctx={normalizeProviderId:s=>String(s||"").toLowerCase(),normalizeLowercaseStringOrEmpty:s=>String(s||"").toLowerCase(),resolveGlobalSingleton:(_k,init)=>init(),getPluginRuntimeGatewayRequestScope:()=>undefined,getPluginRuntimeLoadContextState:()=>undefined};
  vm.createContext(ctx);vm.runInContext(ownerCode+"\n"+lookupCode,ctx);
  const owners=ctx.buildDeclaredProviderOwnerIndex([manifest,{id:"opencode",providers:["opencode"]}]);
  assert.equal(ctx.matchesDeclaredProviderOwner(owners,"opencode","opencode-cli"),true);
  const guard=buildOpenCodeZenInferenceGuard();
  const registration={pluginId:"opencode-cli",provider:guard};
  const params={provider:"opencode",ownerRefs:[],registry:{providers:[registration]},isOwnerEligible:id=>id==="opencode-cli"&&ctx.matchesDeclaredProviderOwner(owners,"opencode",id)};
  assert.equal(ctx.findProviderRuntimeRegistrationInRegistry(params),registration);
  assert.equal(ctx.findProviderRuntimeRegistrationInRegistry({...params,registry:{providers:[]}}),undefined);
});

test("real Telegram request fragment preserves runtime except default selection", {skip:!available}, () => {
  const source=fs.readFileSync(handlerPath,"utf8");
  const start=source.indexOf("const applied = await retryModelAction(() => applySessionModelSelection({");
  assert.ok(start>=0);
  const request=source.slice(start).match(/request: (\{[\s\S]*?\n\t\t\t\}),/)[1];
  const ctx={};vm.createContext(ctx);
  vm.runInContext("function requestFor(selection,isDefaultSelection){return "+request+";}",ctx);
  const picked=ctx.requestFor({provider:"opencode",model:"big-pickle"},false);
  assert.equal(picked.runtime.kind,"unchanged");
  assert.equal(ctx.requestFor({provider:"opencode",model:"big-pickle"},true).runtime.kind,"clear");
});
test("actual runtime directive seam: model-only retains pin; explicit default clears", {skip:!available}, () => {
  const source=fs.readFileSync(path.join(dist,"directive-handling.model-runtime-Cu_ExKA9.mjs"),"utf8");
  const code=source.split("\n").filter(l=>!l.startsWith("import ")&&!l.startsWith("export ")).join("\n");
  const ctx={normalizeProviderId:s=>String(s||"").toLowerCase(),normalizeOptionalAgentRuntimeId:s=>s?.trim().toLowerCase(),isDefaultAgentRuntimeId:s=>s==="auto"||s==="default",resolveCompatibleAgentRuntimeForProvider:({runtime})=>["openclaw","opencode-cli"].includes(runtime)?runtime:undefined};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const entry={agentRuntimeOverride:"openclaw"};
  assert.equal(ctx.resolveModelRuntimeDirective({provider:"opencode",sessionEntry:entry}).kind,"unchanged");
  const reset=ctx.resolveModelRuntimeDirective({provider:"opencode",sessionEntry:entry,rawRuntime:"default"});
  assert.equal(reset.kind,"clear");ctx.applyModelRuntimeDirective(entry,reset);assert.equal(entry.agentRuntimeOverride,undefined);
  const select=ctx.resolveModelRuntimeDirective({provider:"opencode",sessionEntry:entry,rawRuntime:"opencode-cli"});
  assert.equal(select.kind,"set");ctx.applyModelRuntimeDirective(entry,select);assert.equal(entry.agentRuntimeOverride,"opencode-cli");
});
