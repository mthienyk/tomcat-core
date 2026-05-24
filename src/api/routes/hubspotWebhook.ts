import type { FastifyInstance } from "fastify";
import type { CoreStore } from "../../storage/coreStore.js";
import type { Logger } from "../../logger/index.js";
import { enqueueHubspotCompanyActivitySync } from "../../sync/hubspotActivityEnqueue.js";
import {
  extractCompanyIdsFromWebhookEvents,
  parseHubspotWebhookPayload,
  verifyHubspotWebhook,
} from "../../sync/verifyHubspotWebhook.js";

export type HubspotWebhookRouteDeps = {
  store: CoreStore;
  clientSecret: string | undefined;
  publicUrl?: string;
  logger: Logger;
};

const header = (
  req: { headers: Record<string, string | string[] | undefined> },
  name: string,
): string | undefined => {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
};

export const registerHubspotWebhookRoutes = (
  app: FastifyInstance,
  deps: HubspotWebhookRouteDeps,
): void => {
  app.post(
    "/webhooks/hubspot",
    { config: { rawBody: true } },
    async (req, reply) => {
      const rawBody =
        typeof req.rawBody === "string"
          ? req.rawBody
          : typeof (req as unknown as { rawBody?: string }).rawBody === "string"
            ? (req as unknown as { rawBody: string }).rawBody
            : undefined;

      if (rawBody === undefined) {
        deps.logger.error("hubspot_webhook_missing_raw_body");
        return reply.status(500).send({ error: "Raw body not captured" });
      }

      const signatureV1 = header(req, "x-hubspot-signature");
      const signatureV3 = header(req, "x-hubspot-signature-v3");
      const signatureVersion = header(req, "x-hubspot-signature-version");
      const timestampHeader = header(req, "x-hubspot-request-timestamp");

      const verification = verifyHubspotWebhook({
        clientSecret: deps.clientSecret,
        method: req.method,
        requestUri: req.url,
        rawBody,
        ...(deps.publicUrl ? { publicUrl: deps.publicUrl } : {}),
        ...(signatureV1 ? { signatureV1 } : {}),
        ...(signatureV3 ? { signatureV3 } : {}),
        ...(signatureVersion ? { signatureVersion } : {}),
        ...(timestampHeader ? { timestampHeader } : {}),
      });

      if (!verification.ok) {
        if (!deps.clientSecret) {
          deps.logger.warn(
            "HUBSPOT_WEBHOOK_CLIENT_SECRET not set — rejecting webhook",
          );
        }
        return reply.status(401).send({ error: verification.reason });
      }

      let events;
      try {
        events = parseHubspotWebhookPayload(rawBody);
      } catch {
        return reply.status(400).send({ error: "Invalid JSON payload" });
      }

      const companyIds = extractCompanyIdsFromWebhookEvents(events);
      let enqueued = 0;
      for (const companyId of companyIds) {
        const result = await enqueueHubspotCompanyActivitySync(deps.store, {
          companyId,
          reason: "webhook",
        });
        if (result === "created") enqueued += 1;
      }

      deps.logger.info(
        {
          events: events.length,
          companyIds: companyIds.length,
          enqueued,
          signatureVersion: verification.ok ? verification.version : undefined,
        },
        "hubspot_webhook_enqueued",
      );

      return { received: true, enqueued };
    },
  );
};
