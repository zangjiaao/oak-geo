-- T07 owner-authorized proposal: active/deprecated; review before merge.
ALTER TABLE seed_list ADD COLUMN logical_id text;
ALTER TABLE seed_list ADD COLUMN previous_id text;
ALTER TABLE seed_list ADD COLUMN created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
WITH lineage AS (
 SELECT id,first_value(id) OVER(PARTITION BY industry,word_type,word ORDER BY seed_version,id) AS root,
   lag(id) OVER(PARTITION BY industry,word_type,word ORDER BY seed_version,id) AS predecessor
 FROM seed_list
), converted AS (
 UPDATE seed_list s SET logical_id=l.root,previous_id=l.predecessor,status=coalesce(s.status,'active')
 FROM lineage l WHERE s.id=l.id RETURNING s.id
)
INSERT INTO audit_log(id,tenant_id,user_id,action,object_type,object_id,actor_type,agent_run_id,prompt_version)
 SELECT gen_random_uuid()::text,NULL,current_setting('geo.migration_actor'),
 'schema.seed_lifecycle_backfill','seed_list',id,'human',NULL,NULL FROM converted;
ALTER TABLE seed_list ALTER COLUMN logical_id SET NOT NULL;
ALTER TABLE seed_list ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE seed_list ALTER COLUMN status SET NOT NULL;
ALTER TABLE seed_list ADD CONSTRAINT seed_status_valid CHECK(status IN ('active','deprecated'));
ALTER TABLE seed_list ADD CONSTRAINT seed_logical_identity UNIQUE(logical_id,id);
ALTER TABLE seed_list ADD CONSTRAINT seed_predecessor_same_lineage FOREIGN KEY(logical_id,previous_id) REFERENCES seed_list(logical_id,id);
ALTER TABLE seed_list ADD CONSTRAINT seed_no_self_parent CHECK(previous_id IS NULL OR previous_id<>id);
CREATE UNIQUE INDEX seed_single_successor ON seed_list(previous_id) WHERE previous_id IS NOT NULL;
CREATE INDEX seed_history ON seed_list(industry,logical_id,seed_version);
COMMENT ON TABLE seed_list IS 'industry-shared, no tenant_id；许可公共词根；active/deprecated，所有编辑/停用均追加版本，历史不可变';
COMMENT ON COLUMN seed_list.status IS 'T07草案active/deprecated；默认active，NULL迁移active；停用通过revise追加deprecated版本，不物理删除';
COMMENT ON COLUMN seed_list.logical_id IS '跨版本稳定逻辑身份；迁移按行业/类型/词根连接旧历史；不含租户标识';
COMMENT ON COLUMN seed_list.previous_id IS '直接前版本；同逻辑链且仅一后继，陈旧编辑409；NULL为首版';
COMMENT ON COLUMN seed_list.created_at IS '版本写入时间UTC；旧数据迁移时记录迁移时间，历史复核时间不改';
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON seed_list FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
REVOKE UPDATE,DELETE ON seed_list FROM geo_app;
