import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { killOwnedTree, attachCleanupFailure } from "../src/opencode-cli-process.js";

function setup() {
  const child=Object.assign(new EventEmitter(),{pid:4242,exitCode:null,signalCode:null});
  const killer=new EventEmitter(); let kills=0; killer.kill=()=>kills++;
  const timers=new Map(), calls=[];
  const dependencies={platform:"win32",spawnProcess:(...args)=>{calls.push(args);return killer;},setTimer:(fn,ms)=>{const id={};timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)};
  function exit() { child.exitCode=0; child.emit("exit",0,null); }
  function fire(ms) { const entry=[...timers].find(([,value])=>value.ms===ms);assert.ok(entry,"missing timer "+ms);timers.delete(entry[0]);entry[1].fn(); }
  return {child,killer,timers,calls,dependencies,exit,fire,kills:()=>kills};
}
for (const code of [128,255]) {
  test("taskkill "+code+" after root exit is benign and never retries PID",async()=>{
    const s=setup(), p=killOwnedTree(s.child,s.dependencies);
    s.exit(); s.killer.emit("close",code); await p;
    assert.equal(s.calls.length,1); assert.equal(s.timers.size,0);
    assert.deepEqual(s.calls[0][1],["/PID","4242","/T","/F"]);
  });
  test("taskkill "+code+" arriving before root exit tolerates event delivery race",async()=>{
    const s=setup(),p=killOwnedTree(s.child,s.dependencies);
    s.killer.emit("close",code); assert.equal(s.child.listenerCount("exit"),1);
    s.exit(); await p;
    assert.equal(s.calls.length,1); assert.equal(s.child.listenerCount("exit"),0); assert.equal(s.timers.size,0);
  });
  test("taskkill "+code+" with live root remains cleanup failure after bounded grace",async()=>{
    const s=setup(),p=killOwnedTree(s.child,s.dependencies);
    const rejected=assert.rejects(p,error => error.message === "taskkill could not terminate owned process tree ("+code+")");
    s.killer.emit("close",code); s.fire(250); await rejected;
    assert.equal(s.calls.length,1); assert.equal(s.child.listenerCount("exit"),0); assert.equal(s.timers.size,0);
  });
}
test("already exited root is never killed or probed (PID reuse safety)",async()=>{
  const s=setup();s.exit();await killOwnedTree(s.child,s.dependencies);assert.equal(s.calls.length,0);assert.equal(s.timers.size,0);
});
test("taskkill deadline terminates only killer and clears all timers/listeners",async()=>{
  const s=setup(),p=killOwnedTree(s.child,s.dependencies), rejected=assert.rejects(p,/cleanup timed out/);
  s.fire(6000);await rejected;assert.equal(s.kills(),1);assert.equal(s.timers.size,0);assert.equal(s.child.listenerCount("exit"),0);
  s.killer.emit("close",255);assert.equal(s.timers.size,0,"late close restarted a timer");
});
test("taskkill success and spawn errors clear deadline",async()=>{
  for (const success of [true,false]) {
    const s=setup(),p=killOwnedTree(s.child,s.dependencies);
    const result=success?p:assert.rejects(p,/missing taskkill/);
    if(success)s.killer.emit("close",0);else s.killer.emit("error",new Error("missing taskkill"));
    await result;assert.equal(s.timers.size,0);
  }
});
test("all primary failure identities and exit codes survive cleanup errors",()=>{
  for(const [code,message] of [[124,"timed out during inference"],[143,"cancelled by SIGTERM"],[65,"authentication denied"],[67,"malformed JSON event"],[69,"OpenCode exited 7"]]) {
    const primary=Object.assign(new Error(message),{exitCode:code});
    assert.equal(attachCleanupFailure(primary,new Error("taskkill failed")),primary);
    assert.equal(primary.exitCode,code);assert.equal(primary.message,message+"; owned tree cleanup failed: taskkill failed");assert.equal(primary.cleanupError,"taskkill failed");
  }
});
test("POSIX cleanup uses only private process group and tolerates ESRCH",async()=>{
  const calls=[];await killOwnedTree({pid:4242},{platform:"linux",kill:(...args)=>calls.push(args)});assert.deepEqual(calls,[[-4242,"SIGKILL"]]);
  await killOwnedTree({pid:4242},{platform:"linux",kill:()=>{throw Object.assign(new Error("gone"),{code:"ESRCH"});}});
});

test("killer kill errors cannot suppress the bounded cleanup timeout",async()=>{
  const s=setup();s.killer.kill=()=>{throw new Error("kill denied");};
  const p=killOwnedTree(s.child,s.dependencies),result=assert.rejects(p,/cleanup timed out: kill denied/);
  s.fire(6000);await result;assert.equal(s.timers.size,0);
});
test("synchronous taskkill spawn errors leave no timers or listener",async()=>{
  const s=setup();s.dependencies.spawnProcess=()=>{throw new Error("spawn denied");};
  await assert.rejects(killOwnedTree(s.child,s.dependencies),/spawn denied/);
  assert.equal(s.timers.size,0);assert.equal(s.child.listenerCount("exit"),0);
});
