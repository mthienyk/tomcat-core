import { describe, expect, it } from "vitest";
import { emailDomain, normalizeEmail } from "../../src/auth/email.js";

describe("auth email helpers", () => {
  it("normalizes email casing and whitespace", () => {
    expect(normalizeEmail("  Team@Tomcat.EU ")).toBe("team@tomcat.eu");
  });

  it("extracts domain from normalized email", () => {
    expect(emailDomain("Team@Tomcat.EU")).toBe("tomcat.eu");
  });
});
