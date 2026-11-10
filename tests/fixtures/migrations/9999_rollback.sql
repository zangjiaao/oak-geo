-- Deliberate failure to prove migration DDL and its ledger row roll back together.
CREATE TABLE geo_rollback_marker (id text PRIMARY KEY);
DO $$ BEGIN RAISE EXCEPTION 'expected migration rollback test'; END $$;
