-- T04: database backstops for frozen transitions and immutable records.
-- Permission checks and audit writes still belong to src/server/api.
CREATE OR REPLACE FUNCTION geo_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'immutable record: %', TG_TABLE_NAME USING ERRCODE='23514';
END $$;

CREATE OR REPLACE FUNCTION geo_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_state text; after_state text;
BEGIN
 before_state := to_jsonb(OLD)->>TG_ARGV[0]; after_state := to_jsonb(NEW)->>TG_ARGV[0];
 IF (TG_ARGV[2]::jsonb) ? before_state THEN
  RAISE EXCEPTION 'terminal record: %', TG_TABLE_NAME USING ERRCODE='23514';
 END IF;
 IF before_state IS DISTINCT FROM after_state AND NOT ((TG_ARGV[1]::jsonb) ? (before_state||'>'||after_state)) THEN
  RAISE EXCEPTION 'illegal transition: %', TG_TABLE_NAME USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION geo_stable_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text;
BEGIN
 FOREACH key IN ARRAY TG_ARGV LOOP
  IF (to_jsonb(OLD)->key) IS DISTINCT FROM (to_jsonb(NEW)->key) THEN
   RAISE EXCEPTION 'immutable identity: %.%', TG_TABLE_NAME,key USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION geo_frozen_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.frozen THEN
  IF TG_TABLE_NAME='question_pool' AND TG_OP='UPDATE' THEN
   IF NEW.frozen AND OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
    AND (to_jsonb(OLD)-'archived_at')=(to_jsonb(NEW)-'archived_at') THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'frozen configuration cannot change' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION geo_preserve_answer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.raw_answer IS DISTINCT FROM NEW.raw_answer THEN
  IF NEW.raw_answer IS NULL AND current_setting('geo.operation',true) IN ('offboarding.execute','offboarding.cleanup') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'raw answer is immutable except explicit offboarding deletion' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION geo_guard_evidence_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_status text; target evidence_item;
BEGIN
 IF TG_OP='DELETE' THEN target:=OLD; ELSE target:=NEW; END IF;
 SELECT status INTO p_status FROM evidence_package WHERE tenant_id=target.tenant_id AND id=target.package_id;
 IF p_status<>'draft' OR EXISTS (SELECT 1 FROM review_queue WHERE tenant_id=target.tenant_id AND object_type='evidence_package' AND object_id=target.package_id AND status='waiting') THEN
  RAISE EXCEPTION 'reviewing/sealed evidence cannot change' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION geo_guard_lexicon_append() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM brand_lexicon l JOIN review_queue q ON q.tenant_id=l.tenant_id AND q.object_id=l.id AND q.object_type='brand_lexicon'
  WHERE l.tenant_id=NEW.tenant_id AND l.brand_id=NEW.brand_id AND l.version=NEW.version) THEN
  RAISE EXCEPTION 'submitted lexicon version cannot grow' USING ERRCODE='23514';
 END IF;
 IF EXISTS (SELECT 1 FROM brand_lexicon WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND version=NEW.version AND created_by<>NEW.created_by) THEN
  RAISE EXCEPTION 'lexicon version has one author' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION geo_validate_product_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.product_line_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM brand_lexicon WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.product_line_ref AND kind='product_line') THEN
  RAISE EXCEPTION 'product_line_ref must reference same-brand product_line' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_record ON audit_log;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
DROP TRIGGER IF EXISTS immutable_record ON question_score;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON question_score FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
DROP TRIGGER IF EXISTS immutable_record ON cluster_score;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON cluster_score FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
DROP TRIGGER IF EXISTS immutable_record ON cluster_platform_signal;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON cluster_platform_signal FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
DROP TRIGGER IF EXISTS immutable_record ON metric_snapshot;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON metric_snapshot FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
DROP TRIGGER IF EXISTS immutable_record ON brand_lexicon;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON brand_lexicon FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
DROP TRIGGER IF EXISTS named_transition ON claim_block;
CREATE TRIGGER named_transition BEFORE UPDATE ON claim_block FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["draft>pending_review", "pending_review>approved", "pending_review>draft", "approved>retracted"]','["retracted"]');
DROP TRIGGER IF EXISTS named_transition ON content_asset;
CREATE TRIGGER named_transition BEFORE UPDATE ON content_asset FOR EACH ROW EXECUTE FUNCTION geo_transition('review_status','["draft>ready", "ready>draft", "ready>registered", "registered>ready", "draft>retired", "ready>retired", "registered>retired"]','["retired"]');
DROP TRIGGER IF EXISTS named_transition ON intent_cluster;
CREATE TRIGGER named_transition BEFORE UPDATE ON intent_cluster FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["active>archived"]','["archived"]');
DROP TRIGGER IF EXISTS named_transition ON probe_batch;
CREATE TRIGGER named_transition BEFORE UPDATE ON probe_batch FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["pending>running", "running>completed", "running>failed", "pending>cancelled"]','["completed", "failed", "cancelled"]');
DROP TRIGGER IF EXISTS named_transition ON review_queue;
CREATE TRIGGER named_transition BEFORE UPDATE ON review_queue FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["waiting>approved", "waiting>rejected", "waiting>withdrawn"]','["approved", "rejected", "withdrawn"]');
DROP TRIGGER IF EXISTS named_transition ON objection;
CREATE TRIGGER named_transition BEFORE UPDATE ON objection FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["submitted>granted", "submitted>rejected", "granted>viewed"]','["viewed", "rejected"]');
DROP TRIGGER IF EXISTS named_transition ON backflow_ticket;
CREATE TRIGGER named_transition BEFORE UPDATE ON backflow_ticket FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["open>assigned", "assigned>done", "open>expired", "assigned>expired", "expired>done"]','["done"]');
DROP TRIGGER IF EXISTS named_transition ON evidence_package;
CREATE TRIGGER named_transition BEFORE UPDATE ON evidence_package FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["draft>sealed"]','["sealed"]');
DROP TRIGGER IF EXISTS named_transition ON official_fact;
CREATE TRIGGER named_transition BEFORE UPDATE ON official_fact FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["draft>approved", "approved>retracted"]','["retracted"]');
DROP TRIGGER IF EXISTS named_transition ON opportunity_card;
CREATE TRIGGER named_transition BEFORE UPDATE ON opportunity_card FOR EACH ROW EXECUTE FUNCTION geo_transition('status','["候选>评分", "评分>建议", "建议>确认", "确认>在测", "在测>归档"]','["归档"]');
DROP TRIGGER IF EXISTS stable_identity ON brand;
CREATE TRIGGER stable_identity BEFORE UPDATE ON brand FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON user_member;
CREATE TRIGGER stable_identity BEFORE UPDATE ON user_member FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON intent_cluster;
CREATE TRIGGER stable_identity BEFORE UPDATE ON intent_cluster FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON question_pool;
CREATE TRIGGER stable_identity BEFORE UPDATE ON question_pool FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON opportunity_card;
CREATE TRIGGER stable_identity BEFORE UPDATE ON opportunity_card FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON content_asset;
CREATE TRIGGER stable_identity BEFORE UPDATE ON content_asset FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON claim_block;
CREATE TRIGGER stable_identity BEFORE UPDATE ON claim_block FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id','logical_id','version','created_by');
DROP TRIGGER IF EXISTS stable_identity ON probe_batch;
CREATE TRIGGER stable_identity BEFORE UPDATE ON probe_batch FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON probe;
CREATE TRIGGER stable_identity BEFORE UPDATE ON probe FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON probe_result;
CREATE TRIGGER stable_identity BEFORE UPDATE ON probe_result FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON objection;
CREATE TRIGGER stable_identity BEFORE UPDATE ON objection FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON backflow_ticket;
CREATE TRIGGER stable_identity BEFORE UPDATE ON backflow_ticket FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON evidence_package;
CREATE TRIGGER stable_identity BEFORE UPDATE ON evidence_package FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id','logical_id','version','created_by');
DROP TRIGGER IF EXISTS stable_identity ON evidence_item;
CREATE TRIGGER stable_identity BEFORE UPDATE ON evidence_item FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON api_token;
CREATE TRIGGER stable_identity BEFORE UPDATE ON api_token FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON official_fact;
CREATE TRIGGER stable_identity BEFORE UPDATE ON official_fact FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
DROP TRIGGER IF EXISTS stable_identity ON review_queue;
CREATE TRIGGER stable_identity BEFORE UPDATE ON review_queue FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id','object_type','object_id','submitted_by','submitted_at');
DROP TRIGGER IF EXISTS stable_identity ON scoring_snapshot;
CREATE TRIGGER stable_identity BEFORE UPDATE ON scoring_snapshot FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('snapshot_id','tenant_id');
DROP TRIGGER IF EXISTS frozen_configuration ON question_pool;
CREATE TRIGGER frozen_configuration BEFORE UPDATE OR DELETE ON question_pool FOR EACH ROW EXECUTE FUNCTION geo_frozen_configuration();
DROP TRIGGER IF EXISTS frozen_configuration ON scoring_snapshot;
CREATE TRIGGER frozen_configuration BEFORE UPDATE OR DELETE ON scoring_snapshot FOR EACH ROW EXECUTE FUNCTION geo_frozen_configuration();
DROP TRIGGER IF EXISTS preserve_answer ON probe_result;
CREATE TRIGGER preserve_answer BEFORE UPDATE ON probe_result FOR EACH ROW EXECUTE FUNCTION geo_preserve_answer();
DROP TRIGGER IF EXISTS sealed_parent ON evidence_item;
CREATE TRIGGER sealed_parent BEFORE INSERT OR UPDATE OR DELETE ON evidence_item FOR EACH ROW EXECUTE FUNCTION geo_guard_evidence_item();
DROP TRIGGER IF EXISTS lexicon_append ON brand_lexicon;
CREATE TRIGGER lexicon_append BEFORE INSERT ON brand_lexicon FOR EACH ROW EXECUTE FUNCTION geo_guard_lexicon_append();
DROP TRIGGER IF EXISTS product_line ON official_fact;
CREATE TRIGGER product_line BEFORE INSERT OR UPDATE ON official_fact FOR EACH ROW EXECUTE FUNCTION geo_validate_product_line();

DROP TRIGGER IF EXISTS immutable_record ON keyword_pool_snapshot;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON keyword_pool_snapshot FOR EACH ROW EXECUTE FUNCTION geo_reject_change();
DROP TRIGGER IF EXISTS stable_identity ON keyword_raw;
CREATE TRIGGER stable_identity BEFORE UPDATE ON keyword_raw FOR EACH ROW EXECUTE FUNCTION geo_stable_identity('id','tenant_id');
