# Replicação: OpenClaw + OpenCode CLI

<!-- project: github.com/labsclaw/openclaw-opencode-integration -->

Revisado em 15/11/2026 contra OpenClaw 2026.11.2, OpenCode 1.19.4 e Node 26.12.1 no Windows. A compatibilidade declarada no manifesto não substitui teste na versão de destino. Linux/macOS não foram exercitados nesta revisão.

## Contrato e limites

- Namespace dos modelos: `opencode/*`. Backend/plugin: `opencode-cli`. Não criar `models.providers.opencode-cli`.
- O plugin registra o backend CLI e o guard do provider `opencode`. Os hooks `wrapStreamFn` e `wrapSimpleCompletionStreamFn` recusam inferência hosted com `OPENCODE_CLI_ROUTE_REQUIRED`. Isso não impede toda conexão de rede do processo nem fallback para outro provider.
- O wrapper executa OpenCode local com preflight de `Sisyphus - ultraworker`. O OpenCode controla ferramentas/permissões nativas. `nativeToolMode: "always-on"` não oferece sandbox nem restrição exata às ferramentas do OpenClaw.
- O CLI também pode receber `FreeTierError`. A integração não garante elegibilidade, gratuidade ou contorno de política Zen. Catálogo, presença de login e inferência são verificações distintas.
- `syntheticAuthRefs: ["opencode-cli"]` e `providerCatalogEntry: "./src/provider-discovery.js"` anunciam presença de autenticação nativa, nunca copiam a credencial para o Gateway. Presença não comprova saúde da conta.

Contrato detalhado: [docs/cli-wrapper.md](docs/cli-wrapper.md). ACP é outra rota: handshake não comprova inferência.

## Pré-requisitos

1. Node compatível com o OpenClaw instalado. OpenClaw 2026.11.2 exige `>=24.16.0 <25 || >=26.1.0`, não simplesmente Node 20+.
2. OpenClaw com as APIs de plugin/CLI backend deste pacote. Conferir `openclaw --version`.
3. OpenCode acessível ao usuário do serviço Gateway. Conferir `opencode --version` e `opencode --help`. No Windows, usar executável nativo, não shim `.cmd`.
4. Oh-My-OpenAgent configurado no OpenCode, fornecendo o agente primário exato `Sisyphus - ultraworker`. Na versão 1.19.4, a sintaxe é `opencode plugin -g oh-my-openagent`, NÃO `opencode plugin install oh-my-openagent`. Instalar apenas se necessário e seguir também a documentação do OMO. Conferir `opencode agent list`; não aceitar fallback silencioso para `build`.
5. Login e elegibilidade pertencem ao OpenCode quando exigidos. Não solicitar chaves no chat nem exigir uma API key adicional para o provider exato `opencode` no OpenClaw.

## Instalação: uma única árvore

Instalação local vinculada é suportada por `openclaw plugins install --link`. Não manter clones editáveis divergentes.

PowerShell, ambiente novo:

```powershell
$pluginDir = Join-Path $env:USERPROFILE '.openclaw/workspace/openclaw-opencode-integration'
git clone https://github.com/labsclaw/openclaw-opencode-integration.git $pluginDir
openclaw plugins install --link $pluginDir --accept-capabilities
openclaw plugins inspect opencode-cli --json
```

Em POSIX, usar `$HOME/.openclaw/workspace/openclaw-opencode-integration` e a mesma instalação `--link`. Se a versão exigir confirmação de origem não-ClawHub, revisar a origem e consultar `--force` em `openclaw plugins install --help`. Não sobrescrever instalação existente sem comparação e backup.

Registro de instalação, `plugins.load.paths` e `rootDir` da inspeção devem apontar para a mesma árvore. Instalação por cópia também é suportada, mas nesse caso atualizar a instalação, não um checkout paralelo. Usar o CLI para manter os metadados; não editar SQLite manualmente.

### Estado deste host após a consolidação

- Fonte física e registro ativo: `C:\Users\ClawLabs\.openclaw\workspace\openclaw-opencode-integration`.
- `C:\Users\ClawLabs\.openclaw\plugins\opencode-cli` é uma junction para essa fonte, NÃO outro clone. Editar por qualquer caminho altera os mesmos arquivos. Não acrescentar o alias a `plugins.load.paths`.
- Cópia antiga preservada somente como backup inativo em `C:\Users\ClawLabs\.openclaw\backups\opencode-consolidation-20549\legacy-inactive`. Backup da fonte antes desta revisão: `canonical-before.zip`, na mesma pasta. Não carregar backups.
- A fonte já tinha alterações locais, incluindo descoberta de autenticação nativa. Um clone do remoto sozinho pode não conter essas mudanças. Conferir `git status --short` e o manifesto antes de afirmar reprodução exata. Esta revisão local não é publicação no GitHub.
- Não houve mudança de rota, modelo, credencial ou restart nesta consolidação. O alias pode ser aposentado quando nenhum operador/script depender do caminho antigo.

## Configuração

Mesclar trechos ao estado existente, sem substituir mapas inteiros. Usar auxiliares `openclaw config`; validar antes de aplicar. Não copiar o nome do usuário deste host para outra máquina.

Manter `plugins.entries["opencode-cli"].enabled: true`. Desabilitar o plugin legado `plugins.entries.opencode.enabled: false` quando disputar o mesmo provider owner. Se houver allowlist `plugins.allow`, admitir `opencode-cli`. Confirmar o owner pela inspeção.

Preservar `models.providers.opencode` e seus metadados válidos. `baseUrl` não seleciona o transporte. Não alterar endpoint/credenciais para corrigir roteamento nem usar headers estáticos de emulação de sessão.

Binding por modelo:

```json
{
  "agents": {
    "defaults": {
      "models": {
        "opencode/*": { "agentRuntime": { "id": "opencode-cli" } }
      }
    }
  }
}
```

Se `agents.entries.<agente>.models` sobrescrever a herança, espelhar o binding ali. Conferir políticas exatas, que podem prevalecer sobre o wildcard. Não depender apenas de `models.providers.opencode.agentRuntime`: houve falha de admissão com esse binding isolado em versões anteriores.

Catálogo e validação:

```powershell
opencode models opencode --verbose --refresh --pure
openclaw config validate
```

Preço zero é anúncio de catálogo, não prova de inferência gratuita. Não excluir automaticamente IDs ausentes nem substituir por modelos pagos.

## Sessão e picker Telegram

Um pin compatível pode prevalecer sobre a política de modelo. No código instalado do OpenClaw 2026.11.2, o callback ainda envia `runtime.kind: "unchanged"` nas seleções não-default. Isso sozinho não prova a escolha do resolvedor completo. Não concluir o transporte apenas pela mensagem do menu.

Para limpar um pin e herdar a política, na sessão afetada:

```text
/model opencode/<id-confirmado-no-catálogo> --runtime default -s
```

Esse comando depende do binding CLI correto. Conferir seleção efetiva e logs depois. Não prescrever `--runtime opencode-cli` universalmente: admissão de backend/harness varia por versão; este guia recomenda herdar a política com `default`.

## Testes offline e prova de uso

Na raiz canônica:

```powershell
node scripts/verify-plugin.mjs
node --test test/test-cli-backend-offline.mjs test/test-cli-process.mjs test/test-cli-wrapper.mjs test/test-native-auth.mjs test/test-zen-inference-guard.mjs test/test-zen-fallback-scope.mjs test/test-telegram-picker-seam.mjs
```

Registrar pass/fail/SKIP atuais, não uma contagem histórica fixa. Os seams do core dependem de arquivos com hash de uma versão antiga e podem ser ignorados no core atual. Skip não é aprovação nem teste Telegram E2E. `npm test` executa `test/test-adapter.js`, que faz INFERÊNCIA REAL: não é a suíte offline acima.

Após instalação ou mudança de código, usar lifecycle suportado e conferir erros antes de repetir. Já houve `EPERM` em staging de symlinks Windows. Restart com `openclaw gateway restart --safe` deve partir do operador/controle externo, não do turno ativo do próprio Gateway. Mudança documental ou substituição de cópia inativa por alias não exige restart da fonte ativa inalterada.

Aceitação de mudança de transporte exige duas provas separadas:

1. Wrapper com modelo exato confirmado, prompt inofensivo, sem autorizar ações externas/fallback pago:

   ```powershell
   'Responda somente OC_CANARY_OK. Não use ferramentas.' | node src/opencode-cli-wrapper.js --model opencode/<id-confirmado-no-catálogo> --agent 'Sisyphus - ultraworker'
   ```

   O prompt é uma instrução, NÃO bloqueio de ferramentas. Exigir texto, session ID e finalização; heartbeat não basta.
2. Turno Gateway com o mesmo modelo, pela entrada normal, correlacionado a `agent/cli-backend` ou `cli exec` com `provider=opencode-cli`. `provider-transport-fetch` com `provider=opencode` indica HTTP. Não alegar saúde atual com manifesto, catálogo, offline ou canário histórico.

## Diagnóstico e recuperação

| Evidência | Próxima ação |
|---|---|
| Fonte divergente | Conferir registro, load.paths, rootDir e allowlist antes de reinstalar |
| OPENCODE_CLI_ROUTE_REQUIRED | Guard bloqueou tentativa hosted; corrigir política/pin e verificar fallback, sem desligar guard |
| FreeTierError após CLI comprovado | Investigar elegibilidade/política OpenCode; não prometer correção local |
| Indisponível antes de spawn | Conferir binding e descoberta de auth nativa, sem copiar segredos |
| Agente ausente ou fallback build | Corrigir OMO no contexto do usuário do serviço; wrapper deve falhar fechado |
| Timeout | Conferir fase e stderr; deadline padrão 240 s incluindo preflight não prova modelo offline |
| Falha cleanup Windows | Ver limites em docs/cli-wrapper.md; não garantir ausência universal de órfãos |

Rollback deste host: preservar fonte canônica; inspecionar junction/backups e restaurar a árvore antiga em diretório separado para comparação antes de ativar. Nunca aplicar exclusão recursiva através da junction, sobrescrever alterações locais ou reativar backup sem revisar rota/configuração.
