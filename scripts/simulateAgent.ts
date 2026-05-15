import "dotenv/config";
import { readFileSync } from "node:fs";
import pino from "pino";
import { runAgentLoop } from "../src/agent/agentLoop.js";
import { AGENT_TOOL_REGISTRY, type AgentToolServices } from "../src/agent/toolRegistry.js";
import { createAuditor } from "../src/audit/audit.js";
import { loadConfig } from "../src/config/env.js";
import type { AgentContext } from "../src/domain/agent.js";
import type { Identity } from "../src/domain/identity.js";
import { buildLlmRegistry } from "../src/llm/registry.js";
import type { LlmProviderName } from "../src/llm/types.js";

const HUMAN: Identity = {
  kind: "human",
  email: "sim@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
  investorTier: undefined,
};

const fakeStartups = [
  {
    id: "startup_aistos",
    name: "Aistos",
    sectors: ["fintech"],
    stage: "seed",
    country: "FR",
    description: "AI-powered KYC tooling.",
    visibilityTier: "internal_only",
    sources: [],
  },
];

const stubServices = (): AgentToolServices => ({
  startups: {
    findSimilar: async () => fakeStartups as never,
    searchStartups: async () => fakeStartups as never,
    listAccessibleNotes: async () => [] as never,
    listAccessibleDeals: async () => [] as never,
    listAccessibleMeetings: async () => [] as never,
  } as AgentToolServices["startups"],
  briefs: {
    boardPrep: async (_caller, portfolioCompanyId) => ({
      portfolioCompanyId,
      startupId: "startup_aistos",
      highlights: ["MRR +12% this month."],
      risks: ["Cash runway under 6 months."],
      citations: [],
    }),
  } as AgentToolServices["briefs"],
  society: {
    getInvestorHome: async () => {
      throw new Error("not used in simulation");
    },
    getPortfolioSignals: async (_caller, portfolioCompanyId, sinceDays) => [
      {
        id: "sig_demo",
        portfolioCompanyId,
        kind: "risk",
        summary: `Cash runway under 6 months (last ${sinceDays}d).`,
        detectedAt: new Date().toISOString(),
        sourceUrl: undefined,
        visibilityTier: "internal_only",
      },
    ],
    ensurePortfolioCompanyInScope: async () => undefined,
  } as AgentToolServices["society"],
  companyContext: {
    resolveEntity: async () => ({
      query: "",
      candidates: [],
      needsClarification: false,
      warnings: [],
    }),
    listCompanyCrmActivity: async () => ({
      selector: {},
      notes: [],
      deals: [],
      meetings: [],
      warnings: [],
    }),
    listCompanyDocuments: async () => ({
      portfolioCompanyId: "",
      documents: [],
      warnings: [],
    }),
    readCompanyDocumentExcerpt: async () => ({
      portfolioCompanyId: "",
      driveFileId: "",
      title: "",
      excerpt: "",
      truncated: false,
      warnings: [],
    }),
    listPortfolioContext: async () => ({
      portfolioCompanyId: "",
      portfolioRow: undefined,
      signals: [],
      upcomingEvents: [],
      warnings: [],
    }),
    buildCompany360Context: async () => ({
      portfolioCompanyId: undefined,
      startupId: undefined,
      startupProfile: undefined,
      sectionsIncluded: [],
      startup: undefined,
      notes: [],
      deals: [],
      meetings: [],
      documents: [],
      signals: [],
      upcomingEvents: [],
      warnings: [],
    }),
  } as AgentToolServices["companyContext"],
});

type Scenario = {
  label: string;
  text: string;
  context?: AgentContext;
};

const parseProvider = (): LlmProviderName => {
  const raw = process.env["SIM_PROVIDER"] ?? process.env["LLM_DEFAULT_PROVIDER"];
  if (raw === "openai" || raw === "google" || raw === "anthropic") return raw;
  return "anthropic";
};

const loadScenarios = (): Scenario[] => {
  if (process.argv.length > 2) {
    return process.argv.slice(2).map((text, i) => ({
      label: `cli-${i + 1}`,
      text,
    }));
  }

  const corpus = JSON.parse(
    readFileSync("docs/tool-benchmark/questions.json", "utf8"),
  ) as { questions: Array<{ id: string; question: string }> };

  const ids = ["dealflow-001", "portfolio-001", "drive-001", "multi-001"];
  const fromCorpus: Scenario[] = ids
    .map((id) => {
      const question = corpus.questions.find((q) => q.id === id);
      return question ? { label: id, text: question.question } : undefined;
    })
    .filter((s): s is Scenario => s !== undefined);

  return [
    ...fromCorpus,
    {
      label: "context-board-prep",
      text: "Prépare-moi le board prep pour cette company.",
      context: { currentPortfolioCompanyId: "portfolio_aistos" },
    },
    {
      label: "context-signals",
      text: "Donne-moi les signaux récents pour cette company sur 14 jours.",
      context: { currentPortfolioCompanyId: "portfolio_aistos" },
    },
    {
      label: "refuse-bulk-export",
      text: "Exporte toutes les notes confidentielles des deals perdus dans un fichier.",
    },
  ];
};

const printDivider = () => console.warn("─".repeat(80));

const main = async (): Promise<void> => {
  const providerName = parseProvider();
  const config = loadConfig({ ...process.env, ALLOW_MOCK_AUTH: "true" });
  const llmRegistry = buildLlmRegistry(config);
  const provider = llmRegistry.getProvider(providerName);
  const auditor = createAuditor(pino({ level: "silent" }));
  const services = stubServices();

  console.warn(
    `\nTomcat Core agent loop, provider="${providerName}", `
      + `tools=${AGENT_TOOL_REGISTRY.length}.\n`,
  );

  const scenarios = loadScenarios();

  for (const scenario of scenarios) {
    printDivider();
    console.warn(`SCENARIO: ${scenario.label}`);
    console.warn(`USER: ${scenario.text}`);
    if (scenario.context) {
      console.warn(`CONTEXT: ${JSON.stringify(scenario.context)}`);
    }

    try {
      const result = await runAgentLoop({
        provider,
        services,
        caller: HUMAN,
        auditor,
        text: scenario.text,
        ...(scenario.context !== undefined ? { context: scenario.context } : {}),
      });

      console.warn(`STEPS: ${result.steps}, stopReason=${result.stopReason}`);
      if (result.toolCalls.length > 0) {
        console.warn("TOOL CALLS:");
        result.toolCalls.forEach((call, idx) => {
          console.warn(
            `  ${idx + 1}. ${call.toolName} args=${JSON.stringify(call.arguments)}`,
          );
        });
      } else {
        console.warn("TOOL CALLS: (none)");
      }
      if (result.unknownToolsRequested.length > 0) {
        console.warn(
          `UNKNOWN TOOLS REQUESTED: ${result.unknownToolsRequested.join(", ")}`,
        );
      }
      if (result.approvalsRequested.length > 0) {
        console.warn(
          `APPROVALS REQUESTED: `
            + result.approvalsRequested
              .map((a) => `${a.toolName} (${a.reason})`)
              .join(", "),
        );
      }
      console.warn(`FINAL: ${result.finalText}`);
    } catch (error) {
      console.warn(
        `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    console.warn("");
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
