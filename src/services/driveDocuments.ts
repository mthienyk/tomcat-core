export type DriveDocumentListing = {
  driveFileId: string;
  title: string;
  createdAt: string;
  mimeType?: string;
};

export type DriveDocumentRelevance =
  | "board_pack"
  | "deck"
  | "business_plan"
  | "reporting"
  | "legal"
  | "other";

export type RankedDriveDocument = DriveDocumentListing & {
  relevance: DriveDocumentRelevance;
  relevanceScore: number;
  textExtractable: boolean;
};

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

const TEXT_EXTRACTABLE_MIMES = new Set([
  GOOGLE_DOC_MIME,
  GOOGLE_SLIDES_MIME,
  GOOGLE_SHEET_MIME,
]);

const BINARY_EXTENSION = /\.(pdf|xlsx?|docx?|pptx?|zip)$/i;
const MARKETING_ASSET_PATTERN =
  /\blogo\b|\bvisuel\b|\bteam\b|\.(png|jpe?g|webp|svg|gif)$/i;
const DECK_TITLE_PATTERN =
  /\bdeck\b|\bpitch\b|\bpresentation\b|\bbp\b|business plan|busines plan/i;

const DECK_RELEVANCE = new Set<DriveDocumentRelevance>([
  "deck",
  "business_plan",
  "board_pack",
]);

const RELEVANCE_RULES: Array<{
  pattern: RegExp;
  relevance: DriveDocumentRelevance;
  score: number;
}> = [
  { pattern: /\bboard\b/i, relevance: "board_pack", score: 100 },
  { pattern: /\bdeck\b|\bpitch\b/i, relevance: "deck", score: 90 },
  { pattern: /\bbp\b|business plan|busines plan/i, relevance: "business_plan", score: 80 },
  {
    pattern: /\bmonthly\b|\breporting\b|\bq[1-4]\b|\btrimest/i,
    relevance: "reporting",
    score: 60,
  },
  {
    pattern: /\bjuridique\b|\bstatuts\b|\bpv\b|\btrait[eé]\b|\bdua\b|\bactions\b|\bfusion\b|\bapport\b|\battribution\b/i,
    relevance: "legal",
    score: 20,
  },
];

export const inferMimeTypeFromTitle = (title: string): string | undefined => {
  const lower = title.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  return undefined;
};

export const isTextExtractableDriveFile = (
  mimeType: string | undefined,
  title: string,
): boolean => {
  const resolved = mimeType ?? inferMimeTypeFromTitle(title);
  if (!resolved) return true;
  if (TEXT_EXTRACTABLE_MIMES.has(resolved)) return true;
  if (resolved.startsWith("text/")) return true;
  if (BINARY_EXTENSION.test(title)) return false;
  if (
    resolved.includes("pdf") ||
    resolved.includes("spreadsheetml") ||
    resolved.includes("wordprocessingml") ||
    resolved.includes("presentationml")
  ) {
    return false;
  }
  return true;
};

export const scoreDriveDocumentRelevance = (
  title: string,
): { relevance: DriveDocumentRelevance; score: number } => {
  for (const rule of RELEVANCE_RULES) {
    if (rule.pattern.test(title)) {
      return { relevance: rule.relevance, score: rule.score };
    }
  }
  return { relevance: "other", score: 40 };
};

export const rankDriveDocuments = (
  files: DriveDocumentListing[],
): RankedDriveDocument[] =>
  [...files]
    .map((file) => {
      const { relevance, score } = scoreDriveDocumentRelevance(file.title);
      return {
        ...file,
        relevance,
        relevanceScore: score,
        textExtractable: isTextExtractableDriveFile(file.mimeType, file.title),
      };
    })
    .sort((left, right) => {
      if (right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }
      return right.createdAt.localeCompare(left.createdAt);
    });

export const prepareDriveDocumentList = (
  files: DriveDocumentListing[],
  options?: {
    includeBinaries?: boolean;
    limit?: number;
  },
): { documents: RankedDriveDocument[]; warnings: string[] } => {
  const warnings: string[] = [];
  const includeBinaries = options?.includeBinaries ?? false;
  const limit = Math.min(options?.limit ?? 25, 100);

  let ranked = rankDriveDocuments(files);
  const binaryCount = ranked.filter((file) => !file.textExtractable).length;

  if (!includeBinaries) {
    ranked = ranked.filter((file) => file.textExtractable);
    if (binaryCount > 0) {
      warnings.push(
        `${String(binaryCount)} binary file(s) omitted. Pass includeBinaries=true to list PDFs and spreadsheets.`,
      );
    }
  }

  if (ranked.length > limit) {
    warnings.push(
      `Document list truncated to ${String(limit)} items after relevance ranking.`,
    );
    ranked = ranked.slice(0, limit);
  }

  return { documents: ranked, warnings };
};

export const isMarketingDriveAsset = (
  title: string,
  mimeType?: string,
): boolean => {
  if (MARKETING_ASSET_PATTERN.test(title)) return true;
  const resolved = mimeType ?? inferMimeTypeFromTitle(title);
  if (resolved?.startsWith("image/")) return true;
  return false;
};

export const isDeckLikeDriveFile = (file: RankedDriveDocument): boolean => {
  if (isMarketingDriveAsset(file.title, file.mimeType)) return false;
  if (DECK_RELEVANCE.has(file.relevance)) return true;
  if (file.mimeType === GOOGLE_SLIDES_MIME) return true;
  if (DECK_TITLE_PATTERN.test(file.title)) return true;
  const resolved = file.mimeType ?? inferMimeTypeFromTitle(file.title);
  if (
    resolved?.includes("presentationml") &&
    DECK_TITLE_PATTERN.test(file.title)
  ) {
    return true;
  }
  return false;
};

const DECK_KIND_PRIORITY: Record<DriveDocumentRelevance, number> = {
  deck: 3,
  board_pack: 2,
  business_plan: 1,
  reporting: 0,
  legal: 0,
  other: 0,
};

export const rankDeckCandidates = (
  files: DriveDocumentListing[],
): RankedDriveDocument[] => {
  const ranked = rankDriveDocuments(files).filter((file) =>
    isDeckLikeDriveFile(file),
  );

  return ranked.sort((left, right) => {
    const leftKind = DECK_KIND_PRIORITY[left.relevance];
    const rightKind = DECK_KIND_PRIORITY[right.relevance];
    if (rightKind !== leftKind) return rightKind - leftKind;

    const leftSlides = left.mimeType === GOOGLE_SLIDES_MIME ? 5 : 0;
    const rightSlides = right.mimeType === GOOGLE_SLIDES_MIME ? 5 : 0;
    const leftScore = left.relevanceScore + leftSlides;
    const rightScore = right.relevanceScore + rightSlides;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return right.createdAt.localeCompare(left.createdAt);
  });
};
