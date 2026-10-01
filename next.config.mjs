/** @type {import('next').NextConfig} */
const nextConfig = {
  // msedge-tts abre um WebSocket (ws): empacotado pelo webpack o stream da voz de reserva nunca fechava.
  experimental: { serverComponentsExternalPackages: ["msedge-tts"] },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
