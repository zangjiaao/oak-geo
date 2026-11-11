import { connectDatabase } from "../src/server/api/database.mjs";
import { provisionJianzao } from "../src/server/api/fixture-service.mjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error(
    "Set DATABASE_URL explicitly to the intended development database",
  );
const client = await connectDatabase({ connectionString });
try {
  const result = await provisionJianzao({
    client,
    operator: {
      user_id: process.env.GEO_MIGRATION_ACTOR ?? "local-fixture-admin",
      role: "admin",
      actor_type: "human",
    },
  });
  console.log(JSON.stringify(result));
} finally {
  await client.end();
}
