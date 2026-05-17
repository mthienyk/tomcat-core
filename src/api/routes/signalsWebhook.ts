import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "crypto";
import { randomUUID } from "crypto";
import type { SignalStore } from "../../storage/signalStore.js";
import type { GuardianRegistry } from "../../services/signalHub/accountGuardian.js";

// Statuses that indicate the account is healthy — no guardian action needed.
const HEALTHY_STATUSES = new Set([
  "OK",
  "SYNC_SUCCESS",
  "CONNECTING",
  "CREATION_SUCCESS",
]);

// Statuses that trigger an immediate 24h freeze.
const FREEZE_STATUSES = new Set(["CREDENTIALS", "ERROR"]);

// DELETED → permanent kill.
const KILL_STATUS = "DELETED";

// Unipile sends a signature in X-Unipile-Signature as HMAC-SHA256 of the raw body.
// If no secret is configured, we skip verification (dev-only behaviour, logged as warn).
const verifySignature = (
  secret: string | undefined,
  rawBody: string,
  signatureHeader: string | null,
): boolean => {
  if (!secret) return true; // dev fallback — caller must log a warning
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(signatureHeader, "utf-8"),
      Buffer.from(expected, "utf-8"),
    );
  } catch {
    return false;
  }
};

type UnipileWebhookPayload = {
  account_id?: string;
  status?: string;
  [key: string]: unknown;
};

export const registerSignalsWebhookRoutes = (
  app: FastifyInstance,
  store: SignalStore,
  guardians: GuardianRegistry,
  webhookSecret: string | undefined,
): void => {
  app.post(
    "/signals/unipile/webhook",
    {
      config: { rawBody: true },
    },
    async (req, reply) => {
      const rawBody =
        typeof (req as unknown as { rawBody?: string }).rawBody === "string"
          ? (req as unknown as { rawBody: string }).rawBody
          : JSON.stringify(req.body);

      const signature = req.headers["x-unipile-signature"] as string | undefined ?? null;

      if (!webhookSecret) {
        req.log.warn("UNIPILE_WEBHOOK_SECRET not set — skipping signature verification");
      }

      if (!verifySignature(webhookSecret, rawBody, signature)) {
        return reply.status(401).send({ error: "Invalid webhook signature" });
      }

      const payload = req.body as UnipileWebhookPayload;
      const accountId = payload.account_id;
      const status = payload.status?.toUpperCase() ?? "UNKNOWN";

      if (!accountId) {
        return reply.status(400).send({ error: "Missing account_id" });
      }

      // Persist the raw event regardless of action taken.
      await store.appendUnipileStatusEvent({
        id: randomUUID(),
        accountId,
        status,
        rawPayload: payload as Record<string, unknown>,
      });

      const guardian = guardians.get(accountId);

      if (status === KILL_STATUS) {
        if (guardian) {
          await guardian.kill("account deleted upstream (Unipile webhook)");
        } else {
          await store.setUnipileAccountState(accountId, "killed", {
            killedReason: "account deleted upstream (Unipile webhook)",
          });
        }
        req.log.warn({ accountId, status }, "signal_hub.unipile.account_killed");
        return { received: true, action: "killed" };
      }

      if (FREEZE_STATUSES.has(status)) {
        if (guardian) {
          await guardian.freeze(`Unipile webhook status: ${status}`);
        } else {
          const until = new Date(Date.now() + 24 * 3_600_000).toISOString();
          await store.setUnipileAccountState(accountId, "frozen", { frozenUntil: until });
        }
        req.log.warn({ accountId, status }, "signal_hub.unipile.account_frozen");
        return { received: true, action: "frozen" };
      }

      if (HEALTHY_STATUSES.has(status) && guardian) {
        // If account had been frozen due to CREDENTIALS and is now RECONNECTED/OK,
        // lift the freeze automatically.
        const snap = guardian.snapshot();
        if (snap.state === "frozen" && snap.killedReason === undefined) {
          await guardian.unfreeze();
          req.log.info({ accountId, status }, "signal_hub.unipile.account_unfrozen");
          return { received: true, action: "unfrozen" };
        }
      }

      req.log.info({ accountId, status }, "signal_hub.unipile.webhook_received");
      return { received: true, action: "none" };
    },
  );
};
