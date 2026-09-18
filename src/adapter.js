import { spawn } from "node:child_process";
import readline from "node:readline";

/**
 * Executes opencode run with structured JSON streaming output.
 * Captures reasoning blocks and final text.
 *
 * @param {Object} options
 * @param {string} options.prompt - The prompt text to send
 * @param {string} [options.model="opencode/mimo-v2.5-free"] - Model to use
 * @param {string} [options.sessionId] - Session ID to continue
 * @param {string} [options.workdir] - Working directory for the execution
 * @param {boolean} [options.thinking=true] - Whether to capture thinking blocks
 * @param {Function} [options.onReasoning] - Callback for reasoning chunks: (text) => void
 * @param {Function} [options.onText] - Callback for text chunks: (text) => void
 * @returns {Promise<{ text: string, reasoning: string, sessionId: string, tokens: Object, cost: number }>}
 */
export async function runOpenCode({
  prompt,
  model = "opencode/mimo-v2.5-free",
  sessionId,
  workdir = process.cwd(),
  thinking = true,
  onReasoning,
  onText,
}) {
  return new Promise((resolve, reject) => {
    const args = ["run", "--format", "json"];

    if (thinking) {
      args.push("--thinking");
    }

    if (model) {
      args.push("-m", model);
    }

    if (sessionId) {
      args.push("-s", sessionId);
    }

    args.push(prompt);

    const cmd = process.platform === "win32" ? "opencode.cmd" : "opencode";
    const child = spawn(cmd, args, {
      cwd: workdir,
      env: { ...process.env },
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

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
