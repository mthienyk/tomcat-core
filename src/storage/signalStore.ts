import type {
  WatchedEntity,
  WatchedEntityPriority,
  SignalEvent,
  UnipileAccount,
  UnipileAccountState,
  UnipileAccountStatusEvent,
} from "../domain/signalHub.js";

export type AddWatchedInput = {
  id: string;
  startupId?: string | undefined;
  displayName: string;
  linkedinUrl?: string | undefined;
  linkedinIdentifier?: string | undefined;
  kind?: "person" | "company" | undefined;
  priority?: WatchedEntityPriority | undefined;
};

export type ListEventsFilter = {
  watchedId?: string | undefined;
  startupId?: string | undefined;
  source?: string | undefined;
  signalType?: string | undefined;
  sinceIso?: string | undefined;
  textContains?: string | undefined;
  limit?: number | undefined;
};

export type UpsertUnipileAccountInput = {
  accountId: string;
  label: string;
  dailyQuota?: number;
};

export interface SignalStore {
  // Watchlist
  addWatched(input: AddWatchedInput): Promise<WatchedEntity>;
  getWatched(id: string): Promise<WatchedEntity | undefined>;
  findWatchedByName(name: string): Promise<WatchedEntity[]>;
  findWatchedByLinkedinIdentifier(identifier: string): Promise<WatchedEntity | undefined>;
  findWatchedByStartupId(startupId: string): Promise<WatchedEntity | undefined>;
  listWatched(priority?: WatchedEntityPriority): Promise<WatchedEntity[]>;
  updateWatchedPriority(id: string, priority: WatchedEntityPriority): Promise<void>;

  // Signal events (append-only — no update/delete exposed)
  appendEvent(event: Omit<SignalEvent, "ingestedAt">): Promise<SignalEvent>;
  findEventByHash(source: string, signalType: string, contentHash: string): Promise<SignalEvent | undefined>;
  listEvents(filter: ListEventsFilter): Promise<SignalEvent[]>;

  // Unipile account registry
  upsertUnipileAccount(input: UpsertUnipileAccountInput): Promise<UnipileAccount>;
  getUnipileAccount(accountId: string): Promise<UnipileAccount | undefined>;
  listUnipileAccounts(): Promise<UnipileAccount[]>;
  setUnipileAccountState(
    accountId: string,
    state: UnipileAccountState,
    opts?: { frozenUntil?: string; killedReason?: string },
  ): Promise<void>;

  // Unipile status event log (append-only)
  appendUnipileStatusEvent(event: Omit<UnipileAccountStatusEvent, "receivedAt">): Promise<void>;
  listUnipileStatusEvents(accountId: string, limit?: number): Promise<UnipileAccountStatusEvent[]>;
}
