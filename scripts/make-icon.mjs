/**
 * 生成产品图标：使用 DeepSeek 官方品牌图标（来自 dsh-web-frontend 的 favicon.svg，
 * 即官方鲸鱼图形），黑色圆角底 + 白色图标。
 * 输出：build/icon.png (512)、build/icon.ico（多尺寸）、build/icon.icns、build/tray.png。
 *
 * 渲染依赖：sharp（runtime 内置，自带 librsvg，可渲染 SVG）。
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
mkdirSync(buildDir, { recursive: true });

// ── 定位依赖：官方鲸鱼 SVG + sharp ─────────────────────────────────
const faviconCandidates = [
  join(root, "runtime", "dsh", "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist", "favicon.svg"),
];
const sharpCandidates = [
  join(root, "runtime", "dsh", "node_modules", "sharp"),
  join(root, "node_modules", "sharp"),
];

function resolveFirst(candidates, label) {
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`找不到${label}（请先运行 npm run prepare:runtime）: ${candidates.join(", ")}`);
}

const faviconPath = resolveFirst(faviconCandidates, "官方 favicon.svg");
const sharpPath = resolveFirst(sharpCandidates, "sharp");
const sharp = require(sharpPath);

const svgSrc = readFileSync(faviconPath, "utf8");
// 提取官方 <path> 标签并改为白色（去掉 style 里的深色/浅色切换）
const pathMatch = svgSrc.match(/<path[^>]*d="[^"]*"[^>]*\/?>/);
if (!pathMatch) throw new Error("favicon.svg 中未找到 path");
const whalePath = pathMatch[0].replace(/\sfill="#[0-9a-fA-F]{3,6}"/, ' fill="#fff"');

// ── 组合 SVG ────────────────────────────────────────────────────────
// 应用图标：黑色圆角底（#0D0E13，圆角 21%）+ 白色官方鲸鱼（50→450 单位居中）
function appSvg(size = 512) {
  const pad = Math.round(size * 0.02);
  const rx = Math.round(size * 0.21);
  const scale = size * 0.9 / 50;
  const offset = Math.round((size - 50 * scale) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" rx="${rx}" fill="#0D0E13"/>
  <g transform="translate(${offset},${offset}) scale(${scale})">${whalePath}</g>
</svg>`;
}

// 托盘图标：透明底 + 白色鲸鱼
function traySvg(size = 32) {
  const scale = size * 0.92 / 50;
  const offset = Math.round((size - 50 * scale) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${offset},${offset}) scale(${scale})">${whalePath}</g>
</svg>`;
}

// ── 渲染 ────────────────────────────────────────────────────────────
async function renderSvgToPng(svg, size) {
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

async function renderAppPng(size) {
  return sharp(Buffer.from(appSvg(size))).png().toBuffer();
}

// ── PNG / ICO / ICNS 编码（沿用既有编码器） ─────────────────────────
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgba, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const { deflateSync } = require("node:zlib");
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function encodeICO(pngsBySize) {
  const sizes = Object.keys(pngsBySize).map(Number).sort((a, b) => a - b);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + sizes.length * 16;
  for (const size of sizes) {
    const png = pngsBySize[size];
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

const ICNS_TYPES = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
];

function encodeICNS(pngsBySize) {
  const blocks = [];
  for (const [type, size] of ICNS_TYPES) {
    const png = pngsBySize[size];
    const block = Buffer.alloc(8 + png.length);
    block.write(type, 0, "ascii");
    block.writeUInt32BE(8 + png.length, 4);
    png.copy(block, 8);
    blocks.push(block);
  }
  const total = 8 + blocks.reduce((s, b) => s + b.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...blocks]);
}

// ── 生成 ────────────────────────────────────────────────────────────
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024];

// icon.png (512)
const png512 = await renderAppPng(512);
writeFileSync(join(buildDir, "icon.png"), png512);

// icon.ico
const icoPngs = {};
for (const s of ICO_SIZES) icoPngs[s] = await renderAppPng(s);
writeFileSync(join(buildDir, "icon.ico"), encodeICO(icoPngs));

// icon.icns
const icnsPngs = {};
for (const s of ICNS_SIZES) icnsPngs[s] = await renderAppPng(s);
writeFileSync(join(buildDir, "icon.icns"), encodeICNS(icnsPngs));

// tray.png (32, 透明底白鲸鱼)
writeFileSync(join(buildDir, "tray.png"), await renderSvgToPng(traySvg(32), 32));

console.log("✔ 图标已生成（官方 DeepSeek 白色图标，黑底圆角）: icon.png(512) / icon.ico / icon.icns / tray.png");
