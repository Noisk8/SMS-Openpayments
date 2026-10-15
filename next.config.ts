import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["argon2", "@prisma/client", "@prisma/adapter-pg", "pg", "twilio"],
  poweredByHeader: false,
};

export default nextConfig;
