-- T04: frozen t02_api_v1 core tables. No business seed data here.
-- IDs are opaque text; composite foreign keys prevent cross-tenant links.

CREATE TABLE IF NOT EXISTS tenant (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name)<>''),
  mode text NOT NULL CHECK (mode IN ('full','diagnosis','self')),
  plan text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE tenant IS '合同租户；mode沿用冻结枚举；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN tenant.id IS '不可变记录标识';
COMMENT ON COLUMN tenant.name IS 'tenant.name；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN tenant.mode IS 'tenant.mode；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN tenant.plan IS 'tenant.plan；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN tenant.created_at IS '创建时间，UTC timestamptz';

CREATE TABLE IF NOT EXISTS brand (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  name text NOT NULL CHECK (btrim(name)<>''),
  industry text NOT NULL,
  market text NOT NULL,
  UNIQUE (tenant_id, id)
);
COMMENT ON TABLE brand IS '租户下的品牌与行业；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN brand.id IS '不可变记录标识';
COMMENT ON COLUMN brand.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN brand.name IS 'brand.name；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN brand.industry IS 'brand.industry；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN brand.market IS 'brand.market；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS user_member (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  user_id text NOT NULL,
  brand_id text,
  role text NOT NULL CHECK (role IN ('owner','editor','viewer','strategist','content','evidence','factcheck','cs','admin')),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  CHECK (role NOT IN ('owner','editor','viewer') OR brand_id IS NOT NULL)
);
COMMENT ON TABLE user_member IS '成员角色；客户品牌边界保留到服务端权限层；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN user_member.id IS '不可变记录标识';
COMMENT ON COLUMN user_member.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN user_member.user_id IS 'user_member.user_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN user_member.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN user_member.role IS 'user_member.role；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS intent_cluster (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  name text NOT NULL,
  intent_type text NOT NULL CHECK (intent_type IN ('认知','选型对比','价格','场景方案','排障','替代/否定')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  pool_version integer NOT NULL CHECK (pool_version > 0),
  question_pool_version integer CHECK (question_pool_version > 0),
  serp_vacuum numeric CHECK (serp_vacuum BETWEEN 0 AND 1),
  serp_checked_at timestamptz,
  archived_at timestamptz,
  archive_reason text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  CHECK (status <> 'archived' OR (archived_at IS NOT NULL AND btrim(archive_reason)<>'' AND archive_reason IS NOT NULL))
);
COMMENT ON TABLE intent_cluster IS '稳定簇ID，软归档与簇级问句版本锚；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN intent_cluster.id IS '不可变记录标识';
COMMENT ON COLUMN intent_cluster.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN intent_cluster.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN intent_cluster.name IS 'intent_cluster.name；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN intent_cluster.intent_type IS 'intent_cluster.intent_type；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN intent_cluster.status IS '只允许冻结规格中的状态值';
COMMENT ON COLUMN intent_cluster.pool_version IS 'intent_cluster.pool_version；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN intent_cluster.question_pool_version IS 'intent_cluster.question_pool_version；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN intent_cluster.serp_vacuum IS 'intent_cluster.serp_vacuum；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN intent_cluster.serp_checked_at IS 'intent_cluster.serp_checked_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN intent_cluster.archived_at IS 'intent_cluster.archived_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN intent_cluster.archive_reason IS 'intent_cluster.archive_reason；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS question_pool (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  cluster_id text NOT NULL,
  question text NOT NULL CHECK (btrim(question)<>''),
  source_word_id text NOT NULL,
  intent_type text NOT NULL CHECK (intent_type IN ('认知','选型对比','价格','场景方案','排障','替代/否定')),
  source_channel text NOT NULL CHECK (source_channel IN ('A','B','C','D')),
  collected_at timestamptz NOT NULL,
  maintainer text NOT NULL CHECK (btrim(maintainer)<>''),
  question_pool_version integer NOT NULL CHECK (question_pool_version>0),
  frozen boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cluster_id) REFERENCES intent_cluster(tenant_id, id)
);
COMMENT ON TABLE question_pool IS '问句及溯源；冻结后原文不可改；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN question_pool.id IS '不可变记录标识';
COMMENT ON COLUMN question_pool.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN question_pool.cluster_id IS 'question_pool.cluster_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_pool.question IS 'question_pool.question；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_pool.source_word_id IS '来源原始词ID，溯源五字段之一';
COMMENT ON COLUMN question_pool.intent_type IS 'question_pool.intent_type；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_pool.source_channel IS 'question_pool.source_channel；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_pool.collected_at IS 'question_pool.collected_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_pool.maintainer IS '具体人名，不允许空维护人';
COMMENT ON COLUMN question_pool.question_pool_version IS 'question_pool.question_pool_version；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_pool.frozen IS 'question_pool.frozen；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_pool.archived_at IS 'question_pool.archived_at；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS scoring_snapshot (
  snapshot_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  pool_version integer NOT NULL CHECK (pool_version>0),
  question_pool_version integer CHECK (question_pool_version>0),
  model_set jsonb NOT NULL CHECK (jsonb_typeof(model_set)='array' AND jsonb_array_length(model_set)>0),
  temperature_set numeric[] NOT NULL CHECK (cardinality(temperature_set)>0),
  rounds integer NOT NULL CHECK (rounds>0),
  judge_version text NOT NULL CHECK (btrim(judge_version)<>''),
  grounding_mode text NOT NULL CHECK (grounding_mode IN ('search_on','search_off','self_rag')),
  started_at timestamptz,
  finished_at timestamptz,
  frozen boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id,snapshot_id)
);
COMMENT ON TABLE scoring_snapshot IS '配置身份，复测共用；judge_version必须显式写入；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN scoring_snapshot.snapshot_id IS '冻结采样配置身份';
COMMENT ON COLUMN scoring_snapshot.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN scoring_snapshot.pool_version IS 'scoring_snapshot.pool_version；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN scoring_snapshot.question_pool_version IS 'scoring_snapshot.question_pool_version；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN scoring_snapshot.model_set IS 'scoring_snapshot.model_set；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN scoring_snapshot.temperature_set IS 'scoring_snapshot.temperature_set；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN scoring_snapshot.rounds IS 'scoring_snapshot.rounds；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN scoring_snapshot.judge_version IS '判定方式版本；必填，MVP rule_manual_v1';
COMMENT ON COLUMN scoring_snapshot.grounding_mode IS 'scoring_snapshot.grounding_mode；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN scoring_snapshot.started_at IS 'scoring_snapshot.started_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN scoring_snapshot.finished_at IS 'scoring_snapshot.finished_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN scoring_snapshot.frozen IS 'scoring_snapshot.frozen；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS question_score (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  question_id text NOT NULL,
  snapshot_id text NOT NULL,
  blank_q numeric(8,4) CHECK (blank_q BETWEEN 0 AND 1),
  error_q numeric(8,4) CHECK (error_q BETWEEN 0 AND 1),
  generic_q numeric(8,4) CHECK (generic_q BETWEEN 0 AND 1),
  competitor_q numeric(8,4) CHECK (competitor_q BETWEEN 0 AND 1),
  n_valid integer NOT NULL CHECK (n_valid>=0),
  n_refused integer NOT NULL CHECK (n_refused>=0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, question_id) REFERENCES question_pool(tenant_id, id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES scoring_snapshot(tenant_id, snapshot_id),
  UNIQUE (tenant_id,question_id,snapshot_id)
);
COMMENT ON TABLE question_score IS '问句连续分数，四位小数；分母排除拒答；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN question_score.id IS '不可变记录标识';
COMMENT ON COLUMN question_score.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN question_score.question_id IS 'question_score.question_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_score.snapshot_id IS '冻结采样配置身份';
COMMENT ON COLUMN question_score.blank_q IS 'question_score.blank_q；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_score.error_q IS 'question_score.error_q；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_score.generic_q IS 'question_score.generic_q；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_score.competitor_q IS 'question_score.competitor_q；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_score.n_valid IS 'question_score.n_valid；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN question_score.n_refused IS 'question_score.n_refused；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS cluster_score (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  cluster_id text NOT NULL,
  snapshot_id text NOT NULL,
  blank_raw numeric CHECK (blank_raw BETWEEN 0 AND 1),
  blank_score numeric CHECK (blank_score IN (0,0.5,1)),
  error_raw numeric CHECK (error_raw BETWEEN 0 AND 1),
  error_score numeric CHECK (error_score IN (0,0.5,1)),
  generic_raw numeric CHECK (generic_raw BETWEEN 0 AND 1),
  generic_score numeric CHECK (generic_score IN (0,0.5,1)),
  competitor_raw numeric CHECK (competitor_raw BETWEEN 0 AND 1),
  competitor_score numeric CHECK (competitor_score IN (0,0.5,1)),
  whitespace_raw numeric CHECK (whitespace_raw BETWEEN 0 AND 1),
  whitespace_score numeric CHECK (whitespace_score IN (0,0.5,1)),
  n_valid integer NOT NULL CHECK (n_valid>=0),
  model_coverage integer NOT NULL CHECK (model_coverage>=0),
  insufficient_sample boolean GENERATED ALWAYS AS (n_valid<10 OR model_coverage<3) STORED,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cluster_id) REFERENCES intent_cluster(tenant_id, id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES scoring_snapshot(tenant_id, snapshot_id),
  UNIQUE (tenant_id,cluster_id,snapshot_id),
  CHECK (NOT insufficient_sample OR (blank_score IS NULL AND error_score IS NULL AND generic_score IS NULL AND competitor_score IS NULL AND whitespace_score IS NULL))
);
COMMENT ON TABLE cluster_score IS '簇级唯一出数口；同配置只写一次；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN cluster_score.id IS '不可变记录标识';
COMMENT ON COLUMN cluster_score.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN cluster_score.cluster_id IS 'cluster_score.cluster_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.snapshot_id IS '冻结采样配置身份';
COMMENT ON COLUMN cluster_score.blank_raw IS 'cluster_score.blank_raw；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.blank_score IS 'cluster_score.blank_score；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.error_raw IS 'cluster_score.error_raw；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.error_score IS 'cluster_score.error_score；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.generic_raw IS 'cluster_score.generic_raw；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.generic_score IS 'cluster_score.generic_score；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.competitor_raw IS 'cluster_score.competitor_raw；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.competitor_score IS 'cluster_score.competitor_score；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.whitespace_raw IS 'cluster_score.whitespace_raw；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.whitespace_score IS 'cluster_score.whitespace_score；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.n_valid IS 'cluster_score.n_valid；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.model_coverage IS 'cluster_score.model_coverage；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_score.insufficient_sample IS '由n_valid<10或model_coverage<3计算，不能伪填false';

CREATE TABLE IF NOT EXISTS cluster_platform_signal (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  cluster_id text NOT NULL,
  snapshot_id text NOT NULL,
  platform text NOT NULL,
  model_citation_count integer NOT NULL CHECK (model_citation_count>=0),
  serp_occurrence integer NOT NULL CHECK (serp_occurrence BETWEEN 0 AND 20),
  suggested_rank integer,
  note text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cluster_id) REFERENCES intent_cluster(tenant_id, id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES scoring_snapshot(tenant_id, snapshot_id),
  UNIQUE (tenant_id,cluster_id,snapshot_id,platform)
);
COMMENT ON TABLE cluster_platform_signal IS '簇级模型引用与SERP渠道信号；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN cluster_platform_signal.id IS '不可变记录标识';
COMMENT ON COLUMN cluster_platform_signal.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN cluster_platform_signal.cluster_id IS 'cluster_platform_signal.cluster_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_platform_signal.snapshot_id IS '冻结采样配置身份';
COMMENT ON COLUMN cluster_platform_signal.platform IS 'cluster_platform_signal.platform；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_platform_signal.model_citation_count IS 'cluster_platform_signal.model_citation_count；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_platform_signal.serp_occurrence IS 'cluster_platform_signal.serp_occurrence；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_platform_signal.suggested_rank IS 'cluster_platform_signal.suggested_rank；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN cluster_platform_signal.note IS 'cluster_platform_signal.note；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS opportunity_card (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  intent_cluster_id text NOT NULL,
  pool_version integer NOT NULL,
  seed_terms text[] NOT NULL DEFAULT '{}',
  demand_size numeric,
  business_value numeric,
  competition_density numeric,
  demand_tier text CHECK (demand_tier IN ('S','A','B','C')),
  demand_source text,
  industry_score numeric,
  industry_score_version integer,
  snapshot_id text,
  score numeric,
  owner_role text CHECK (owner_role IN ('owner','editor','viewer','strategist','content','evidence','factcheck','cs','admin')),
  status text NOT NULL DEFAULT '候选' CHECK (status IN ('候选','评分','建议','确认','在测','归档')),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  FOREIGN KEY (tenant_id, intent_cluster_id) REFERENCES intent_cluster(tenant_id, id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES scoring_snapshot(tenant_id, snapshot_id),
  CHECK (status NOT IN ('确认','在测') OR (demand_tier IS NOT NULL AND demand_source IS NOT NULL AND btrim(demand_source)<>''))
);
COMMENT ON TABLE opportunity_card IS '引用留白分，不复制四分与留白score；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN opportunity_card.id IS '不可变记录标识';
COMMENT ON COLUMN opportunity_card.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN opportunity_card.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN opportunity_card.intent_cluster_id IS 'opportunity_card.intent_cluster_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.pool_version IS 'opportunity_card.pool_version；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.seed_terms IS 'opportunity_card.seed_terms；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.demand_size IS 'opportunity_card.demand_size；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.business_value IS 'opportunity_card.business_value；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.competition_density IS 'opportunity_card.competition_density；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.demand_tier IS 'opportunity_card.demand_tier；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.demand_source IS 'opportunity_card.demand_source；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.industry_score IS 'opportunity_card.industry_score；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.industry_score_version IS 'opportunity_card.industry_score_version；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.snapshot_id IS '冻结采样配置身份';
COMMENT ON COLUMN opportunity_card.score IS 'opportunity_card.score；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.owner_role IS 'opportunity_card.owner_role；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN opportunity_card.status IS '只允许冻结规格中的状态值';

CREATE TABLE IF NOT EXISTS content_asset (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  opportunity_card_id text NOT NULL,
  type text NOT NULL,
  platform text,
  url text,
  published_at timestamptz,
  author text NOT NULL,
  review_status text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','ready','registered','retired')),
  published_claim_versions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(published_claim_versions)='array'),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  FOREIGN KEY (tenant_id, opportunity_card_id) REFERENCES opportunity_card(tenant_id, id)
);
COMMENT ON TABLE content_asset IS '内容资产；发布进度不放在事实块上；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN content_asset.id IS '不可变记录标识';
COMMENT ON COLUMN content_asset.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN content_asset.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN content_asset.opportunity_card_id IS 'content_asset.opportunity_card_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN content_asset.type IS 'content_asset.type；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN content_asset.platform IS 'content_asset.platform；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN content_asset.url IS 'content_asset.url；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN content_asset.published_at IS 'content_asset.published_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN content_asset.author IS 'content_asset.author；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN content_asset.review_status IS '资产draft/ready/registered/retired，ready由服务层派生';
COMMENT ON COLUMN content_asset.published_claim_versions IS '已发布事实块版本引用，用于retract事件链';

CREATE TABLE IF NOT EXISTS claim_block (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  content_asset_id text NOT NULL,
  logical_id text NOT NULL,
  version integer NOT NULL CHECK (version>0),
  created_by text NOT NULL,
  text text NOT NULL CHECK (btrim(text)<>''),
  number text NOT NULL CHECK (btrim(number)<>''),
  unit text NOT NULL CHECK (btrim(unit)<>''),
  scope text NOT NULL CHECK (btrim(scope)<>''),
  source_url text NOT NULL CHECK (btrim(source_url)<>''),
  source_level text NOT NULL CHECK (source_level IN ('L1','L2')),
  source_checked_at timestamptz,
  valid_until timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','retracted')),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, content_asset_id) REFERENCES content_asset(tenant_id, id),
  UNIQUE (tenant_id,logical_id,version)
);
COMMENT ON TABLE claim_block IS '事实块版本，新版本新行，L3永不准入；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN claim_block.id IS '不可变记录标识';
COMMENT ON COLUMN claim_block.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN claim_block.content_asset_id IS 'claim_block.content_asset_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN claim_block.logical_id IS '同一逻辑对象的版本链标识，非新产品状态';
COMMENT ON COLUMN claim_block.version IS '版本号；变更开新行';
COMMENT ON COLUMN claim_block.created_by IS 'claim_block.created_by；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN claim_block.text IS 'claim_block.text；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN claim_block.number IS '数字原文，支持区间，非任意精度浮点';
COMMENT ON COLUMN claim_block.unit IS 'claim_block.unit；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN claim_block.scope IS 'claim_block.scope；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN claim_block.source_url IS 'claim_block.source_url；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN claim_block.source_level IS '来源等级；事实基准只准L1，事实块只准L1/L2';
COMMENT ON COLUMN claim_block.source_checked_at IS 'claim_block.source_checked_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN claim_block.valid_until IS 'claim_block.valid_until；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN claim_block.status IS '只允许冻结规格中的状态值';

CREATE TABLE IF NOT EXISTS probe_batch (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('baseline','event','monthly')),
  scheduled_at timestamptz NOT NULL,
  snapshot_id text NOT NULL,
  lexicon_version integer NOT NULL CHECK (lexicon_version>0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  cluster_question_sets jsonb NOT NULL CHECK (jsonb_typeof(cluster_question_sets)='array'),
  baseline_batch_id text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3),
  attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no>0),
  committed_attempt_no integer CHECK (committed_attempt_no>0),
  compensates_batch_id text,
  dead_letter_ref text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES scoring_snapshot(tenant_id, snapshot_id),
  FOREIGN KEY (tenant_id, baseline_batch_id) REFERENCES probe_batch(tenant_id, id),
  FOREIGN KEY (tenant_id, compensates_batch_id) REFERENCES probe_batch(tenant_id, id)
);
COMMENT ON TABLE probe_batch IS '执行身份；终态不可改，补偿新开批次；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN probe_batch.id IS '不可变记录标识';
COMMENT ON COLUMN probe_batch.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN probe_batch.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN probe_batch.type IS 'probe_batch.type；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_batch.scheduled_at IS 'probe_batch.scheduled_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_batch.snapshot_id IS '冻结采样配置身份';
COMMENT ON COLUMN probe_batch.lexicon_version IS '批次判定使用的历史词表版本';
COMMENT ON COLUMN probe_batch.status IS '只允许冻结规格中的状态值';
COMMENT ON COLUMN probe_batch.cluster_question_sets IS '批次固定的簇/锚定版本/question_id集合';
COMMENT ON COLUMN probe_batch.baseline_batch_id IS 'probe_batch.baseline_batch_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_batch.retry_count IS 'probe_batch.retry_count；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_batch.attempt_no IS 'probe_batch.attempt_no；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_batch.committed_attempt_no IS 'probe_batch.committed_attempt_no；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_batch.compensates_batch_id IS 'probe_batch.compensates_batch_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_batch.dead_letter_ref IS 'probe_batch.dead_letter_ref；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_batch.created_at IS '创建时间，UTC timestamptz';
COMMENT ON COLUMN probe_batch.started_at IS 'probe_batch.started_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_batch.finished_at IS 'probe_batch.finished_at；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS probe (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  batch_id text NOT NULL,
  intent_cluster_id text NOT NULL,
  question_id text NOT NULL,
  question text NOT NULL,
  model text NOT NULL,
  model_version text NOT NULL,
  temperature numeric NOT NULL,
  round integer NOT NULL CHECK (round>0),
  attempt_no integer NOT NULL CHECK (attempt_no>0),
  run_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES probe_batch(tenant_id, id),
  FOREIGN KEY (tenant_id, intent_cluster_id) REFERENCES intent_cluster(tenant_id, id),
  FOREIGN KEY (tenant_id, question_id) REFERENCES question_pool(tenant_id, id),
  UNIQUE (tenant_id,batch_id,attempt_no,intent_cluster_id,question_id,model,temperature,round)
);
COMMENT ON TABLE probe IS '批次内采样槽，重试尝试号分开；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN probe.id IS '不可变记录标识';
COMMENT ON COLUMN probe.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN probe.batch_id IS '采样执行批次身份';
COMMENT ON COLUMN probe.intent_cluster_id IS 'probe.intent_cluster_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe.question_id IS 'probe.question_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe.question IS 'probe.question；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe.model IS 'probe.model；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe.model_version IS 'probe.model_version；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe.temperature IS 'probe.temperature；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe.round IS 'probe.round；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe.attempt_no IS 'probe.attempt_no；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe.run_at IS 'probe.run_at；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS probe_result (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  probe_id text NOT NULL,
  brand_mentioned boolean,
  refused boolean NOT NULL DEFAULT false,
  cited_claim_ids text[] NOT NULL DEFAULT '{}',
  cited_urls text[] NOT NULL DEFAULT '{}',
  cited_domains text[] NOT NULL DEFAULT '{}',
  blank_i numeric CHECK (blank_i IN (0,0.5,1)),
  error_i numeric CHECK (error_i IN (0,0.5,1)),
  generic_i numeric CHECK (generic_i IN (0,0.5,1)),
  competitor_i numeric CHECK (competitor_i IN (0,0.5,1)),
  fact_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  high_err_types text[] NOT NULL DEFAULT '{}',
  spec_score numeric,
  note text,
  raw_answer text,
  lexicon_version integer,
  official_fact_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, probe_id) REFERENCES probe(tenant_id, id),
  UNIQUE (tenant_id,probe_id)
);
COMMENT ON TABLE probe_result IS '原始回答不进指令位，拒答排分母；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN probe_result.id IS '不可变记录标识';
COMMENT ON COLUMN probe_result.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN probe_result.probe_id IS 'probe_result.probe_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.brand_mentioned IS 'probe_result.brand_mentioned；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.refused IS 'probe_result.refused；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.cited_claim_ids IS 'probe_result.cited_claim_ids；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.cited_urls IS 'probe_result.cited_urls；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.cited_domains IS 'probe_result.cited_domains；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.blank_i IS 'probe_result.blank_i；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.error_i IS 'probe_result.error_i；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.generic_i IS 'probe_result.generic_i；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.competitor_i IS 'probe_result.competitor_i；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.fact_errors IS 'probe_result.fact_errors；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.high_err_types IS 'probe_result.high_err_types；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.spec_score IS 'probe_result.spec_score；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.note IS 'probe_result.note；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN probe_result.raw_answer IS '受限原始回答；解约显式删除可置空';
COMMENT ON COLUMN probe_result.lexicon_version IS '批次判定使用的历史词表版本';
COMMENT ON COLUMN probe_result.official_fact_ids IS '本次判定实际引用的官方基准ID集合';
COMMENT ON COLUMN probe_result.created_at IS '创建时间，UTC timestamptz';

CREATE TABLE IF NOT EXISTS metric_snapshot (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  intent_cluster_id text NOT NULL,
  snapshot_id text NOT NULL,
  batch_id text NOT NULL,
  lexicon_version integer NOT NULL CHECK (lexicon_version>0),
  date timestamptz NOT NULL,
  mention_rate numeric CHECK (mention_rate BETWEEN 0 AND 1),
  citation_rate numeric CHECK (citation_rate BETWEEN 0 AND 1),
  accuracy numeric CHECK (accuracy BETWEEN 0 AND 1),
  sov numeric CHECK (sov BETWEEN 0 AND 1),
  avg_position numeric,
  leads bigint,
  produced_by_us boolean NOT NULL DEFAULT false,
  control_cluster_ids text[] NOT NULL DEFAULT '{}',
  denominator_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  FOREIGN KEY (tenant_id, intent_cluster_id) REFERENCES intent_cluster(tenant_id, id),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES scoring_snapshot(tenant_id, snapshot_id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES probe_batch(tenant_id, id),
  UNIQUE (tenant_id,brand_id,intent_cluster_id,batch_id)
);
COMMENT ON TABLE metric_snapshot IS '按执行批次追加的指标，保留判定词表版本；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN metric_snapshot.id IS '不可变记录标识';
COMMENT ON COLUMN metric_snapshot.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN metric_snapshot.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN metric_snapshot.intent_cluster_id IS 'metric_snapshot.intent_cluster_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.snapshot_id IS '冻结采样配置身份';
COMMENT ON COLUMN metric_snapshot.batch_id IS '采样执行批次身份';
COMMENT ON COLUMN metric_snapshot.lexicon_version IS '批次判定使用的历史词表版本';
COMMENT ON COLUMN metric_snapshot.date IS 'metric_snapshot.date；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.mention_rate IS 'metric_snapshot.mention_rate；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.citation_rate IS 'metric_snapshot.citation_rate；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.accuracy IS 'metric_snapshot.accuracy；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.sov IS 'metric_snapshot.sov；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.avg_position IS 'metric_snapshot.avg_position；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.leads IS 'metric_snapshot.leads；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.produced_by_us IS 'metric_snapshot.produced_by_us；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.control_cluster_ids IS 'metric_snapshot.control_cluster_ids；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN metric_snapshot.denominator_changes IS 'metric_snapshot.denominator_changes；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  tenant_id text REFERENCES tenant(id),
  user_id text,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_type text NOT NULL CHECK (actor_type IN ('human','agent','system','external_agent')),
  agent_run_id text,
  prompt_version text,
  job_name text CHECK (job_name IN ('judge','weekly_pool','c_import','event_schedule','probe_execute','baseline_scoring','metric_aggregate','backflow_scan','ticket_deadline','content_reconcile','audit_middleware','opportunity_lifecycle','publication_lifecycle','offboarding')),
  batch_id text,
  trigger_source jsonb,
  viewing_session_id text,
  viewer_user_id text,
  reason text,
  cause_event_id text,
  CHECK (actor_type NOT IN ('agent','external_agent') OR (agent_run_id IS NOT NULL AND prompt_version IS NOT NULL)),
  CHECK (actor_type <> 'system' OR (job_name IS NOT NULL AND trigger_source IS NOT NULL)),
  CHECK (job_name NOT IN ('judge','probe_execute','baseline_scoring','metric_aggregate','publication_lifecycle') OR batch_id IS NOT NULL),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES probe_batch(tenant_id, id)
);
COMMENT ON TABLE audit_log IS '所有写入/原始回答/C类访问的追加审计；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN audit_log.id IS '不可变记录标识';
COMMENT ON COLUMN audit_log.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN audit_log.user_id IS 'audit_log.user_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.action IS 'audit_log.action；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.object_type IS 'audit_log.object_type；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.object_id IS 'audit_log.object_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.at IS 'audit_log.at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.actor_type IS 'human/agent/system/external_agent';
COMMENT ON COLUMN audit_log.agent_run_id IS 'Agent运行标识；human/system不适用时NULL';
COMMENT ON COLUMN audit_log.prompt_version IS '提示版本；human/system不适用时NULL';
COMMENT ON COLUMN audit_log.job_name IS 'audit_log.job_name；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.batch_id IS '采样执行批次身份';
COMMENT ON COLUMN audit_log.trigger_source IS 'audit_log.trigger_source；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.viewing_session_id IS 'audit_log.viewing_session_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.viewer_user_id IS 'audit_log.viewer_user_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.reason IS 'audit_log.reason；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN audit_log.cause_event_id IS 'audit_log.cause_event_id；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS review_queue (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  object_type text NOT NULL CHECK (object_type IN ('claim_block','evidence_package','diagnosis_report','brand_lexicon','official_fact')),
  object_id text NOT NULL,
  submitted_by text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','approved','rejected','withdrawn')),
  decided_by text,
  decided_at timestamptz,
  reject_reason text,
  UNIQUE (tenant_id, id),
  CHECK ((status='waiting' AND decided_by IS NULL AND decided_at IS NULL) OR (status<>'waiting' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status NOT IN ('approved','rejected') OR decided_by<>submitted_by),
  CHECK (status<>'rejected' OR (reject_reason IS NOT NULL AND btrim(reject_reason)<>'')),
  CHECK (status<>'withdrawn' OR decided_by=submitted_by)
);
COMMENT ON TABLE review_queue IS '多对象统一审核；放行人和作者分离；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN review_queue.id IS '不可变记录标识';
COMMENT ON COLUMN review_queue.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN review_queue.object_type IS 'review_queue.object_type；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN review_queue.object_id IS 'review_queue.object_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN review_queue.submitted_by IS 'review_queue.submitted_by；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN review_queue.submitted_at IS 'review_queue.submitted_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN review_queue.status IS '只允许冻结规格中的状态值';
COMMENT ON COLUMN review_queue.decided_by IS 'review_queue.decided_by；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN review_queue.decided_at IS 'review_queue.decided_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN review_queue.reject_reason IS 'review_queue.reject_reason；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS objection (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  applicant_user_id text NOT NULL,
  probe_id text NOT NULL,
  conclusion_ref jsonb NOT NULL CHECK (conclusion_ref ? 'object_type' AND conclusion_ref ? 'object_id'),
  reason text NOT NULL CHECK (btrim(reason)<>''),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','granted','viewed','rejected')),
  decided_by text,
  decided_at timestamptz,
  viewing_session_id text UNIQUE,
  viewed_at timestamptz,
  watermark_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  FOREIGN KEY (tenant_id, probe_id) REFERENCES probe(tenant_id, id),
  CHECK (status<>'viewed' OR (viewing_session_id IS NOT NULL AND viewed_at IS NOT NULL AND watermark_meta IS NOT NULL))
);
COMMENT ON TABLE objection IS '单probe单次异议调阅，会话由CS发起；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN objection.id IS '不可变记录标识';
COMMENT ON COLUMN objection.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN objection.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN objection.applicant_user_id IS 'objection.applicant_user_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN objection.probe_id IS 'objection.probe_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN objection.conclusion_ref IS 'objection.conclusion_ref；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN objection.reason IS 'objection.reason；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN objection.status IS '只允许冻结规格中的状态值';
COMMENT ON COLUMN objection.decided_by IS 'objection.decided_by；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN objection.decided_at IS 'objection.decided_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN objection.viewing_session_id IS 'objection.viewing_session_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN objection.viewed_at IS 'objection.viewed_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN objection.watermark_meta IS 'objection.watermark_meta；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN objection.created_at IS '创建时间，UTC timestamptz';

CREATE TABLE IF NOT EXISTS backflow_ticket (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  signal_type text NOT NULL CHECK (signal_type IN ('uncited','cited_wrong','no_demand','competitor_surge','model_version')),
  cluster_id text NOT NULL,
  evidence_probe_ids text[] NOT NULL DEFAULT '{}',
  trigger_metric_id text,
  severity text NOT NULL CHECK (severity IN ('normal','urgent')),
  owner_role text NOT NULL CHECK (owner_role IN ('owner','editor','viewer','strategist','content','evidence','factcheck','cs','admin')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','expired','done')),
  assigned_user_id text,
  deadline_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at timestamptz,
  resolution_note text,
  followup_batch_id text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  FOREIGN KEY (tenant_id, cluster_id) REFERENCES intent_cluster(tenant_id, id),
  FOREIGN KEY (tenant_id, trigger_metric_id) REFERENCES metric_snapshot(tenant_id, id),
  FOREIGN KEY (tenant_id, followup_batch_id) REFERENCES probe_batch(tenant_id, id),
  CHECK (status<>'done' OR (resolved_at IS NOT NULL AND resolution_note IS NOT NULL AND btrim(resolution_note)<>'')),
  CHECK (signal_type<>'cited_wrong' OR (severity='urgent' AND deadline_at<=created_at+interval '24 hours'))
);
COMMENT ON TABLE backflow_ticket IS '五类回流及超时保留，完成说明必填；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN backflow_ticket.id IS '不可变记录标识';
COMMENT ON COLUMN backflow_ticket.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN backflow_ticket.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN backflow_ticket.signal_type IS 'backflow_ticket.signal_type；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.cluster_id IS 'backflow_ticket.cluster_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.evidence_probe_ids IS 'backflow_ticket.evidence_probe_ids；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.trigger_metric_id IS 'backflow_ticket.trigger_metric_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.severity IS 'backflow_ticket.severity；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.owner_role IS 'backflow_ticket.owner_role；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.status IS '只允许冻结规格中的状态值';
COMMENT ON COLUMN backflow_ticket.assigned_user_id IS 'backflow_ticket.assigned_user_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.deadline_at IS 'backflow_ticket.deadline_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.created_at IS '创建时间，UTC timestamptz';
COMMENT ON COLUMN backflow_ticket.resolved_at IS 'backflow_ticket.resolved_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.resolution_note IS 'backflow_ticket.resolution_note；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN backflow_ticket.followup_batch_id IS 'backflow_ticket.followup_batch_id；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS evidence_package (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  logical_id text NOT NULL,
  version integer NOT NULL CHECK (version>0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sealed')),
  created_by text NOT NULL,
  sealed_by text,
  sealed_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  UNIQUE (tenant_id,logical_id,version),
  CHECK (status<>'sealed' OR (sealed_by IS NOT NULL AND sealed_at IS NOT NULL AND sealed_by<>created_by))
);
COMMENT ON TABLE evidence_package IS '每版本放行即sealed，修订新行；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN evidence_package.id IS '不可变记录标识';
COMMENT ON COLUMN evidence_package.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN evidence_package.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN evidence_package.logical_id IS '同一逻辑对象的版本链标识，非新产品状态';
COMMENT ON COLUMN evidence_package.version IS '版本号；变更开新行';
COMMENT ON COLUMN evidence_package.status IS '只允许冻结规格中的状态值';
COMMENT ON COLUMN evidence_package.created_by IS 'evidence_package.created_by；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN evidence_package.sealed_by IS 'evidence_package.sealed_by；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN evidence_package.sealed_at IS 'evidence_package.sealed_at；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS evidence_item (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  package_id text NOT NULL,
  conclusion_text text NOT NULL,
  probe_id text NOT NULL,
  source_level text NOT NULL CHECK (source_level IN ('L1','L2','L3')),
  excerpt text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, package_id) REFERENCES evidence_package(tenant_id, id),
  FOREIGN KEY (tenant_id, probe_id) REFERENCES probe(tenant_id, id)
);
COMMENT ON TABLE evidence_item IS '证据包内部条目，经父包继承租户/原文访问限制；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN evidence_item.id IS '不可变记录标识';
COMMENT ON COLUMN evidence_item.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN evidence_item.package_id IS 'evidence_item.package_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN evidence_item.conclusion_text IS 'evidence_item.conclusion_text；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN evidence_item.probe_id IS 'evidence_item.probe_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN evidence_item.source_level IS '来源等级；事实基准只准L1，事实块只准L1/L2';
COMMENT ON COLUMN evidence_item.excerpt IS 'evidence_item.excerpt；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN evidence_item.created_at IS '创建时间，UTC timestamptz';

CREATE TABLE IF NOT EXISTS api_token (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  user_id text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (btrim(token_hash)<>''),
  scopes jsonb NOT NULL CHECK (jsonb_typeof(scopes)='array'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (tenant_id, id)
);
COMMENT ON TABLE api_token IS 'per-user PAT只存hash，scopes不扩权；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN api_token.id IS '不可变记录标识';
COMMENT ON COLUMN api_token.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN api_token.user_id IS 'api_token.user_id；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN api_token.token_hash IS '仅存哈希，禁止存明文令牌';
COMMENT ON COLUMN api_token.scopes IS 'PAT操作范围，与用户权限取交集';
COMMENT ON COLUMN api_token.created_at IS '创建时间，UTC timestamptz';
COMMENT ON COLUMN api_token.last_used_at IS 'api_token.last_used_at；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN api_token.revoked_at IS 'api_token.revoked_at；按冻结API语义保存，不作口径折算';

CREATE TABLE IF NOT EXISTS brand_lexicon (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  version integer NOT NULL CHECK (version>0),
  kind text NOT NULL CHECK (kind IN ('brand_alias','product_line','model','competitor','exclusion')),
  term text NOT NULL CHECK (btrim(term)<>''),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  UNIQUE (tenant_id,brand_id,id),
  UNIQUE (tenant_id,brand_id,version,kind,term)
);
COMMENT ON TABLE brand_lexicon IS '整品牌版本只读词表；生效沿审核队列承载；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN brand_lexicon.id IS '不可变记录标识';
COMMENT ON COLUMN brand_lexicon.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN brand_lexicon.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN brand_lexicon.version IS '版本号；变更开新行';
COMMENT ON COLUMN brand_lexicon.kind IS 'brand_lexicon.kind；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN brand_lexicon.term IS 'brand_lexicon.term；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN brand_lexicon.created_by IS 'brand_lexicon.created_by；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN brand_lexicon.created_at IS '创建时间，UTC timestamptz';

CREATE TABLE IF NOT EXISTS official_fact (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenant(id),
  brand_id text NOT NULL,
  fact_category text NOT NULL CHECK (fact_category IN ('price','spec','boundary','service_promise')),
  content text NOT NULL CHECK (btrim(content)<>''),
  source_level text NOT NULL CHECK (source_level='L1'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retracted')),
  effective_from timestamptz NOT NULL,
  product_line_ref text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id),
  FOREIGN KEY (tenant_id,brand_id,product_line_ref) REFERENCES brand_lexicon(tenant_id,brand_id,id)
);
COMMENT ON TABLE official_fact IS 'judge唯一官方比对基准，L1准入；依据产品§18及冻结API字段落地说明';
COMMENT ON COLUMN official_fact.id IS '不可变记录标识';
COMMENT ON COLUMN official_fact.tenant_id IS '租户隔离边界';
COMMENT ON COLUMN official_fact.brand_id IS '所属品牌；与tenant_id复合外键约束';
COMMENT ON COLUMN official_fact.fact_category IS 'official_fact.fact_category；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN official_fact.content IS 'official_fact.content；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN official_fact.source_level IS '来源等级；事实基准只准L1，事实块只准L1/L2';
COMMENT ON COLUMN official_fact.status IS '只允许冻结规格中的状态值';
COMMENT ON COLUMN official_fact.effective_from IS 'official_fact.effective_from；按冻结API语义保存，不作口径折算';
COMMENT ON COLUMN official_fact.product_line_ref IS 'C4可选品线引用；MVP可空';

CREATE UNIQUE INDEX IF NOT EXISTS member_tenant_role_unique ON user_member(tenant_id,user_id,role) WHERE brand_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS member_brand_role_unique ON user_member(tenant_id,user_id,role,brand_id) WHERE brand_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS review_waiting_object_unique ON review_queue(tenant_id,object_type,object_id) WHERE status='waiting';
CREATE INDEX IF NOT EXISTS brand_tenant_idx ON brand(tenant_id);
CREATE INDEX IF NOT EXISTS user_member_tenant_idx ON user_member(tenant_id);
CREATE INDEX IF NOT EXISTS intent_cluster_tenant_idx ON intent_cluster(tenant_id);
CREATE INDEX IF NOT EXISTS question_pool_tenant_idx ON question_pool(tenant_id);
CREATE INDEX IF NOT EXISTS scoring_snapshot_tenant_idx ON scoring_snapshot(tenant_id);
CREATE INDEX IF NOT EXISTS question_score_tenant_idx ON question_score(tenant_id);
CREATE INDEX IF NOT EXISTS cluster_score_tenant_idx ON cluster_score(tenant_id);
CREATE INDEX IF NOT EXISTS cluster_platform_signal_tenant_idx ON cluster_platform_signal(tenant_id);
CREATE INDEX IF NOT EXISTS opportunity_card_tenant_idx ON opportunity_card(tenant_id);
CREATE INDEX IF NOT EXISTS content_asset_tenant_idx ON content_asset(tenant_id);
CREATE INDEX IF NOT EXISTS claim_block_tenant_idx ON claim_block(tenant_id);
CREATE INDEX IF NOT EXISTS probe_batch_tenant_idx ON probe_batch(tenant_id);
CREATE INDEX IF NOT EXISTS probe_tenant_idx ON probe(tenant_id);
CREATE INDEX IF NOT EXISTS probe_result_tenant_idx ON probe_result(tenant_id);
CREATE INDEX IF NOT EXISTS metric_snapshot_tenant_idx ON metric_snapshot(tenant_id);
CREATE INDEX IF NOT EXISTS review_queue_tenant_idx ON review_queue(tenant_id);
CREATE INDEX IF NOT EXISTS objection_tenant_idx ON objection(tenant_id);
CREATE INDEX IF NOT EXISTS backflow_ticket_tenant_idx ON backflow_ticket(tenant_id);
CREATE INDEX IF NOT EXISTS evidence_package_tenant_idx ON evidence_package(tenant_id);
CREATE INDEX IF NOT EXISTS evidence_item_tenant_idx ON evidence_item(tenant_id);
CREATE INDEX IF NOT EXISTS api_token_tenant_idx ON api_token(tenant_id);
CREATE INDEX IF NOT EXISTS brand_lexicon_tenant_idx ON brand_lexicon(tenant_id);
CREATE INDEX IF NOT EXISTS official_fact_tenant_idx ON official_fact(tenant_id);
CREATE INDEX IF NOT EXISTS audit_object_idx ON audit_log(tenant_id,object_type,object_id,at);
CREATE INDEX IF NOT EXISTS audit_batch_idx ON audit_log(tenant_id,batch_id);

-- Fail closed for non-owner application roles until T05 installs scoped policies.
-- Owners/superusers used for migrations are not evidence of tenant isolation.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_cluster ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_platform_signal ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE probe_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE probe_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE objection ENABLE ROW LEVEL SECURITY;
ALTER TABLE backflow_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_package ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_lexicon ENABLE ROW LEVEL SECURITY;
ALTER TABLE official_fact ENABLE ROW LEVEL SECURITY;
