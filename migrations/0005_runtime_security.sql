-- T05: application connections are a separate, non-owner role.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='geo_app') THEN
  CREATE ROLE geo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO geo_app;

-- Installation identity only authorizes tenant/member configuration; no data role.
CREATE TABLE auth_installation_admin (user_id text PRIMARY KEY);
COMMENT ON TABLE auth_installation_admin IS '部署身份提供方登记的安装管理员；仅引导配置；不授予原文或业务万能权限';
COMMENT ON COLUMN auth_installation_admin.user_id IS '可信身份提供方subject；仅管理迁移服务可登记';
GRANT SELECT ON auth_installation_admin TO geo_app;

CREATE TABLE task_assignment (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), user_id text NOT NULL,
 object_type text NOT NULL CHECK(object_type IN ('intent_cluster','opportunity_card','keyword_raw')),
 object_id text NOT NULL, assigned_by text NOT NULL,
 UNIQUE(tenant_id,user_id,object_type,object_id)
);
COMMENT ON TABLE task_assignment IS 'Content/Evidence已分派对象；配置服务写入，不从请求ID推定授权';
CREATE TABLE idempotency_record (
 tenant_id text NOT NULL REFERENCES tenant(id), principal_key text NOT NULL, operation text NOT NULL,
 target text NOT NULL, key text NOT NULL, payload_hash text NOT NULL, response jsonb NOT NULL,
 expires_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,principal_key,operation,target,key)
);
COMMENT ON TABLE idempotency_record IS '冻结契约24h幂等账本，随业务与审计同事务';
CREATE TABLE operation_usage (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id),
 operation_type text NOT NULL CHECK(operation_type IN ('probe','judge','drafting')),
 object_id text NOT NULL, at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE operation_usage IS 'probe/judge/drafting分粒度计量；与操作同事务';
CREATE TABLE diagnosis_record (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenant(id), brand_id text NOT NULL,
 version integer NOT NULL CHECK(version>0), logical_id text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sealed')),
 created_by text NOT NULL, probe_ids text[] NOT NULL, sealed_by text, sealed_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,logical_id,version),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES brand(tenant_id,id),
 CHECK(status<>'sealed' OR (sealed_by IS NOT NULL AND sealed_by<>created_by AND sealed_at IS NOT NULL))
);
COMMENT ON TABLE diagnosis_record IS '已有diagnosis_report投影的封版身份；结论从probe及判定依据推导，不存复制原文';
CREATE TRIGGER named_transition BEFORE UPDATE ON diagnosis_record FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["draft>sealed"]','["sealed"]');
CREATE TRIGGER stable_identity BEFORE UPDATE ON diagnosis_record FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id','logical_id','version','created_by');
ALTER TABLE claim_block ADD COLUMN block_kind text;
COMMENT ON COLUMN claim_block.block_kind IS '产品§6意图必配块项目名；字段补充，不新增产品类型枚举';
ALTER TABLE probe_result ADD COLUMN competitor_mentions text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN probe_result.competitor_mentions IS '人工判定记录的竞品词表entry ID；用于SOV分母，不用占位档位反推提及数';
DO $$ DECLARE t text; c record; BEGIN
 FOREACH t IN ARRAY ARRAY['task_assignment','idempotency_record','operation_usage','diagnosis_record'] LOOP
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=t LOOP
   EXECUTE format('COMMENT ON COLUMN %I.%I IS %L',t,c.column_name,'T05实现字段：'||t||'.'||c.column_name||'；受租户RLS及服务层权限约束');
  END LOOP;
 END LOOP;
END $$;

DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id' LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_boundary ON %I USING (tenant_id = nullif(current_setting(''geo.tenant_id'',true),'''')) WITH CHECK (tenant_id = nullif(current_setting(''geo.tenant_id'',true),''''))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO geo_app',t);
 END LOOP;
END $$;
-- Management migration audit is global. geo_app cannot use this policy.
CREATE POLICY migration_audit ON audit_log USING (tenant_id IS NULL AND current_user<>'geo_app') WITH CHECK (tenant_id IS NULL AND current_user<>'geo_app');
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_identity ON tenant USING (id=nullif(current_setting('geo.tenant_id',true),'')) WITH CHECK(id=nullif(current_setting('geo.tenant_id',true),''));
GRANT SELECT,INSERT,UPDATE ON tenant TO geo_app;
GRANT SELECT,INSERT ON seed_list,keyword_pool_snapshot,industry_score TO geo_app;
REVOKE UPDATE,DELETE ON audit_log,question_score,cluster_score,metric_snapshot,brand_lexicon FROM geo_app;
ALTER TABLE content_asset ADD COLUMN originated_by_internal boolean;
COMMENT ON COLUMN content_asset.originated_by_internal IS '创建时冻结的Content角色生产来源；历史未知保持NULL，不能从当前成员角色反推历史';
ALTER TABLE diagnosis_record ADD COLUMN package_id text NOT NULL;
ALTER TABLE diagnosis_record ADD CONSTRAINT diagnosis_evidence_same_tenant FOREIGN KEY(tenant_id,package_id) REFERENCES evidence_package(tenant_id,id);
COMMENT ON COLUMN diagnosis_record.package_id IS '封版证据包身份；普通诊断投影不复制原文';
