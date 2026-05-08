import type { Scenario } from "./types.js";

export const b2bSales: Scenario = {
  name: "b2b-sales",
  description: "B2B sales pipeline with multi-contact accounts and opportunity-shaped tickets.",
  companySuffixes: ["Holdings", "Group", "Partners", "Capital", "Industries", "International"],
  emailDomainTemplate: "${slug}.com",
  ticketTitles: [
    "Renewal discussion — Q2 expansion",
    "Procurement requesting SOC2 Type II report",
    "Security review questionnaire",
    "MSA redlines from legal",
    "Pilot extension request",
    "Reference call with VP Engineering",
    "Pricing approval for multi-year",
    "Champion change at customer",
    "Onboarding kickoff scheduling",
    "Custom integration scoping",
  ],
  issueTitles: [
    "Build out commercial deck variant for FSI",
    "Standardize SOC2 evidence packet",
    "Draft multi-year discount approval flow",
    "Improve onboarding kickoff template",
  ],
  priorityWeights: ["p1", "p2", "p2", "p2", "p3", "p0"],
  articleTitles: [
    "How to request a SOC2 Type II report",
    "Standard MSA & redline turnaround",
    "Multi-year discount approval policy",
    "Reference-call request process",
    "Self-serve POC playbook",
    "Champion onboarding checklist",
  ],
  conversations: [
    {
      customer: "Procurement is asking for a current SOC2 Type II report before we can finalize the renewal.",
      agent: "Of course — sending the latest report under NDA. Our coverage period closed in March, so this is the most recent. Let me know if procurement needs the bridge letter as well.",
    },
    {
      customer: "Legal has redlines on the MSA. Our primary asks: data residency, audit rights, and a notice-of-breach window of 24 hours.",
      agent: "Thanks for surfacing these early. Data residency to EU is something we can accommodate via our Frankfurt region. 24-hour notice-of-breach is in our standard template. I'll route the audit-rights ask to legal and come back with a turn within 2 business days.",
    },
    {
      customer: "Can we extend the pilot another 30 days while procurement finishes its security review?",
      agent: "Yes — given how fast your team moved through the use-case validation, extending makes sense. I'll send a no-cost pilot extension addendum today and update the renewal date.",
    },
  ],
};
