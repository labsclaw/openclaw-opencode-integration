import { spawn } from "node:child_process";
import path from "node:path";

const exited = child => child.exitCode !== null || child.signalCode !== null;

// Dependencies are injectable for deterministic Windows exit/taskkill race tests.
export function killOwnedTree(child, { platform = process.platform, spawnProcess = spawn, kill = process.kill, systemRoot = process.env.SystemRoot || "C:/Windows", setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!child?.pid) return Promise.resolve();
  if (platform !== "win32") {
    try { kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") return Promise.reject(error); }
    return Promise.resolve();
  }
  // An exited Windows root is not an ownership handle: never probe/retry its PID.
  if (exited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let deadline, exitGrace, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimer(deadline); clearTimer(exitGrace);
      child.removeListener("exit", rootExited);
      if (error) reject(error); else resolve();
    };
    const rootExited = () => finish();
    let killer;
    try {
      // No /IM, name-based kills, shared-server attachment or PID retries.
      killer = spawnProcess(path.join(systemRoot, "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false });
    } catch (error) { finish(error); return; }
    deadline = setTimer(() => {
      const error = new Error("owned tree cleanup timed out");
      try { killer.kill(); } catch (cleanup) { error.message += ": " + cleanup.message; }
      finish(error);
    }, 6000);
    killer.once("error", finish);
    killer.once("close", code => {
      if (settled) return;
      if (code === 0) { finish(); return; }
      const error = new Error("taskkill could not terminate owned process tree (" + code + ")");
      if (code !== 128 && code !== 255) { finish(error); return; }
      // taskkill can report 'not found' before Node delivers the root exit event.
      if (exited(child)) { finish(); return; }
      child.once("exit", rootExited);
      exitGrace = setTimer(() => finish(exited(child) ? undefined : error), 250);
    });
  });
}

export function attachCleanupFailure(primary, cleanup) {
  // Keep the primary identity, status and diagnostic; cleanup is secondary evidence.
  primary.cleanupError = String(cleanup.message);
  primary.message += "; owned tree cleanup failed: " + primary.cleanupError;
  return primary;
}
