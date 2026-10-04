import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beto",
  description:
    "BETO IA — Assistente pessoal de voz e texto alimentado por IA.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.png?v=5", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png?v=5", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png?v=5", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Beto",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("beto-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?"#f4f6fa":"#000000")}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
