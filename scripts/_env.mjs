import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** contracts/.env ve .env.local dosyalarını process.env'e yükler; değerleri yazdırmaz. */
export function loadEnv() {
  for (const f of ["contracts/.env", ".env.local"]) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export const BACKUP_RPC = "https://testnet-rpc.monad.xyz";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [BACKUP_RPC] } },
  blockExplorers: { default: { name: "MonadExplorer", url: "https://testnet.monadexplorer.com" } },
});

export function clients() {
  loadEnv();
  const urls = [process.env.MONAD_RPC_URL, BACKUP_RPC].filter(Boolean);
  const transport = fallback(urls.map((u) => http(u, { retryCount: 3, retryDelay: 400 })));
  const publicClient = createPublicClient({ chain: monadTestnet, transport, pollingInterval: 500 });
  let account = null;
  if (process.env.HOST_PRIVATE_KEY) {
    const k = process.env.HOST_PRIVATE_KEY.trim();
    account = privateKeyToAccount(k.startsWith("0x") ? k : `0x${k}`);
  }
  const walletClient = account
    ? createWalletClient({ account, chain: monadTestnet, transport })
    : null;
  return { publicClient, walletClient, account };
}

export function readArtifact(name) {
  const p = join(root, "contracts", "out", `${name}.sol`, `${name}.json`);
  const j = JSON.parse(readFileSync(p, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}
