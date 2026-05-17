import type { SyncWorker, SyncWorkerDeps } from "./types.js";

export const hubspotStartupsWorker: SyncWorker = {
  dataset: "hubspot.startups",

  async run({ store, connectors, logger }: SyncWorkerDeps): Promise<void> {
    const run = await store.startSyncRun("hubspot.startups");
    try {
      const startups = await connectors.hubspot.listStartups();
      for (const startup of startups) {
        await store.upsertStartup(startup);
      }
      await store.finishSyncRun(run.id, { recordsUpserted: startups.length });
      logger.info({ dataset: "hubspot.startups", count: startups.length }, "sync complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: "hubspot.startups", err }, "sync failed");
    }
  },
};

export const hubspotActivityWorker: SyncWorker = {
  dataset: "hubspot.activity",

  async run({ store, connectors, logger }: SyncWorkerDeps): Promise<void> {
    const run = await store.startSyncRun("hubspot.activity");
    try {
      const startups = await store.listStartups();
      if (startups.length === 0) {
        await store.failSyncRun(run.id, "No startups in store yet; run hubspot.startups first");
        return;
      }

      let deals = 0;
      let notes = 0;
      let meetings = 0;

      for (const startup of startups) {
        const [dealList, noteList, meetingList] = await Promise.all([
          connectors.hubspot.listDealsForStartup(startup.id),
          connectors.hubspot.listNotesForStartup(startup.id),
          connectors.hubspot.listMeetingsForStartup(startup.id),
        ]);
        for (const d of dealList) await store.upsertDeal(d);
        for (const n of noteList) await store.upsertNote(n);
        for (const m of meetingList) await store.upsertMeeting(m);
        deals += dealList.length;
        notes += noteList.length;
        meetings += meetingList.length;
      }

      await store.finishSyncRun(run.id, { recordsUpserted: deals + notes + meetings });
      logger.info(
        { dataset: "hubspot.activity", deals, notes, meetings },
        "sync complete",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.failSyncRun(run.id, message);
      logger.error({ dataset: "hubspot.activity", err }, "sync failed");
    }
  },
};
