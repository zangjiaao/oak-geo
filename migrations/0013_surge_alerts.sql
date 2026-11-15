-- T11 private signal and durable in-app notification, no new product status.
CREATE TABLE keyword_surge_alert (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), industry text NOT NULL,
 pool_version integer NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
 normalized_hash text NOT NULL, source_channel text NOT NULL CHECK(source_channel IN ('A','B','C','D')),
 source_identity text NOT NULL, first_seen_at timestamptz NOT NULL,
 source_word_ids text[] NOT NULL CHECK(cardinality(source_word_ids)=2 AND source_word_ids[1] IS NOT NULL AND source_word_ids[2] IS NOT NULL AND source_word_ids[1]<>source_word_ids[2]),
 old_cluster_ids text[] NOT NULL, prefilter_ids text[] NOT NULL,
 evidence jsonb NOT NULL, rule_version text NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,industry,window_start,window_end,normalized_hash,source_channel,source_identity),
 FOREIGN KEY(industry,pool_version) REFERENCES keyword_pool_snapshot(industry,pool_version),
 CHECK(window_start<window_end), CHECK(first_seen_at<=created_at AND created_at-first_seen_at<interval '14 days'),
 CHECK(coalesce(evidence#>>'{previous,trend_dir}','')='up' AND coalesce(evidence#>>'{current,trend_dir}','')='up')
);
CREATE TABLE keyword_surge_notification (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id),
 alert_id text NOT NULL, recipient_user_id text NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(tenant_id,alert_id,recipient_user_id),
 FOREIGN KEY(tenant_id,alert_id) REFERENCES keyword_surge_alert(tenant_id,id)
);
CREATE INDEX surge_alert_tenant_created ON keyword_surge_alert(tenant_id,industry,created_at,id);
CREATE INDEX surge_inbox_recipient ON keyword_surge_notification(tenant_id,recipient_user_id,created_at,id);
DO $$ DECLARE t text; c record; BEGIN
 FOREACH t IN ARRAY ARRAY['keyword_surge_alert','keyword_surge_notification'] LOOP
  EXECUTE format('COMMENT ON TABLE %I IS %L',t,'T11 tenant-private只追加信号/站内通知；不复制关键词原句、C摘录、原始回答；写入与周批事务及审计一起提交');
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=t LOOP
   EXECUTE format('COMMENT ON COLUMN %I.%I IS %L',t,c.column_name,'T11内部字段：'||t||'.'||c.column_name||'；首见<14天且连续两周来源趋势up，GET不改业务状态');
  END LOOP;
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_boundary ON %I USING(tenant_id=nullif(current_setting(''geo.tenant_id'',true),'''')) WITH CHECK(tenant_id=nullif(current_setting(''geo.tenant_id'',true),''''))',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO geo_app',t);
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION geo_reject_change()',t);
 END LOOP;
END $$;
