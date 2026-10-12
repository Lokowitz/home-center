import type { MetadataRoute } from "next"

// Lets "Add to Home Screen" launch HomeCenter as a standalone app. The
// icons come from app/favicon.ico (scripts/make-pwa-icons.mjs). proxy.ts leaves
// this route and /icons out of the login redirect so the browser can fetch them
// before anyone is signed in.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HomeCenter",
    short_name: "HomeCenter",
    description: "Track and manage your homes and vehicles",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/app-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
