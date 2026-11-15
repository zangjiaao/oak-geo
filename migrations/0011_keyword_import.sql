ALTER TABLE keyword_raw ADD COLUMN normalized_hash text CHECK(normalized_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE keyword_raw ADD COLUMN normalization_version text;
ALTER TABLE keyword_raw ADD COLUMN authorization_ref text;
ALTER TABLE keyword_raw ADD COLUMN redaction_policy_version text;
COMMENT ON COLUMN keyword_raw.normalized_hash IS 'T09归一化文本SHA256；C只基于脱敏后的文本；旧行由导入服务惰性补齐，不换source_word_id';
COMMENT ON COLUMN keyword_raw.normalization_version IS 'T09固定归一化算法/字典版本；升级须显式迁移';
COMMENT ON COLUMN keyword_raw.authorization_ref IS 'C类书面授权引用；服务端受信登记验真，不接受请求内伪造授权对象';
COMMENT ON COLUMN keyword_raw.redaction_policy_version IS '入库前实际执行的受信脱敏配置版本；C原始身份列不持久化';
CREATE UNIQUE INDEX keyword_observation_unique ON keyword_raw(tenant_id,industry,channel,normalized_hash,collected_at) WHERE normalized_hash IS NOT NULL;
ALTER TABLE keyword_raw ADD CONSTRAINT c_import_provenance CHECK(channel<>'C' OR (authorization_ref IS NOT NULL AND btrim(authorization_ref)<>'' AND redaction_policy_version IS NOT NULL AND btrim(redaction_policy_version)<>'')) NOT VALID;
CREATE TABLE keyword_import_batch (
 id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenant(id),industry text NOT NULL,
 channel text NOT NULL CHECK(channel IN ('A','B','C','D')),added integer NOT NULL CHECK(added>=0),
 duplicate integer NOT NULL CHECK(duplicate>=0),rejected integer NOT NULL CHECK(rejected>=0),
 normalization_version text NOT NULL,authorization_ref text,redaction_policy_version text,created_at timestamptz NOT NULL
);
COMMENT ON TABLE keyword_import_batch IS 'T09导入结果，只存计数/配置版本，不存CSV、拒绝行、身份列或C原文；重试走24h幂等';
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='keyword_import_batch' LOOP
  EXECUTE format('COMMENT ON COLUMN keyword_import_batch.%I IS %L',c.column_name,'T09租户导入摘要：'||c.column_name||'；无原始CSV/身份字段');
 END LOOP;
END $$;
ALTER TABLE keyword_import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_import_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON keyword_import_batch USING(tenant_id=nullif(current_setting('geo.tenant_id',true),'')) WITH CHECK(tenant_id=nullif(current_setting('geo.tenant_id',true),''));
GRANT SELECT,INSERT ON keyword_import_batch TO geo_app;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON keyword_import_batch FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
