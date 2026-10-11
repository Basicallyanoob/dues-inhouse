import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Postgres driver must not be bundled into the edge proxy.
  serverExternalPackages: ["postgres"],
  // Hero and agent lists are read from config/ at run time.
  outputFileTracingIncludes: { "/**": ["./config/**"] },
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
  agentRules: false,
};

export default nextConfig;
