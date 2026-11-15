import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("本地Compose数据库仅回环监听，保留密码鉴权和18版数据卷；不通过容器初始化写业务数据", () => {
  const compose = readFileSync("compose.yaml", "utf8");
  assert.match(compose, /host_ip: 127\.0\.0\.1/);
  assert.doesNotMatch(compose, /host_ip: (?:0\.0\.0\.0|::)|network_mode: host/);
  assert.match(compose, /image: postgres:18\s/);
  assert.match(compose, /POSTGRES_USER: postgres/);
  assert.doesNotMatch(compose, /POSTGRES_HOST_AUTH_METHOD|docker-entrypoint-initdb\.d|GEO_SESSION_SECRET|DATABASE_URL/);
  assert.match(compose, /target: \/var\/lib\/postgresql\s/);
  assert.match(compose, /pg_isready -h 127\.0\.0\.1/);
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.match(scripts["db:up"], /--env-file \.dev\.vars up -d --wait postgres$/);
  assert.match(scripts["db:down"], /--env-file \.dev\.vars down$/);
  assert.ok(!scripts["db:down"].includes("--volumes"));
  assert.match(scripts["db:password"], /\\password geo_app/);
  assert.doesNotMatch(scripts["db:password"], /ALTER ROLE|CREATE ROLE|BYPASSRLS/);
});
