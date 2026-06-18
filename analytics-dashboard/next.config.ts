import type { NextConfig } from "next";

const researchUrl = process.env.RESEARCH_API_URL || "http://localhost:8100";
const tradingUrl = process.env.TRADING_API_URL || "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/research/:path*", destination: `${researchUrl}/:path*` },
      { source: "/api/trading/:path*", destination: `${tradingUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
