import type { CoreToolName } from "../domain/agent.js";
import { AGENT_TOOL_REGISTRY, type RegisteredAgentToolDefinition } from "./toolRegistry.js";

const SIGNAL_HUB_TOOL_NAMES = new Set<CoreToolName>([
  "signal_hub_list_watched",
  "signal_hub_add_watched",
  "signal_hub_set_priority",
  "signal_hub_recent_signals",
  "signal_hub_search_signals",
  "signal_hub_resolve_entity",
  "signal_hub_list_accounts",
  "signal_hub_request_refresh",
  "signal_hub_freeze_account",
]);

export const isSignalHubToolName = (toolName: CoreToolName): boolean =>
  SIGNAL_HUB_TOOL_NAMES.has(toolName);

export const isSignalHubSuggestedTool = (toolName: string): boolean =>
  toolName.startsWith("signal_hub_");

export const listMcpAgentTools = (
  signalHubEnabled: boolean,
): RegisteredAgentToolDefinition[] =>
  AGENT_TOOL_REGISTRY.filter(
    (tool) => signalHubEnabled || !isSignalHubToolName(tool.name),
  );

export const filterSignalHubSuggestions = <T extends { toolName: string }>(
  suggestions: T[],
  signalHubEnabled: boolean,
): T[] =>
  signalHubEnabled
    ? suggestions
    : suggestions.filter((item) => !isSignalHubSuggestedTool(item.toolName));
