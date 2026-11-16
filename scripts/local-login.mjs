import { connectDatabase } from "../src/server/api/database.mjs";
import { createApplication } from "../src/server/api/application.mjs";
import { prepareLocalAcceptance } from "../src/server/api/local-acceptance.mjs";

if (process.env.NODE_ENV === "production")
  throw new Error("Local acceptance is disabled in production");
const args = process.argv.slice(2);
if (
  args.length > 2 ||
  args.some((arg) => !arg.startsWith("--origin=") && !arg.startsWith("--role="))
)
  throw new Error("Only --origin and --role are supported");
const role =
  args.find((arg) => arg.startsWith("--role="))?.slice(7) ?? "strategist";
if (!["strategist", "owner", "factcheck"].includes(role))
  throw new Error(
    "Only fixture strategist/owner/factcheck roles are supported",
  );
const origin = new URL(
  args.find((arg) => arg.startsWith("--origin="))?.slice(9) ??
    "http://localhost:3000",
);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("Use a loopback origin only");
if (!process.env.GEO_APPLICATION_DATABASE_URL)
  throw new Error(
    "Set GEO_APPLICATION_DATABASE_URL in .dev.vars to the non-owner geo_app connection; run npm run db:migrate first",
  );
if ((process.env.GEO_SESSION_SECRET ?? "").length < 32)
  throw new Error(
    "Set GEO_SESSION_SECRET in .dev.vars (at least 32 characters)",
  );
const client = await connectDatabase({
  connectionString: process.env.GEO_APPLICATION_DATABASE_URL,
});
try {
  const application = await createApplication({
    client,
    secret: process.env.GEO_SESSION_SECRET,
    publicRootCatalog: new Set(["B2B\0ai 自动排产"]),
  });
  const operator = application.issueActor({
    user_id: process.env.GEO_MIGRATION_ACTOR ?? "local-migration-admin",
    tenant_id: "fixture-jianzao",
    role: "admin",
    actor_type: "human",
  });
  const result = await prepareLocalAcceptance({ application, operator });
  // Fragment is not sent in HTTP requests/access logs. It is a bearer link:
  // operator output only; never print the secret or either database URI.
  const chosen = application.issueActor({
    tenant_id: result.tenant_id,
    user_id: "fixture-" + role,
    role,
    actor_type: "human",
    ...(["owner"].includes(role) ? { brand_id: result.brand_id } : {}),
  });
  const checked = await application.call("brand.read", {
    actor: chosen,
    params: {
      tid: result.tenant_id,
      bid: result.brand_id,
      id: result.brand_id,
    },
  });
  if (checked.status !== 200)
    throw new Error("Fixture role is not currently granted");
  console.log(
    `本地演示账号：简造 ERP / ${role}。请勿分享此登录链接（24 小时有效）。`,
  );
  console.log(`${origin.origin}/account#session=${chosen.credential}`);
} finally {
  await client.end();
}
