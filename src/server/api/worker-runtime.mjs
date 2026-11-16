import { createApplication } from "./application.mjs";
import { connectDatabase } from "./database.mjs";
import { createIdentityAuthority } from "./identity.mjs";
import { requestCredential } from "./seed-http.mjs";
import { readWorkspaceContext } from "./workspace-context.mjs";
import { productionModelCapabilities } from "./probe-model-candidates.mjs";

async function bindings() {
  let cf = {};
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    cf = (await getCloudflareContext({ async: true })).env;
  } catch {}
  return { ...process.env, ...cf };
}
export async function createWorkerRuntime(credential) {
  const env = await bindings();
  createIdentityAuthority({
    secret: env.GEO_SESSION_SECRET,
    now: Date.now,
  }).verify(credential);
  if (process.env.NODE_ENV === "production" && !env.HYPERDRIVE)
    throw new Error("Hyperdrive binding is required");
  const client = await connectDatabase(
    env.HYPERDRIVE ?? { connectionString: env.GEO_APPLICATION_DATABASE_URL },
  );
  try {
    const entries = JSON.parse(env.GEO_PUBLIC_ROOT_CATALOG ?? "[]");
    const publicRootCatalog = new Set(
      entries.map(([industry, word]) => industry + "\0" + word),
    );
    const application = await createApplication({
      client,
      secret: env.GEO_SESSION_SECRET,
      publicRootCatalog,
      modelCapabilities: productionModelCapabilities,
      loadWeeklyPolicy: async () => JSON.parse(env.GEO_WEEKLY_POLICY_RECORD || "null"),
      loadIndustryPopulation: async ({ industry, window }) =>
        JSON.parse(env.GEO_INDUSTRY_POPULATIONS || "[]").find((record) =>
          record.industry === industry && record.window_start === window.start && record.window_end === window.end,
        ) ?? null,
      resolveImportAuthorization: async ({ tenant_id, authorization_ref }) => {
        const records = JSON.parse(env.GEO_C_IMPORT_AUTHORIZATIONS ?? "[]");
        return (
          records.find(
            (record) =>
              record.tenant_id === tenant_id &&
              record.ref === authorization_ref,
          ) ?? null
        );
      },
    });
    return {
      application,
      readWorkspace: () => readWorkspaceContext({
        client,
        application,
        secret: env.GEO_SESSION_SECRET,
        credential,
      }),
      close: () => client.end(),
    };
  } catch (error) {
    await client.end();
    throw error;
  }
}
export async function readWorkbenchSession(headers) {
  let runtime;
  try {
    const credential = requestCredential(headers);
    runtime = await createWorkerRuntime(credential);
    return await runtime.readWorkspace();
  } catch {
    return null;
  } finally {
    if (runtime) await runtime.close();
  }
}
