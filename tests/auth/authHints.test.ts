import { describe, expect, it } from "vitest";
import { AuthInvalid } from "../../src/errors/index.js";
import {
  authFailureReason,
  mcpNextActionForAuthError,
} from "../../src/auth/authHints.js";

describe("authHints", () => {
  it("maps revoked access to contact_admin", () => {
    const error = AuthInvalid("Tomcat access revoked for x@tomcat.eu", {
      reason: "access_revoked",
    });
    expect(authFailureReason(error)).toBe("access_revoked");
    expect(mcpNextActionForAuthError(error)).toBe("contact_admin");
  });

  it("maps invalid token to reconnect for remote MCP", () => {
    const error = AuthInvalid("Invalid or expired Google ID token", {
      reason: "invalid_token",
    });
    expect(authFailureReason(error)).toBe("invalid_token");
    expect(mcpNextActionForAuthError(error)).toBe("reconnect_mcp_connector");
  });

  it("honors explicit nextAction in error details", () => {
    const error = AuthInvalid("Invalid or expired Google ID token", {
      reason: "invalid_token",
      nextAction: "run_npm_auth_token",
    });
    expect(mcpNextActionForAuthError(error)).toBe("run_npm_auth_token");
  });
});
