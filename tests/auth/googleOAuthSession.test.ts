import { describe, expect, it } from "vitest";
import { decodeJwtExp, isIdTokenFresh } from "../../src/auth/googleOAuthSession.js";

const sampleJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
};

describe("googleOAuthSession", () => {
  it("decodes JWT exp claim", () => {
    expect(decodeJwtExp(sampleJwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000);
  });

  it("treats token as fresh before exp minus skew", () => {
    const now = 1_700_000_000;
    const token = sampleJwt({ exp: now + 120 });
    expect(isIdTokenFresh(token, now)).toBe(true);
  });

  it("treats token as stale near exp", () => {
    const now = 1_700_000_000;
    const token = sampleJwt({ exp: now + 30 });
    expect(isIdTokenFresh(token, now)).toBe(false);
  });
});
