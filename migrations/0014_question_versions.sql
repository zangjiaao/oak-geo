-- T12: a frozen brand/version is closed against INSERT, including sibling clusters.
CREATE INDEX question_brand_version_lookup ON question_pool(tenant_id,question_pool_version,cluster_id);
CREATE OR REPLACE FUNCTION geo_question_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid text;
BEGIN
 SELECT brand_id INTO bid FROM intent_cluster WHERE tenant_id=NEW.tenant_id AND id=NEW.cluster_id;
 IF bid IS NULL THEN RAISE EXCEPTION 'question cluster not found' USING ERRCODE='23503'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('question-version:'||NEW.tenant_id||':'||bid||':'||NEW.question_pool_version,0));
 IF NEW.frozen OR NEW.archived_at IS NOT NULL THEN
  RAISE EXCEPTION 'questions must start open' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM question_pool q JOIN intent_cluster c ON c.tenant_id=q.tenant_id AND c.id=q.cluster_id
   WHERE q.tenant_id=NEW.tenant_id AND c.brand_id=bid AND q.question_pool_version=NEW.question_pool_version AND (q.frozen OR q.archived_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'frozen question version cannot grow' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER question_version_insert BEFORE INSERT ON question_pool FOR EACH ROW EXECUTE FUNCTION geo_question_insert_guard();
DROP TRIGGER stable_identity ON question_pool;
CREATE TRIGGER stable_identity BEFORE UPDATE ON question_pool FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id','cluster_id','question_pool_version');
COMMENT ON FUNCTION geo_question_insert_guard() IS 'T12：普通运行身份下的版本插入兜底，与服务层品牌/版本锁相同；冻结集合不能插入新问句';
