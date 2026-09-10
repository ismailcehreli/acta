import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // En fazla 5 × 25 MB ek ve multipart/FormData payı için Server Action
  // gövde sınırı; asıl dosya boyutu ve adet kararı sunucu servisinde yapılır.
  experimental: {
    serverActions: { bodySizeLimit: "128mb" },
  },
  // Uçtan uca testler geliştirme sunucusuna 127.0.0.1 üzerinden bağlanır.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
