/** Local routing refusal, not an upstream authentication or quota error. */
export const OPENCODE_CLI_ROUTE_REQUIRED = "OPENCODE_CLI_ROUTE_REQUIRED";

export class OpenCodeInferenceRouteError extends Error {
  constructor() {
    super("OpenCode inference requires the local opencode-cli runtime. Select /model opencode/<model> --runtime opencode-cli -s. No hosted request was sent.");
    this.name = "OpenCodeInferenceRouteError";
    this.code = OPENCODE_CLI_ROUTE_REQUIRED;
    // This closes only the hosted OpenCode stream seam. OpenClaw may still
    // use an ordinary configured fallback; no public terminal marker exists.
  }
}

// Called only by the hosted text-stream seams. The CLI runner never invokes
// these provider stream wrappers. Catalog/discovery has no hook here.
function refuseHostedOpenCodeInference() {
  throw new OpenCodeInferenceRouteError();
}

export function wrapOpenCodeHostedInference(ctx) {
  const provider = String(ctx.provider ?? ctx.model?.provider ?? "").trim().toLowerCase();
  return provider === "opencode" ? refuseHostedOpenCodeInference : ctx.streamFn;
}

export function buildOpenCodeZenInferenceGuard() {
  // Required ProviderPlugin surface, with NO credential, endpoint, model,
  // catalog, alias, or configuration replacement. Existing Zen catalog stays
  // in models.providers.opencode. Official provider must remain disabled;
  // duplicate provider registration is rejected by OpenClaw, not overridden.
  return {
    id: "opencode",
    label: "OpenCode Zen (local CLI required)",
    auth: [],
    wrapStreamFn: wrapOpenCodeHostedInference,
    wrapSimpleCompletionStreamFn: wrapOpenCodeHostedInference,
  };
}
