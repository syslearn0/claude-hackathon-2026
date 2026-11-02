import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API ルートが実行時に読む場所データを、公開先にも含める
  outputFileTracingIncludes: {
    "/api/**": ["./data/places/**", "./data/stations/**", "./data/indoor/**"],
  },
};

export default nextConfig;
