import { requestCredential } from "./seed-http.mjs";
import { createWorkerRuntime } from "./worker-runtime.mjs";

export async function readQuestionWorkbench(
  headers,
  { brand, cluster_id, version },
) {
  let runtime;
  try {
    const credential = requestCredential(headers);
    runtime = await createWorkerRuntime(credential);
    const app = runtime.application,
      actor = app.actorFromCredential(credential);
    const params = { tid: actor.tenant_id, bid: brand.id };
    const call = async (operation, query) => {
      const response = await app.call(operation, { actor, params, query });
      if (response.status !== 200)
        throw new Error(
          response.status === 403 ? "无问句池访问权限" : "问句池暂不可用",
        );
      return response.data;
    };
    const all = async (operation, query) => {
      const items = [];
      let cursor, next_version;
      do {
        const data = await call(operation, {
          ...query,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        items.push(...data.items);
        cursor = data.next_cursor;
        next_version = data.next_version;
      } while (cursor);
      return { items, next_version };
    };
    const clusters = await all("intent_cluster.read", {});
    const selected = cluster_id
      ? clusters.items.find((c) => c.id === cluster_id)
      : (clusters.items.find((c) => c.status === "active") ??
        clusters.items[0]);
    if (cluster_id && !selected) return { error: "该簇不在当前可见范围" };
    const versions = await all("question_pool.read", { view: "versions" });
    const latest = versions.items[0]?.question_pool_version;
    const selectedVersion = version == null ? latest : Number(version);
    if (
      version != null &&
      (!/^[1-9]\d*$/.test(String(version)) ||
        !Number.isSafeInteger(selectedVersion) ||
        selectedVersion > 2147483647)
    )
      return { error: "版本无效" };
    const questions =
      selected && selectedVersion != null
        ? await all("question_pool.read", {
            view: "list",
            cluster_id: selected.id,
            question_pool_version: selectedVersion,
          })
        : { items: [] };
    const canWrite =
      actor.role === "strategist" && actor.actor_type === "human";
    const sources = canWrite
      ? await all("keyword_raw.read", {
          industry: brand.industry,
          provenance_ready: "true",
        })
      : { items: [] };
    return {
      clusters: clusters.items,
      cluster_id: selected?.id ?? null,
      versions: versions.items,
      version: selectedVersion ?? versions.next_version ?? 1,
      next_version: versions.next_version ?? 1,
      questions: questions.items,
      sources: sources.items,
    };
  } catch (error) {
    return {
      error:
        error.message === "无问句池访问权限" ? error.message : "问句池暂不可用",
    };
  } finally {
    if (runtime) await runtime.close();
  }
}
