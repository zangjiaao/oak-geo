-- T42: one editable current dossier per brand, not a versioned document system.
CREATE TABLE product_profile (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), brand_id text NOT NULL,
 input jsonb NOT NULL, input_hash text NOT NULL, research jsonb, knowledge jsonb NOT NULL DEFAULT '[]',
 onboarded_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, updated_by text NOT NULL,
 UNIQUE(tenant_id,brand_id), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,brand_id) REFERENCES brand(tenant_id,id)
);
CREATE TABLE product_research_run (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), brand_id text NOT NULL,
 input_hash text NOT NULL, created_by text NOT NULL, model text NOT NULL, prompt_version text NOT NULL,
 started_at timestamptz NOT NULL, claimed_at timestamptz, finished_at timestamptz,
 error text, saved boolean NOT NULL DEFAULT false, usage jsonb, trace jsonb,
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,brand_id) REFERENCES product_profile(tenant_id,brand_id)
);
CREATE INDEX product_research_brand_time ON product_research_run(tenant_id,brand_id,started_at DESC);
DO $$ DECLARE t text; c record; BEGIN
 FOREACH t IN ARRAY ARRAY['product_profile','product_research_run'] LOOP
  EXECUTE format('COMMENT ON TABLE %I IS %L',t,'T42当前品牌资料/知识与调查执行记录：租户品牌隔离；仅服务层写入；无资料版本管理，无探针原文或C类对话');
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=t LOOP
   EXECUTE format('COMMENT ON COLUMN %I.%I IS %L',t,c.column_name,'T42当前品牌资料/调查执行字段：'||c.column_name);
  END LOOP;
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_boundary ON %I USING(tenant_id=nullif(current_setting(''geo.tenant_id'',true),'''')) WITH CHECK(tenant_id=nullif(current_setting(''geo.tenant_id'',true),''''))',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO geo_app',t);
 END LOOP;
END $$;
GRANT UPDATE(input,input_hash,research,knowledge,updated_at,updated_by) ON product_profile TO geo_app;
GRANT UPDATE(claimed_at,finished_at,error,saved,usage,trace) ON product_research_run TO geo_app;
CREATE OR REPLACE FUNCTION geo_research_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.finished_at IS NOT NULL OR (OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at) THEN
  RAISE EXCEPTION 'completed research is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER research_completion_guard BEFORE UPDATE OR DELETE ON product_research_run FOR EACH ROW EXECUTE FUNCTION geo_research_run_guard();
ALTER TABLE audit_log DROP CONSTRAINT audit_log_job_name_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_job_name_check CHECK(job_name IN ('judge','weekly_pool','c_import','event_schedule','probe_execute','baseline_scoring','metric_aggregate','backflow_scan','ticket_deadline','content_reconcile','audit_middleware','opportunity_lifecycle','publication_lifecycle','offboarding','product_research'));
