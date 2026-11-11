import { connectDatabase } from "../src/server/api/database.mjs";
import { createApplication } from "../src/server/api/application.mjs";
import { provisionJianzao } from "../src/server/api/fixture-service.mjs";

const connectionString = process.env.GEO_APPLICATION_DATABASE_URL;
if (!connectionString)
  throw new Error(
    "Set GEO_APPLICATION_DATABASE_URL to the non-owner geo_app database connection",
  );
const client = await connectDatabase({ connectionString });
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
  const result = await provisionJianzao({ application, operator });
  console.log(JSON.stringify(result));
} finally {
  await client.end();
}
