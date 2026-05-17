import { createHttpClient } from "./http.js";
import { ConnectorNotConfigured } from "../errors/index.js";

export type SerperSearchResult = {
  title: string;
  link: string;
  snippet: string;
  date: string | undefined;
};

export type SerperLinkedinSearchOptions = {
  limit?: number;
};

export type SerperConnector = {
  searchLinkedinPosts(query: string, opts?: SerperLinkedinSearchOptions): Promise<SerperSearchResult[]>;
  searchLinkedinProfile(identifier: string): Promise<SerperSearchResult[]>;
};

type SerperOrganicResult = {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
};

type SerperResponse = {
  organic?: SerperOrganicResult[];
};

const mapResult = (r: SerperOrganicResult): SerperSearchResult => ({
  title: r.title ?? "",
  link: r.link ?? "",
  snippet: r.snippet ?? "",
  date: r.date,
});

export const createSerperConnector = (apiKey: string): SerperConnector => {
  const http = createHttpClient({
    connector: "serper",
    baseUrl: "https://google.serper.dev",
    defaultHeaders: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    timeoutMs: 10_000,
    maxAttempts: 2,
  });

  const search = async (
    q: string,
    limit: number,
  ): Promise<SerperSearchResult[]> => {
    const data = await http.json<SerperResponse>("/search", {
      method: "POST",
      body: { q, num: Math.min(limit, 10), gl: "fr", hl: "fr" },
    });
    return (data.organic ?? []).slice(0, limit).map(mapResult);
  };

  return {
    async searchLinkedinPosts(
      query: string,
      opts: SerperLinkedinSearchOptions = {},
    ): Promise<SerperSearchResult[]> {
      const limit = opts.limit ?? 10;
      const q = `site:linkedin.com/posts "${query}"`;
      return search(q, limit);
    },

    async searchLinkedinProfile(
      identifier: string,
    ): Promise<SerperSearchResult[]> {
      const q = `site:linkedin.com/in/${identifier}`;
      return search(q, 3);
    },
  };
};

export const createUnconfiguredSerperConnector = (): SerperConnector => ({
  searchLinkedinPosts: () =>
    Promise.reject(ConnectorNotConfigured("serper", "searchLinkedinPosts")),
  searchLinkedinProfile: () =>
    Promise.reject(ConnectorNotConfigured("serper", "searchLinkedinProfile")),
});
