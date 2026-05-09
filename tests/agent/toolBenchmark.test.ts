import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const BenchmarkQuestionSchema = z.object({
  id: z.string().min(1),
  persona: z.enum([
    "partner",
    "analyst",
    "portfolio_ops",
    "finance",
    "investor_relations",
    "marketing",
    "admin",
  ]),
  intent: z.string().min(1),
  question: z.string().min(10),
  sources: z
    .array(
      z.enum([
        "hubspot",
        "monday",
        "drive",
        "linkedin",
        "internal_db",
        "transcripts",
        "llm",
      ]),
    )
    .min(1),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
  expectedBehavior: z.enum([
    "answer",
    "clarify",
    "refuse",
    "approval_required",
  ]),
  candidateTools: z.array(z.string().min(1)).min(1),
});

const BenchmarkSchema = z.object({
  version: z.string().min(1),
  source: z.string().min(1),
  questions: z.array(BenchmarkQuestionSchema).min(60).max(80),
});

const loadBenchmark = (): z.infer<typeof BenchmarkSchema> =>
  BenchmarkSchema.parse(
    JSON.parse(
      readFileSync("docs/tool-benchmark/questions.json", "utf8"),
    ) as unknown,
  );

describe("tool benchmark corpus", () => {
  it("keeps a valid 60-80 question benchmark", () => {
    const benchmark = loadBenchmark();

    expect(benchmark.questions).toHaveLength(62);
  });

  it("uses portable tool names for MCP, OpenAI, Claude and Gemini", () => {
    const benchmark = loadBenchmark();
    const toolNamePattern = /^[A-Za-z0-9_.-]{1,64}$/;

    const invalidNames = benchmark.questions.flatMap((question) =>
      question.candidateTools.filter((toolName) => !toolNamePattern.test(toolName)),
    );

    expect(invalidNames).toEqual([]);
  });

  it("marks dangerous bulk export requests as refusals", () => {
    const benchmark = loadBenchmark();
    const exportCase = benchmark.questions.find(
      (question) => question.id === "governance-003",
    );

    expect(exportCase?.expectedBehavior).toBe("refuse");
    expect(exportCase?.candidateTools).toEqual(["policy.evaluate_request"]);
  });

  it("requires approval for restricted finance and outbound workflows", () => {
    const benchmark = loadBenchmark();
    const approvalCases = benchmark.questions.filter(
      (question) =>
        question.intent.startsWith("bp_") ||
        question.intent.startsWith("legal_") ||
        question.intent.startsWith("reporting_") ||
        question.intent.startsWith("kpi_") ||
        question.intent.startsWith("signature_") ||
        question.intent.startsWith("bank_") ||
        question.intent.startsWith("private_data_") ||
        question.intent === "outbound_send",
    );

    expect(approvalCases.length).toBeGreaterThan(5);
    expect(
      approvalCases.every((question) =>
        ["approval_required", "refuse"].includes(question.expectedBehavior),
      ),
    ).toBe(true);
  });

  it("covers the current and future source systems", () => {
    const benchmark = loadBenchmark();
    const sourceSet = new Set(
      benchmark.questions.flatMap((question) => question.sources),
    );

    expect(sourceSet).toEqual(
      new Set([
        "hubspot",
        "monday",
        "drive",
        "linkedin",
        "internal_db",
        "transcripts",
        "llm",
      ]),
    );
  });
});
