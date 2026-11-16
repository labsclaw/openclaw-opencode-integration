import { spawnSync } from "node:child_process";
import { buildOpenCodeCliBackend } from "../src/cli-backend.js";

const backend = buildOpenCodeCliBackend({ mode: process.env.OPENCODE_TEST_MODE ?? "native" });
const agentIndex = backend.config.args.indexOf("--agent");
if (agentIndex < 0 || !backend.config.args.includes("--mode")) {
  throw new Error(
    "OpenCode CLI backend must declare its mode and requested agent",
  );
}
const alwaysOnArgs = backend.resolveExecutionArgs({
  baseArgs: ["node", "wrapper.js", "--thinking", "--variant", "high"],
  thinkingLevel: "always on",
});
if (!alwaysOnArgs.includes("--thinking") || alwaysOnArgs.includes("--variant") || alwaysOnArgs.includes("high")) {
  throw new Error(`Mimo always-on thinking was not normalized correctly: ${JSON.stringify(alwaysOnArgs)}`);
}

async function main() {
  console.log("=== Teste do Adaptador OpenCode CLI (Rota B) ===");
  const startTime = Date.now();

  try {
    const model = process.env.OPENCODE_TEST_MODEL;
    if (!model) throw new Error("Set OPENCODE_TEST_MODEL to an explicitly authorized model before live inference");
    const run = spawnSync(process.execPath, [...backend.config.args, "--model", model], {
      input: "Responda somente OC_NATIVE_OK. Não use ferramentas.", encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024,
    });
    if (run.error) throw run.error;
    if (run.status !== 0) throw new Error(run.stderr || "OpenCode wrapper failed");
    const records = run.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const res = records.find(row => row.item?.type === "message");
    if (!res) throw new Error("No terminal message from wrapper");

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n=== Execução Concluída com Sucesso ===");
    console.log(`Tempo decorrido: ${elapsed}s`);
    console.log(`Session ID capturado: ${res.sessionID}`);
    console.log(`Texto final retornado: "${res.item.text.trim()}"`);
    console.log("Métricas de tokens:", res.usage);
    console.log(`Custo informado: $${res.cost}`);
  } catch (err) {
    console.error("\n[ERRO] Falha no teste do adaptador:", err);
    process.exit(1);
  }
}

main();
