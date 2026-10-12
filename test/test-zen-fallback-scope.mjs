// Offline integration of the installed REAL fallback runner. Dist imports are
// test-only, never imported by production guard. No auth/network/session I/O.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { OpenCodeInferenceRouteError } from "../src/zen-inference-guard.js";
const dist=process.env.OPENCLAW_DIST || "C:/Users/ClawLabs/AppData/Roaming/npm/node_modules/openclaw/dist";
const runnerFile=path.join(dist,"model-fallback-runner-DQm27MBe.mjs");
const policyFile=path.join(dist,"agent-scope-L_eY3Hj7.mjs");
const available=fs.existsSync(runnerFile)&&fs.existsSync(policyFile);
const cfg={agents:{defaults:{model:{primary:"opencode/big-pickle",fallbacks:["openai/offline-fixture"]}}}};
async function modules(){return {runner:await import(pathToFileURL(runnerFile).href),policy:await import(pathToFileURL(policyFile).href)};}
function params(run){return {cfg,provider:"opencode",model:"big-pickle",skipAuthProfileRuntime:true,manifestPlugins:[],run};}

test("ordinary configured fallback is NOT stopped by the local guard error", {skip:!available}, async()=>{
  const {runner}=await modules();const calls=[];
  const result=await runner.t(params(async(provider,model)=>{calls.push(provider+"/"+model);if(provider==="opencode")throw new OpenCodeInferenceRouteError();return {text:"offline fake completion"};}));
  assert.deepEqual(calls,["opencode/big-pickle","openai/offline-fixture"]);
  assert.equal(result.provider,"openai");
});

test("actual USER session model override policy closes fallback contextually", {skip:!available}, async()=>{
  const {runner,policy}=await modules();const calls=[];let secondCalls=0;
  const availability=policy.m({cfg,agentId:"main",sessionKey:"agent:main:main",hasSessionModelOverride:true,modelOverrideSource:"user"});
  assert.equal(availability.kind,"disabled_by_model_override");
  const fallbacksOverride=policy.a(availability);assert.deepEqual(fallbacksOverride,[]);
  await assert.rejects(runner.t({...params(async(provider,model)=>{calls.push(provider+"/"+model);if(provider==="opencode")throw new OpenCodeInferenceRouteError();secondCalls++;return {text:"MUST NOT RUN"};}),fallbacksOverride}),/OpenCode inference requires/);
  assert.equal(secondCalls,0);assert.deepEqual(calls,["opencode/big-pickle"]);
});

test("real HOST canFallbackAfterError gate can stop, but is not a provider SDK hook", {skip:!available}, async()=>{
  const {runner}=await modules();let secondCalls=0;let gateCalls=0;
  await assert.rejects(runner.t({...params(async(provider)=>{if(provider==="opencode")throw new OpenCodeInferenceRouteError();secondCalls++;return "MUST NOT RUN";}),canFallbackAfterError:()=>{gateCalls++;return false;}}),/OpenCode inference requires/);
  assert.equal(gateCalls,1);assert.equal(secondCalls,0);
});
