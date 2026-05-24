export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const emailDomain = (email: string): string =>
  normalizeEmail(email).split("@")[1] ?? "";
