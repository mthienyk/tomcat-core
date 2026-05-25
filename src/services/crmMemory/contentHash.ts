import { createHash } from "node:crypto";
import { CRM_MEMORY_SCHEMA_VERSION } from "../../domain/crmMemory.js";

export const noteContentHash = (body: string): string =>
  createHash("sha256")
    .update(`${CRM_MEMORY_SCHEMA_VERSION}:${body.trim()}`)
    .digest("hex");
