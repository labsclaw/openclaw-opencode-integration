import { runOpenCode } from "../src/adapter.js";
import { buildOpenCodeCliBackend } from "../src/cli-backend.js";

const backend = buildOpenCodeCliBackend();
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
    const res = await runOpenCode({
      prompt: "Responda em uma unica frase curta o que e a teoria da relatividade.",
      model: "opencode/mimo-v2.6-flash-free",
      thinking: true,
      onReasoning: (chunk) => {
        process.stdout.write(`[REASONING] ${chunk}\n`);
      },
      onText: (chunk) => {
        process.stdout.write(`[TEXT] ${chunk}\n`);
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n=== Execução Concluída com Sucesso ===");
    console.log(`Tempo decorrido: ${elapsed}s`);
    console.log(`Session ID capturado: ${res.sessionId}`);
    console.log(`Thinking capturado: ${res.reasoning ? "SIM (" + res.reasoning.length + " chars)" : "NÃO"}`);
    console.log(`Texto final retornado: "${res.text.trim()}"`);
    console.log("Métricas de tokens:", res.tokens);
    console.log(`Custo informado: $${res.cost}`);
  } catch (err) {
    console.error("\n[ERRO] Falha no teste do adaptador:", err);
    process.exit(1);
  }
}

main();
