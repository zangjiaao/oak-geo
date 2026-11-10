import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

test("T04复核：pg与嵌入式平台包保留在生产依赖树", () => {
  const manifest = readJson("package.json");
  const lock = readJson("package-lock.json");
  for (const name of ["pg", "embedded-postgres"]) {
    assert.ok(
      manifest.dependencies[name],
      `${name} must be a production dependency`,
    );
    assert.ok(!manifest.devDependencies[name]);
    assert.ok(!lock.packages[`node_modules/${name}`].dev);
  }
  const platforms = Object.entries(lock.packages).filter(([name]) =>
    name.startsWith("node_modules/@embedded-postgres/"),
  );
  assert.ok(platforms.length > 0);
  for (const [name, pkg] of platforms)
    assert.ok(!pkg.dev, `${name} must survive --omit=dev`);
});

test("T04复核：机会卡DB/API映射与冻结契约一一对应", async () => {
  const {
    opportunityStatusToDatabase: toDb,
    opportunityStatusToApi: toApi,
    opportunityStatusMap,
  } = await import("../../src/server/api/opportunity-status.mjs");
  const states = readJson("docs/api/contracts.json").states.opportunity_card;
  assert.deepEqual(Object.values(opportunityStatusMap), states.states);
  assert.equal(
    new Set(Object.values(opportunityStatusMap)).size,
    states.states.length,
  );
  for (const [db, api] of Object.entries(opportunityStatusMap)) {
    assert.match(db, /^[a-z_]+$/);
    assert.equal(toDb(api), db);
    assert.equal(toApi(db), api);
  }
  assert.throws(
    () => toDb("unapproved_state"),
    (e) => e.status === 422,
  );
  assert.throws(
    () => toApi("unapproved_state"),
    (e) => e.status === 422,
  );
});

test("T04复核：真实PG机会卡枚举、默认值及迁移边与映射一致", async () => {
  const { withPostgres } = await import("../support/postgres-server.mjs");
  const { applyMigrations } = await import(
    "../../src/server/api/migration-service.mjs"
  );
  const { opportunityStatusToDatabase: toDb, opportunityStatusMap } =
    await import("../../src/server/api/opportunity-status.mjs");
  const states = readJson("docs/api/contracts.json").states.opportunity_card;
  await withPostgres(async (client) => {
    const files = readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => ({
        name,
        sql: readFileSync(`migrations/${name}`, "utf8"),
      }));
    const actor = {
      user_id: "review-migration-admin",
      role: "admin",
      actor_type: "human",
    };
    await applyMigrations({ client, files, actor });
    const args = (
      await client.query(
        "SELECT tgargs FROM pg_trigger WHERE tgrelid='opportunity_card'::regclass AND tgname='named_transition'",
      )
    ).rows[0].tgargs
      .toString()
      .split("\0");
    assert.deepEqual(
      JSON.parse(args[1]),
      states.transitions.map((t) => `${toDb(t.from)}>${toDb(t.to)}`),
    );
    assert.deepEqual(JSON.parse(args[2]), states.terminal.map(toDb));
    const col = (
      await client.query(
        "SELECT column_default FROM information_schema.columns WHERE table_name='opportunity_card' AND column_name='status'",
      )
    ).rows[0];
    assert.equal(col.column_default, "'candidate'::text");
    const constraints = (
      await client.query(
        "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='opportunity_card'::regclass AND conname='opportunity_card_status_check'",
      )
    ).rows[0].definition;
    for (const db of Object.keys(opportunityStatusMap))
      assert.ok(constraints.includes(`'${db}'`), db);
    assert.doesNotMatch(constraints, /候选|评分|建议|确认|在测|归档/);
    assert.equal(
      (await applyMigrations({ client, files, actor })).applied.length,
      0,
    );
  });
});
