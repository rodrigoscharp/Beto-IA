import { notFound } from "next/navigation";

/* Rota só de desenvolvimento: galeria do mascote (Fantasminha 3D). Em produção não existe. */
export default function PreviewFaceLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
