export type SignalSource = "serper_public" | "unipile";

export type SignalType = "post" | "reaction" | "comment" | "profile_change";

export type WatchedEntityKind = "person" | "company";

export type WatchedEntityPriority = "hot" | "warm" | "cold";

export type WatchedEntity = {
  id: string;
  startupId: string | undefined;
  displayName: string;
  linkedinUrl: string | undefined;
  linkedinIdentifier: string | undefined;
  kind: WatchedEntityKind;
  priority: WatchedEntityPriority;
  createdAt: string;
};

export type SignalEvent = {
  id: string;
  source: SignalSource;
  signalType: SignalType;
  watchedId: string | undefined;
  startupId: string | undefined;
  unipileAccountId: string | undefined;
  emittedAt: string | undefined;
  ingestedAt: string;
  url: string | undefined;
  rawText: string | undefined;
  rawPayload: Record<string, unknown>;
  contentHash: string;
};

export type UnipileAccountState = "active" | "frozen" | "killed";

export type UnipileAccount = {
  accountId: string;
  label: string;
  state: UnipileAccountState;
  frozenUntil: string | undefined;
  dailyQuota: number;
  killedReason: string | undefined;
  updatedAt: string;
};

export type UnipileAccountStatusEvent = {
  id: string;
  accountId: string;
  status: string;
  rawPayload: Record<string, unknown>;
  receivedAt: string;
};

export type GuardianStatus = {
  accountId: string;
  label: string;
  state: UnipileAccountState;
  frozenUntil: string | undefined;
  frozenReason: string | undefined;
  killedReason: string | undefined;
  dailyQuota: number;
  dailyUsed: number;
  dailyResetsAt: string;
  lastCallAt: string | undefined;
  lastErrorCode: number | undefined;
  nextAllowedAt: string | undefined;
};

export type RefreshJob = {
  jobId: string;
  watchedId: string;
  source: SignalSource;
  unipileAccountId: string | undefined;
  enqueuedAt: string;
};

export type EntityResolution =
  | { resolved: true; watchedId: string; startupId: string | undefined; displayName: string }
  | { resolved: false; candidates: { watchedId: string; displayName: string }[]; needsClarification: boolean };
