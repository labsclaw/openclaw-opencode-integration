import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function normalizeModel(model) {
  const value = String(model ?? "").trim();
  if (!value) return value;
  return value.replace(/^opencode\/opencode\//i, "opencode/");
}

function resolveOpenCodeCommand(explicit) {
  if (explicit) return explicit;
  if (process.platform !== "win32") return "opencode";
  const npmRoot = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm")
    : path.join(process.env.USERPROFILE || "", "AppData", "Roaming", "npm");
  const nativeBinary = path.join(npmRoot, "node_modules", "opencode-ai", "bin", "opencode.exe");
  return fs.existsSync(nativeBinary) ? nativeBinary : "opencode.exe";
}

/**
 * Executes opencode run with structured JSON streaming output.
 * Captures reasoning blocks and final text.
 *
 * @param {Object} options
 * @param {string} options.prompt - The prompt text to send
 * @param {string} [options.model="opencode/mimo-v2.6-flash-free"] - Model to use
 * @param {string} [options.sessionId] - Session ID to continue
 * @param {string} [options.workdir] - Working directory for the execution
 * @param {boolean} [options.thinking=true] - Whether to capture thinking blocks
 * @param {Function} [options.onReasoning] - Callback for reasoning chunks: (text) => void
 * @param {Function} [options.onText] - Callback for text chunks: (text) => void
 * @returns {Promise<{ text: string, reasoning: string, sessionId: string, tokens: Object, cost: number }>}
 */
export async function runOpenCode({
  prompt,
  model = "opencode/mimo-v2.6-flash-free",
  sessionId,
  workdir = process.cwd(),
  thinking = true,
  onReasoning,
  onText,
  timeoutMs = 240_000,
  command,
}) {
  return new Promise((resolve, reject) => {
    const args = ["run", "--format", "json"];

    if (thinking) {
      args.push("--thinking");
    }

    if (model) {
      args.push("-m", normalizeModel(model));
    }

    if (sessionId) {
      args.push("-s", sessionId);
    }

    // Spawn the native exe (no shell) to avoid flashing a cmd.exe window on Windows.
    const cmd = resolveOpenCodeCommand(command);
    const child = spawn(cmd, args, {
      cwd: workdir,
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

    child.stdin.end(prompt);

    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeoutMs)
      : null;

    let fullText = "";
    let fullReasoning = "";
    let capturedSessionId = sessionId || "";
    let tokenStats = null;
    let cost = 0;
    let stderrOutput = "";

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const event = JSON.parse(trimmed);

        if (event.sessionID && !capturedSessionId) {
          capturedSessionId = event.sessionID;
        }

        switch (event.type) {
          case "reasoning": {
            const chunk = event.part?.text || "";
            fullReasoning += chunk;
            if (onReasoning && chunk) {
              onReasoning(chunk);
            }
            break;
          }

          case "text": {
            const chunk = event.part?.text || "";
            fullText += chunk;
            if (onText && chunk) {
              onText(chunk);
            }
            break;
          }

          case "step_finish": {
            if (event.part?.tokens) {
              tokenStats = event.part.tokens;
            }
            if (typeof event.part?.cost === "number") {
              cost = event.part.cost;
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        // Line wasn't JSON, ignore or treat as raw output
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn opencode process: ${err.message}`));
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        return reject(new Error(`opencode timed out after ${timeoutMs}ms. Stderr: ${stderrOutput.trim()}`));
      }
      if (code !== 0 && !fullText) {
        return reject(
          new Error(
            `opencode exited with code ${code}. Stderr: ${stderrOutput.trim()}`
          )
        );
      }

      resolve({
        text: fullText,
        reasoning: fullReasoning,
        sessionId: capturedSessionId,
        tokens: tokenStats,
        cost,
      });
    });
  });
}
