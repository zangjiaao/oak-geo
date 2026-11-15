-- T10 internal projection records, not new product resources or state enums.
CREATE TABLE weekly_pool_publication (
 id text PRIMARY KEY, industry text NOT NULL, pool_version integer NOT NULL,
 window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
 policy_version text NOT NULL, policy_digest text NOT NULL, source_digest text NOT NULL, seed_version integer NOT NULL,
 created_at timestamptz NOT NULL, CHECK(window_start<window_end),
 UNIQUE(industry,window_start,window_end,policy_version),
 FOREIGN KEY(industry,pool_version) REFERENCES keyword_pool_snapshot(industry,pool_version)
);
CREATE TABLE weekly_public_metric (
 industry text NOT NULL, pool_version integer NOT NULL, public_cluster_key text NOT NULL,
 root text NOT NULL, intent_type text NOT NULL CHECK(intent_type IN ('认知','选型对比','价格','场景方案','排障','替代/否定')),
 demand_score numeric, percentile numeric CHECK(percentile BETWEEN 0 AND 1),
 demand_tier text CHECK(demand_tier IN ('S','A','B','C')),
 channel_percentiles jsonb NOT NULL, source_coverage jsonb NOT NULL,
 PRIMARY KEY(industry,pool_version,public_cluster_key),
 FOREIGN KEY(industry,pool_version) REFERENCES keyword_pool_snapshot(industry,pool_version),
 CHECK((percentile IS NULL)=(demand_tier IS NULL))
);
CREATE TABLE weekly_pool_run (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), industry text NOT NULL,
 pool_version integer NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
 policy_version text NOT NULL, policy_digest text NOT NULL, policy_record jsonb NOT NULL,
 source_digest text NOT NULL, input_digest text NOT NULL,
 source_ref text NOT NULL, source_receipt jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL, CHECK(window_start<window_end),
 UNIQUE(tenant_id,industry,window_start,window_end,policy_version),
 FOREIGN KEY(industry,pool_version) REFERENCES keyword_pool_snapshot(industry,pool_version)
);
CREATE TABLE weekly_cluster_snapshot (
 tenant_id text NOT NULL, cluster_id text NOT NULL, industry text NOT NULL,
 pool_version integer NOT NULL, public_cluster_key text NOT NULL,
 representative_word_ids text[] NOT NULL, channel_counts jsonb NOT NULL,
 demand_score numeric, percentile numeric CHECK(percentile BETWEEN 0 AND 1),
 demand_tier text CHECK(demand_tier IN ('S','A','B','C')), source_coverage jsonb,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,cluster_id,pool_version),
 FOREIGN KEY(tenant_id,cluster_id) REFERENCES intent_cluster(tenant_id,id),
 FOREIGN KEY(industry,pool_version) REFERENCES keyword_pool_snapshot(industry,pool_version),
 CHECK((percentile IS NULL)=(demand_tier IS NULL))
);
CREATE TABLE weekly_pool_candidate (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), brand_id text,
 industry text NOT NULL, pool_version integer NOT NULL, reason text NOT NULL,
 source_word_ids text[] NOT NULL, old_cluster_ids text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,brand_id) REFERENCES brand(tenant_id,id),
 FOREIGN KEY(industry,pool_version) REFERENCES keyword_pool_snapshot(industry,pool_version)
);
DO $$ DECLARE t text; c record; BEGIN
 FOREACH t IN ARRAY ARRAY['weekly_pool_publication','weekly_public_metric','weekly_pool_run','weekly_cluster_snapshot','weekly_pool_candidate'] LOOP
  EXECUTE format('COMMENT ON TABLE %I IS %L',t,CASE WHEN t IN ('weekly_pool_publication','weekly_public_metric') THEN 'T10 industry-shared, no tenant_id；仅公共键/数值/版本，不含原文或客户标识' ELSE 'T10 tenant-private内部周批投影；只追加，写入经weekly_pool服务层及审计' END);
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=t LOOP
   EXECUTE format('COMMENT ON COLUMN %I.%I IS %L',t,c.column_name,'T10内部投影字段：'||t||'.'||c.column_name||'；口径见T10人审草案，非新增产品状态');
  END LOOP;
  EXECUTE format('GRANT SELECT,INSERT ON %I TO geo_app',t);
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION geo_reject_change()',t);
  IF t IN ('weekly_pool_run','weekly_cluster_snapshot','weekly_pool_candidate') THEN
   EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
   EXECUTE format('CREATE POLICY tenant_boundary ON %I USING(tenant_id=nullif(current_setting(''geo.tenant_id'',true),'''')) WITH CHECK(tenant_id=nullif(current_setting(''geo.tenant_id'',true),''''))',t);
  END IF;
 END LOOP;
END $$;
