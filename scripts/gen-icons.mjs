import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";

/* Ícones do Beto a partir do render 3D do próprio mascote (scripts/assets/beto-3d.png, PNG transparente
   gerado do mesmo modelo do app, components/mascot/ghost.ts). Fundo preto com um brilho suave atrás dele. */
const SRC = "scripts/assets/beto-3d.png";
const M = 1024;
await mkdir("public/icons", { recursive: true });

const glow = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${M}" height="${M}">
  <defs><radialGradient id="g" cx="50%" cy="46%" r="50%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
    <stop offset="55%" stop-color="#ffffff" stop-opacity="0.04"/>
    <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient></defs>
  <rect width="${M}" height="${M}" fill="#000"/>
  <rect width="${M}" height="${M}" fill="url(#g)"/>
</svg>`);

/* fill: fração do lado ocupada pelo mascote. 0.6 cabe na zona segura de 80% do maskable; 0.9 é para tamanhos minúsculos. */
async function master(fill) {
  const side = Math.round(M * fill);
  const ghost = await sharp(SRC).resize(side, side, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  const off = Math.round((M - side) / 2);
  return sharp(glow).composite([{ input: ghost, left: off, top: off + Math.round(M * 0.01) }]).png().toBuffer();
}

const roomy = await master(0.6);    // app instalado: o sistema recorta em círculo/squircle
const tight = await master(0.9);    // favicon: em 32px cada pixel conta
const png = (buf, size) => sharp(buf).resize(size, size).png({ compressionLevel: 9 });

await png(roomy, 192).toFile("public/icons/icon-192.png");
await png(roomy, 512).toFile("public/icons/icon-512.png");
await png(roomy, 512).toFile("public/icons/icon-maskable-512.png");
await png(await master(0.74), 180).toFile("app/apple-icon.png");   // iOS só arredonda os cantos: dá para ocupar mais
await png(tight, 32).toFile("app/icon.png");
const ico32 = await png(tight, 32).toBuffer();
// Minimal ICO wrapper around a PNG payload.
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head.writeUInt8(32, 6); head.writeUInt8(32, 7);
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(ico32.length, 14); head.writeUInt32LE(22, 18);
await writeFile("public/favicon.ico", Buffer.concat([head, ico32]));
console.log("icons ok");
