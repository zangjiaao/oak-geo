import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();
// Preserve the owner-managed AGENTS.md; Next dev must not append agent rules.
const nextConfig: NextConfig = {agentRules:false};
export default nextConfig;
