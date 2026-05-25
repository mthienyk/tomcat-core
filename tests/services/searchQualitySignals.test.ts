import { describe, expect, it } from "vitest";
import {
  buildSearchQualitySignals,
  computeTopClusterCoherence,
  detectNoisyTopMatch,
  scoreToRegimeLevel,
} from "../../src/services/crmMemory/searchQualitySignals.js";
import type { SimilarCaseMatch } from "../../src/domain/crmMemory.js";

const match = (
  name: string,
  whySimilar: string,
  score: number,
): SimilarCaseMatch => ({
  startupId: name,
  name,
  sectors: ["saas"],
  similarityScore: score,
  whySimilar,
  soWhat: "Review prior judgment.",
  topEvidence: [],
});

describe("searchQualitySignals", () => {
  it("maps scores to encoding-regime levels", () => {
    expect(scoreToRegimeLevel(0.7)).toBe("high");
    expect(scoreToRegimeLevel(0.6)).toBe("mid");
    expect(scoreToRegimeLevel(0.5)).toBe("low");
  });

  it("detects thematic cluster coherence among top matches", () => {
    const matches = [
      match(
        "Pinql",
        "App gestion locative proprio particuliers bail digital quittancement",
        0.71,
      ),
      match(
        "Nopillo",
        "Gestion locative proprio bail digital état des lieux foncières",
        0.69,
      ),
      match(
        "Avis-Locataire",
        "Location proprio bail quittancement gestion locative PME",
        0.67,
      ),
    ];

    expect(computeTopClusterCoherence(matches)).toBeGreaterThan(0.1);
  });

  it("flags a noisy top match when it diverges from the cluster", () => {
    const matches = [
      match(
        "Viapazon",
        "Plateforme M&A early-stage valo pre-seed ARR faible levée",
        0.726,
      ),
      match(
        "Pinql",
        "App gestion locative proprio bail digital quittancement foncières",
        0.714,
      ),
      match(
        "Nopillo",
        "Gestion locative proprio bail digital état des lieux",
        0.71,
      ),
      match(
        "Avis-Locataire",
        "Location proprio bail quittancement gestion locative",
        0.69,
      ),
    ];

    const coherence = computeTopClusterCoherence(matches);
    expect(detectNoisyTopMatch(matches, coherence)).toBe(true);
  });

  it("builds regime and quality signals for misaligned searchTexts", () => {
    const result = buildSearchQualitySignals({
      searchTexts: ["Quelles boîtes similaires avons-nous vues sur la paie ?"],
      matches: [
        match("InterFast", "Logiciel devis facture BTP TPE PME", 0.45),
        match("Empowill", "HR Tech entretiens annuels GPEC PME", 0.44),
      ],
    });

    expect(result.regimeSignals.scoreLevel).toBe("low");
    expect(result.suggestedRewrite).toContain("question");
  });
});
