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

// Used by an isolated test environment; production passes Hyperdrive connectionString.
export async function connectDatabaseParameters(parameters) {
  const client = new pg.Client(parameters);
  await client.connect();
  return client;
}
