# OpenClaw OpenCode Integration

Integração de alta fidelidade entre o **OpenClaw** e o ecossistema **OpenCode CLI**.

## 🎯 Motivação e Diagnóstico

Em setembro de 2026, o endpoint Zen (`https://opencode.ai/zen/v1`) passou a validar criptograficamente/contextualmente se as requisições gratuitas originam-se de dentro de uma execução legítima do OpenCode CLI. A emulação estática de cabeçalhos (`x-opencode-session`, `User-Agent`, etc.) passou a retornar:

```
HTTP 403: OpenCode's free tier can only be used from within OpenCode
```

Além disso, o suporte a raciocínio estendido (**thinking**) nos modelos do OpenCode (como `mimo-v2.5-free`, `big-pickle`, etc.) é gerado nativamente pelo CLI e retornado em campos SSE dedicados (`reasoning`), e não por seletores de variantes nos headers.

Para resolver a raiz do problema de forma definitiva e resiliente a futuras alterações da API, esta integração implementa duas rotas oficiais:

---

## 🏗️ Arquitetura de Duas Rotas

```
                     ┌────────────────────────────────┐
                     │            OpenClaw            │
                     └───────┬────────────────┬───────┘
                             │                │
            [ Rota A: ACPX Harness ]   [ Rota B: CLI Backend ]
                             │                │
                             ▼                ▼
                     ┌───────────────┐ ┌───────────────┐
                     │  opencode acp │ │ opencode run  │
                     │  (Full Agent) │ │ (Headless)    │
                     └───────┬───────┘ └───────┬───────┘
                             │                 │
                             └────────┬────────┘
                                      │ (Runtime nativo com sessões,
                                      │  chaves de projeto e thinking)
                                      ▼
                             ┌─────────────────┐
                             │  OpenCode Zen   │
                             │  (Models API)   │
                             └─────────────────┘
```

### Rota A — Agente Nativo via ACPX (`opencode acp`)
- **Protocolo:** Agent Client Protocol (ACP) sobre stdio/WebSocket.
- **Objetivo:** Sessões completas de codificação e execução com thinking, histórico persistido no banco local do OpenCode, cancelamento e ferramentas nativas.
- **Identificadores:** Sessão, projeto e request gerados dinamicamente pelo binário `opencode`.
- **Status:** **Validado**. Handshake `initialize` e criação de sessão `session/new` funcionando com negociação de capacidades e catálogo dinâmico de modelos.

### Rota B — CLI Backend para Fallbacks (`opencode run`)
- **Protocolo:** CLI Backend do OpenClaw com parsing estruturado de streaming JSON.
- **Objetivo:** Permitir que modelos do OpenCode participem da cadeia tradicional de fallback do OpenClaw (`primary` -> `fallbacks`), mantendo a geração correta de tokens de reasoning.
- **Status:** **Validado**. Captura de reasoning em tempo real e resposta final sem 403.

---

## 📖 Guia de Replicação para Outros Agentes e Instalações

Para replicar esta integração do zero em uma nova máquina ou instalação do OpenClaw, consulte o guia passo a passo detalhado:
👉 **[REPLICATION_GUIDE.md](./REPLICATION_GUIDE.md)**

Contém:
- Pré-requisitos de ambiente e runtime.
- Diagnóstico exato do erro 403 da Zen API.
- Passo a passo de configuração do `openclaw.json` (remoção de headers legados, bloco ACP e fallbacks).
- Scripts de teste de bancada para validação imediata da Rota A e Rota B.
- Matriz de troubleshooting para falhas comuns (Windows/Linux, Zod schemas, reasoning).

---

## 📅 Roadmap de Implementação

- [x] **Fase 0: Baseline e Repositório**
  - Criação do repositório dedicado `labsclaw/openclaw-opencode-integration`.
  - Mapeamento de versões (`openclaw` 2026.9.3, `opencode` 1.18.30).
- [x] **Fase 1: Canário ACPX Oficial (Rota A)**
  - Criação da classe `OpenCodeAcpHarness` para stdio JSON-RPC 2.0.
  - Validação de handshake canônico (`initialize` com `protocolVersion: 1`).
  - Validação de criação de sessão interativa (`session/new`).
- [x] **Fase 2: Plugin `opencode-cli` (CLI Backend - Rota B)**
  - Criação de pacote/plugin `@labsclaw/openclaw-opencode-cli` com `api.registerCliBackend`.
  - Mapeamento de eventos SSE/JSON para o contrato de reasoning do OpenClaw.
  - Teste de ponta a ponta com `opencode/mimo-v2.5-free`.
- [x] **Fase 3: Sincronização de Catálogo e Políticas**
  - Configuração do bloco `acp` no Gateway com `acpx` e `opencode` permitido.
  - Remoção dos cabeçalhos estáticos legados (`x-opencode-*`) em `openclaw.json`.
  - Inclusão do modelo `opencode/mimo-v2.5-free` na cadeia oficial de fallbacks.
- [ ] **Fase 4: Testes de Resiliência e Documentação**
  - Testes de timeout, cancelamento, restart de gateway e integridade de sessões.

---

## 🛠️ Tecnologias
- **Runtime:** Node.js v26 / Bun
- **Harness:** OpenClaw ACPX (`@openclaw/acpx`) & Agent Client Protocol (ACP)
- **CLI Engine:** OpenCode CLI (v1.18.30+)
