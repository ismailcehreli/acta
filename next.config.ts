import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Server Action body limit for up to five 25 MB attachments plus
  // multipart/FormData overhead; the service enforces actual file size and
  // count limits.
  experimental: {
    serverActions: { bodySizeLimit: "128mb" },
  },
  // End-to-end tests connect to the development server through 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
