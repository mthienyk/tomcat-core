import type { NoteSensitivity } from "./entities.js";

export const CRM_MEMORY_SCHEMA_VERSION = "1";

export type CrmMemoryChunkKind = "recap" | "investment_lens";

export type CrmMemoryNoteKind = "m1_m2" | "board" | "ops" | "unknown";

export type CrmMemorySemanticCard = {
  noteKind: CrmMemoryNoteKind;
  recap: string;
  investmentLens: string;
  markets: string[];
  customerSegments: string[];
  businessModel: string;
  gtmMotion: string;
  redFlags: string[];
  positiveSignals: string[];
  competitorNames: string[];
  tomcatTake: string;
  questionsToReuse: string[];
  confidence: "high" | "medium" | "low";
  language: string;
};

export type KnowledgeIndexChunkInput = {
  id: string;
  sourceKind: "hubspot_note";
  sourceId: string;
  chunkKind: CrmMemoryChunkKind;
  chunkIdx: number;
  chunkText: string;
  contentHash: string;
  embedding: number[] | undefined;
  embeddingModel: string | undefined;
  semanticModel: string | undefined;
  semanticSchemaVersion: string;
  startupId: string;
  authorEmail: string;
  noteCreatedAt: string;
  meta: CrmMemorySemanticCard;
};

export type KnowledgeChunkSearchHit = {
  chunkId: string;
  noteId: string;
  startupId: string;
  chunkKind: CrmMemoryChunkKind;
  chunkText: string;
  score: number;
  authorEmail: string;
  noteCreatedAt: string;
  meta: CrmMemorySemanticCard;
};

export type KnowledgeChunkSearchParams = {
  queryEmbedding: number[];
  chunkKind?: CrmMemoryChunkKind;
  authorEmail?: string;
  sectorStartupIds?: string[];
  sinceDays?: number;
  excludeStartupId?: string;
  limit: number;
};

export type SimilarCaseEvidence = {
  noteId: string;
  authorEmail: string;
  createdAt: string;
  excerpt: string;
  noteKind: CrmMemoryNoteKind;
  chunkKind: CrmMemoryChunkKind;
};

export type SimilarCaseMatch = {
  startupId: string;
  name: string;
  sectors: string[];
  similarityScore: number;
  whySimilar: string;
  soWhat: string;
  topEvidence: SimilarCaseEvidence[];
};

export type SimilarCasesData = {
  searchBasis: "client_text" | "free_text" | "note_anchor";
  referenceStartup: {
    id: string;
    name: string;
    sectors: string[];
  } | null;
  matchCount: number;
  matches: SimilarCaseMatch[];
  indexStats: {
    chunksIndexed: number;
  };
};

export type NoteIndexingContext = {
  note: {
    id: string;
    body: string;
    authorEmail: string;
    createdAt: string;
    sensitivity: NoteSensitivity;
  };
  startup: {
    id: string;
    name: string;
    sectors: string[];
    stage: string;
    country: string | undefined;
    description: string | undefined;
  };
};
