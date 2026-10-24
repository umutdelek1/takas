import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./_env.mjs";

const file = join(root, "public", "bench.json");

export function loadBench() {
  if (!existsSync(file)) return { generatedAt: null, ethereum: null, monad: null };
  return JSON.parse(readFileSync(file, "utf8"));
}

/** bench.json içindeki tek bölümü (ethereum | monad) günceller. */
export function saveSection(name, value) {
  const b = loadBench();
  b[name] = value;
  b.generatedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(b, null, 2) + "\n");
}

export const jsonSafe = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
