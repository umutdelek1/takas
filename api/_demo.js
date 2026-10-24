import { keccak256, pad as padHex, parseAbi, parseEther, toHex } from "viem";
import { publicClient, deployment, takasAbi, HttpError, EXPLORER } from "./_lib.js";
import { companyName, initials } from "../src/lib/names.js";

// Demo kontratları: ana Takas'tan AYRI TakasStress örnekleri; sahibi host cüzdanıdır.
//   supply  → "Tedarik zinciri" senaryosu (deployment.demo)
//   payroll → "Maaş günü" senaryosu (deployment.demoPayroll)
export const demoAbi = [
  ...takasAbi,
  ...parseAbi([
    "function seedMerchants(uint256 count, uint256 collateralWei)",
    "function seedInvoices(uint256 count, uint256 maxAmountWei, uint256 seed)",
    "function seedPayroll(uint256 companyCollateralWei, uint256 workers, uint256 salaryWei)",
  ]),
];

export const MAX_MERCHANTS = 40; // tedarik zinciri demosundaki en çok sentetik işletme
export const MAX_OPEN_INVOICES = 60; // üst üste basmayı sınırlar; durum okuması da hafif kalır
export const MERCHANTS_PER_SEED = 10;
export const INVOICES_PER_SEED = 20;
export const SEED_COLLATERAL = parseEther("0.2"); // sentetik teminat: gerçek MON değildir
export const SEED_MAX_INVOICE = parseEther("0.05");

export const PAYROLL_WORKERS = 200;
export const PAYROLL_SALARY = parseEther("0.01");
export const PAYROLL_COLLATERAL = parseEther("2.2"); // 200 × (0,01 maaş + 0,0005 ücret) + pay
export const PAYROLL_MAX_ACCOUNTS = 3000; // settle() tüm hesapları gezer; demo kontratı bu sınırda dolar

const INVOICES_SLOT = 5n; // TakasStress depolama düzeni: _invoices (forge inspect storageLayout)
const UNIT = 1_000_000_000_000n;

export function scenarioOf(req) {
  let s = req.body?.scenario;
  if (!s && req.url) s = new URL(req.url, "http://x").searchParams.get("scenario");
  return s === "payroll" ? "payroll" : "supply";
}

export function addressOf(scenario) {
  const a = scenario === "payroll" ? deployment.demoPayroll : deployment.demo;
  if (!a) throw new HttpError(503, "Demo kontratı henüz yayınlanmadı.");
  return a;
}

/** Sentetik hesapların adresi yazılmaz; arayüz için numaradan türetilen sahte adres kullanılır. */
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

const lastCache = new Map(); // adres → { block, value }
const stateCache = new Map(); // senaryo → { at, value }

const invoiceSlot = () => BigInt(keccak256(padHex(toHex(INVOICES_SLOT), { size: 32 })));
const getWord = (address, i) =>
  publicClient.getStorageAt({ address, slot: toHex(invoiceSlot() + BigInt(i), { size: 32 }) }).then((w) => BigInt(w ?? "0x0"));
const halfOf = (word, k) => (word >> BigInt((k & 1) * 128)) & ((1n << 128n) - 1n);

/** /api/state ile aynı biçimde, seçilen demo kontratının durumu. */
export async function demoState(scenario) {
  const cached = stateCache.get(scenario);
  if (cached && Date.now() - cached.at < 900) return cached.value;
  const address = addressOf(scenario);
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

  const lastP = (async () => {
    if (lastBlock === 0n) return null;
    const c = lastCache.get(address);
    if (c && c.block === lastBlock) return c.value;
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
    lastCache.set(address, { block: lastBlock, value });
    return value;
  })();

  let members = [];
  let invoices = [];

  if (scenario === "payroll") {
    // Açık faturalar hep son partinin maaşlarıdır: şirket c → çalışan c+1 … c+m (hepsi aynı tutar).
    if (m > 0) {
      const w0 = halfOf(await getWord(address, 0), 0);
      const company = Number(w0 & 0xffffffffn);
      const amountWei = big(((w0 >> 64n) & 0xffffffffffffffffn) * UNIT);
      const page = await read("membersPage", [BigInt(company), BigInt(Math.min(m + 1, n - company))]);
      members = page[0].map((_, i) => ({
        id: company + i,
        address: pseudo(company + i),
        collateralWei: big(page[1][i]),
        sicil: Number(page[2][i]),
        name: i === 0 ? companyName(company) : `Çalışan ${i}`,
        badge: i === 0 ? initials(company) : `Ç${i}`,
      }));
      invoices = Array.from({ length: m }, (_, k) => ({
        debtor: pseudo(company),
        creditor: pseudo(company + 1 + k),
        amountWei,
      }));
    }
  } else {
    const [page, words] = await Promise.all([
      n > 0 ? read("membersPage", [0n, BigInt(n)]) : [[], [], []],
      Promise.all(Array.from({ length: Math.ceil(m / 2) }, (_, i) => getWord(address, i))),
    ]);
    members = Array.from({ length: n }, (_, i) => ({
      id: i,
      address: pseudo(i),
      collateralWei: big(page[1][i]),
      sicil: Number(page[2][i]),
    }));
    for (let k = 0; k < m; k++) {
      const inv = halfOf(words[k >> 1] ?? 0n, k);
      invoices.push({
        debtor: pseudo(inv & 0xffffffffn),
        creditor: pseudo((inv >> 32n) & 0xffffffffn),
        amountWei: big(((inv >> 64n) & 0xffffffffffffffffn) * UNIT),
      });
    }
  }

  const value = {
    demo: true,
    scenario,
    chainId: deployment.chainId,
    contract: address,
    block: Number(blockNumber),
    feeWei: big(fee),
    feeBalanceWei: big(feeBalance),
    session: Number(session),
    cumulative: { grossWei: big(cumGross * UNIT), cashWei: big(cumCash * UNIT) },
    members,
    memberCount: n,
    invoices,
    invoiceCount: m,
    preview: statsOut(preview),
    lastSettle: await lastP,
    limits: { maxMerchants: MAX_MERCHANTS, maxOpenInvoices: MAX_OPEN_INVOICES, payrollWorkers: PAYROLL_WORKERS },
  };
  stateCache.set(scenario, { at: Date.now(), value });
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
