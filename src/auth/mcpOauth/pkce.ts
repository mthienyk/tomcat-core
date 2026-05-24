import { createHash, timingSafeEqual } from "node:crypto";

export const verifyPkceS256 = (verifier: string, challenge: string): boolean => {
  const computed = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  if (computed.length !== challenge.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
};

export const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");
