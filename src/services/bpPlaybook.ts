import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLAYBOOK_SECTIONS = [
  "goal",
  "template",
  "modes",
  "tools",
  "mapping",
  "revenue",
  "payroll",
  "debt",
  "benchmark",
  "confidentiality",
  "mistakes",
] as const;

export type BpPlaybookSection = (typeof PLAYBOOK_SECTIONS)[number];

export type ReadBpPlaybookOutput = {
  playbook: string;
  sections: readonly BpPlaybookSection[];
  version: string;
};

const resolvePlaybookPath = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../playbooks/bp/playbook.md"),
    join(process.cwd(), "src/playbooks/bp/playbook.md"),
    join(process.cwd(), "dist/playbooks/bp/playbook.md"),
  ];
  for (const path of candidates) {
    try {
      readFileSync(path, "utf8");
      return path;
    } catch {
      // try next
    }
  }
  throw new Error("BP playbook not found (src/playbooks/bp/playbook.md)");
};

let cached: ReadBpPlaybookOutput | undefined;

export const readBpPlaybook = (
  section?: BpPlaybookSection,
): ReadBpPlaybookOutput => {
  const full = cached ?? readFullPlaybook();
  if (!section) return full;
  const anchor = sectionAnchor(section);
  const start = full.playbook.indexOf(anchor);
  if (start === -1) return full;
  const rest = full.playbook.slice(start + anchor.length);
  const nextHeading = rest.search(/\n## /);
  const excerpt =
    nextHeading === -1
      ? full.playbook.slice(start)
      : full.playbook.slice(start, start + anchor.length + nextHeading);
  return { ...full, playbook: excerpt.trim() };
};

const readFullPlaybook = (): ReadBpPlaybookOutput => {
  const playbook = readFileSync(resolvePlaybookPath(), "utf8");
  cached = {
    playbook,
    sections: PLAYBOOK_SECTIONS,
    version: "2026-05-24",
  };
  return cached;
};

const sectionAnchor = (section: BpPlaybookSection): string => {
  const titles: Record<BpPlaybookSection, string> = {
    goal: "## Goal",
    template: "## Canonical template",
    modes: "## Three workflow modes",
    tools: "## Tool chain",
    mapping: "## Founder tab",
    revenue: "## Revenue patterns",
    payroll: "## Payroll / DSN",
    debt: "## Debt / loans",
    benchmark: "## Success criteria",
    confidentiality: "## Confidentiality",
    mistakes: "## Common mistakes",
  };
  return titles[section];
};

export const buildBpPlaybookService = () => ({
  readPlaybook: readBpPlaybook,
});

export type BpPlaybookService = ReturnType<typeof buildBpPlaybookService>;
