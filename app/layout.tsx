import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beto",
  description:
    "BETO IA — Assistente pessoal de voz e texto alimentado por IA.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon.svg?v=2", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png?v=2", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Beto",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#050a0f",
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
    <html lang="pt-BR">
      <body className="antialiased">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
