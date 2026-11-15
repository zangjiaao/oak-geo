import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
const req = (actor, body = {}, id, query = {}) => ({
  actor,
  body,
  params: id ? { id } : {},
  query,
});
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data;
};
const policy = {
  version: "contacts_v1",
  verified: true,
  dictionary_complete: true,
  reviewed_by: "合规审核人（虚构）",
  reviewed_at: "2026-01-01T00:00:00Z",
  names: ["张三"],
  addresses: ["北京市海淀区1号"],
};
const sensitive =
  "張三住北京市海淀区1号，电话１３８００１３８０００，邮箱 zhang@example.com，身份证11010519491231002X";

test("T09下载模板填入观测后可经真实导入服务处理，C模板不索取来源URL", async () => {
  const { keywordImportFields, keywordImportTemplate } = await import(
    "../../src/lib/keyword-import-template.mjs"
  );
  let authorization;
  const env = await startRuntimeEnvironment({
    resolveImportAuthorization: async () => authorization,
  });
  try {
    const app = env.application;
    const f = await createFixtureRegistry(app, { clock: env.clock }).fixture("snapshot-input");
    authorization = {
      tenant_id: f.tenant_id, ref: "template-auth", document_ref: "written-template-auth",
      active: true, redaction_policy: policy,
    };
    const values = {
      keyword: "模板回归测试词", collected_at: "2026-01-01T00:00:00Z",
      demand_index: "", trend_dir: "", excerpt: "虚构测试摘录",
      source_url: "https://example.com/observation",
    };
    for (const channel of ["A", "B", "C", "D"]) {
      const fields = keywordImportFields(channel);
      assert.equal(fields.some((field) => field.key === "source_url"), channel !== "C");
      const template = keywordImportTemplate(channel);
      assert.ok(template.startsWith("\uFEFFkeyword,collected_at,"));
      // The downloadable template is blank: it must not create fabricated observations.
      assert.equal(template.trim().split(/\r?\n/).length, 1);
      const row = fields.map((field) => values[field.key]).join(",") + "\r\n";
      const result = ok(await app.call("keyword_raw.import", req(f.actors.strategist, {
        industry: "B2B", channel, csv: template + row,
        ...(channel === "C" ? { authorization_ref: "template-auth" } : {}),
      })));
      assert.equal(result.added, 1);
      assert.equal(result.rejected, 0);
    }
    const unknownHeaders = await app.call("keyword_raw.import", req(f.actors.strategist, {
      industry: "B2B", channel: "B", csv: "名称,时间\n任意列名,2026-01-01T00:00:00Z\n",
    }));
    assert.equal(unknownHeaders.status, 422);
  } finally { await env.close(); }
});

test("T09 CSV按租户/行业/渠道精确去重并回报新增重复拒绝，首见取最早", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    const body = {
      industry: "B2B",
      channel: "B",
      csv: 'keyword,collected_at,demand_index\r\n"ＥＲＰ，系統！",2026-02-01T00:00:00Z,20\r\nerp 系统,2026-02-01T00:00:00Z,20\r\n另一个词,2026-02-01T00:00:00Z,10\r\n坏指数,2026-02-01T00:00:00Z,NaN\r\n',
    };
    const report = ok(
      await app.call("keyword_raw.import", req(f.actors.strategist, body), {
        idempotencyKey: "csv-once",
      }),
    );
    assert.equal(report.added, 2);
    assert.equal(report.duplicate, 1);
    assert.equal(report.rejected, 1);
    assert.deepEqual(
      ok(
        await app.call("keyword_raw.import", req(f.actors.strategist, body), {
          idempotencyKey: "csv-once",
        }),
      ),
      report,
    );
    const again = ok(
      await app.call("keyword_raw.import", req(f.actors.strategist, body)),
    );
    assert.equal(again.added, 0);
    assert.equal(again.duplicate, 3);
    assert.equal(again.rejected, 1);
    assert.equal(
      ok(
        await app.call(
          "keyword_raw.import",
          req(f.actors.strategist, {
            industry: "B2B",
            channel: "B",
            keyword: "erp 系统",
            collected_at: "2026-01-01T00:00:00Z",
          }),
        ),
      ).added,
      1,
    );
    const read = ok(
      await app.call("keyword_raw.read", req(f.actors.strategist)),
    );
    const row = read.items.find((row) => row.keyword.includes("ＥＲＰ"));
    assert.ok(row);
    assert.equal(row.first_seen_at, "2026-01-01T00:00:00.000Z");
    const otherChannel = ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "A",
          keyword: "ERP 系统",
          collected_at: "2026-02-01T00:00:00Z",
        }),
      ),
    );
    assert.equal(otherChannel.added, 1);
    assert.notEqual(otherChannel.id, row.id);
    const other = await createFixtureRegistry(app, {
      clock: env.clock,
    }).fixture("snapshot-input");
    assert.equal(
      ok(
        await app.call(
          "keyword_raw.import",
          req(other.actors.strategist, {
            industry: "B2B",
            channel: "B",
            keyword: "ERP 系统",
            collected_at: "2026-02-01T00:00:00Z",
          }),
        ),
      ).added,
      1,
    );
  } finally {
    await env.close();
  }
});

test("T09 C类先验权再脱敏：结构化身份列不入库，原文/报表/审计不泄露PII", async () => {
  const authorizations = new Map();
  const env = await startRuntimeEnvironment({
    resolveImportAuthorization: async ({ tenant_id, authorization_ref }) =>
      authorizations.get(tenant_id + ":" + authorization_ref),
  });
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    const body = {
      industry: "B2B",
      channel: "C",
      authorization_ref: "auth1",
      reason: sensitive,
      csv: `keyword,collected_at,customer_name,address\n"${sensitive}",2026-01-01T00:00:00Z,张三,北京市海淀区1号\n`,
    };
    assert.equal(
      (await app.call("keyword_raw.import", req(f.actors.strategist, body)))
        .status,
      403,
    );
    authorizations.set(f.tenant_id + ":auth1", {
      tenant_id: f.tenant_id,
      ref: "auth1",
      document_ref: "signed-document-1",
      active: true,
      redaction_policy: policy,
    });
    const report = ok(
      await app.call("keyword_raw.import", req(f.actors.strategist, body)),
    );
    assert.equal(report.added, 1);
    const read = ok(
      await app.call("keyword_raw.read", req(f.actors.strategist)),
    );
    const row = read.items.find((row) => row.channel === "C");
    assert.ok(row);
    const raw = ok(
      await app.call(
        "keyword_raw.read_raw",
        req(f.actors.strategist, {}, row.id),
      ),
    );
    const audit = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, undefined, { limit: 100 }),
      ),
    );
    for (const value of [report, read, raw, audit])
      assert.doesNotMatch(
        JSON.stringify(value),
        /张三|張三|海淀区1号|13800138000|１３８００１３８０００|zhang@example\.com|11010519491231002X/,
      );
    assert.ok(row.keyword.includes("[姓名]"));
    assert.ok(row.keyword.includes("[地址]"));
    assert.ok(row.keyword.includes("[手机号]"));
    assert.equal(raw.redacted_payload.customer_name, undefined);
    assert.equal(raw.redacted_payload.address, undefined);
    authorizations.get(f.tenant_id + ":auth1").redaction_policy = null;
    assert.equal(
      (await app.call("keyword_raw.import", req(f.actors.strategist, body)))
        .status,
      422,
    );
  } finally {
    await env.close();
  }
});

test("T09 csv_ref与书面授权均绑定租户，c_import仅能导入已授权C批次", async () => {
  const auth = new Map(),
    files = new Map();
  const env = await startRuntimeEnvironment({
    resolveImportAuthorization: async ({ tenant_id, authorization_ref }) =>
      auth.get(tenant_id + ":" + authorization_ref),
    loadImportCsv: async ({ csv_ref }) => files.get(csv_ref),
  });
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    files.set("upload1", {
      tenant_id: "other-tenant",
      content: "keyword,collected_at\na,2026-01-01T00:00:00Z",
    });
    assert.equal(
      (
        await app.call(
          "keyword_raw.import",
          req(f.actors.strategist, {
            industry: "B2B",
            channel: "B",
            csv_ref: "upload1",
          }),
        )
      ).status,
      403,
    );
    files.set("upload1", {
      tenant_id: f.tenant_id,
      content: "keyword,collected_at\n工单需求,2026-01-01T00:00:00Z",
    });
    auth.set(f.tenant_id + ":auth1", {
      tenant_id: "other-tenant",
      ref: "auth1",
      active: true,
      document_ref: "doc",
      redaction_policy: policy,
    });
    const body = {
      industry: "B2B",
      channel: "C",
      csv_ref: "upload1",
      authorization_ref: "auth1",
    };
    assert.equal(
      (await app.call("keyword_raw.import", req(f.actors.strategist, body)))
        .status,
      403,
    );
    auth.get(f.tenant_id + ":auth1").tenant_id = f.tenant_id;
    const job = app.issueActor({
      user_id: "job-c_import",
      tenant_id: f.tenant_id,
      role: "system",
      actor_type: "system",
      job_name: "c_import",
      trigger_source: { event_id: "upload1" },
    });
    assert.equal(
      ok(await app.call("keyword_raw.import", req(job, body))).added,
      1,
    );
    assert.equal(
      (
        await app.call(
          "keyword_raw.import",
          req(job, { ...body, channel: "B" }),
        )
      ).status,
      403,
    );
    auth.get(f.tenant_id + ":auth1").active = false;
    assert.equal(
      (await app.call("keyword_raw.import", req(f.actors.strategist, body)))
        .status,
      403,
    );
  } finally {
    await env.close();
  }
});

test("T09 坏CSV/绝对搜索量字段拒绝；行内改渠道不能绕过C闸门，拒绝报表不回显原文", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    for (const csv of ['keyword\n"broken', "search_volume,keyword\n200,词"])
      assert.equal(
        (
          await app.call(
            "keyword_raw.import",
            req(f.actors.strategist, { industry: "B2B", channel: "B", csv }),
          )
        ).status,
        422,
      );
    assert.equal(
      (
        await app.call(
          "keyword_raw.import",
          req(f.actors.strategist, {
            industry: "B2B",
            channel: "B",
            keyword: "nul-source",
            collected_at: "2026-01-01T00:00:00Z",
            raw_payload: { text: "\0" },
          }),
        )
      ).status,
      422,
    );
    const report = ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "B",
          csv: `keyword,collected_at,channel\n"${sensitive}",2026-01-01T00:00:00Z,C`,
        }),
      ),
    );
    assert.equal(report.added, 0);
    assert.equal(report.rejected, 1);
    assert.doesNotMatch(JSON.stringify(report), /张三|張三|zhang@example/);
  } finally {
    await env.close();
  }
});
