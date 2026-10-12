# OpenCode: guard de inferência e picker Telegram (2026.9.9)

## Patch desta lane

O entrypoint preserva registerCliBackend e registra um ProviderPlugin mínimo de id opencode. O manifesto declara providers=["opencode"] para tornar opencode-cli elegível como owner do mesmo namespace. src/zen-inference-guard.js não implementa catálogo, endpoints, credenciais, aliases ou normalização de modelos.

wrapStreamFn (agente) e wrapSimpleCompletionStreamFn (completeSimple/utility) retornam a mesma função de recusa determinística. Ela nunca chama inner e lança OpenCodeInferenceRouteError com code=OPENCODE_CLI_ROUTE_REQUIRED e sem HTTP status. O campo retryable foi removido: ele não é consultado pelo fallback runner e NÃO torna a recusa terminal. O CLI runner não usa esses hooks. Não chamar isso de garantia universal: falta deployment/E2E, e plugin ausente não oferece guard. Media/PDF e bypasses diretos do transporte não foram cobertos.

O provider oficial opencode deve continuar desabilitado. OpenClaw rejeita registro duplicado, em vez de sobrescrever owner. Antes de deployment ser considerado válido, confirmar que o registro runtime opencode pertence a opencode-cli e que nenhum diagnóstico provider already registered apareceu. Apenas status loaded do plugin não basta. O guard não substitui config/catalog Zen existente.

## Callback REAL Telegram

Base: pacote instalado OpenClaw/dist.
- command-ui-BAoze0Y_.mjs:73–76 gera mdl_sel_<provider>/<model> ou callback opaco; :34–71 decodifica; :136–163 gera teclado. Nenhum campo runtime nessa seleção.
- transport-status-D5EbAgHL.mjs:944–963 autoriza e resolve sessão/catálogo; :1022–1027 resolve modelo; :1057–1078 chama applySessionModelSelection.
- Crucial :1075: runtime=clear somente se isDefaultSelection, caso contrário unchanged. Apesar de :1018 dizer que selecionar aplica runtime configurado, um pin compatível pode sobreviver.
- apply-session-model-selection-DxZ5Eu3X.mjs:135–144 mapeia unchanged para rawRuntime=undefined, clear para "default", set para runtime indicado.
- directive-handling.model-runtime-Cu_ExKA9.mjs:8–24 conserva pin compatível; :32–43 limpa/fixa override.

Export suportado: openclaw/plugin-sdk/model-session-runtime exporta applySessionModelSelection (dist/plugin-sdk/model-session-runtime.js:7–8). Isso permite ao owner autorizado de uma interface própria fazer uma seleção transacional explícita; não concede a este provider plugin autoridade para substituir callback/bot do Telegram.

Comandos suportados, sessão somente:
- /model opencode/<id> --runtime default -s: segue política configurada.
- /model opencode/<id> --runtime opencode-cli -s: fixa CLI explicitamente.
- /model default -s: limpa também seleção do modelo, não apenas runtime.
Docs/concepts/models.md:389,391,395–396. Control UI tem rows explícitas runtime/Default; o picker Telegram padrão não recebe essas choices: commands-models-BCzQYOsl.mjs:543–551 envia apenas provider/models/currentModel/paginação/modelNames ao canal.

## Limite de extensão / proposta core (NÃO aplicada)

Não há, no seam inspecionado, extensão de provider capaz de acrescentar runtime ao callback padrão Telegram. Não alterar sua semântica global model-only silenciosamente: docs:396 promete preservar overrides compatíveis.

Proposta mínima para o pai decidir: adicionar ação explícita "Usar runtime configurado" no teclado/codec Telegram (command-ui:73–76,136–163) e tratá-la no callback (transport-status:1071–1075) com request.runtime={kind:"clear"}. Opcionalmente rows explícitas set para runtime disponível e autorizado, passando por applySessionModelSelection, nunca escrevendo SQLite. Provider/model continuam iguais. Testar callback normal preserva pin; ação configured limpa pin; ação set valida provider/runtime; stale catalog/unauthorized callback não muta sessão. Alternativa ainda menor, sem core: reset/runtime via comando suportado acima. Nenhuma dessas seleções foi executada nesta lane.

## Evidência de contrato / ownership

- agent-harness-runtime-R8dTs5zl.d.ts:14962–14985 requer id/label/auth; auth=[] é válido pelo normalizador loader-runtime-load-DpgEqnzx.mjs:3700–3705. Não exige baseUrl/apiKey/catalog.
- Mesmo loader:3749–3752 rejeita provider duplicado; :3755–3763 só registra catálogo se provider tiver catalog/staticCatalog.
- provider-owner-index-DC0jvNkI.mjs:4–25 constrói declaração de owners; loader:5986 exige owner declarado e escopo elegível. model-ref-shared-DNbjvLQv.mjs:79–89 escolhe registro canônico elegível.
- Agent: extra-params-DwhNMOiX.mjs:483–497 instala wrapStreamFn.
- Utility: loader:5788–5789 chama wrapSimpleCompletionStreamFn; ai-transport-runtime-host-CzkbiNw1.mjs:339–351 o usa em completeSimple. d.ts:15172–15181 documenta ambos.
- SDK public import existente openclaw/plugin-sdk/plugin-entry mantido. Novo guard usa somente JavaScript; nenhum import privado de dist na produção. package.json/scripts/dependências intactos.

## Testes offline

node --test test/test-zen-inference-guard.mjs test/test-telegram-picker-seam.mjs test/test-zen-fallback-scope.mjs

Suíte original: 10 pass, 0 fail, 0 skip no pacote local 2026.9.9; após QA: 13 pass, detalhados abaixo. Guard: inner spy zero para agente/utility, identidade determinística, erro local, outros providers preservados, registro CLI mantido, config não mutada e provider sem catálogo/auth novo. Picker/owner: fragmentos reais do código instalado em VM com dependências declaradas como stubs. NÃO E2E Telegram, NÃO boot real de plugin, NÃO canário CLI. Testes seam são versionados pelos nomes hash e pulam quando o pacote correspondente não existe.

node --check index.js e src/zen-inference-guard.js: exit0. git diff --check dos dois arquivos tracked desta lane: exit0.

verify-plugin.mjs global: exit1 exclusivamente porque test/fixtures/fake-opencode.mjs da lane paralela contém quatro escaped quotes e o verificador trata isso como dano. Não tocado/corrigido nesta lane; pai deve avaliar se é fixture legítima/limite do scanner, não declarar verificação global verde.

## Correção após QA: fallback terminal não é suportado pelo provider

QA tmp/opencode-guard-qa-20261012.md REFUTED a interpretação terminal. Removido retryable=false; não foi substituído por AbortError, erro de auth/quota/CLI nem marcação privada. A proteção continua sendo APENAS impedir hosted OpenCode no inner dos dois hooks. Um fallback configurado para outro provider pode executar normalmente.

Novo test/test-zen-fallback-scope.mjs importa o runner REAL 2026.9.9 somente no teste, com skipAuthProfileRuntime=true, manifestPlugins=[], sem sessionId e callbacks offline. Usa cfg fixture de formato real com primary opencode/big-pickle e fallback openai/offline-fixture. Resultado:
1. Recusa guard + política comum: chamadas opencode/big-pickle → openai/offline-fixture; segundo fake provider EXECUTA. Comportamento esperado/documentado, não escondido.
2. Política REAL resolveModelFallbackAvailability com hasSessionModelOverride=true, modelOverrideSource=user, sessionKey=agent:main:main: disabled_by_model_override. Projeção REAL para fallbacksOverride=[]; mesmo runWithModelFallback com cfg/fallback configurado rejeita recusa e segundo spy=ZERO. Isso prova somente contexto de override humano explícito; não publica/edita sessão real nem oferece terminalidade universal.
3. Host canFallbackAfterError retornando false no runner REAL: segundo spy=ZERO. Esse parâmetro pertence ao owner do runner, NÃO ao contrato ProviderPlugin; nenhum hook/marker terminal público suportado foi encontrado para esta lane. Não foi conectado artificialmente ao provider.

Fontes: agent-scope-L_eY3Hj7.mjs:326–348 projeta override humano para lista vazia; model-fallback-runner-DQm27MBe.mjs:167–174 recebe a lista, :507–513 implementa o gate do host. Docs/concepts/models.md:398 confirma seleção humana estrita. Auto override/proveniência automática, default e cron não têm essa garantia contextual.

**BLOCKER:** tornar esse erro terminal para toda cadeia configurada exige decisão/hook suportado no core ou no owner do runner. Não cabe ao provider guard sob o SDK inspecionado. Sem alterar política global/config, o escopo correto é hosted OpenCode bloqueado + fallback normal permitido; ausência de troca de provider somente quando a política existente de override humano já desabilita a cadeia.

13 testes passaram, 0 fail, 0 skip, 15.7s. Os três testes novos usam funções instaladas reais, não VM. Callbacks continuam fake e não houve auth/rede/sessão/CLI; não é E2E de gateway.

## Escopo e rollback

Arquivos desta lane: index.js, openclaw.plugin.json, src/zen-inference-guard.js, test/test-zen-inference-guard.mjs, test/test-telegram-picker-seam.mjs, test/test-zen-fallback-scope.mjs e este documento. Checkout/worktree HEAD 955cd780cb22aba2c73d726de74393c378ad36d3; sem commit/push/deploy. Wrapper/descriptor e fixtures paralelos preservados. Reverter somente os dois hunks tracked e remover arquivos novos desta lane. Código instalado, config, sessão/SQLite e plugin ativo intactos.

UNTESTABLE: seleção/runtime real da sessão após patch; guard selecionado em geração publicada; classificação final/retries do erro pelo Gateway; zero tráfego HTTP em E2E; cancel/resume do wrapper; UI real. Não foram feitas inferências ou chamadas externas.
