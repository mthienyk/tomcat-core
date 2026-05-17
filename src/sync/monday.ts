import type { SyncWorker, SyncWorkerDeps } from "./types.js";

export const mondayPortfolioWorker: SyncWorker = {
  dataset: "monday.portfolio",

  async run({ store, connectors, logger }: SyncWorkerDeps): Promise<void> {
    const run = await store.startSyncRun("monday.portfolio");
    try {
      const companies = await connectors.monday.listPortfolio();
      for (const company of companies) {
        await store.upsertPortfolioCompany(company);
      }
      await store.finishSyncRun(run.id, { recordsUpserted: companies.length });
      logger.info({ dataset: "monday.portfolio", count: companies.length }, "sync complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: "monday.portfolio", err }, "sync failed");
    }
  },
};

export const mondaySignalsWorker: SyncWorker = {
  dataset: "monday.signals",

  async run({ store, connectors, logger }: SyncWorkerDeps): Promise<void> {
    const run = await store.startSyncRun("monday.signals");
    try {
      // Fetch signals for the last 90 days on each full sync.
      const signals = await connectors.monday.listSignals(90);
      for (const signal of signals) {
        await store.upsertPortfolioSignal(signal);
      }
      await store.finishSyncRun(run.id, { recordsUpserted: signals.length });
      logger.info({ dataset: "monday.signals", count: signals.length }, "sync complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: "monday.signals", err }, "sync failed");
    }
  },
};

export const mondayEventsWorker: SyncWorker = {
  dataset: "monday.events",

  async run({ store, connectors, logger }: SyncWorkerDeps): Promise<void> {
    const run = await store.startSyncRun("monday.events");
    try {
      const events = await connectors.monday.listUpcomingEvents();
      for (const event of events) {
        await store.upsertEvent(event);
      }
      await store.finishSyncRun(run.id, { recordsUpserted: events.length });
      logger.info({ dataset: "monday.events", count: events.length }, "sync complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: "monday.events", err }, "sync failed");
    }
  },
};
