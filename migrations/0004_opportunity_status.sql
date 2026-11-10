-- T04 review: storage encoding only; the frozen API still uses Chinese states.
-- Preserve 0001/0003 checksums. Re-encoding does not advance any business state.
DROP TRIGGER IF EXISTS named_transition ON opportunity_card;
ALTER TABLE opportunity_card DROP CONSTRAINT opportunity_card_status_check;
ALTER TABLE opportunity_card DROP CONSTRAINT opportunity_card_check;
ALTER TABLE opportunity_card ALTER COLUMN status SET DEFAULT 'candidate';

WITH converted AS (
 UPDATE opportunity_card SET status = CASE status
  WHEN '候选' THEN 'candidate' WHEN '评分' THEN 'scored'
  WHEN '建议' THEN 'recommended' WHEN '确认' THEN 'confirmed'
  WHEN '在测' THEN 'monitoring' WHEN '归档' THEN 'archived'
 END
 WHERE status IN ('候选','评分','建议','确认','在测','归档')
 RETURNING id, tenant_id
)
INSERT INTO audit_log(id,tenant_id,user_id,action,object_type,object_id,actor_type,agent_run_id,prompt_version)
SELECT gen_random_uuid()::text,tenant_id,current_setting('geo.migration_actor'),
 'schema.reencode_storage','opportunity_card',id,'human',NULL,NULL FROM converted;

ALTER TABLE opportunity_card ADD CONSTRAINT opportunity_card_status_check
 CHECK (status IN ('candidate','scored','recommended','confirmed','monitoring','archived'));
ALTER TABLE opportunity_card ADD CONSTRAINT opportunity_card_production_basis_check
 CHECK (status NOT IN ('confirmed','monitoring') OR
  (demand_tier IS NOT NULL AND demand_source IS NOT NULL AND btrim(demand_source)<>''));
COMMENT ON COLUMN opportunity_card.status IS '英文存储码；与冻结API中文枚举一一映射，见opportunity-status.mjs及T04复核裁定；无新增状态';

CREATE TRIGGER named_transition BEFORE UPDATE ON opportunity_card FOR EACH ROW
 EXECUTE FUNCTION geo_transition('status',
 '["candidate>scored","scored>recommended","recommended>confirmed","confirmed>monitoring","monitoring>archived"]',
 '["archived"]');
