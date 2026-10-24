import type { NextConfig } from "next";
import { securityHeaderRules } from "./lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  // No "X-Powered-By: Next.js" — it only helps someone pick an exploit.
  poweredByHeader: false,
  // next/image isn't used, so the /_next/image optimizer (public, outside the
  // proxy) is switched off rather than left as attack surface.
  images: { unoptimized: true },
  // The capture inbox is shown as "Intake" now; old links and bookmarks still work.
  async redirects() {
    return [{ source: "/inbox", destination: "/intake", permanent: true }];
  },
  async headers() {
    return securityHeaderRules(process.env.NODE_ENV === "development");
  },
  // Native addons and packages that spawn their own workers or read data files
  // from their package folder break when bundled; load them from node_modules.
  serverExternalPackages: [
    "officeparser",
    "unpdf",
    "word-extractor",
    "tesseract.js",
    "@tesseract.js-data/eng",
    "@napi-rs/canvas",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
  experimental: {
    globalNotFound: true,
  },
};

export default nextConfig;
