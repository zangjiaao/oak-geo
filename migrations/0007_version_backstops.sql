ALTER TABLE scoring_snapshot ADD COLUMN model_version_manifest jsonb;
COMMENT ON COLUMN scoring_snapshot.model_version_manifest IS '冻结时适配器报告的模型版本映射；测试仅使用录制适配器，不替代T14当日复核';
CREATE OR REPLACE FUNCTION geo_sealed_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 state:=to_jsonb(OLD)->>'status';
 IF state IN ('approved','retracted','sealed','pending_review') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'versioned content cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME IN ('claim_block','official_fact') AND (to_jsonb(OLD)-'status') IS DISTINCT FROM (to_jsonb(NEW)-'status') THEN
   RAISE EXCEPTION 'sealed content revision requires new row' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER sealed_content BEFORE UPDATE OR DELETE ON claim_block FOR EACH ROW EXECUTE FUNCTION geo_sealed_content_guard();
CREATE TRIGGER sealed_content BEFORE UPDATE OR DELETE ON official_fact FOR EACH ROW EXECUTE FUNCTION geo_sealed_content_guard();
CREATE TRIGGER sealed_content BEFORE DELETE ON evidence_package FOR EACH ROW EXECUTE FUNCTION geo_sealed_content_guard();
CREATE TRIGGER sealed_content BEFORE DELETE ON diagnosis_record FOR EACH ROW EXECUTE FUNCTION geo_sealed_content_guard();
CREATE UNIQUE INDEX archive_one_advice ON backflow_ticket(tenant_id,archive_evidence_id) WHERE archive_evidence_id IS NOT NULL;
