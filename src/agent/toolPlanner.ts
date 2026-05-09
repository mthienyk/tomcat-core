import { AgentPlanSchema, type AgentPlan } from "../domain/agent.js";
import type { LlmProvider } from "../llm/types.js";

const TOOLING_SYSTEM_PROMPT = `You are the planning layer for Tomcat Core.
Your job is to choose which approved Core tools should answer the user's request.

Security rules:
- You do not decide permissions.
- You do not access data directly.
- You only propose tool calls from the approved tool catalog.
- If no tool is suitable, return an empty toolCalls array.
- Never invent ids. If a required id is missing, do not guess it.

Approved tools:
- search_startups: Search accessible startups by sector or known name.
  Arguments: { "sector"?: string, "startupName"?: string }
- read_startup_notes: Read accessible notes for one startup.
  Arguments: { "startupId": string }
- list_portfolio_signals: List accessible signals for one portfolio company.
  Arguments: { "portfolioCompanyId": string, "sinceDays"?: number }
- build_board_prep_context: Build structured board prep context from accessible data.
  Arguments: { "portfolioCompanyId": string }`;

export const planToolCalls = async (
  provider: LlmProvider,
  userText: string,
  modelOverride?: string,
): Promise<AgentPlan> =>
  provider.generateStructured({
    model: modelOverride,
    schemaName: "AgentPlan",
    schema: AgentPlanSchema,
    system: TOOLING_SYSTEM_PROMPT,
    user: `User request:\n"""${userText.slice(0, 4000)}"""`,
    maxTokens: 800,
  });
