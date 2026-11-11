-- Owner ruling R11: no calibrated industry threshold => human decision.
ALTER TABLE industry_score ADD COLUMN c_delete_threshold numeric CHECK(c_delete_threshold>=0);
COMMENT ON COLUMN industry_score.c_delete_threshold IS '尚未校准的行业= NULL =人工判定；月出现量阈值，仅内部配置，不进对外报告';
CREATE TABLE archive_review_evidence (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), brand_id text NOT NULL,
 cluster_id text NOT NULL, requested_by text NOT NULL, created_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status='manual_review_required'),
 condition1_met boolean NOT NULL, condition2_met boolean NOT NULL, condition3_met boolean,
 source_word_percentiles jsonb NOT NULL, probe_batch_id text NOT NULL,
 b_source_excerpts jsonb NOT NULL, statistics_window jsonb NOT NULL, channel_scope text NOT NULL,
 observed_count numeric NOT NULL CHECK(observed_count>=0), industry_threshold numeric,
 threshold_version integer, audit_event_id text NOT NULL, digest text NOT NULL,
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,brand_id) REFERENCES brand(tenant_id,id),
 FOREIGN KEY(tenant_id,cluster_id) REFERENCES intent_cluster(tenant_id,id),
 FOREIGN KEY(tenant_id,probe_batch_id) REFERENCES probe_batch(tenant_id,id)
);
COMMENT ON TABLE archive_review_evidence IS 'R11机器举证；manual_review_required不是intent_cluster新状态；最终仅Strategist显式人工动作';
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='archive_review_evidence' LOOP
  EXECUTE format('COMMENT ON COLUMN archive_review_evidence.%I IS %L',c.column_name,'R11归档证据字段：'||c.column_name||'；B类摘录租户私有，含统计窗口/渠道/请求人');
 END LOOP;
END $$;
ALTER TABLE archive_review_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_review_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON archive_review_evidence USING (tenant_id=nullif(current_setting('geo.tenant_id',true),'')) WITH CHECK(tenant_id=nullif(current_setting('geo.tenant_id',true),''));
GRANT SELECT,INSERT ON archive_review_evidence TO geo_app;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON archive_review_evidence FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
ALTER TABLE backflow_ticket ADD COLUMN archive_evidence_id text;
ALTER TABLE backflow_ticket ADD CONSTRAINT archive_ticket_evidence_fk FOREIGN KEY(tenant_id,archive_evidence_id) REFERENCES archive_review_evidence(tenant_id,id);
COMMENT ON COLUMN backflow_ticket.archive_evidence_id IS 'R11删除建议工单引用；配置阈值且机器判齐只生成工单，不自动归档';
-- Only cited_wrong has an approved 24h deadline. Do not invent an SLA for advice.
ALTER TABLE backflow_ticket ALTER COLUMN deadline_at DROP NOT NULL;
ALTER TABLE backflow_ticket ADD CONSTRAINT wrong_fact_deadline_required CHECK(signal_type<>'cited_wrong' OR deadline_at IS NOT NULL);
