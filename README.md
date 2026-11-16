# OpenClaw OpenCode Integration (native + OMO)

Integração entre **OpenClaw Gateway** e **OpenCode CLI v1/v2**. Padrão: agente **build** em modo nativo. OMO/Sisyphus é uma opção explícita.

## 🎯 Visão Geral e Motivação

O endpoint oficial Zen (`https://opencode.ai/zen/v1`) valida contextualmente as chamadas aos modelos gratuitos (`mimo-v2.6-flash-free`, `big-pickle`, etc.), rejeitando clientes HTTP de terceiros com:

```
HTTP 403: OpenCode's free tier can only be used from within OpenCode
```

Esta integração **encaminha a inferência para o executável nativo do OpenCode CLI local**, com preflight do agente selecionado. O guard recusa a rota hosted nos hooks de inferência registrados, mas não garante elegibilidade gratuita: o próprio CLI também pode receber `FreeTierError`. Catálogo e presença de login não comprovam inferência saudável.

---

## 🏗️ Arquitetura dos Componentes

1. **Namespace Canônico (`opencode/*`):** Mantém o catálogo oficial descoberto via Gateway (`models.providers.opencode`), preservando compatibilidade com ferramentas de auditoria e seleção de modelos.
2. **Zen Inference Guard (`src/zen-inference-guard.js`):** Intercepta hooks de stream hosted do Gateway (`wrapStreamFn` e `wrapSimpleCompletionStreamFn`) e lança `OPENCODE_CLI_ROUTE_REQUIRED` caso uma sessão desconfigurada tente fazer requisições HTTP para a Zen API.
3. **CLI Backend Descriptors (`src/cli-backend.js`):** Declaração com `nativeToolMode: "always-on"` e parser customizado `parseJsonlEvent` para streaming incremental em deltas de texto sem duplicação.
4. **Wrapper CLI Robusto (`src/opencode-cli-wrapper.js`):**
   - Execução direta de binários nativos (`opencode.exe` no Windows, sem console `.cmd` piscando).
   - Validação prévia de agente primary/all: listagem textual na v1 e JSON/id na v2, sem fallback de persona.
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

`npm test` executa a suíte offline acima. `npm run test:live` faz inferência real pelo mesmo wrapper do backend e exige `OPENCODE_TEST_MODEL` explicitamente definido. Seams dependentes de hashes antigos do core podem ser ignorados e não comprovam Telegram E2E.

## Seleção de modo

No `config` do plugin `plugins.entries.opencode-cli`: `{"mode":"native"}` é o padrão e seleciona build; `{"mode":"omo"}` solicita Sisyphus. `agent` pode definir outro id/nome exato primary/all. Na v1, nativo usa `--pure`; na v2, solicita negação de plugins na configuração privada e usa `--standalone`, sem anexar a serviço compartilhado. OMO precisa estar disponível na versão escolhida; não é instalado nem substituído automaticamente. Veja os limites e comandos no guia de replicação. Trocar de modo exige iniciar uma sessão nova, não reutilizar sessão de outro perfil.

---

## 📄 Licença

Apache-2.0. Desenvolvido para o ecossistema OpenClaw / LabsClaw.
