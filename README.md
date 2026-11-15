# OpenClaw OpenCode Integration (Sisyphus CLI)

Integração de alta fidelidade entre o **OpenClaw Gateway** e o **OpenCode CLI** com a persona **Sisyphus - ultraworker** (Oh-My-OpenAgent).

## 🎯 Visão Geral e Motivação

O endpoint oficial Zen (`https://opencode.ai/zen/v1`) valida contextualmente as chamadas aos modelos gratuitos (`mimo-v2.6-flash-free`, `big-pickle`, etc.), rejeitando clientes HTTP de terceiros com:

```
HTTP 403: OpenCode's free tier can only be used from within OpenCode
```

Esta integração **encaminha a inferência para o executável nativo do OpenCode CLI local**, com preflight da persona **`Sisyphus - ultraworker`**. O guard recusa a rota hosted nos hooks de inferência registrados, mas não garante elegibilidade gratuita: o próprio CLI também pode receber `FreeTierError`. Catálogo e presença de login não comprovam inferência saudável.

---

## 🏗️ Arquitetura dos Componentes

1. **Namespace Canônico (`opencode/*`):** Mantém o catálogo oficial descoberto via Gateway (`models.providers.opencode`), preservando compatibilidade com ferramentas de auditoria e seleção de modelos.
2. **Zen Inference Guard (`src/zen-inference-guard.js`):** Intercepta hooks de stream hosted do Gateway (`wrapStreamFn` e `wrapSimpleCompletionStreamFn`) e lança `OPENCODE_CLI_ROUTE_REQUIRED` caso uma sessão desconfigurada tente fazer requisições HTTP para a Zen API.
3. **CLI Backend Descriptors (`src/cli-backend.js`):** Declaração com `nativeToolMode: "always-on"` e parser customizado `parseJsonlEvent` para streaming incremental em deltas de texto sem duplicação.
4. **Wrapper CLI Robusto (`src/opencode-cli-wrapper.js`):**
   - Execução direta de binários nativos (`opencode.exe` no Windows, sem console `.cmd` piscando).
   - Validação prévia de existência da persona primária `Sisyphus - ultraworker`.
   - Limpeza estrita de árvore de processos (`taskkill /PID <pid> /T /F` no Windows) para evitar processos zumbis em timeout ou cancelamento.
   - Parsing NDJSON estrito com decodificação segura de UTF-8.

---

## 📖 Guia de Replicação Passo a Passo

O guia completo com todos os detalhes de configuração do `openclaw.json`, tratamento de pins de sessão no Telegram (`/model ... --runtime default -s`) e matriz de troubleshooting está disponível em:

👉 **[REPLICATION_GUIDE.md](./REPLICATION_GUIDE.md)**

Instalação local vinculada (`openclaw plugins install --link`): manter uma única árvore registrada. Neste host, a fonte canônica é `workspace/openclaw-opencode-integration`; `plugins/opencode-cli` é apenas uma junction de compatibilidade. O guia registra backups, limites e critérios de aceitação.

---

## 🧪 Testes e Validação Offline

Para rodar a suíte de validação automatizada (100% offline, sem gastar tokens nem chamar APIs externas):

```bash
# Validação de sintaxe e exports
node scripts/verify-plugin.mjs

# Suíte offline: registrar pass/fail/skip da versão atual
node --test test/test-zen-inference-guard.mjs test/test-telegram-picker-seam.mjs test/test-cli-backend-offline.mjs test/test-zen-fallback-scope.mjs test/test-cli-wrapper.mjs test/test-cli-process.mjs test/test-native-auth.mjs
```

Seams dependentes de hashes antigos do core podem ser ignorados e não comprovam Telegram E2E. `npm test` faz inferência real pelo adaptador; não o tratar como teste offline.

---

## 📄 Licença

Apache-2.0. Desenvolvido para o ecossistema OpenClaw / LabsClaw.
