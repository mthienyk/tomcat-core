import { effectiveHuman, isInternalRole, type Identity } from "../domain/identity.js";
import type { Note, Startup } from "../domain/entities.js";

export const redactStartup = (id: Identity, startup: Startup): Startup => {
  const human = effectiveHuman(id);
  if (human && isInternalRole(human.role)) return startup;
  return {
    ...startup,
    description: startup.description ?? undefined,
  };
};

export const redactNoteBody = (id: Identity, note: Note): Note => {
  const human = effectiveHuman(id);
  if (human && isInternalRole(human.role)) return note;
  if (note.sensitivity === "internal" || note.sensitivity === "confidential") {
    return { ...note, body: "[redacted]" };
  }
  return note;
};
