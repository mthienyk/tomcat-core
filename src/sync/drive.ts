import type { SyncWorker, SyncWorkerDeps } from "./types.js";

export const driveBoardPacksWorker: SyncWorker = {
  dataset: "drive.boardPacks",

  async run({ store, connectors, logger }: SyncWorkerDeps): Promise<void> {
    const run = await store.startSyncRun("drive.boardPacks");
    try {
      const companies = await store.listPortfolioCompanies();
      if (companies.length === 0) {
        await store.failSyncRun(run.id, "No portfolio companies in store yet; run monday.portfolio first");
        return;
      }

      let count = 0;
      for (const company of companies) {
        const packs = await connectors.drive.listBoardPacksForCompany(company.id);
        for (const pack of packs) {
          await store.upsertBoardPack({
            id: pack.id,
            portfolioCompanyId: company.id,
            title: pack.title,
            driveFileId: pack.driveFileId,
            createdAt: pack.createdAt,
            mimeType: pack.mimeType,
          });
        }
        count += packs.length;
      }

      await store.finishSyncRun(run.id, { recordsUpserted: count });
      logger.info({ dataset: "drive.boardPacks", count }, "sync complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: "drive.boardPacks", err }, "sync failed");
    }
  },
};
