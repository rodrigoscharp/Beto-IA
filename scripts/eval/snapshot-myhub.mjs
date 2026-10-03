/* Baixa o contexto real do My Hub (catálogo de ações, contas, categorias) para virar o fixture da bateria.
   O arquivo cru vai para evals/out/ (fora do git). ANONIMIZE à mão antes de copiar para evals/fixtures.json:
   o repositório é público. Uso: node scripts/eval/snapshot-myhub.mjs */
import { mkdirSync, writeFileSync } from "node:fs";

try { process.loadEnvFile(".env.local"); } catch { /* sem .env.local: usa o ambiente */ }
const base = process.env.MYHUB_URL?.replace(/\/+$/, "");
const token = process.env.MYHUB_SERVICE_TOKEN;
if (!base || !token) { console.error("Defina MYHUB_URL e MYHUB_SERVICE_TOKEN (.env.local)."); process.exit(1); }

const res = await fetch(`${base}/api/v1/service/beto-contexto`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) { console.error(`My Hub respondeu ${res.status}`); process.exit(1); }
mkdirSync("evals/out", { recursive: true });
writeFileSync("evals/out/myhub-snapshot.json", JSON.stringify(await res.json(), null, 2));
console.log("Salvo em evals/out/myhub-snapshot.json. Anonimize antes de usar em evals/fixtures.json.");
