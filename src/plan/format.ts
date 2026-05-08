import type { Plan } from "../types/plan.js";

export function formatPlanHuman(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`## ${plan.title}`);
  if (plan.summary) lines.push(plan.summary);
  lines.push("");
  lines.push("### API / automation steps");
  let n = 0;
  for (const s of plan.steps) {
    n++;
    lines.push(`${n}. [${s.kind}] ${s.title}`);
    lines.push(`   - Rationale: ${s.rationale}`);
    if (s.payload && Object.keys(s.payload).length > 0) {
      lines.push(`   - Payload keys: ${Object.keys(s.payload).join(", ")}`);
    }
  }
  if (plan.ui_guidance_sections?.length) {
    lines.push("");
    lines.push("### UI guidance (manual steps)");
    for (const g of plan.ui_guidance_sections) {
      lines.push(`#### ${g.title}`);
      if (g.doc_links?.length) lines.push(`Docs: ${g.doc_links.join(" · ")}`);
      for (let i = 0; i < g.steps.length; i++) {
        lines.push(`${i + 1}. ${g.steps[i]}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
