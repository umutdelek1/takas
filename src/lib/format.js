import { formatEther } from "viem";

/** Wei → "0,125" biçiminde MON (en çok 4 ondalık, sondaki sıfırlar atılır). */
export function mon(wei, max = 4) {
  const n = Number(formatEther(BigInt(wei)));
  const s = n.toLocaleString("tr-TR", { maximumFractionDigits: max, minimumFractionDigits: 0 });
  return s;
}

export const monLabel = (wei, max) => `${mon(wei, max)} MON`;

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const num = (n) => Number(n).toLocaleString("tr-TR");

export function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} sn önce`;
  return `${Math.round(s / 60)} dk önce`;
}
