import { AuthInvalid, CoreError } from "../errors/index.js";

export type AuthFailureReason =
  | "access_revoked"
  | "user_not_provisioned"
  | "invalid_token"
  | "auth_required";

export const accessRevokedMessage = (email: string): string =>
  `Tomcat access revoked for "${email}". Contact an admin.`;

export const mcpSessionExpiredMessage =
  "MCP session expired or invalid. Disconnect and reconnect the connector in Claude or Cursor.";

export const staleBearerAuthInvalid = (): CoreError =>
  AuthInvalid(mcpSessionExpiredMessage, {
    reason: "invalid_token",
    nextAction: "reconnect_mcp_connector",
  });

export const authFailureReason = (error: unknown): AuthFailureReason | undefined => {
  if (!(error instanceof CoreError)) return undefined;
  if (error.code === "AUTH_REQUIRED") return "auth_required";
  if (error.code !== "AUTH_INVALID") return undefined;

  const reason = error.details?.["reason"];
  if (reason === "access_revoked" || reason === "user_not_provisioned") {
    return reason;
  }
  if (error.message.includes("revoked")) return "access_revoked";
  return "invalid_token";
};

export const mcpNextActionForAuthError = (error: unknown): string => {
  if (error instanceof CoreError && error.details?.["nextAction"]) {
    return String(error.details["nextAction"]);
  }

  const reason = authFailureReason(error);
  if (reason === "access_revoked") return "contact_admin";
  if (reason === "user_not_provisioned") return "contact_admin";
  if (reason === "invalid_token") return "reconnect_mcp_connector";
  if (reason === "auth_required") return "reconnect_mcp_connector";

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("auth:token")) return "run_npm_auth_token";
  if (message.includes("auth:google")) return "run_npm_auth_google";
  return "inspect_audit_logs_or_support";
};
