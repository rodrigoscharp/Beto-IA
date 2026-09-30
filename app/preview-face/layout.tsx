import { notFound } from "next/navigation";

/* Rota só de desenvolvimento: confere os rostos do Beto. Em produção não existe. */
export default function PreviewFaceLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
