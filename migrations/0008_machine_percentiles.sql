-- R11 owner v2: only T10 weekly machine production; no human write channel.
CREATE TABLE IF NOT EXISTS w_pool_percentile (
 industry text NOT NULL,
 public_cluster_key text NOT NULL,
 pool_version integer NOT NULL,
 demand_index numeric NOT NULL,
 percentile numeric NOT NULL CHECK(percentile BETWEEN 0 AND 1),
 producer text NOT NULL CHECK(producer='weekly_batch'),
 basis_note text NOT NULL CHECK(length(btrim(basis_note))>0),
 computed_at timestamptz NOT NULL,
 PRIMARY KEY(industry,pool_version,public_cluster_key),
 FOREIGN KEY(industry,pool_version) REFERENCES keyword_pool_snapshot(industry,pool_version)
);
COMMENT ON TABLE w_pool_percentile IS 'industry-shared, no tenant_id；仅许可公共词根/簇键与机器数值；唯一生产者T10周批；Strategist只读';
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='w_pool_percentile' LOOP
  EXECUTE format('COMMENT ON COLUMN w_pool_percentile.%I IS %L',c.column_name,'R11行业分位证据：'||c.column_name||'；producer=weekly_batch，basis_note必填T10批次id；不含租户/客户标识');
 END LOOP;
END $$;
GRANT SELECT,INSERT ON w_pool_percentile TO geo_app;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON w_pool_percentile FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
ALTER TABLE archive_review_evidence ADD COLUMN condition1_status text NOT NULL DEFAULT 'data_pending' CHECK(condition1_status IN ('data_pending','evaluated'));
COMMENT ON COLUMN archive_review_evidence.condition1_status IS 'R11条件1缺机器分位或版本stale时data_pending，不允许归档';
