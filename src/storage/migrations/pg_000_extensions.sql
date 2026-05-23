DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pgvector extension skipped: grant CREATE on database or enable via Scaleway console';
END $$;
