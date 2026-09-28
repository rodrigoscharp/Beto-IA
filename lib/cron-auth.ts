import { timingSafeEqual } from "node:crypto";

/** Bearer $CRON_SECRET em tempo constante. O agendador (GitHub Actions) não tem cookie de sessão. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
