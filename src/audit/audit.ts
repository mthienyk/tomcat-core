import type { Logger } from "../logger/index.js";
import type { Identity } from "../domain/identity.js";

export type AuditEvent = {
  action: string;
  resource: string | undefined;
  outcome: "allowed" | "denied" | "error";
  reason: string | undefined;
  meta: Record<string, unknown> | undefined;
};

const principalOf = (id: Identity): string => {
  if (id.kind === "human") return `human:${id.email}`;
  const onBehalf = id.onBehalfOf ? ` (onBehalf:${id.onBehalfOf.email})` : "";
  return `service:${id.clientId}${onBehalf}`;
};

export const createAuditor = (logger: Logger) => {
  const child = logger.child({ stream: "audit" });
  return {
    record: (id: Identity, event: AuditEvent): void => {
      child.info(
        {
          principal: principalOf(id),
          action: event.action,
          resource: event.resource,
          outcome: event.outcome,
          reason: event.reason,
          meta: event.meta,
          ts: new Date().toISOString(),
        },
        "audit",
      );
    },
  };
};

export type Auditor = ReturnType<typeof createAuditor>;
