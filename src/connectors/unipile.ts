import { createHttpClient } from "./http.js";
import { ConnectorNotConfigured } from "../errors/index.js";

// Unipile READ-ONLY connector.
// Write operations (like, comment, invite, sendMessage, createPost) are
// intentionally absent from this module — not just policy-blocked but
// structurally unavailable so no code path can reach them.

export type UnipilePost = {
  id: string;
  socialId: string;
  shareUrl: string | undefined;
  date: string | undefined;
  parsedDatetime: string | undefined;
  text: string;
  authorName: string;
  authorIdentifier: string;
  isCompany: boolean;
  reactionCounter: number;
  commentCounter: number;
  repostCounter: number;
  isRepost: boolean;
};

export type UnipileReaction = {
  actorName: string;
  actorIdentifier: string;
  reactionType: string;
};

export type UnipileComment = {
  id: string;
  text: string;
  authorName: string;
  authorIdentifier: string;
  createdAt: string | undefined;
};

export type UnipileUserProfile = {
  id: string;
  publicIdentifier: string;
  firstName: string;
  lastName: string;
  headline: string | undefined;
  location: string | undefined;
};

export type UnipileAccountStatusResponse = {
  accountId: string;
  status: string;
  provider: string;
};

export type ListPostsOptions = {
  limit?: number;
  cursor?: string;
};

export type UnipileConnector = {
  listUserPosts(
    accountId: string,
    identifier: string,
    opts?: ListPostsOptions,
  ): Promise<{ posts: UnipilePost[]; nextCursor: string | undefined }>;

  getPost(accountId: string, idOrUrn: string): Promise<UnipilePost>;

  listPostReactions(
    accountId: string,
    socialId: string,
    opts?: { limit?: number },
  ): Promise<UnipileReaction[]>;

  listPostComments(
    accountId: string,
    socialId: string,
    opts?: { limit?: number },
  ): Promise<UnipileComment[]>;

  getUserProfile(accountId: string, identifier: string): Promise<UnipileUserProfile>;

  getAccountStatus(accountId: string): Promise<UnipileAccountStatusResponse>;
};

// --- Raw API shapes ---

type UnipileRawPost = {
  id?: string;
  social_id?: string;
  share_url?: string;
  date?: string;
  parsed_datetime?: string;
  text?: string;
  author?: {
    name?: string;
    public_identifier?: string;
    is_company?: boolean;
  };
  reaction_counter?: number;
  comment_counter?: number;
  repost_counter?: number;
  is_repost?: boolean;
};

type UnipileRawPostsResponse = {
  items?: UnipileRawPost[];
  cursor?: string;
};

type UnipileRawReaction = {
  actor?: { name?: string; public_identifier?: string };
  reaction_type?: string;
};

type UnipileRawReactionsResponse = {
  items?: UnipileRawReaction[];
};

type UnipileRawComment = {
  id?: string;
  text?: string;
  author?: { name?: string; public_identifier?: string };
  created_at?: string;
};

type UnipileRawCommentsResponse = {
  items?: UnipileRawComment[];
};

type UnipileRawProfile = {
  id?: string;
  public_identifier?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  location?: string;
};

type UnipileRawAccountStatus = {
  account_id?: string;
  status?: string;
  provider?: string;
};

// --- Mappers ---

const mapPost = (r: UnipileRawPost): UnipilePost => ({
  id: r.id ?? "",
  socialId: r.social_id ?? "",
  shareUrl: r.share_url,
  date: r.date,
  parsedDatetime: r.parsed_datetime,
  text: r.text ?? "",
  authorName: r.author?.name ?? "",
  authorIdentifier: r.author?.public_identifier ?? "",
  isCompany: r.author?.is_company ?? false,
  reactionCounter: r.reaction_counter ?? 0,
  commentCounter: r.comment_counter ?? 0,
  repostCounter: r.repost_counter ?? 0,
  isRepost: r.is_repost ?? false,
});

const mapReaction = (r: UnipileRawReaction): UnipileReaction => ({
  actorName: r.actor?.name ?? "",
  actorIdentifier: r.actor?.public_identifier ?? "",
  reactionType: r.reaction_type ?? "like",
});

const mapComment = (r: UnipileRawComment): UnipileComment => ({
  id: r.id ?? "",
  text: r.text ?? "",
  authorName: r.author?.name ?? "",
  authorIdentifier: r.author?.public_identifier ?? "",
  createdAt: r.created_at,
});

// --- Factory ---

export const createUnipileConnector = (dsn: string, apiKey: string): UnipileConnector => {
  // DSN format from Unipile dashboard: "https://apiX.unipile.com:PORT"
  const http = createHttpClient({
    connector: "unipile",
    baseUrl: dsn,
    defaultHeaders: { "X-API-KEY": apiKey },
    timeoutMs: 15_000,
    // No retry on 429 — the AccountGuardian handles that via freeze, not immediate retry.
    maxAttempts: 1,
  });

  return {
    async listUserPosts(
      accountId: string,
      identifier: string,
      opts: ListPostsOptions = {},
    ) {
      const params = new URLSearchParams({ account_id: accountId, identifier });
      if (opts.limit) params.set("limit", String(Math.min(opts.limit, 100)));
      if (opts.cursor) params.set("cursor", opts.cursor);
      const data = await http.json<UnipileRawPostsResponse>(
        `/api/v1/users/${encodeURIComponent(identifier)}/posts?${params}`,
      );
      return {
        posts: (data.items ?? []).map(mapPost),
        nextCursor: data.cursor,
      };
    },

    async getPost(accountId: string, idOrUrn: string) {
      const data = await http.json<UnipileRawPost>(
        `/api/v1/posts/${encodeURIComponent(idOrUrn)}?account_id=${encodeURIComponent(accountId)}`,
      );
      return mapPost(data);
    },

    async listPostReactions(
      accountId: string,
      socialId: string,
      opts: { limit?: number } = {},
    ) {
      const params = new URLSearchParams({ account_id: accountId });
      if (opts.limit) params.set("limit", String(Math.min(opts.limit, 100)));
      const data = await http.json<UnipileRawReactionsResponse>(
        `/api/v1/posts/${encodeURIComponent(socialId)}/reactions?${params}`,
      );
      return (data.items ?? []).map(mapReaction);
    },

    async listPostComments(
      accountId: string,
      socialId: string,
      opts: { limit?: number } = {},
    ) {
      const params = new URLSearchParams({ account_id: accountId });
      if (opts.limit) params.set("limit", String(Math.min(opts.limit, 100)));
      const data = await http.json<UnipileRawCommentsResponse>(
        `/api/v1/posts/${encodeURIComponent(socialId)}/comments?${params}`,
      );
      return (data.items ?? []).map(mapComment);
    },

    async getUserProfile(accountId: string, identifier: string) {
      const data = await http.json<UnipileRawProfile>(
        `/api/v1/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(accountId)}`,
      );
      return {
        id: data.id ?? "",
        publicIdentifier: data.public_identifier ?? identifier,
        firstName: data.first_name ?? "",
        lastName: data.last_name ?? "",
        headline: data.headline,
        location: data.location,
      };
    },

    async getAccountStatus(accountId: string) {
      const data = await http.json<UnipileRawAccountStatus>(
        `/api/v1/accounts/${encodeURIComponent(accountId)}`,
      );
      return {
        accountId: data.account_id ?? accountId,
        status: data.status ?? "UNKNOWN",
        provider: data.provider ?? "LINKEDIN",
      };
    },
  };
};

export const createUnconfiguredUnipileConnector = (): UnipileConnector => {
  const reject = (op: string) =>
    Promise.reject(ConnectorNotConfigured("unipile", op));
  return {
    listUserPosts: () => reject("listUserPosts"),
    getPost: () => reject("getPost"),
    listPostReactions: () => reject("listPostReactions"),
    listPostComments: () => reject("listPostComments"),
    getUserProfile: () => reject("getUserProfile"),
    getAccountStatus: () => reject("getAccountStatus"),
  };
};
