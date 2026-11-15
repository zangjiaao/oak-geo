import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { withPostgres } from "../support/postgres-server.mjs";
const run = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const scripts = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).scripts;
const environment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GEO_") &&
        !key.startsWith("PG") &&
        !["DATABASE_URL", "NODE_OPTIONS", "NODE_PATH"].includes(key),
    ),
  );
function invoke(name, cwd, extra = {}) {
  const [node, ...args] = scripts[name].split(" ");
  assert.equal(node, "node");
  args[args.length - 1] = resolve(root, args.at(-1));
  return run(process.execPath, args, {
    cwd,
    env: { ...environment(), ...extra },
    timeout: 30000,
  });
}

test("CLI从.dev.vars加载迁移/普通fixture连接与身份，显式环境变量优先且不打印密钥", async () => {
  await withPostgres(async (management) => {
    const dir = mkdtempSync(join(tmpdir(), "oak-cli-env-"));
    try {
      const host = encodeURIComponent(management.connectionParameters.host),
        port = management.connectionParameters.port;
      const owner = `postgresql://postgres@localhost/postgres?host=${host}&port=${port}`;
      const ordinary = `postgresql://geo_app@localhost/postgres?host=${host}&port=${port}`;
      const secret = randomBytes(32).toString("hex");
      writeFileSync(
        join(dir, ".dev.vars"),
        `# dotenv syntax, not shell execution\nDATABASE_URL='${owner}'\nGEO_APPLICATION_DATABASE_URL="${ordinary}"\nGEO_SESSION_SECRET=${secret}\nGEO_MIGRATION_ACTOR=file-operator\n`,
        { mode: 0o600 },
      );
      const migrated = await invoke("db:migrate", dir);
      assert.ok(
        JSON.parse(migrated.stdout).applied.includes(
          "0014_question_versions.sql",
        ),
      );
      const rows = (
        await management.query(
          "SELECT DISTINCT applied_by FROM schema_migration",
        )
      ).rows;
      assert.deepEqual(rows, [{ applied_by: "file-operator" }]);
      const fixture = await invoke("db:fixture", dir);
      assert.equal(JSON.parse(fixture.stdout).tenant_id, "fixture-jianzao");
      const repeated = await invoke("db:migrate", dir, {
        GEO_MIGRATION_ACTOR: "shell-operator",
      });
      assert.deepEqual(JSON.parse(repeated.stdout).applied, []);
      assert.equal(
        (
          await management.query(
            "SELECT user_id FROM auth_installation_admin WHERE user_id=$1",
            ["shell-operator"],
          )
        ).rowCount,
        1,
      );
      rmSync(join(dir, ".dev.vars"));
      const explicit = await invoke("db:migrate", dir, {
        DATABASE_URL: owner,
        GEO_MIGRATION_ACTOR: "file-operator",
      });
      assert.deepEqual(JSON.parse(explicit.stdout).applied, []);
      const explicitFixture = await invoke("db:fixture", dir, {
        GEO_APPLICATION_DATABASE_URL: ordinary,
        GEO_SESSION_SECRET: secret,
        GEO_MIGRATION_ACTOR: "file-operator",
      });
      assert.equal(JSON.parse(explicitFixture.stdout).existing, true);
      const output = [migrated, fixture, repeated, explicit, explicitFixture]
        .map((r) => r.stdout + r.stderr)
        .join("\n");
      assert.ok(
        !output.includes(secret),
        "CLI must not print the session secret",
      );
      assert.ok(
        !output.includes(owner),
        "CLI must not print the migration connection",
      );
      assert.ok(
        !output.includes(ordinary),
        "CLI must not print the runtime connection",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("CLI缺少目标连接则拒绝；fixture不回退到管理连接", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oak-cli-missing-"));
  try {
    await assert.rejects(
      invoke("db:migrate", dir),
      (e) => e.code === 1 && /Set DATABASE_URL/.test(e.stderr),
    );
    await assert.rejects(
      invoke("db:fixture", dir, {
        DATABASE_URL: "postgresql://migration-only.invalid/not-used",
      }),
      (e) => e.code === 1 && /Set GEO_APPLICATION_DATABASE_URL/.test(e.stderr),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
