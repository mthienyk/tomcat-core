-- Optional metadata captured at enqueue time (e.g. reconcile watermark).
alter table sync_queue
  add column if not exists trigger_context jsonb;
