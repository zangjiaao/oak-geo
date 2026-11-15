CREATE TABLE seed_generation_metadata (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id),
 seed_id text NOT NULL REFERENCES seed_list(id), source_seed_id text NOT NULL REFERENCES seed_list(id),
 template_id text NOT NULL, source_channel text NOT NULL CHECK(source_channel IN ('A','B')),
 planned boolean NOT NULL DEFAULT true CHECK(planned=true), confirmed_by text NOT NULL,
 created_at timestamptz NOT NULL, UNIQUE(tenant_id,seed_id)
);
COMMENT ON TABLE seed_generation_metadata IS 'T08租户私有生成元数据；source_channel仅计划采集渠道，不能当作真实观测/测量问句；种子本身仍行业共享';
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='seed_generation_metadata' LOOP
  EXECUTE format('COMMENT ON COLUMN seed_generation_metadata.%I IS %L',c.column_name,'T08生成确认元数据：'||c.column_name||'；受租户RLS及种子allow约束');
 END LOOP;
END $$;
ALTER TABLE seed_generation_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE seed_generation_metadata FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON seed_generation_metadata USING(tenant_id=nullif(current_setting('geo.tenant_id',true),'')) WITH CHECK(tenant_id=nullif(current_setting('geo.tenant_id',true),''));
GRANT SELECT,INSERT ON seed_generation_metadata TO geo_app;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON seed_generation_metadata FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
