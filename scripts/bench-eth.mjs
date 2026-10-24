// Ethereum kurallarında (anvil --hardfork prague) TakasStress ile settle() gas ölçümü.
//   node scripts/bench-eth.mjs
// İşlem başı gas sınırı EIP-7825: 16.777.216. Sınırın iki yanından ölçülür; sınırı aşan boyutta gerçek bir
// settle() o limitle gönderilir ve gas yetmeyip düştüğü kaydedilir.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseEther, parseEventLogs } from "viem";
import { readArtifact } from "./_env.mjs";
import { saveSection, jsonSafe } from "./_bench.mjs";

const CAP = 16_777_216n;
const SIZES = [500, 1000, 2000, 2500, 3000, 5000, 10000];
const INVOICES_PER_MERCHANT = 2;
const PORT = 8546;
const url = `http://127.0.0.1:${PORT}`;

const anvil = spawn(
  join(homedir(), ".foundry", "bin", "anvil.exe"),
  ["--hardfork", "prague", "--gas-limit", "3000000000", "--port", String(PORT), "--silent", "--code-size-limit", "100000"],
  { stdio: "ignore" },
);
process.on("exit", () => anvil.kill());

const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
const publicClient = createPublicClient({ chain, transport: http(url) });
for (let i = 0; i < 40; i++) {
  try {
    await publicClient.getBlockNumber();
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
const [from] = await publicClient.request({ method: "eth_accounts" });
const walletClient = createWalletClient({ account: from, chain, transport: http(url) });

const { abi, bytecode } = readArtifact("TakasStress");
const dep = await walletClient.deployContract({ abi, bytecode, args: [parseEther("0.0005")], gas: 8_000_000n });
const { contractAddress: address } = await publicClient.waitForTransactionReceipt({ hash: dep });

const out = {
  chainId: 31337,
  hardfork: "prague",
  txGasCap: CAP,
  invoicesPerMerchant: INVOICES_PER_MERCHANT,
  points: [],
  overLimitSettle: null,
  uncappedSettle: null,
};

async function write(functionName, args) {
  const hash = await walletClient.writeContract({ address, abi, functionName, args, gas: 1_000_000_000n });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} başarısız`);
}

let merchants = 0;
let invoices = 0;
let counter = 1;
for (const size of SIZES) {
  while (merchants < size) {
    const n = Math.min(4000, size - merchants);
    await write("seedMerchants", [BigInt(n), parseEther("10")]);
    merchants += n;
  }
  const want = size * INVOICES_PER_MERCHANT;
  while (invoices < want) {
    const n = Math.min(4000, want - invoices);
    await write("seedInvoices", [BigInt(n), parseEther("1"), BigInt(counter++)]);
    invoices += n;
  }
  const est = await publicClient.estimateContractGas({ address, abi, functionName: "settle", account: from });
  const fits = est <= CAP;
  out.points.push({ merchants: size, invoices: want, gasEstimate: est, gasPerMerchant: Math.round(Number(est) / size), fitsCap: fits });
  console.log(size, "esnaf", est.toString(), fits ? "sınır içinde" : "SINIRI AŞIYOR");

  if (!fits && !out.overLimitSettle) {
    // Sınırı aşan boyutta gerçek settle(), sınır kadar gas limitiyle.
    const hash = await walletClient.writeContract({ address, abi, functionName: "settle", gas: CAP });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    out.overLimitSettle = {
      merchants: size,
      invoices: want,
      gasLimit: CAP,
      gasEstimateNeeded: est,
      status: rc.status,
      receiptGasUsed: rc.gasUsed,
      note: rc.status === "reverted" ? "Gas yetmedi: işlem düştü, hiçbir esnaf takasa girmedi." : "Beklenmedik: işlem geçti.",
    };
    console.log("sınırlı settle durumu:", rc.status);
  }
}

// Sınırsız (sadece ölçüm için) gerçek settle: en büyük boyutta gerçek tüketim.
const hash = await walletClient.writeContract({ address, abi, functionName: "settle", gas: 2_000_000_000n });
const rc = await publicClient.waitForTransactionReceipt({ hash });
const [ev] = parseEventLogs({ abi, logs: rc.logs, eventName: "Settled" });
out.uncappedSettle = {
  merchants: SIZES[SIZES.length - 1],
  status: rc.status,
  receiptGasUsed: rc.gasUsed,
  gasUsedEvent: ev ? ev.args.stats.gasUsed : null,
};
saveSection("ethereum", jsonSafe(out));
console.log("tamam");
anvil.kill();
process.exit(0);
