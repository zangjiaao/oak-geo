import { createFixtureRegistry } from "./fixture-registry.mjs";
// Real service calls only; no SQL/connection or pre-completed batch shortcut.
export async function prepareScheduleFixture(app, clock) {
  const registry = createFixtureRegistry(app, { clock });
  const f = await registry.fixture("snapshot-input");
  const call = async (operation, actor, body = {}, params = {}) => {
    const result = await app.call(operation, {
      actor,
      body,
      params,
      query: {},
    });
    if (result.status !== 200) throw new Error(JSON.stringify(result.error));
    return result.data;
  };
  const weekly = app.issueActor({
    user_id: "job-weekly_pool",
    tenant_id: f.tenant_id,
    role: "system",
    actor_type: "system",
    job_name: "weekly_pool",
    trigger_source: { event_id: "t13-fixture" },
  });
  const sets = [];
  for (let i = 0; i < 30; i++) {
    const cluster = await call("intent_cluster.transition", weekly, {
      brand_id: f.brand_id,
      name: `T13公开测试簇${i}`,
      intent_type: "认知",
      pool_version: f.poolVersion,
    });
    const question_ids = [];
    for (let j = 0; j < 3; j++)
      question_ids.push(
        (
          await call("question_pool.create", f.actors.strategist, {
            cluster_id: cluster.id,
            question: `T13测试问句${i}-${j}`,
            source_word_id: f.sourceId,
            intent_type: "认知",
            source_channel: "B",
            collected_at: new Date(clock.now()).toISOString(),
            maintainer: "张三（虚构）",
            question_pool_version: 1,
          })
        ).id,
      );
    sets.push({
      cluster_id: cluster.id,
      question_pool_version: 1,
      question_ids,
    });
  }
  await call("question_pool.freeze", f.actors.strategist, {
    cluster_id: sets[0].cluster_id,
    question_pool_version: 1,
  });
  for (const set of sets)
    await call("question_pool.upgrade_anchor", f.actors.strategist, {
      ...set,
      reason: "T13隔离测试首次入测",
    });
  const snapshot = await call("scoring_snapshot.create", f.actors.cs, f.config);
  await call(
    "scoring_snapshot.freeze",
    f.actors.cs,
    {},
    { id: snapshot.snapshot_id },
  );
  return { f, registry, sets, snapshot };
}
