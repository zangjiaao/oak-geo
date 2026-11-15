import { createSeedTransport } from "@/server/api/seed-http.mjs";
import { createWorkerRuntime } from "@/server/api/worker-runtime.mjs";
export const dynamic = "force-dynamic";
export const GET = createSeedTransport(createWorkerRuntime);
export const POST = GET;
