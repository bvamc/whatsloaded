import type { ResolvedContext } from "@whatsloaded/core";

export function renderJson(ctx: ResolvedContext, showSecrets = false): string {
  if (showSecrets) {
    return JSON.stringify(ctx, null, 2);
  }

  // Redact secrets in JSON output
  const replacer = (key: string, value: unknown) => {
    if ((key === "env" || key === "headers") && value && typeof value === "object") {
      const redactedObj: Record<string, string> = {};
      for (const k of Object.keys(value as Record<string, unknown>)) {
        redactedObj[k] = "•••";
      }
      return redactedObj;
    }
    return value;
  };

  return JSON.stringify(ctx, replacer, 2);
}
