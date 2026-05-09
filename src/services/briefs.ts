import { NotFound } from "../errors/index.js";
import type { Identity } from "../domain/identity.js";
import { canSeeNote, canSeeSignal } from "../permissions/policies.js";
import type { Citation } from "../domain/entities.js";
import type { Connectors } from "../connectors/registry.js";

export type BoardPrepBrief = {
  portfolioCompanyId: string;
  startupId: string;
  highlights: string[];
  risks: string[];
  citations: Citation[];
};

export const buildBriefsService = (deps: { connectors: Connectors }) => {
  const { connectors } = deps;

  return {
    boardPrep: async (
      caller: Identity,
      portfolioCompanyId: string,
    ): Promise<BoardPrepBrief> => {
      const portfolio = await connectors.monday.listPortfolio();
      const company = portfolio.find((p) => p.id === portfolioCompanyId);
      if (!company) throw NotFound(`Portfolio company ${portfolioCompanyId} not found`);

      const [signals, notes, packs] = await Promise.all([
        connectors.monday.listSignals(90),
        connectors.hubspot.listNotesForStartup(company.startupId),
        connectors.drive.listBoardPacksForCompany(portfolioCompanyId),
      ]);

      const visibleSignals = signals
        .filter((s) => s.portfolioCompanyId === portfolioCompanyId)
        .filter((s) => canSeeSignal(caller, s));
      const visibleNotes = notes.filter((n) => canSeeNote(caller, n));

      const highlights = visibleSignals
        .filter((s) => s.kind !== "risk")
        .map((s) => s.summary);
      const risks = visibleSignals
        .filter((s) => s.kind === "risk")
        .map((s) => s.summary);

      const citations: Citation[] = [
        ...visibleNotes.map((n) => ({
          label: `Note ${n.id} (${n.sensitivity})`,
          source: n.source,
        })),
        ...packs.map((p) => ({
          label: p.title,
          source: {
            system: "drive" as const,
            externalId: p.driveFileId,
            url: undefined,
          },
        })),
      ];

      return {
        portfolioCompanyId,
        startupId: company.startupId,
        highlights,
        risks,
        citations,
      };
    },
  };
};

export type BriefsService = ReturnType<typeof buildBriefsService>;
