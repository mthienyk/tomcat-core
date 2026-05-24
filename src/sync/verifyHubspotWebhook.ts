import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_TIMESTAMP_SKEW_MS = 5 * 60_000;

export type VerifyHubspotWebhookInput = {
  clientSecret: string | undefined;
  method: string;
  requestUri: string;
  publicUrl?: string;
  rawBody: string;
  signatureV1?: string;
  signatureV2?: string;
  signatureV3?: string;
  signatureVersion?: string;
  timestampHeader?: string;
  nowMs?: number;
};

export type VerifyHubspotWebhookResult =
  | { ok: true; version: "v1" | "v2" | "v3" }
  | { ok: false; reason: string };

const decodeUriComponentSafe = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const normalizeHubspotRequestUri = (requestUri: string): string =>
  requestUri
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/%3F/gi, "?")
    .replace(/%40/gi, "@")
    .replace(/%21/gi, "!")
    .replace(/%24/gi, "$")
    .replace(/%27/gi, "'")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .replace(/%2A/gi, "*")
    .replace(/%2C/gi, ",")
    .replace(/%3B/gi, ";")
    .split("?")
    .map((part, index) => (index === 0 ? part : decodeUriComponentSafe(part)))
    .join("?");

const safeEqual = (left: string, right: string): boolean => {
  try {
    return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
  } catch {
    return false;
  }
};

const sha256Hex = (source: string): string =>
  createHash("sha256").update(source, "utf8").digest("hex");

const requestUriCandidates = (
  requestUri: string,
  publicUrl?: string,
): string[] => {
  const normalizedPath = normalizeHubspotRequestUri(requestUri);
  const candidates = new Set<string>([normalizedPath, requestUri]);
  if (publicUrl) {
    candidates.add(publicUrl);
    try {
      const parsed = new URL(publicUrl);
      candidates.add(`${parsed.pathname}${parsed.search}`);
      candidates.add(normalizeHubspotRequestUri(`${parsed.pathname}${parsed.search}`));
    } catch {
      // ignore invalid public URL
    }
  }
  return [...candidates];
};

export const verifyHubspotWebhookV1 = (input: {
  clientSecret: string;
  rawBody: string;
  signature: string;
}): boolean => {
  const expected = sha256Hex(`${input.clientSecret}${input.rawBody}`);
  return safeEqual(expected, input.signature);
};

export const verifyHubspotWebhookV2 = (input: {
  clientSecret: string;
  method: string;
  requestUri: string;
  publicUrl?: string;
  rawBody: string;
  signature: string;
}): boolean => {
  const method = input.method.toUpperCase();
  for (const uri of requestUriCandidates(input.requestUri, input.publicUrl)) {
    const expected = sha256Hex(
      `${input.clientSecret}${method}${uri}${input.rawBody}`,
    );
    if (safeEqual(expected, input.signature)) return true;
  }
  return false;
};

export const verifyHubspotWebhookV3 = (
  input: Omit<VerifyHubspotWebhookInput, "clientSecret"> & {
    clientSecret: string;
    signatureV3: string;
  },
): VerifyHubspotWebhookResult => {
  if (!input.timestampHeader) {
    return { ok: false, reason: "Missing X-HubSpot-Request-Timestamp header" };
  }

  const timestampMs = Number(input.timestampHeader);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "Invalid X-HubSpot-Request-Timestamp" };
  }

  const nowMs = input.nowMs ?? Date.now();
  if (Math.abs(nowMs - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: "Webhook timestamp outside 5 minute window" };
  }

  const method = input.method.toUpperCase();
  for (const uri of requestUriCandidates(input.requestUri, input.publicUrl)) {
    const source = `${method}${uri}${input.rawBody}${input.timestampHeader}`;
    const expected = createHmac("sha256", input.clientSecret)
      .update(source, "utf8")
      .digest("base64");
    if (safeEqual(expected, input.signatureV3)) {
      return { ok: true, version: "v3" };
    }
  }

  return { ok: false, reason: "Signature mismatch (v3)" };
};

export const verifyHubspotWebhook = (
  input: VerifyHubspotWebhookInput,
): VerifyHubspotWebhookResult => {
  if (!input.clientSecret) {
    return { ok: false, reason: "HUBSPOT_WEBHOOK_CLIENT_SECRET not configured" };
  }

  const version = input.signatureVersion?.toLowerCase();

  if (input.signatureV3) {
    const v3 = verifyHubspotWebhookV3({
      ...input,
      clientSecret: input.clientSecret,
      signatureV3: input.signatureV3,
    });
    if (v3.ok) return v3;
    if (version === "v3") return v3;
  }

  if (input.signatureV2 || version === "v2") {
    const signature = input.signatureV2 ?? input.signatureV1;
    if (!signature) {
      return { ok: false, reason: "Missing X-HubSpot-Signature header" };
    }
    const valid = verifyHubspotWebhookV2({
      clientSecret: input.clientSecret,
      method: input.method,
      requestUri: input.requestUri,
      rawBody: input.rawBody,
      signature,
      ...(input.publicUrl ? { publicUrl: input.publicUrl } : {}),
    });
    return valid
      ? { ok: true, version: "v2" }
      : { ok: false, reason: "Signature mismatch (v2)" };
  }

  if (input.signatureV1) {
    const valid = verifyHubspotWebhookV1({
      clientSecret: input.clientSecret,
      rawBody: input.rawBody,
      signature: input.signatureV1,
    });
    if (valid) return { ok: true, version: "v1" };
  }

  if (input.signatureV3) {
    return verifyHubspotWebhookV3({
      ...input,
      clientSecret: input.clientSecret,
      signatureV3: input.signatureV3,
    });
  }

  return { ok: false, reason: "Missing HubSpot signature header" };
};

export type HubspotWebhookEvent = {
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  changeSource?: string;
  eventId?: number;
  subscriptionId?: number;
  portalId?: number;
  occurredAt?: number;
  subscriptionType?: string;
  attemptNumber?: number;
};

export const parseHubspotWebhookPayload = (
  rawBody: string,
): HubspotWebhookEvent[] => {
  const parsed = JSON.parse(rawBody) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is HubspotWebhookEvent =>
      typeof item === "object"
      && item !== null
      && typeof (item as HubspotWebhookEvent).objectId === "number",
  );
};

export const extractCompanyIdsFromWebhookEvents = (
  events: HubspotWebhookEvent[],
): string[] => {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.subscriptionType?.startsWith("company.")) {
      ids.add(String(event.objectId));
    }
  }
  return [...ids];
};
