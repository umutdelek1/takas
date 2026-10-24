import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./_env.mjs";

const file = join(root, "public", "bench.json");

export function loadBench() {
  if (!existsSync(file)) return { generatedAt: null, ethereum: null, monad: null };
  return JSON.parse(readFileSync(file, "utf8"));
}

const MEASURED = "ölçülen";
const ESTIMATED = "tahmin";
const COMPUTED = "hesaplanan";

/**
 * Her rakama kaynağını etiketler:
 *  - ölçülen: gerçek işlem makbuzu / Settled olayı
 *  - tahmin: eth_estimateGas sonucu (işlem gönderilmedi)
 *  - hesaplanan: ölçülen/tahmin değerlerden türetilen sayı
 */
export function annotate(name, section) {
  const s = { ...section };
  s.points = (s.points || []).map((p) => ({ ...p, kind: ESTIMATED }));
  if (s.realSettle) s.realSettle = { ...s.realSettle, kind: MEASURED };
  if (s.overLimitSettle) s.overLimitSettle = { ...s.overLimitSettle, kind: MEASURED };
  if (s.uncappedSettle) s.uncappedSettle = { ...s.uncappedSettle, kind: MEASURED };
  if (name === "ethereum") {
    const over = s.points.find((p) => !p.fitsCap);
    const per = (over ?? s.points[s.points.length - 1]).gasPerMerchant;
    s.derived = {
      kind: COMPUTED,
      maxMerchantsPerTx: Math.floor(Number(s.txGasCap) / per),
      basis: `işlem başı gas sınırı ${s.txGasCap} / esnaf başına ${per} gas (sınırı ilk aşan ölçüm noktası)`,
    };
  }
  s.kinds = {
    [MEASURED]: "gerçek işlem makbuzu ve Settled olayı",
    [ESTIMATED]: "eth_estimateGas, işlem gönderilmedi",
    [COMPUTED]: "ölçülen/tahmin değerlerden türetildi",
  };
  return s;
}

/** bench.json içindeki tek bölümü (ethereum | monad) günceller. */
export function saveSection(name, value) {
  const b = loadBench();
  b[name] = annotate(name, value);
  b.generatedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(b, null, 2) + "\n");
}

export const jsonSafe = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
