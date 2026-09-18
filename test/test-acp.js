import { OpenCodeAcpHarness } from "../src/acp-harness.js";

async function main() {
  console.log("=== Teste de Inicialização do Harness ACP (Rota A) ===");
  const harness = new OpenCodeAcpHarness({
    onNotification: (msg) => {
      console.log("[ACP NOTIFICATION]", JSON.stringify(msg));
    },
  });

  try {
    console.log("1. Iniciando processo opencode acp...");
    await harness.start();
    console.log("Processo iniciado com sucesso.");

    console.log("2. Enviando initialize request...");
    const initRes = await harness.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        auth: { terminal: false },
      },
      clientInfo: {
        name: "openclaw-acp-client",
        version: "1.0.0",
      },
    });
    console.log("Initialize response recebida:", JSON.stringify(initRes, null, 2));

    console.log("3. Enviando session/new request...");
    const sessionRes = await harness.request("session/new", {
      cwd: process.cwd(),
      mcpServers: [],
    });
    console.log("Session/new response recebida:", JSON.stringify(sessionRes, null, 2));

    harness.stop();
    console.log("\n=== Teste ACP Concluído com Sucesso Total ===");
  } catch (err) {
    console.error("\n[ERRO] Falha no teste ACP:", err.message);
    harness.stop();
    process.exit(1);
  }
}

main();
