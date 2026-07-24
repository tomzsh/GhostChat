import type { MetadataRoute } from "next";

/** Web app manifest — installable PWA (ephemeral chat shell). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GhostChat",
    short_name: "GhostChat",
    description:
      "Anonymous ephemeral end-to-end encrypted chat. No accounts. No history.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["social", "communication"],
    lang: "en",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
