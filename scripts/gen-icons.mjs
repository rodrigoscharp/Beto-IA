import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const svg = await readFile("public/icons/icon.svg");
await mkdir("public/icons", { recursive: true });

const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 });

// Artwork already sits inside the 80% maskable safe zone (hex radius ~37.5%), so full-bleed doubles as maskable.
await png(192).toFile("public/icons/icon-192.png");
await png(512).toFile("public/icons/icon-512.png");
await png(512).toFile("public/icons/icon-maskable-512.png");
await png(180).toFile("app/apple-icon.png");
await png(32).toFile("app/icon.png");
const ico32 = await png(32).toBuffer();
// Minimal ICO wrapper around a PNG payload.
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head.writeUInt8(32, 6); head.writeUInt8(32, 7);
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(ico32.length, 14); head.writeUInt32LE(22, 18);
await writeFile("public/favicon.ico", Buffer.concat([head, ico32]));
console.log("icons ok");
