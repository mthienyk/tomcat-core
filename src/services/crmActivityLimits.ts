export const CRM_ACTIVITY_DEFAULT_LIMITS = {
  notes: 15,
  deals: 10,
  meetings: 10,
} as const;

export const clampCrmLimit = (
  value: number | undefined,
  fallback: number,
  max: number,
): number => {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
};
