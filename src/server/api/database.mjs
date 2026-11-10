import pg from "pg";
// Runtime callers pass the Hyperdrive binding; the administrative migration CLI
// passes its explicitly configured direct Postgres URL. Never log this value.
export async function connectDatabase(binding) {
  if (!binding?.connectionString)
    throw new Error("PostgreSQL connectionString is required");
  const client = new pg.Client({ connectionString: binding.connectionString });
  await client.connect();
  return client;
}
