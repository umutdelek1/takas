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
});

/** Birincil RPC (Alchemy) önce, yedek sonra. 429/5xx'te yeniden dener. */
export function rpcUrls() {
  return [process.env.MONAD_RPC_URL, BACKUP_RPC].filter(Boolean);
}

function transport() {
  return fallback(rpcUrls().map((u) => http(u, { retryCount: 3, retryDelay: 300, timeout: 8000 })));
}

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: transport(),
  pollingInterval: 500,
});

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
