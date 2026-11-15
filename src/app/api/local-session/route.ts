import { createLocalSessionTransport } from "@/server/api/local-session.mjs";
import { createWorkerRuntime } from "@/server/api/worker-runtime.mjs";
export const dynamic = "force-dynamic";
export const POST = createLocalSessionTransport(createWorkerRuntime);
