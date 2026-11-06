import type { ResolvedContext } from "@whatsloaded/core";
import pc from "picocolors";

export function renderTree(ctx: ResolvedContext): string {
  const lines: string[] = [];

  lines.push(
    `${pc.bold(pc.cyan(ctx.provider))} · ${ctx.dir} · ${pc.dim(`rules ${ctx.rulesVersion}`)}`,
  );

  lines.push("");
  lines.push(
    `${pc.bold("EFFECTIVE ITEMS")} ${pc.dim(`(${ctx.effective.length} active · ${ctx.shadowed.length} shadowed)`)}`,
  );

  if (ctx.effective.length === 0) {
    lines.push(pc.dim("  (none)"));
  } else {
    for (const item of ctx.effective) {
      lines.push(`  ${pc.green("•")} ${item.artifactId.padEnd(45)} ${pc.dim(item.reason)}`);
    }
  }

  if (ctx.shadowed.length > 0) {
    lines.push("");
    lines.push(pc.bold(pc.yellow("SHADOWED (OVERRIDDEN)")));
    for (const edge of ctx.shadowed) {
      lines.push(
        `  ${pc.red("✗")} ${pc.strikethrough(edge.loser)} ${pc.dim(`shadowed by ${edge.winner} (${edge.ruleId})`)}`,
      );
    }
  }

  if (ctx.conditional.length > 0) {
    lines.push("");
    lines.push(pc.bold(pc.cyan("CONDITIONAL / LAZY")));
    for (const item of ctx.conditional) {
      lines.push(`  ${pc.cyan("~")} ${item.artifactId} ${pc.dim(item.reason)}`);
    }
  }

  lines.push("");
  lines.push(
    `${pc.bold("TOTALS")}: ${ctx.totals.instructionBytes} bytes (≈${ctx.totals.approxTokens} tokens)`,
  );

  return lines.join("\n");
}
