import { createProbeTransport } from "@/server/api/probe-http.mjs";
import { createWorkerRuntime } from "@/server/api/worker-runtime.mjs";
export const dynamic = "force-dynamic";
export const POST = createProbeTransport(createWorkerRuntime);
export const GET = POST;
