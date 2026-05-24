import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBpPlaybook } from "../../src/services/bpPlaybook.js";

const ROOT = join(import.meta.dirname, "../..");

describe("readBpPlaybook", () => {
  it("loads playbook with workflow modes and tool chain", () => {
    const out = readBpPlaybook();
    expect(out.playbook).toContain("Three workflow modes");
    expect(out.playbook).toContain("transform");
    expect(out.playbook).toContain("draft_bp_tab_debt");
    expect(out.playbook).toContain("read_bp_playbook");
    expect(out.sections.length).toBeGreaterThan(5);
  });

  it("loads from dist/playbooks/bp when built", () => {
    const distPlaybook = join(ROOT, "dist/playbooks/bp/playbook.md");
    if (!existsSync(distPlaybook)) return;
    const fromDist = readFileSync(distPlaybook, "utf8");
    expect(fromDist).toContain("Three workflow modes");
  });
});
