import { spawn } from "node:child_process";
import readline from "node:readline";

/**
 * OpenCode ACP Harness Client.
 * Connects to `opencode acp` over stdio and manages JSON-RPC / ACP protocol frames.
 */
export class OpenCodeAcpHarness {
  constructor(options = {}) {
    this.workdir = options.workdir || process.cwd();
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.rl = null;
    this.onNotification = options.onNotification || (() => {});
  }

  /**
   * Spawns the native `opencode acp` process over stdio.
   */
  async start() {
    return new Promise((resolve, reject) => {
      const cmd = process.platform === "win32" ? "opencode.cmd" : "opencode";
      const args = ["acp"];

      this.child = spawn(cmd, args, {
        cwd: this.workdir,
        env: { ...process.env },
        shell: process.platform === "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.rl = readline.createInterface({
        input: this.child.stdout,
        crlfDelay: Infinity,
      });

      this.rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const msg = JSON.parse(trimmed);

          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve: res, reject: rej } = this.pending.get(msg.id);
            this.pending.delete(msg.id);

            if (msg.error) {
              rej(new Error(`ACP Error [${msg.error.code}]: ${msg.error.message}`));
            } else {
              res(msg.result);
            }
          } else {
            this.onNotification(msg);
          }
        } catch (err) {
          // Non-JSON output from stderr or startup banner
        }
      });

      this.child.stderr.on("data", (data) => {
        // Can be forwarded or logged if needed
      });

      this.child.on("error", (err) => {
        reject(new Error(`Failed to start opencode acp: ${err.message}`));
      });

      this.child.on("close", (code) => {
        for (const [id, { reject: rej }] of this.pending.entries()) {
          rej(new Error(`opencode acp process closed with code ${code}`));
        }
        this.pending.clear();
      });

      // Give process a moment to initialize
      setTimeout(resolve, 500);
    });
  }

  /**
   * Sends a JSON-RPC request to the ACP server.
   */
  async request(method, params = {}) {
    if (!this.child) {
      throw new Error("ACP harness is not running. Call start() first.");
    }

    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  /**
   * Sends a JSON-RPC notification.
   */
  notify(method, params = {}) {
    if (!this.child) return;
    const payload = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  /**
   * Stops the ACP server.
   */
  stop() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}
