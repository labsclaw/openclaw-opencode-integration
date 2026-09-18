# Guia de Replicação para Agentes e Engenheiros: OpenClaw + OpenCode CLI

<!-- project: github.com/labsclaw/openclaw-opencode-integration -->

Este documento foi elaborado para que **outros modelos, agentes de codificação autônomos (Codex, Claude Code, Gemini CLI, OpenClaw Subagents) ou engenheiros de infraestrutura** possam reproduzir com 100% de fidelidade a integração do OpenCode CLI no OpenClaw em qualquer host limpo, contornando o bloqueio **HTTP 403 da Zen API** e habilitando raciocínio estendido (**thinking**).

---

## 📋 Pré-Requisitos do Host

Antes de iniciar a configuração, valide se o ambiente possui os binários e permissões necessárias:

1. **Node.js:** Versão 20.x ou superior (testado e validado em Node v26.1.0).
2. **OpenCode CLI:** Versão 1.18.30 ou superior instalada e no `PATH` do sistema:
   ```bash
   opencode --version
   ```
   *Certifique-se de que a autenticação do OpenCode já foi executada no host (`opencode auth login` ou credenciais ativas em `~/.opencode`).*
3. **OpenClaw:** Versão 2026.3.24+ (testado em OpenClaw 2026.9.3).
4. **Plugin ACPX Oficial:** Pacote `@openclaw/acpx` instalado no Gateway.

---

## 🎯 Diagnóstico da Causa Raiz (Por que o 403 acontece?)

Se o OpenClaw tentar chamar `https://opencode.ai/zen/v1` via requisição HTTP direta simulando headers estáticos (`x-opencode-session`, `x-opencode-project`, `User-Agent: opencode/...`), a API Zen rejeita com:

```
HTTP 403: OpenCode's free tier can only be used from within OpenCode
```

**Solução de Arquitetura:**
- O tráfego precisa ser executado por dentro do runtime oficial do binário `opencode`.
- A integração disponibiliza duas vias oficiais:
  - **Rota A (Harness ACP):** Servidor ACP nativo (`opencode acp`) para sessões interativas e comandos de código.
  - **Rota B (CLI Backend):** Processo headless (`opencode run --format json --thinking`) para atuar como provedor de inferência na cadeia de fallback do OpenClaw.

---

## 🚀 Passo a Passo de Replicação

### Passo 1: Clonar o Repositório de Integração
No workspace do seu OpenClaw:

```bash
cd ~/.openclaw/workspace
git clone https://github.com/labsclaw/openclaw-opencode-integration.git
cd openclaw-opencode-integration
```

### Passo 2: Estrutura dos Arquivos de Integração
O repositório já contém a suíte completa:
- `package.json` & `openclaw.plugin.json`: Manifesto do plugin `@labsclaw/openclaw-opencode-cli`.
- `src/adapter.js`: Conector de streaming SSE com captura de eventos `reasoning`, `text` e tokens.
- `src/cli-backend.js`: Descritor canônico registrado via `api.registerCliBackend(...)`.
- `src/acp-harness.js`: Cliente JSON-RPC 2.0 para comunicação stdio com `opencode acp`.
- `test/test-adapter.js` & `test/test-acp.js`: Scripts de teste de bancada.

### Passo 3: Limpeza de Cabeçalhos e Configuração do `openclaw.json`

Edite o arquivo de configuração global do Gateway (`~/.openclaw/openclaw.json` ou `%USERPROFILE%\.openclaw\openclaw.json`):

#### 3.1. Limpar Headers Legados do Provider OpenCode
No objeto `models.providers.opencode`, **remova** todos os headers estáticos de spoofing (`x-opencode-*`) e mantenha apenas cabeçalhos genéricos:

```json
{
  "models": {
    "providers": {
      "opencode": {
        "baseUrl": "https://opencode.ai/zen/v1",
        "api": "openai-completions",
        "headers": {
          "Accept": "application/json"
        }
      }
    }
  }
}
```

#### 3.2. Configurar o Bloco ACP Oficial
Adicione ou atualize a seção raiz `acp` para permitir o backend `acpx` e o agente `opencode`:

```json
{
  "acp": {
    "enabled": true,
    "dispatch": {
      "enabled": true
    },
    "backend": "acpx",
    "defaultAgent": "codex",
    "allowedAgents": [
      "claude",
      "codex",
      "gemini",
      "opencode"
    ],
    "stream": {
      "deliveryMode": "live"
    }
  }
}
```

#### 3.3. Adicionar o Modelo na Cadeia de Fallback
Adicione `opencode/mimo-v2.5-free` na lista de fallbacks de `agents.defaults.model.fallbacks`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "antigravity-proxy/gemini-3.8-flash-high",
        "fallbacks": [
          "opencode/mimo-v2.5-free",
          "opencode/big-pickle",
          "kilocode/nvidia/nemotron-3-ultra-550b-a55b:free",
          "openrouter/deepseek/deepseek-v4-flash:free"
        ]
      }
    }
  }
}
```

---

## 🧪 Passo 4: Testes de Bancada e Validação

Antes de colocar o Gateway em produção, execute os testes unitários da integração:

### 1. Testar a Rota B (CLI Backend + Reasoning)
```bash
node test/test-adapter.js
```
*Critério de Sucesso:*
- Output do reasoning impresso via `[REASONING] ...`
- Texto final emitido sem erro 403
- Métricas de tokens capturadas e custo informado $0.

### 2. Testar a Rota A (ACP Harness Handshake)
```bash
node test/test-acp.js
```
*Critério de Sucesso:*
- Subprocesso `opencode acp` iniciado
- Handshake `initialize` respondido com `protocolVersion: 1`
- Sessão criada com `sessionId: ses_...` e catálogo dinâmico retornado.

---

## 🔄 Passo 5: Reinicialização do Serviço

Para que o Gateway instancie os listeners e despachantes do ACP:

```bash
pm2 restart openclaw-gateway
# ou: systemctl restart openclaw-gateway
```

*Nota de Segurança para Agentes Autônomos: Nunca execute o restart do Gateway de dentro de uma sessão interativa usando chamadas de shell direta `exec`, pois isso interrompe o processo pai do WebSocket/Telegram abruptamente.*

---

## 🛠️ Matriz de Resolução de Problemas (Troubleshooting)

| Sintoma / Erro | Causa Provável | Solução |
| :--- | :--- | :--- |
| `HTTP 403: OpenCode's free tier can only be used from within OpenCode` | Requisição HTTP direta feita sem o CLI ou headers legados presentes | Usar o conector `src/adapter.js` ou ACP (`src/acp-harness.js`). Limpar headers em `openclaw.json`. |
| `ACP Error [-32602]: Invalid params` | Handshake `initialize` do ACP enviado sem `protocolVersion: 1` | Garantir que o payload JSON-RPC contenha `protocolVersion: 1` e `clientCapabilities`. |
| `spawn opencode ENOENT` no Windows | O Node.js não encontrou o executável `.cmd` no PATH do Windows | Utilizar `opencode.cmd` no Windows e `shell: true` na chamada de spawn. |
| Reasoning não aparece na resposta | Falta da flag `--thinking` | Adicionar `--thinking` e `--format json` nos argumentos de chamada do `opencode run`. |
