import { publicClient, hostWallet, route, HttpError, sendWithRetry, pad, EXPLORER } from "../_lib.js";
import {
  demoAbi,
  requireDemo,
  rateLimit,
  lock,
  unlock,
  MAX_MERCHANTS,
  MAX_OPEN_INVOICES,
  MERCHANTS_PER_SEED,
  INVOICES_PER_SEED,
  SEED_COLLATERAL,
  SEED_MAX_INVOICE,
} from "../_demo.js";

const LOCK_MS = 20_000;

async function send(address, functionName, args) {
  const wallet = hostWallet();
  const gas = pad(
    await publicClient.estimateContractGas({ address, abi: demoAbi, functionName, args, account: wallet.account }),
  );
  const hash = await sendWithRetry(() => wallet.writeContract({ address, abi: demoAbi, functionName, args, gas }));
  const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 25_000 });
  if (rc.status !== "success") throw new HttpError(502, `Demo işlemi başarısız oldu (${hash}).`);
  return { hash, explorer: `${EXPLORER}/tx/${hash}`, gasLimit: gas.toString() };
}

/** 10 sentetik işletme (tavan 40) ve 20 borç ekler. Herkes çağırabilir; 20 sn ortak kilit ve IP sınırı var. */
export default route(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Yalnızca POST.");
  const address = requireDemo();
  rateLimit(req, "seed", 5_000);
  lock("seed", LOCK_MS);
  try {
    const read = (functionName) => publicClient.readContract({ address, abi: demoAbi, functionName });
    const [members, open] = await Promise.all([read("memberCount"), read("openInvoiceCount")]);
    if (Number(open) + INVOICES_PER_SEED > MAX_OPEN_INVOICES) {
      throw new HttpError(409, "Ağda yeterince açık fatura var. Önce TAKAS'a bas.");
    }
    const txs = [];
    const add = Math.min(MERCHANTS_PER_SEED, MAX_MERCHANTS - Number(members));
    if (add > 0) txs.push(await send(address, "seedMerchants", [BigInt(add), SEED_COLLATERAL]));
    if (Number(members) + Math.max(add, 0) < 2) throw new HttpError(409, "Önce en az iki işletme gerekir.");
    txs.push(await send(address, "seedInvoices", [BigInt(INVOICES_PER_SEED), SEED_MAX_INVOICE, BigInt(Date.now())]));
    res.status(200).json({ ok: true, merchantsAdded: Math.max(add, 0), invoicesAdded: INVOICES_PER_SEED, txs });
  } catch (e) {
    unlock("seed"); // başarısız denemede kilidi bırak
    throw e;
  }
});
