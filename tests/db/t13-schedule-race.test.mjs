import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { withPostgres } from "../support/postgres-server.mjs";
import { applyMigrations } from "../../src/server/api/migration-service.mjs";
import { registerInstallationAdmin } from "../../src/server/api/installation-service.mjs";
import { connectDatabaseParameters } from "../../src/server/api/database.mjs";
import { createApplication } from "../../src/server/api/application.mjs";
import { prepareScheduleFixture } from "../support/probe-schedule-fixture.mjs";

test("T13双普通连接竞争排期只建一批，数据库拒绝改写排期身份", async () => {
  await withPostgres(async (management) => {
    const settings = {
      host: management.connectionParameters.host,
      port: management.connectionParameters.port,
      database: management.connectionParameters.database,
      user: "geo_app",
    };
    const actor = {
      user_id: "installation-operator",
      role: "admin",
      actor_type: "human",
    };
    const files = readdirSync("migrations")
      .filter((n) => n.endsWith(".sql"))
      .map((name) => ({
        name,
        sql: readFileSync("migrations/" + name, "utf8"),
      }));
    await applyMigrations({ client: management, files, actor });
    await registerInstallationAdmin({ client: management, actor });
    await management.end();
    const clients = await Promise.all([
      connectDatabaseParameters(settings),
      connectDatabaseParameters(settings),
    ]);
    try {
      const secret = randomBytes(32).toString("hex"),
        clock = { now: () => Date.parse("2026-11-10T12:00:00Z") };
      const options = {
        secret,
        now: clock.now,
        publicRootCatalog: new Set(["B2B\0ai 自动排产"]),
        modelCapabilities: (model) =>
          /^fixture-enabled-[0-3]$/.test(model)
            ? {
                nativeSearch: true,
                searchEnabled: true,
                modelVersion: "recorded-v1",
              }
            : null,
      };
      const [a, b] = await Promise.all(
        clients.map((client) => createApplication({ client, ...options })),
      );
      const { f, sets, snapshot } = await prepareScheduleFixture(a, clock);
      const request = {
        actor: f.actors.cs,
        body: {
          type: "baseline",
          snapshot_id: snapshot.snapshot_id,
          scheduled_at: new Date(clock.now()).toISOString(),
          cluster_question_sets: sets,
          schedule: { source_event_id: "two-workers-same-baseline" },
        },
        params: {},
        query: {},
      };
      const results = await Promise.all([
        a.call("probe_batch.create", request),
        b.call("probe_batch.create", request),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        [200, 200],
      );
      assert.equal(results[0].data.id, results[1].data.id);
      const queue = await a.call("probe_batch.read", {
        actor: f.actors.cs,
        body: {},
        params: {},
        query: { view: "scheduled" },
      });
      assert.equal(queue.status, 200);
      assert.equal(queue.data.items.length, 1);
      // Negative infrastructure test only: ordinary-role direct rewrite must
      // fail at the database backstop, never seed or modify business data.
      for (const field of [
        "expedited=true",
        "scheduled_at=scheduled_at+interval '1 day'",
        "cluster_question_sets='[]'::jsonb",
      ]) {
        await clients[0].query("BEGIN");
        await clients[0].query("SELECT set_config('geo.tenant_id',$1,true)", [
          f.tenant_id,
        ]);
        await assert.rejects(
          clients[0].query(`UPDATE probe_batch SET ${field} WHERE id=$1`, [
            results[0].data.id,
          ]),
          (e) => e.code === "23514",
        );
        await clients[0].query("ROLLBACK");
      }
      const unchanged = await a.call("probe_batch.read", {
        actor: f.actors.cs,
        params: { id: results[0].data.id },
      });
      assert.equal(unchanged.status, 200);
      assert.equal(unchanged.data.expedited, false);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });
});
