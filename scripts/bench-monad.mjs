// Monad testnet'te TakasStress ile settle() gas ölçümü.
//   node scripts/bench-monad.mjs
// Esnaf sayısı 500 → 2000 → 5000 → 10000 büyür, esnaf başına 2 fatura. Her boyutta settle() tahmini
// (eth_estimateGas) alınır; en büyük uygun boyutta GERÇEK bir settle() gönderilir ve Settled olayından
// gasUsed okunur (Monad'da makbuzdaki gasUsed gas limitini gösterir).
// Bütçe: bu betiğin harcayacağı toplam MON en fazla BUDGET; her işlemden önce bakiye kontrol edilir.
import { formatEther, parseEther, parseEventLogs } from "viem";
import { clients, readArtifact } from "./_env.mjs";
import { saveSection, jsonSafe } from "./_bench.mjs";
import deployment from "../src/deployment.js";

const BUDGET = parseEther("150");
const SIZES = [500, 2000, 5000, 10000];
const INVOICES_PER_MERCHANT = 2;
const BLOCK_GAS = 150_000_000n; // Monad testnet blok gas limiti
const MERCHANT_CHUNK = 3000;
const INVOICE_CHUNK = 2000;
const pad = (g) => g + g / 20n + 20_000n;

const { publicClient, walletClient, account } = clients();
const { abi } = readArtifact("TakasStress");
const address = deployment.stress;
const start = await publicClient.getBalance({ address: account.address });
const spent = async () => start - (await publicClient.getBalance({ address: account.address }));

const out = {
  chainId: 10143,
  contract: address,
  invoicesPerMerchant: INVOICES_PER_MERCHANT,
  budgetMon: formatEther(BUDGET),
  points: [],
  realSettle: null,
  stoppedBecause: null,
  spentMon: "0",
};
const save = async () => {
  out.spentMon = formatEther(await spent());
  saveSection("monad", jsonSafe(out));
};

let nonceHint = null;
async function write(functionName, args, label) {
  if ((await spent()) >= BUDGET) throw new Error("budget");
  const gas = pad(await publicClient.estimateContractGas({ address, abi, functionName, args, account }));
  const hash = await walletClient.writeContract({ address, abi, functionName, args, gas });
  const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
  if (rc.status !== "success") throw new Error(`${label} başarısız: ${hash}`);
  return { hash, rc, gas };
}

let merchants = 0;
let invoices = 0;
let seedCounter = 1;
let prevPer = null;

try {
  for (const size of SIZES) {
    while (merchants < size) {
      const n = Math.min(MERCHANT_CHUNK, size - merchants);
      await write("seedMerchants", [BigInt(n), parseEther("10")], "seedMerchants");
      merchants += n;
    }
    const wantInvoices = size * INVOICES_PER_MERCHANT;
    while (invoices < wantInvoices) {
      const n = Math.min(INVOICE_CHUNK, wantInvoices - invoices);
      await write("seedInvoices", [BigInt(n), parseEther("1"), BigInt(seedCounter++)], "seedInvoices");
      invoices += n;
    }
    let estimate;
    try {
      estimate = await publicClient.estimateContractGas({ address, abi, functionName: "settle", account });
    } catch (e) {
      out.points.push({ merchants: size, invoices: wantInvoices, ok: false, reason: (e.shortMessage || e.message).slice(0, 200) });
      out.stoppedBecause = `settle tahmini ${size} esnafta başarısız`;
      break;
    }
    const per = Number(estimate) / size;
    out.points.push({
      merchants: size,
      invoices: wantInvoices,
      ok: true,
      gasEstimate: estimate,
      gasPerMerchant: Math.round(per),
      fitsBlock: estimate < BLOCK_GAS,
    });
    console.log(size, "esnaf  tahmin", estimate.toString(), "esnaf başına", Math.round(per));
    await save();
    const next = SIZES[SIZES.indexOf(size) + 1];
    prevPer = per;
    if (!next || per * next * 1.15 > Number(BLOCK_GAS)) {
      if (next) out.stoppedBecause = `${next} esnafta tahmini blok gas limitini (${BLOCK_GAS}) aşıyor`;
      break;
    }
  }
} catch (e) {
  out.stoppedBecause = e.message === "budget" ? "150 MON bütçesi doldu" : `hata: ${(e.shortMessage || e.message).slice(0, 200)}`;
  console.log(out.stoppedBecause);
}

// Gerçek settle(): mevcut en büyük uygun boyutta.
const last = [...out.points].reverse().find((p) => p.ok);
if (last) {
  try {
    const gas = pad(BigInt(last.gasEstimate));
    const hash = await walletClient.writeContract({ address, abi, functionName: "settle", gas });
    const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
    const [ev] = parseEventLogs({ abi, logs: rc.logs, eventName: "Settled" });
    out.realSettle = {
      merchants: last.merchants,
      invoices: last.invoices,
      txHash: hash,
      explorer: `https://testnet.monadexplorer.com/tx/${hash}`,
      status: rc.status,
      gasLimit: gas,
      receiptGasUsed: rc.gasUsed,
      gasUsedEvent: ev ? ev.args.stats.gasUsed : null,
      block: rc.blockNumber,
    };
    console.log("gerçek settle", hash, rc.status, "olay gasUsed", ev?.args.stats.gasUsed?.toString());
  } catch (e) {
    out.realSettle = { merchants: last.merchants, error: (e.shortMessage || e.message).slice(0, 300) };
  }
}
await save();
console.log("harcanan MON:", out.spentMon);
