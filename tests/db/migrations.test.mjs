import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

test("T04迁移覆盖产品§18所有表，且包含审计和预留硬约束", () => {
  const product = readFileSync("docs/GEO产品文档.md", "utf8")
    .split("## 18. 表结构")[1]
    .split("```")[1];
  const names = [...product.matchAll(/^(\w+)\s{2,}/gm)].map((m) => m[1]);
  const sql = readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync("migrations/" + f, "utf8"))
    .join("\n");
  assert.equal(names.length, 29);
  for (const name of names)
    assert.match(
      sql,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\b`, "i"),
      name,
    );
  for (const field of [
    "judge_version",
    "actor_type",
    "agent_run_id",
    "prompt_version",
    "batch_id",
    "lexicon_version",
    "product_line_ref",
  ])
    assert.ok(sql.includes(field), field);
  assert.doesNotMatch(
    sql,
    /\bsearch_volume\s+(?:text|integer|bigint|numeric)/i,
  );
});

test("T04真实Postgres：迁移可重复、fixture经服务层入库、回滚与约束有效", async (t) => {
  const { withPostgres } = await import("../support/postgres-server.mjs");
  const { applyMigrations } = await import(
    "../../src/server/api/migration-service.mjs"
  );
  const { provisionJianzao } = await import(
    "../../src/server/api/fixture-service.mjs"
  );
  const { executeProvisioningOperation } = await import(
    "../../src/server/api/provisioning-service.mjs"
  );
  const { readSharedIndustry, channelCounts } = await import(
    "../../src/server/api/shared-industry.mjs"
  );
  await withPostgres(async (client) => {
    const files = readdirSync("migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({
        name,
        sql: readFileSync("migrations/" + name, "utf8"),
      }));
    const actor = {
      user_id: "migration-admin",
      role: "admin",
      actor_type: "human",
      agent_run_id: null,
      prompt_version: null,
    };
    assert.equal(
      (await applyMigrations({ client, files, actor })).applied.length,
      files.length,
    );
    assert.equal(
      (await applyMigrations({ client, files, actor })).applied.length,
      0,
    );
    const fixture = await provisionJianzao({ client, operator: actor });
    assert.ok(fixture.tenant_id);
    assert.ok(fixture.brand_id);
    const tenants = await client.query("SELECT name FROM tenant WHERE id=$1", [
      fixture.tenant_id,
    ]);
    assert.equal(tenants.rows[0].name, "简造 ERP（虚构测试租户）");
    const approved = await client.query(
      "SELECT status,source_level FROM official_fact WHERE tenant_id=$1",
      [fixture.tenant_id],
    );
    assert.equal(approved.rows[0].status, "approved");
    assert.equal(approved.rows[0].source_level, "L1");
    const reviewed = await client.query(
      "SELECT object_type,submitted_by,decided_by FROM review_queue WHERE tenant_id=$1 AND status='approved'",
      [fixture.tenant_id],
    );
    for (const r of reviewed.rows)
      assert.notEqual(r.submitted_by, r.decided_by);
    assert.ok(reviewed.rows.some((r) => r.object_type === "brand_lexicon"));
    const audit = await client.query(
      "SELECT actor_type,agent_run_id,prompt_version FROM audit_log WHERE tenant_id=$1",
      [fixture.tenant_id],
    );
    assert.ok(audit.rows.length > 0);
    assert.ok(audit.rows.every((r) => r.actor_type === "human"));
    await t.test(
      "所有列注释存在，共享三表没有tenant_id，seed.status无默认",
      async () => {
        const cols = (
          await client.query(
            "SELECT table_name,column_name,is_nullable,column_default,col_description((quote_ident(table_schema)||'.'||quote_ident(table_name))::regclass,ordinal_position) AS note FROM information_schema.columns WHERE table_schema='public' AND table_name<>'schema_migration'",
          )
        ).rows;
        for (const c of cols)
          assert.ok(c.note, `${c.table_name}.${c.column_name}`);
        const product = readFileSync("docs/GEO产品文档.md", "utf8")
          .split("## 18. 表结构")[1]
          .split("```")[1];
        let table;
        for (const line of product.split("\n")) {
          const heading = line.match(/^(\w+)\s{2,}/);
          if (heading) {
            table = heading[1];
            continue;
          }
          if (!table || !/^  [^ -]/.test(line)) continue;
          const fields = line
            .split("--")[0]
            .replace(/\([^)]*\)/g, "")
            .replace(/\[\]/g, "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
          for (const field of fields)
            assert.ok(
              cols.some(
                (c) => c.table_name === table && c.column_name === field,
              ),
              `${table}.${field} from product §18`,
            );
        }
        assert.equal(new Set(cols.map((c) => c.table_name)).size, 29);
        for (const table of new Set(cols.map((c) => c.table_name)))
          if (
            ![
              "tenant",
              "seed_list",
              "keyword_pool_snapshot",
              "industry_score",
            ].includes(table)
          )
            assert.ok(
              cols.some(
                (c) => c.table_name === table && c.column_name === "tenant_id",
              ),
            );

        for (const table of [
          "seed_list",
          "keyword_pool_snapshot",
          "industry_score",
        ])
          assert.ok(
            !cols.some(
              (c) => c.table_name === table && c.column_name === "tenant_id",
            ),
          );
        const status = cols.find(
          (c) => c.table_name === "seed_list" && c.column_name === "status",
        );
        assert.equal(status.is_nullable, "YES");
        assert.equal(status.column_default, null);
        const privateCol = cols.find(
          (c) =>
            c.table_name === "keyword_raw" && c.column_name === "tenant_id",
        );
        assert.equal(privateCol.is_nullable, "NO");
        const seeds = (await client.query("SELECT word,status FROM seed_list"))
          .rows;
        assert.ok(
          seeds.some((s) => s.word === "ai 自动排产" && s.status === null),
        );
      },
    );
    await t.test(
      "重复fixture不复制对象或审核，已应用迁移checksum不可改",
      async () => {
        const count = (await client.query("SELECT count(*) FROM audit_log"))
          .rows[0].count;
        assert.equal(
          (await provisionJianzao({ client, operator: actor })).existing,
          true,
        );
        assert.equal(
          (await client.query("SELECT count(*) FROM audit_log")).rows[0].count,
          count,
        );
        await assert.rejects(
          () =>
            applyMigrations({
              client,
              actor,
              files: [{ ...files[0], sql: files[0].sql + "\n-- changed" }],
            }),
          /Applied migration changed/,
        );
      },
    );
    await t.test("迁移DDL失败回滚，迁移账本不写成功记录", async () => {
      await assert.rejects(
        () =>
          applyMigrations({
            client,
            actor,
            files: [
              {
                name: "9999_rollback.sql",
                sql: readFileSync(
                  "tests/fixtures/migrations/9999_rollback.sql",
                  "utf8",
                ),
              },
            ],
          }),
        /expected migration rollback/,
      );
      assert.equal(
        (
          await client.query(
            "SELECT to_regclass('geo_rollback_marker') AS relation",
          )
        ).rows[0].relation,
        null,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM schema_migration WHERE name='9999_rollback.sql'",
          )
        ).rows[0].count,
        "0",
      );
    });
    const strategy = {
      user_id: "fixture-strategist",
      role: "strategist",
      actor_type: "human",
    };
    const reviewActor = {
      user_id: "fixture-factcheck",
      role: "factcheck",
      actor_type: "human",
    };
    const exec = (operation, who, body, params = {}) =>
      executeProvisioningOperation({
        client,
        operation,
        context: { actor: who, tenant_id: fixture.tenant_id, body, params },
      });
    await t.test("L2官方口径被数据库CHECK拒绝，数据与审计均回滚", async () => {
      const before = (await client.query("SELECT count(*) FROM official_fact"))
        .rows[0].count;
      await assert.rejects(
        () =>
          exec("official_fact.create", strategy, {
            brand_id: fixture.brand_id,
            fact_category: "price",
            content: "虚构测试，不对外",
            source_level: "L2",
            effective_from: "2026-01-01T00:00:00Z",
          }),
        (e) => e.status === 422 && Boolean(e.details.constraint),
      );
      assert.equal(
        (await client.query("SELECT count(*) FROM official_fact")).rows[0]
          .count,
        before,
      );
    });
    await t.test("服务端同人禁令与独立放行，审核终态不重复变更", async () => {
      const fact = await exec("official_fact.create", strategy, {
        brand_id: fixture.brand_id,
        fact_category: "boundary",
        content: "仅供测试的第二条边界",
        source_level: "L1",
        effective_from: "2026-01-01T00:00:00Z",
      });
      await assert.rejects(
        () =>
          exec(
            "official_fact.approve",
            { ...reviewActor, user_id: strategy.user_id },
            {},
            { id: fact.id },
          ),
        (e) => e.status === 403,
      );
      await exec("official_fact.approve", reviewActor, {}, { id: fact.id });
      await assert.rejects(
        () =>
          exec(
            "review_queue.approve",
            reviewActor,
            {},
            { id: fact.review_entry_id },
          ),
        (e) => e.status === 409,
      );
    });
    await t.test("复合外键拒绝跨租户品牌成员关系", async () => {
      const second = await executeProvisioningOperation({
        client,
        operation: "tenant.configure",
        context: {
          actor,
          tenant_id: "fixture-other",
          body: {
            name: "第二测试租户",
            mode: "self",
            plan: "internal-fixture",
          },
        },
      });
      await assert.rejects(
        () =>
          executeProvisioningOperation({
            client,
            operation: "user_member.configure",
            context: {
              actor,
              tenant_id: second.id,
              body: {
                user_id: "wrong-owner",
                role: "owner",
                brand_id: fixture.brand_id,
              },
            },
          }),
        (e) => e.status === 422,
      );
    });
    await t.test("已封版词表不可再次提交，已放行口径不可重复放行", async () => {
      const lex = (
        await client.query(
          "SELECT object_id FROM review_queue WHERE object_type='brand_lexicon' AND status='approved'",
        )
      ).rows[0];
      await assert.rejects(
        () => exec("brand_lexicon.submit", strategy, {}, { id: lex.object_id }),
        (e) => e.status === 409,
      );
      await assert.rejects(
        () =>
          exec(
            "official_fact.approve",
            reviewActor,
            {},
            { id: fixture.official_fact_id },
          ),
        (e) => e.status === 409,
      );
    });
    await t.test(
      "共享写入拒绝客户厂牌/竞品/C私有词句，投影只返公共词根与数值",
      async () => {
        const seed = {
          industry: "B2B",
          word: "简造ERP 客户专属",
          word_type: "场景",
          maintainer: "内部测试维护人",
          last_reviewed_at: "2026-01-01T00:00:00Z",
          seed_version: 2,
        };
        const publicRootCatalog = new Set([
          "B2B\0ai 自动排产",
          `B2B\0${seed.word}`,
        ]);
        await assert.rejects(
          () =>
            executeProvisioningOperation({
              client,
              operation: "seed_list.create",
              publicRootCatalog,
              context: {
                actor: strategy,
                tenant_id: fixture.tenant_id,
                body: seed,
              },
            }),
          (e) => e.status === 422,
        );
        for (const body of [
          { ...seed, id: "简造ERP-private-id", word: "ai 自动排产" },
          { ...seed, word: "仅一个客户会说的C类原话" },
          { ...seed, word: "ai 自动排产", word_type: "竞品" },
          { ...seed, word: "ai 自动排产", status: "active" },
        ])
          await assert.rejects(
            () =>
              executeProvisioningOperation({
                client,
                operation: "seed_list.create",
                publicRootCatalog,
                context: {
                  actor: strategy,
                  tenant_id: fixture.tenant_id,
                  body,
                },
              }),
            (e) => e.status === 422,
          );
        const shared = await readSharedIndustry({
          client,
          actor: strategy,
          industry: "B2B",
          publicRootCatalog,
        });
        assert.ok(shared.seeds.length > 0);
        assert.doesNotMatch(
          JSON.stringify(shared),
          /简造|tenant_id|raw_payload|changelog_note|reliability_note|maintainer/,
        );
        await assert.rejects(
          () =>
            readSharedIndustry({
              client,
              actor: strategy,
              industry: "B2B",
              publicRootCatalog,
              audience: "public",
            }),
          (e) => e.status === 403,
        );
        assert.deepEqual(channelCounts({ A: 1, C: 3 }), { A: 1, C: 3 });
        assert.throws(() => channelCounts({ C: "客户原话" }));
        for (const value of [
          { C: "客户原话" },
          ["客户原话"],
          { tenant_id: 1 },
          { C: -1 },
        ])
          assert.equal(
            (
              await client.query(
                "SELECT geo_numeric_channel_counts($1::jsonb) AS valid",
                [JSON.stringify(value)],
              )
            ).rows[0].valid,
            false,
          );
      },
    );
  });
});
