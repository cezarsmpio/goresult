import { readFileSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { transformSync } from "esbuild";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("dist/index.js", root), "utf8");
const declarations = readFileSync(new URL("dist/index.d.ts", root), "utf8");
const minified = transformSync(source, {
  format: "esm",
  legalComments: "none",
  minify: true,
  target: "es2022",
}).code.trim();

function bytes(value) {
  if (value < 1000) return `${value} B`;
  return `${(value / 1000).toFixed(2)} kB`;
}

function compressed(value) {
  return {
    gzip: gzipSync(Buffer.from(value), { level: 9 }).length,
    brotli: brotliCompressSync(Buffer.from(value)).length,
  };
}

const rows = [
  {
    file: "dist/index.js",
    raw: Buffer.byteLength(source),
    ...compressed(source),
  },
  {
    file: "minified",
    raw: Buffer.byteLength(minified),
    ...compressed(minified),
  },
  {
    file: "dist/index.d.ts",
    raw: Buffer.byteLength(declarations),
    ...compressed(declarations),
  },
];

const widths = {
  file: Math.max("file".length, ...rows.map((row) => row.file.length)),
  raw: Math.max("raw".length, ...rows.map((row) => bytes(row.raw).length)),
  gzip: Math.max("gzip".length, ...rows.map((row) => bytes(row.gzip).length)),
  brotli: Math.max(
    "brotli".length,
    ...rows.map((row) => bytes(row.brotli).length),
  ),
};

const pad = (value, width) => value.padEnd(width);
const padStart = (value, width) => value.padStart(width);

console.log(
  `${pad("file", widths.file)}  ${padStart("raw", widths.raw)}  ${padStart("gzip", widths.gzip)}  ${padStart("brotli", widths.brotli)}`,
);

for (const row of rows) {
  console.log(
    `${pad(row.file, widths.file)}  ${padStart(bytes(row.raw), widths.raw)}  ${padStart(bytes(row.gzip), widths.gzip)}  ${padStart(bytes(row.brotli), widths.brotli)}`,
  );
}
