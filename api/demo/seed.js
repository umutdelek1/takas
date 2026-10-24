import { publicClient, hostWallet, route, HttpError, sendWithRetry, pad, EXPLORER } from "../_lib.js";
import {
  demoAbi,
  addressOf,
  scenarioOf,
  rateLimit,
  lock,
  unlock,
  MAX_MERCHANTS,
  MAX_OPEN_INVOICES,
  MERCHANTS_PER_SEED,
  INVOICES_PER_SEED,
  SEED_COLLATERAL,
  SEED_MAX_INVOICE,
  PAYROLL_WORKERS,
  PAYROLL_SALARY,
  PAYROLL_COLLATERAL,
  PAYROLL_MAX_ACCOUNTS,
} from "../_demo.js";

const LOCK_MS = 20_000;

async function send(address, functionName, args) {
  const wallet = hostWallet();
  // Gas limiti = tahmin + küçük pay (Monad tüm limiti ücretlendirir).
  const gas = pad(
    await publicClient.estimateContractGas({ address, abi: demoAbi, functionName, args, account: wallet.account }),
  );
  const hash = await sendWithRetry(() => wallet.writeContract({ address, abi: demoAbi, functionName, args, gas }));
  const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 25_000 });
  if (rc.status !== "success") throw new HttpError(502, `Demo işlemi başarısız oldu (${hash}).`);
  return { hash, explorer: `${EXPLORER}/tx/${hash}`, gasLimit: gas.toString() };
}

/**
 * Demo ağını kurar. Herkes çağırabilir; senaryo başına 20 sn ortak kilit ve IP sınırı var.
 *  - supply : 10 sentetik işletme (tavan 40) + 20 borç
 *  - payroll: 1 şirket + 200 çalışan, şirket her çalışana bir maaş faturası yazar
 */
export default route(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Yalnızca POST.");
  const scenario = scenarioOf(req);
  const address = addressOf(scenario);
  rateLimit(req, `seed:${scenario}`, 5_000);
  lock(`seed:${scenario}`, LOCK_MS);
  try {
    const read = (functionName) => publicClient.readContract({ address, abi: demoAbi, functionName });
    const [members, open] = await Promise.all([read("memberCount"), read("openInvoiceCount")]);

    if (scenario === "payroll") {
      if (Number(open) > 0) throw new HttpError(409, "Maaş günü ağı hazır. TAKAS'a bas.");
      if (Number(members) + PAYROLL_WORKERS + 1 > PAYROLL_MAX_ACCOUNTS) {
        throw new HttpError(409, "Maaş günü demo kontratı doldu. Lütfen daha sonra tekrar dene.");
      }
      const tx = await send(address, "seedPayroll", [PAYROLL_COLLATERAL, BigInt(PAYROLL_WORKERS), PAYROLL_SALARY]);
      res.status(200).json({ ok: true, scenario, workersAdded: PAYROLL_WORKERS, invoicesAdded: PAYROLL_WORKERS, txs: [tx] });
      return;
    }

    if (Number(open) + INVOICES_PER_SEED > MAX_OPEN_INVOICES) {
      throw new HttpError(409, "Ağda yeterince açık fatura var. Önce TAKAS'a bas.");
    }
    const txs = [];
    const add = Math.min(MERCHANTS_PER_SEED, MAX_MERCHANTS - Number(members));
    if (add > 0) txs.push(await send(address, "seedMerchants", [BigInt(add), SEED_COLLATERAL]));
    if (Number(members) + Math.max(add, 0) < 2) throw new HttpError(409, "Önce en az iki işletme gerekir.");
    txs.push(await send(address, "seedInvoices", [BigInt(INVOICES_PER_SEED), SEED_MAX_INVOICE, BigInt(Date.now())]));
    res.status(200).json({ ok: true, scenario, merchantsAdded: Math.max(add, 0), invoicesAdded: INVOICES_PER_SEED, txs });
  } catch (e) {
    unlock(`seed:${scenario}`); // başarısız denemede kilidi bırak
    throw e;
  }
});
