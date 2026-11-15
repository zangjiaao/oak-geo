-- T13 implementation metadata; no new resource, role, or lifecycle state.
ALTER TABLE probe_batch ADD COLUMN schedule_key text;
ALTER TABLE probe_batch ADD COLUMN schedule_digest text;
ALTER TABLE probe_batch ADD COLUMN schedule_meta jsonb;
ALTER TABLE probe_batch ADD COLUMN expedited boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN probe_batch.schedule_key IS 'T13持久排期身份；登记事件+时点、基线配置或基线+月份；不随24h请求缓存失效';
COMMENT ON COLUMN probe_batch.schedule_digest IS 'T13规范化排期请求SHA256；同排期身份变更载荷返回409，不覆盖旧记录';
COMMENT ON COLUMN probe_batch.schedule_meta IS 'T13只读溯源：触发事件、发布时点/偏移或月份、目标与对照清单；不含原文';
COMMENT ON COLUMN probe_batch.expedited IS 'T13接入加急标志；只提升已到期pending任务顺序，不提前执行';
ALTER TABLE probe_batch ADD CONSTRAINT complete_schedule_identity CHECK (
 (schedule_key IS NULL AND schedule_digest IS NULL AND schedule_meta IS NULL AND NOT expedited) OR
 (schedule_key IS NOT NULL AND btrim(schedule_key)<>'' AND schedule_digest ~ '^[0-9a-f]{64}$' AND schedule_digest IS NOT NULL AND jsonb_typeof(schedule_meta)='object' AND schedule_meta IS NOT NULL)
);
CREATE UNIQUE INDEX probe_schedule_identity ON probe_batch(tenant_id,schedule_key) WHERE schedule_key IS NOT NULL;
CREATE INDEX due_probe_schedules ON probe_batch(tenant_id,expedited DESC,scheduled_at,id) WHERE status='pending';
CREATE TRIGGER frozen_schedule_identity BEFORE UPDATE ON probe_batch FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('schedule_key','schedule_digest','schedule_meta','expedited','scheduled_at','snapshot_id','brand_id','type','cluster_question_sets','baseline_batch_id','lexicon_version');
