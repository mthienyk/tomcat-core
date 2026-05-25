import { z } from "zod";

export const CrmMemorySemanticCardSchema = z
  .object({
    noteKind: z.enum(["m1_m2", "board", "ops", "unknown"]),
    recap: z.string().min(1),
    investmentLens: z.string().min(1),
    markets: z.array(z.string()),
    customerSegments: z.array(z.string()),
    businessModel: z.string(),
    gtmMotion: z.string(),
    redFlags: z.array(z.string()),
    positiveSignals: z.array(z.string()),
    competitorNames: z.array(z.string()),
    tomcatTake: z.string(),
    questionsToReuse: z.array(z.string()),
    confidence: z.enum(["high", "medium", "low"]),
    language: z.string().min(2),
  })
  .strict();

export type CrmMemorySemanticCardOutput = z.infer<
  typeof CrmMemorySemanticCardSchema
>;
