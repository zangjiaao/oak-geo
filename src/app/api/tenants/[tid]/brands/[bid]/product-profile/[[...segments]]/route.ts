import { createProductOnboardingTransport } from "@/server/api/product-onboarding-http.mjs";
import { createWorkerRuntime } from "@/server/api/worker-runtime.mjs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const GET = createProductOnboardingTransport(createWorkerRuntime);
export const POST = GET;
