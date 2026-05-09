import type { Identity } from "../domain/identity.js";
import type { Note, Startup } from "../domain/entities.js";
import { canSeeNote, canSeeStartup } from "../permissions/policies.js";
import { redactNoteBody } from "../permissions/redact.js";
import type { Connectors } from "../connectors/registry.js";

export const buildStartupsService = (deps: { connectors: Connectors }) => {
  const { connectors } = deps;

  return {
    findSimilar: async (
      caller: Identity,
      seed: {
        startupId: string | undefined;
        startupName: string | undefined;
        sector: string | undefined;
      },
    ): Promise<Startup[]> => {
      const all = await connectors.hubspot.listStartups();
      const visible = all.filter((s) => canSeeStartup(caller, s));

      if (seed.sector) {
        return visible.filter((s) =>
          s.sectors.some((sec) => sec.toLowerCase() === seed.sector?.toLowerCase()),
        );
      }
      if (seed.startupName) {
        const ref = visible.find(
          (s) => s.name.toLowerCase() === seed.startupName?.toLowerCase(),
        );
        if (!ref) return [];
        return visible.filter(
          (s) =>
            s.id !== ref.id &&
            s.sectors.some((sec) => ref.sectors.includes(sec)),
        );
      }
      return visible;
    },

    listAccessibleNotes: async (
      caller: Identity,
      startupId: string,
    ): Promise<Note[]> => {
      const notes = await connectors.hubspot.listNotesForStartup(startupId);
      return notes
        .filter((n) => canSeeNote(caller, n))
        .map((n) => redactNoteBody(caller, n));
    },
  };
};

export type StartupsService = ReturnType<typeof buildStartupsService>;
