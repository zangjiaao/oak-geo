-- T04 owner decision: three industry-shared tables have NO tenant_id.
-- Private raw inputs, especially channel C, always retain tenant_id.
CREATE TABLE IF NOT EXISTS seed_list (
 id text PRIMARY KEY,
 industry text NOT NULL,
 word text NOT NULL CHECK (btrim(word)<>''),
 word_type text NOT NULL CHECK (word_type IN ('品类','场景','问题','竞品','品线')),
 maintainer text NOT NULL CHECK (btrim(maintainer)<>''),
 last_reviewed_at timestamptz NOT NULL,
 seed_version integer NOT NULL CHECK (seed_version>0),
 status text
);
COMMENT ON TABLE seed_list IS 'industry-shared, no tenant_id；不得存入客户专属词句/厂牌/竞品名单；status允许NULL无默认，T07再定枚举';
COMMENT ON COLUMN seed_list.id IS '公共种子记录标识';
COMMENT ON COLUMN seed_list.industry IS '行业键；不绑定租户';
COMMENT ON COLUMN seed_list.word IS '经策略确认可共享的公共词根，不得来自客户专属原文';
COMMENT ON COLUMN seed_list.word_type IS '保留既有类型字段；共享服务拒绝客户竞品与品线输入，品牌专属词放brand_lexicon';
COMMENT ON COLUMN seed_list.maintainer IS '维护人的具体人名，不得为空';
COMMENT ON COLUMN seed_list.last_reviewed_at IS '最近复核时间，UTC';
COMMENT ON COLUMN seed_list.seed_version IS '行业种子版本';
COMMENT ON COLUMN seed_list.status IS 'T04未预批准枚举，允许NULL且不设默认；T07设计后另走迁移';
CREATE UNIQUE INDEX IF NOT EXISTS seed_public_word_unique ON seed_list(industry,seed_version,word_type,word);

CREATE TABLE IF NOT EXISTS keyword_raw (
 id text PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES tenant(id),
 industry text NOT NULL,
 keyword text NOT NULL CHECK (btrim(keyword)<>''),
 channel text NOT NULL CHECK (channel IN ('A','B','C','D')),
 demand_index numeric,
 trend_dir text CHECK (trend_dir IN ('up','flat','down')),
 first_seen_at timestamptz NOT NULL,
 collected_at timestamptz NOT NULL,
 raw_payload jsonb,
 UNIQUE (tenant_id,id)
);
COMMENT ON TABLE keyword_raw IS 'C-class rows always tenant-private；所有原始输入保留非空tenant_id，C入库须先走授权和脱敏ETL';
COMMENT ON COLUMN keyword_raw.id IS '原始词标识，问句source_word_id引用';
COMMENT ON COLUMN keyword_raw.tenant_id IS '强制租户归属，C类行不得共享';
COMMENT ON COLUMN keyword_raw.industry IS '行业分类键，不取消租户私有边界';
COMMENT ON COLUMN keyword_raw.keyword IS '租户私有原始词，不可直接复制到行业共享层';
COMMENT ON COLUMN keyword_raw.channel IS '四类输入A/B/C/D';
COMMENT ON COLUMN keyword_raw.demand_index IS '热度指数，不是绝对搜索次数';
COMMENT ON COLUMN keyword_raw.trend_dir IS 'up/flat/down趋势';
COMMENT ON COLUMN keyword_raw.first_seen_at IS '首见时间';
COMMENT ON COLUMN keyword_raw.collected_at IS '采集时间';
COMMENT ON COLUMN keyword_raw.raw_payload IS '受限原始载荷；C类访问必须审计';
CREATE INDEX IF NOT EXISTS keyword_raw_tenant_idx ON keyword_raw(tenant_id);
ALTER TABLE keyword_raw ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS keyword_pool_snapshot (
 pool_version integer NOT NULL CHECK (pool_version>0),
 industry text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 seed_version integer NOT NULL CHECK (seed_version>0),
 counts_by_channel jsonb NOT NULL,
 cluster_count integer NOT NULL CHECK (cluster_count>=0),
 changelog_note text,
 PRIMARY KEY(industry,pool_version)
);
COMMENT ON TABLE keyword_pool_snapshot IS 'industry-shared, no tenant_id；只消费脱敏聚合，不能夹带C类词句/厂牌/客户标识';
COMMENT ON COLUMN keyword_pool_snapshot.pool_version IS '行业周快照版本';
COMMENT ON COLUMN keyword_pool_snapshot.industry IS '行业共享键';
COMMENT ON COLUMN keyword_pool_snapshot.created_at IS '周批产出时间，UTC';
COMMENT ON COLUMN keyword_pool_snapshot.seed_version IS '公共种子版本链';
COMMENT ON COLUMN keyword_pool_snapshot.counts_by_channel IS '仅A/B/C/D非负数值计数，不允许词句或客户标识';
COMMENT ON COLUMN keyword_pool_snapshot.cluster_count IS '非负簇计数';
COMMENT ON COLUMN keyword_pool_snapshot.changelog_note IS '内部变更备注；行业共享投影/报告不返回此自由文本';

CREATE TABLE IF NOT EXISTS industry_score (
 industry text NOT NULL,
 version integer NOT NULL CHECK (version>0),
 demand numeric,
 gap numeric,
 willingness numeric,
 competition numeric,
 score numeric,
 reliability_note text,
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(industry,version)
);
COMMENT ON TABLE industry_score IS 'industry-shared, no tenant_id；内部排产用，不进对外报告';
COMMENT ON COLUMN industry_score.industry IS '共享行业键';
COMMENT ON COLUMN industry_score.version IS '内部策略版本';
COMMENT ON COLUMN industry_score.demand IS '需求策略读数';
COMMENT ON COLUMN industry_score.gap IS '留白策略读数';
COMMENT ON COLUMN industry_score.willingness IS '付费意愿策略读数';
COMMENT ON COLUMN industry_score.competition IS '竞争策略读数';
COMMENT ON COLUMN industry_score.score IS '行业排产评分，不作对外承诺';
COMMENT ON COLUMN industry_score.reliability_note IS '内部说明；共享读投影不返回客户相关自由文本';
COMMENT ON COLUMN industry_score.updated_by IS '内部维护人';
COMMENT ON COLUMN industry_score.updated_at IS '维护时间，UTC';

CREATE OR REPLACE FUNCTION geo_numeric_channel_counts(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e record;
BEGIN
 IF jsonb_typeof(value)<>'object' THEN RETURN false; END IF;
 FOR e IN SELECT * FROM jsonb_each(value) LOOP
  IF e.key NOT IN ('A','B','C','D') OR jsonb_typeof(e.value)<>'number' THEN RETURN false; END IF;
  IF (e.value::text)::numeric<0 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='keyword_pool_numeric_counts') THEN
  ALTER TABLE keyword_pool_snapshot ADD CONSTRAINT keyword_pool_numeric_counts CHECK (geo_numeric_channel_counts(counts_by_channel));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='question_source_same_tenant') THEN
  ALTER TABLE question_pool ADD CONSTRAINT question_source_same_tenant FOREIGN KEY (tenant_id,source_word_id) REFERENCES keyword_raw(tenant_id,id);
 END IF;
END $$;
