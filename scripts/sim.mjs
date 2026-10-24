// Demo/test için geçici esnaf üretir: MON gönderir, dükkân açtırır, aralarında borç yazdırır.
//   node scripts/sim.mjs <esnafSayısı> [borçSayısı]
// Üretilen anahtarlar yalnızca bellekte tutulur; dosyaya yazılmaz.
import { createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { clients, monadTestnet, readArtifact } from "./_env.mjs";
import { takasAbi } from "../src/abi.js";
import deployment from "../src/deployment.js";

const n = Number(process.argv[2] || 3);
const m = Number(process.argv[3] || n * 2);
const { publicClient, walletClient, account: host } = clients();
const address = deployment.takas;
const pad = (g) => g + 30_000n;
const url = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wallets = Array.from({ length: n }, () => privateKeyToAccount(generatePrivateKey()));

async function send(account, functionName, args, value = 0n) {
  const w = createWalletClient({ account, chain: monadTestnet, transport: http("https://testnet-rpc.monad.xyz") });
  for (let i = 0; ; i++) {
    try {
      const est = await publicClient.estimateContractGas({ address, abi: takasAbi, functionName, args, account, value });
      const hash = await w.writeContract({ address, abi: takasAbi, functionName, args, value, gas: pad(est) });
      const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
      if (rc.status !== "success") throw new Error(`${functionName} düştü`);
      return;
    } catch (e) {
      console.log(functionName, 'hata:', (e.shortMessage || e.message).slice(0, 220).replace(/\s+/g, ' '), '|', (e.details || '').slice(0, 160));
      if (i < 3 && /insufficient|nonce/i.test(e.message)) {
        await sleep(1200);
        continue;
      }
      throw e;
    }
  }
}

// MON gönder (host'tan), sırayla.
for (const w of wallets) {
  const hash = await walletClient.sendTransaction({ to: w.address, value: parseEther("0.25"), gas: 21_000n });
  await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
}
await sleep(800);
await Promise.all(wallets.map((w) => send(w, "register", [], parseEther("0.1"))));
console.log(n, "esnaf kayıt oldu");

const { default: _d } = await import("../src/deployment.js");
const members = await publicClient.readContract({ address, abi: takasAbi, functionName: "membersPage", args: [0n, 400n] });
const all = members[0];
const mine = new Set(wallets.map((w) => w.address.toLowerCase()));
for (let k = 0; k < m; k++) {
  const from = wallets[k % n];
  const targets = all.filter((a) => a.toLowerCase() !== from.address.toLowerCase());
  const to = targets[(k * 7 + 3) % targets.length];
  const amt = [parseEther("0.01"), parseEther("0.02"), parseEther("0.05")][k % 3];
  await send(from, "owe", [to, amt]);
}
console.log(m, "borç yazıldı");

