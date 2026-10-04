import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BETO IA",
    short_name: "Beto",
    description: "BETO IA — assistente pessoal de voz.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png?v=5", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=5", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png?v=5", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
