export type StartupDirectoryTier =
  | "excluded"
  | "dealflow"
  | "invested"
  | "portfolio"
  | "alumni";

export const SOCIETY_INTERNAL_DIRECTORY_TIERS: readonly StartupDirectoryTier[] = [
  "portfolio",
  "invested",
  "dealflow",
  "alumni",
];

export const SOCIETY_INVESTOR_DIRECTORY_TIERS: readonly StartupDirectoryTier[] = [
  "portfolio",
  "invested",
  "alumni",
];
