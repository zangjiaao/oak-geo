import {
  mkdtempSync,
  mkdirSync,
  chmodSync,
  chownSync,
  cpSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
const run = promisify(execFile);

// Real PostgreSQL, isolated under /tmp; Unix socket only, never Neon/production.
// Root containers use existing nobody instead of creating an OS user.
export async function withPostgres(fn) {
  if (process.platform === "win32")
    throw new Error(
      "This isolated DB harness requires Unix; run in the project Linux dev environment",
    );
  const platform = await import(
    `@embedded-postgres/${process.platform}-${process.arch}`
  );
  const root = mkdtempSync(join(tmpdir(), "oak-geo-pg-"));
  chmodSync(root, 0o755);
  const bundle = join(root, "native");
  cpSync(dirname(dirname(platform.postgres)), bundle, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const data = join(root, "data"),
    socket = join(root, "socket");
  mkdirSync(data);
  mkdirSync(socket);
  const asUser = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
  if (asUser.uid) {
    chownSync(data, asUser.uid, asUser.gid);
    chownSync(socket, asUser.uid, asUser.gid);
  }
  chmodSync(data, 0o700);
  chmodSync(socket, 0o700);
  const bin = (name) => join(bundle, "bin", name);
  let server,
    client,
    log = "";
  try {
    await run(
      bin("initdb"),
      [
        "-D",
        data,
        "-U",
        "postgres",
        "-A",
        "trust",
        "--no-locale",
        "--encoding=UTF8",
      ],
      { ...asUser, timeout: 20000 },
    );
    server = spawn(
      bin("postgres"),
      ["-D", data, "-k", socket, "-h", "", "-F"],
      { ...asUser, stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stdout.on("data", (b) => {
      log += b;
    });
    server.stderr.on("data", (b) => {
      log += b;
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      client = new pg.Client({
        host: socket,
        user: "postgres",
        database: "postgres",
        port: 5432,
      });
      try {
        await client.connect();
        ready = true;
        break;
      } catch {
        await client.end().catch(() => {});
        if (server.exitCode !== null) break;
        await delay(50);
      }
    }
    if (!ready)
      throw new Error("Postgres failed to start: " + log.slice(-1500));
    return await fn(client);
  } finally {
    if (client) await client.end().catch(() => {});
    if (server?.exitCode === null)
      await run(bin("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], {
        ...asUser,
        timeout: 10000,
      }).catch(() => {
        server.kill("SIGKILL");
      });
    rmSync(root, { recursive: true, force: true });
  }
}
