import { z } from "zod";

export const M1SearchTextsSchema = z
  .object({
    searchTexts: z.array(z.string().min(20)).min(1).max(2),
    competitorHints: z.array(z.string().min(2)).max(8),
    prepAngles: z.array(z.string().min(10)).max(6),
  })
  .strict();

export type M1SearchTextsOutput = z.infer<typeof M1SearchTextsSchema>;
