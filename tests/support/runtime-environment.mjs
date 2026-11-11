import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { withPostgres } from "./postgres-server.mjs";
import { applyMigrations } from "../../src/server/api/migration-service.mjs";
import { registerInstallationAdmin } from "../../src/server/api/installation-service.mjs";
import { connectDatabaseParameters } from "../../src/server/api/database.mjs";
import { createApplication } from "../../src/server/api/application.mjs";
import { assertRuntimeConnection } from "../../src/server/api/runtime-connection.mjs";

// Infrastructure-only owner connection: schema + provider's installation subject.
// It is closed BEFORE application, fixture registry or driver are handed out.
export async function startRuntimeEnvironment(options = {}) {
  let readyResolve, readyReject, stopResolve;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const stopped = new Promise((resolve) => {
    stopResolve = resolve;
  });
  const lifecycle = withPostgres(async (management) => {
    const settings = {
      host: management.connectionParameters.host,
      port: management.connectionParameters.port,
      database: management.connectionParameters.database,
    };
    const actor = {
      user_id: "installation-operator",
      role: "admin",
      actor_type: "human",
    };
    const files = readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => ({
        name,
        sql: readFileSync("migrations/" + name, "utf8"),
      }));
    await applyMigrations({ client: management, files, actor });
    await registerInstallationAdmin({ client: management, actor });
    await management.end();
    const client = await connectDatabaseParameters({
      ...settings,
      user: "geo_app",
    });
    let currentTime = Date.parse("2026-11-10T12:00:00Z");
    const clock = Object.freeze({
      now: () => currentTime,
      advanceDays: (days) => {
        currentTime += days * 86400_000;
      },
    });
    try {
      const application = await createApplication({
        client,
        secret: randomBytes(32).toString("hex"),
        now: clock.now,
        modelCapabilities: (model, grounding) =>
          /^fixture-(enabled|disabled)-[0-3]$/.test(model)
            ? {
                nativeSearch: true,
                searchEnabled:
                  grounding === "search_off"
                    ? false
                    : model.startsWith("fixture-enabled-"),
                modelVersion: "recorded-v1",
              }
            : null,
        publicRootCatalog: new Set([
          "B2B\0ai 自动排产",
          ...Array.from({ length: 4 }, (_, i) => "B2B\0公开词根" + (i + 1)),
        ]),
        observe: (phase, detail) => {
          if (phase === "failure" && process.env.GEO_TEST_TRACE)
            process.stderr.write(JSON.stringify(detail) + "\n");
          options.observe?.(phase, detail);
        },
        beforeAudit: options.beforeAudit,
        limits: options.limits,
      });
      readyResolve(
        Object.freeze({
          application,
          clock,
          inspectSecurity: () => application.inspectSecurity(),
          assertManagementRejected: async () => {
            const owner = await connectDatabaseParameters({
              ...settings,
              user: "postgres",
            });
            try {
              await assertRuntimeConnection(owner);
            } finally {
              await owner.end();
            }
          },
        }),
      );
      await stopped;
    } finally {
      await client.end();
    }
  });
  lifecycle.catch(readyReject);
  try {
    const env = await ready;
    return Object.freeze({
      ...env,
      close: async () => {
        stopResolve();
        await lifecycle;
      },
    });
  } catch (error) {
    stopResolve();
    await lifecycle.catch(() => {});
    throw error;
  }
}

// Migration tests keep their inspection connection; fixture work is isolated on geo_app.
export async function openRuntimeOnDatabase(management, actor) {
  await registerInstallationAdmin({ client: management, actor });
  const client = await connectDatabaseParameters({
    host: management.connectionParameters.host,
    port: management.connectionParameters.port,
    database: management.connectionParameters.database,
    user: "geo_app",
  });
  try {
    const application = await createApplication({
      client,
      secret: randomBytes(32).toString("hex"),
      publicRootCatalog: new Set(["B2B\0ai 自动排产"]),
    });
    return { application, close: () => client.end() };
  } catch (e) {
    await client.end();
    throw e;
  }
}
