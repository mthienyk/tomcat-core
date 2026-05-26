import type { StartupDirectoryTier } from "./startupDirectory.js";

export type SocietyMemberKind = "society_member" | "founder";

export type SocietyMember = {
  memberId: string;
  email: string;
  kind: SocietyMemberKind;
  tier: string;
  investorId: string | undefined;
  active: boolean;
};

export type StartupBrowseQuery = {
  q: string | undefined;
  sector: string | undefined;
  cursor: string | undefined;
  limit: number;
  includeInternalOnly: boolean;
  directoryTiers: readonly StartupDirectoryTier[] | undefined;
};

export type StartupBrowsePage = {
  items: import("./entities.js").Startup[];
  nextCursor: string | undefined;
  hasMore: boolean;
};
