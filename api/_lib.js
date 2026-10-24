import { createPublicClient, createWalletClient, defineChain, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployment from "../src/deployment.js";
import { takasAbi } from "../src/abi.js";

export { deployment, takasAbi };

export const BACKUP_RPC = "https://testnet-rpc.monad.xyz";
export const EXPLORER = "https://testnet.monadexplorer.com";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [BACKUP_RPC] } },
  blockExplorers: { default: { name: "MonadExplorer", url: EXPLORER } },
  // Monad testnet'te kanonik Multicall3: bağımsız okumalar tek eth_call'da birleşir.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

// Ortam değişkeni panelden/borudan eklenirken sonuna satır sonu karışabilir; geçersiz URL her
// çağrıda yeniden deneme + yedeğe geçiş demektir (canlıda ~4 sn). Bu yüzden temizlenir.
const rawPrimary = process.env.MONAD_RPC_URL || "";
const primary = rawPrimary.trim();
export const rpcDiag = {
  primarySet: !!primary,
  primaryHadWhitespace: rawPrimary !== primary,
  primaryValid: /^https?:\/\/\S+$/.test(primary),
};

/** Birincil RPC (Alchemy) önce, yedek sonra. */
export function rpcUrls() {
  return [...new Set([rpcDiag.primaryValid ? primary : null, BACKUP_RPC].filter(Boolean))];
}

function transport() {
  // Kısa zaman aşımı: birincil yanıt vermezse 1,5 sn içinde yedeğe geçilir. Aynı anda giden
  // istekler tek HTTP JSON-RPC partisinde gider.
  return fallback(
    rpcUrls().map((u) => http(u, { retryCount: 1, retryDelay: 150, timeout: 1500, batch: true })),
    { retryCount: 1, retryDelay: 100 },
  );
}

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: transport(),
  batch: { multicall: { wait: 0 } },
  pollingInterval: 500,
});

/** Basit süre ölçer: her adımın süresini toplar; Server-Timing başlığı ve log için. */
export function stopwatch() {
  const t0 = Date.now();
  const marks = [];
  return {
    async time(name, p) {
      const t = Date.now();
      try {
        return await p;
      } finally {
        marks.push([name, Date.now() - t]);
      }
    },
    total: () => Date.now() - t0,
    header(extra = []) {
      return [...marks, ...extra, ["total", Date.now() - t0]].map(([n, d]) => `${n};dur=${d}`).join(", ");
    },
    log(label) {
      console.log(label, JSON.stringify({ total: Date.now() - t0, steps: Object.fromEntries(marks), rpc: rpcDiag }));
    },
  };
}

export function hostAccount() {
  const k = (process.env.HOST_PRIVATE_KEY || "").trim();
  if (!k) throw new HttpError(500, "Sunucuda HOST_PRIVATE_KEY tanımlı değil.");
  return privateKeyToAccount(k.startsWith("0x") ? k : `0x${k}`);
}

export function hostWallet() {
  const account = hostAccount();
  return createWalletClient({ account, chain: monadTestnet, transport: transport() });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireDeployed() {
  if (!deployment.takas) throw new HttpError(503, "Kontrat henüz yayınlanmadı.");
  return deployment.takas;
}

/** Tüm uçlar için ortak sarmalayıcı: hata → JSON. */
export function route(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      res.status(status).json({ error: e instanceof HttpError ? e.message : "Sunucu hatası, tekrar deneyin." });
      if (!(e instanceof HttpError)) console.error(e?.shortMessage || e?.message || e);
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

/** Aynı hesaptan gelen eşzamanlı işlemlerde nonce çakışmasını yeniden deneyerek aşar. */
export async function sendWithRetry(send) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      return await send();
    } catch (e) {
      last = e;
      const m = `${e?.shortMessage || ""} ${e?.message || ""}`.toLowerCase();
      const retryable =
        m.includes("nonce") || m.includes("replacement") || m.includes("already known") || m.includes("insufficient");
      if (!retryable) throw e;
      await sleep(300 + Math.random() * 500 + i * 300);
    }
  }
  throw last;
}

export const pad = (g) => g + g / 10n + 30_000n;
