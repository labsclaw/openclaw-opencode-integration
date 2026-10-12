# Guia Definitivo de Replicação: OpenClaw + OpenCode CLI (Sisyphus)

<!-- project: github.com/labsclaw/openclaw-opencode-integration -->

Este guia técnico documenta a arquitetura, configuração e operação para integrar o **OpenCode CLI** ao **OpenClaw** em qualquer ambiente limpo (Windows, Linux ou macOS).

Esta solução contorna o bloqueio **HTTP 403 (FreeTierError)** do endpoint Zen, assegura execução via persona **Sisyphus - ultraworker** do pacote Oh-My-OpenAgent (OMO), implementa **guard fail-closed** contra tráfego HTTP desautorizado, e documenta o tratamento de seleção de modelos e pins de sessão no Gateway.

---

## 🎯 Diagnóstico da Causa Raiz: Por que o HTTP 403 Acontece?

Desde setembro de 2026, o endpoint Zen (`https://opencode.ai/zen/v1`) valida contextualmente se as requisições para modelos gratuitos (`mimo-v2.6-flash-free`, `big-pickle`, etc.) se originam de uma sessão interativa genuína do binário oficial `opencode`.

Qualquer requisição HTTP direta de terceiros simulando cabeçalhos estáticos (`x-opencode-session`, `User-Agent`, etc.) é rejeitada:

```json
{
  "type": "error",
  "error": {
    "type": "FreeTierError",
    "message": "OpenCode's free tier can only be used from within OpenCode"
  }
}
```

A única via operacional para usufruir dos modelos gratuitos do ecossistema OpenCode é **executar as inferências diretamente pelo executável nativo do OpenCode CLI**.

---

## 🏗️ Arquitetura Híbrida

A arquitetura adota o modelo híbrido validado:

```
┌────────────────────────────────────────────────────────────────────────┐
│                           OpenClaw Gateway                             │
│                                                                        │
│  1. Descoberta de Catálogo: models.providers.opencode (API Zen Oficial)│
│  2. Provedor Guard Local:  src/zen-inference-guard.js                  │
│     -> Intercepta wrapStreamFn e recusa HTTP (OPENCODE_CLI_ROUTE_REQUIRED)│
│  3. Transporte de Execução: src/cli-backend.js                         │
│     -> nativeToolMode: "always-on"                                     │
│     -> parseJsonlEvent: streaming de deltas sem duplicação             │
│  4. Wrapper de Processo:   src/opencode-cli-wrapper.js                 │
│     -> Executa opencode.exe run --format json --agent "Sisyphus..."     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                       (Spawn de Processo Local)
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │             OpenCode CLI (opencode.exe)                │
       │                                                        │
       │  Harness: Oh-My-OpenAgent (OMO)                        │
       │  Persona: Sisyphus - ultraworker (primary)             │
       │  Thinking / Reasoning: Capturado via streaming nativo  │
       └────────────────────────────┬───────────────────────────┘
                                    │
                                    │ (Tráfego interno autorizado)
                                    ▼
                      Zen API (HTTP 200 OK)
```

### Componentes Principais:
1. **`index.js`**: Ponto de entrada do plugin que registra simultaneamente o `cli-backend` de inferência e o provider guard `opencode`.
2. **`openclaw.plugin.json`**: Manifesto declarando `cliBackends: ["opencode-cli"]`, `providers: ["opencode"]` e ativação em `onStartup: true`.
3. **`src/cli-backend.js`**: Descritor de CLI backend registrado no OpenClaw com:
   - `nativeToolMode: "always-on"` (declaração honesta: não finge controle exato de ferramentas do OpenClaw sobre ferramentas nativas do OpenCode).
   - Hook público `parseJsonlEvent` para streaming incremental de texto (`opencode_text_delta`) e emissão de resultado final único com contagem de tokens.
4. **`src/opencode-cli-wrapper.js`**:
   - Execução direta do binário nativo `opencode.exe` (no Windows, sem shims `.cmd` que piscam console).
   - Validação prévia de existência da persona primária `Sisyphus - ultraworker` (evita fallback silencioso do OpenCode para o agente `build`).
   - Gerenciamento rigoroso de árvore de processos no Windows usando `taskkill /PID <pid> /T /F` no PID privado da instância, garantindo zero processos órfãos em timeouts ou cancelamentos.
   - Streaming seguro em UTF-8 com buffer delimitado e parsing tolerante a chunks parciais.
5. **`src/zen-inference-guard.js`**:
   - Provider plugin local que intercepta chamadas hosted (`wrapStreamFn` e `wrapSimpleCompletionStreamFn`) e lança `OpenCodeInferenceRouteError` (`OPENCODE_CLI_ROUTE_REQUIRED`).
   - Evita que qualquer sessão com pin incorreto ou fallback acidental tente vazar requisições para a API Zen via HTTP.

---

## 📋 Pré-Requisitos

1. **Node.js:** Versão 20.x ou superior (testado em Node v26.1.0).
2. **OpenCode CLI:** Versão 1.18.30+ instalada globalmente:
   ```bash
   npm install -g opencode-ai
   opencode --version
   ```
3. **Oh-My-OpenAgent (OMO):** Plugin instalado no OpenCode fornecendo o Sisyphus:
   ```bash
   opencode plugin install oh-my-openagent
   opencode agent list
   ```
   *Certifique-se de que `Sisyphus - ultraworker (primary)` aparece na listagem.*
4. **OpenClaw:** Versão 2026.3.24+ (testado em 2026.9.9).

---

## 🚀 Passo a Passo de Instalação e Configuração

### 1. Clonar o Repositório
No diretório de plugins do seu workspace OpenClaw:

```bash
cd ~/.openclaw/workspace
git clone https://github.com/labsclaw/openclaw-opencode-integration.git
cd openclaw-opencode-integration
```

### 2. Configurar o `openclaw.json`

Edite o arquivo global `~/.openclaw/openclaw.json` (ou `%USERPROFILE%\.openclaw\openclaw.json`):

#### A. Carregar o Plugin
```json
{
  "plugins": {
    "load": {
      "paths": [
        "C:\\Users\\ClawLabs\\.openclaw\\workspace\\openclaw-opencode-integration"
      ]
    },
    "entries": {
      "opencode-cli": {
        "enabled": true
      },
      "opencode": {
        "enabled": false
      }
    }
  }
}
```
*(Nota: O plugin oficial legado `opencode` deve ficar `enabled: false` para evitar conflito de registro com o guard local).*

#### B. Configurar o Provider `opencode`
No bloco `models.providers.opencode`, vincule o `agentRuntime` no nível do provedor:

```json
{
  "models": {
    "providers": {
      "opencode": {
        "baseUrl": "https://opencode.ai/zen/v1",
        "api": "openai-completions",
        "agentRuntime": {
          "id": "opencode-cli"
        },
        "headers": {
          "Accept": "*/*"
        },
        "models": [
          { "id": "mimo-v2.6-flash-free", "name": "mimo-v2.6-flash-free", "contextWindow": 200000 },
          { "id": "big-pickle", "name": "Big Pickle", "reasoning": true, "contextWindow": 200000 }
        ]
      }
    }
  }
}
```

#### C. Configurar a Precedência de Runtime nos Agentes
Em `agents.defaults.models` e `agents.entries.main.models`, declare o wildcard `opencode/*` apontando para o CLI:

```json
{
  "agents": {
    "defaults": {
      "models": {
        "opencode/*": {
          "agentRuntime": {
            "id": "opencode-cli"
          }
        }
      }
    },
    "entries": {
      "main": {
        "models": {
          "opencode/*": {
            "agentRuntime": {
              "id": "opencode-cli"
            }
          }
        }
      }
    }
  }
}
```

#### D. Validar a Configuração
```bash
openclaw config validate
```

---

## ⚡ Tratamento Crítico de Sessão e Picker Telegram

### O Problema do Pin de Sessão (`agentRuntimeOverride`)
Nas sessões existentes do Telegram (`agent:main:main`), o OpenClaw armazena no SQLite o estado da sessão:
```json
"agentRuntimeOverride": "openclaw"
```
Ao usar o menu `/models` no Telegram para trocar de modelo, o callback do Telegram envia `runtime: "unchanged"`. Isso faz com que o OpenClaw **preserve** o pin anterior (`openclaw`). Sob esse pin, o Gateway ignora a política do `openclaw.json` e tenta realizar inferência HTTP tradicional, caindo no **HTTP 403**.

### Como Limpar o Pin Corretamente
Para limpar o pin da sessão e herdar a política configurada (`opencode-cli`):

```text
/model opencode/mimo-v2.6-flash-free --runtime default -s
```

- `--runtime default`: Gera uma diretiva `{ kind: "clear" }` no resolvedor do Gateway, removendo o pin da sessão.
- `-s`: Aplica a alteração especificamente para a sessão corrente.

> ⚠️ **Importante:** Nunca utilize `/model ... --runtime opencode-cli -s`. No OpenClaw, a flag `--runtime` do comando `/model` aceita apenas IDs de Agent Harnesses (como `openclaw` ou `codex`). Como `opencode-cli` é um CLI Backend, passar esse nome gerará o erro:  
> `Runtime "opencode-cli" is not available for opencode/...`

---

## 🧪 Suíte de Testes Offline e Validação

A integração conta com uma suíte de testes 100% offline (utiliza mocks estruturados e testes de seam sem disparar chamadas de rede ou inferências pagas):

```bash
cd openclaw-opencode-integration

# 1. Validação estrutural e sintaxe
node scripts/verify-plugin.mjs

# 2. Testes de Seam: Guard e Picker
node --test test/test-zen-inference-guard.mjs test/test-telegram-picker-seam.mjs

# 3. Testes do Backend, Wrapper, Streaming e Fallback
node --test test/test-cli-backend-offline.mjs test/test-zen-fallback-scope.mjs test/test-cli-wrapper.mjs
```

**Resultado esperado:**
- `verify-plugin.mjs`: `0 error(s), 0 note(s)`.
- Testes automatizados: **83 testes executados e aprovados** (0 falhas).

---

## 🔄 Reinicialização Segura do Gateway

No Windows, o OpenClaw Gateway é gerenciado por Scheduled Task nativa. Para reiniciar com segurança:

```powershell
openclaw gateway restart --safe
```

*Verificação de status pós-reinício:*
```powershell
openclaw gateway status
openclaw plugins inspect opencode-cli
```
Deverá exibir:
- `Status: enabled`
- `Capabilities: cli-backend: opencode-cli, opencode-cli` e `text-inference: opencode`.

---

## 🛠️ Resumo de Troubleshooting

| Erro / Comportamento | Causa | Solução |
| :--- | :--- | :--- |
| `HTTP 403 FreeTierError` no Telegram | Sessão presa com `agentRuntimeOverride: "openclaw"` | Executar `/model opencode/<modelo> --runtime default -s` |
| `Runtime "opencode-cli" is not available` | Passou `--runtime opencode-cli` no comando `/model` | Usar `--runtime default` para herdar a política configurada |
| `OPENCODE_CLI_ROUTE_REQUIRED` | O inference guard interceptou uma chamada que tentou ir via HTTP | Normal e esperado: confirma que o guard impediu o vazamento para o Zen |
| Subprocesso CLI dá timeout de 180s | Modelo offline ou erro de servidor na API externa do OpenCode | Testar via terminal com `opencode run -m <modelo> "ping"` |
| Plugin não recarrega no Windows (`EPERM`) | Symlinks temporários bloqueados pelo SO | Fazer `openclaw gateway restart --safe` em vez de reload via CLI |
