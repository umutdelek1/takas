import { keccak256, pad as padHex, parseAbi, parseEther, toHex } from "viem";
import { publicClient, deployment, takasAbi, HttpError, EXPLORER } from "./_lib.js";

// Demo kontratı: ana Takas'tan AYRI bir TakasStress örneği. Sahibi host cüzdanıdır.
export const demoAbi = [
  ...takasAbi,
  ...parseAbi([
    "function seedMerchants(uint256 count, uint256 collateralWei)",
    "function seedInvoices(uint256 count, uint256 maxAmountWei, uint256 seed)",
  ]),
];

export const MAX_MERCHANTS = 40; // demo ağındaki en çok sentetik işletme
export const MAX_OPEN_INVOICES = 60; // üst üste basmayı sınırlar; durum okuması da hafif kalır
export const MERCHANTS_PER_SEED = 10;
export const INVOICES_PER_SEED = 20;
export const SEED_COLLATERAL = parseEther("0.2"); // sentetik teminat: gerçek MON değildir
export const SEED_MAX_INVOICE = parseEther("0.05");

const INVOICES_SLOT = 5n; // TakasStress depolama düzeni: _invoices (forge inspect storageLayout)
const UNIT = 1_000_000_000_000n;

export function requireDemo() {
  if (!deployment.demo) throw new HttpError(503, "Demo kontratı henüz yayınlanmadı.");
  return deployment.demo;
}

/** Sentetik işletmelerin adresi yazılmaz; arayüz için numaradan türetilen sahte adres kullanılır. */
export const pseudo = (id) => `0x${BigInt(id).toString(16).padStart(40, "0")}`;

const settledEvent = takasAbi.find((x) => x.type === "event" && x.name === "Settled");
const big = (v) => v.toString();

function statsOut(s) {
  return {
    invoices: Number(s.invoices),
    participants: Number(s.participants),
    excluded: Number(s.excluded),
    grossWei: big(s.grossWei),
    cashWei: big(s.cashWei),
    savedWei: big(s.savedWei),
    feesWei: big(s.feesWei),
    gasUsed: Number(s.gasUsed),
  };
}

let lastCache = { block: -1n, value: null };
let stateCache = { at: 0, value: null };

/** /api/state ile aynı biçimde, demo kontratının durumu. */
export async function demoState() {
  if (stateCache.value && Date.now() - stateCache.at < 900) return stateCache.value;
  const address = requireDemo();
  const read = (functionName, args = []) => publicClient.readContract({ address, abi: demoAbi, functionName, args });

  const [fee, session, feeBalance, memberCount, openCount, lastBlock, cumGross, cumCash, preview, blockNumber] =
    await Promise.all([
      read("fee"),
      read("session"),
      read("feeBalance"),
      read("memberCount"),
      read("openInvoiceCount"),
      read("lastSettleBlock"),
      read("cumGrossUnits"),
      read("cumCashUnits"),
      read("previewSettle"),
      publicClient.getBlockNumber(),
    ]);

  const n = Number(memberCount);
  const m = Number(openCount);
  const base = BigInt(keccak256(padHex(toHex(INVOICES_SLOT), { size: 32 })));

  const [page, words, last] = await Promise.all([
    n > 0 ? read("membersPage", [0n, BigInt(n)]) : [[], [], []],
    Promise.all(
      Array.from({ length: Math.ceil(m / 2) }, (_, i) =>
        publicClient.getStorageAt({ address, slot: toHex(base + BigInt(i), { size: 32 }) }),
      ),
    ),
    (async () => {
      if (lastBlock === 0n) return null;
      if (lastCache.block === lastBlock) return lastCache.value;
      const logs = await publicClient.getLogs({ address, event: settledEvent, fromBlock: lastBlock, toBlock: lastBlock });
      const log = logs[logs.length - 1];
      const value = log
        ? {
            session: Number(log.args.session),
            block: Number(lastBlock),
            txHash: log.transactionHash,
            explorer: `${EXPLORER}/tx/${log.transactionHash}`,
            stats: statsOut(log.args.stats),
          }
        : null;
      lastCache = { block: lastBlock, value };
      return value;
    })(),
  ]);

  const invoices = [];
  for (let k = 0; k < m; k++) {
    const word = BigInt(words[k >> 1] ?? "0x0");
    const inv = (word >> BigInt((k & 1) * 128)) & ((1n << 128n) - 1n);
    invoices.push({
      debtor: pseudo(inv & 0xffffffffn),
      creditor: pseudo((inv >> 32n) & 0xffffffffn),
      amountWei: big(((inv >> 64n) & 0xffffffffffffffffn) * UNIT),
    });
  }

  const value = {
    demo: true,
    chainId: deployment.chainId,
    contract: address,
    block: Number(blockNumber),
    feeWei: big(fee),
    feeBalanceWei: big(feeBalance),
    session: Number(session),
    cumulative: { grossWei: big(cumGross * UNIT), cashWei: big(cumCash * UNIT) },
    members: Array.from({ length: n }, (_, i) => ({
      id: i,
      address: pseudo(i),
      collateralWei: big(page[1][i]),
      sicil: Number(page[2][i]),
    })),
    memberCount: n,
    invoices,
    invoiceCount: m,
    preview: statsOut(preview),
    lastSettle: last,
    limits: { maxMerchants: MAX_MERCHANTS, maxOpenInvoices: MAX_OPEN_INVOICES },
  };
  stateCache = { at: Date.now(), value };
  return value;
}

// ---- hız sınırı (sunucu belleğinde; aynı örneğe düşen istekleri sınırlar) ----
const hits = new Map();
const locks = new Map();

function ipOf(req) {
  const f = req.headers["x-forwarded-for"];
  return (typeof f === "string" ? f.split(",")[0].trim() : req.socket?.remoteAddress) || "?";
}

/** Aynı IP aynı işlemi `ms` içinde tekrarlayamaz. */
export function rateLimit(req, name, ms) {
  const key = `${name}:${ipOf(req)}`;
  const now = Date.now();
  if (now - (hits.get(key) ?? 0) < ms) throw new HttpError(429, "Çok sık denedin. Birkaç saniye sonra tekrar dene.");
  hits.set(key, now);
  if (hits.size > 500) for (const [k, t] of hits) if (now - t > 60_000) hits.delete(k);
}

/** Herkes için ortak kilit: `name` işlemi `ms` içinde yalnızca bir kez başlayabilir. */
export function lock(name, ms) {
  const now = Date.now();
  const until = locks.get(name) ?? 0;
  if (now < until) {
    const s = Math.ceil((until - now) / 1000);
    throw new HttpError(429, `Demo ağı şu an hazırlanıyor. ${s} sn sonra tekrar dene.`);
  }
  locks.set(name, now + ms);
}

export function unlock(name) {
  locks.delete(name);
}
