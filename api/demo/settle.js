import { parseEventLogs } from "viem";
import { publicClient, hostWallet, route, HttpError, sendWithRetry, pad, EXPLORER } from "../_lib.js";
import { demoAbi, requireDemo, rateLimit, lock, unlock } from "../_demo.js";

/** Demo ağında settle(): token yok, herkes çağırabilir; IP başına 8 sn, ortak 5 sn sınır. */
export default route(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Yalnızca POST.");
  const address = requireDemo();
  rateLimit(req, "settle", 8_000);
  lock("settle", 5_000);
  try {
    const wallet = hostWallet();
    let estimate;
    try {
      estimate = await publicClient.estimateContractGas({
        address,
        abi: demoAbi,
        functionName: "settle",
        account: wallet.account,
      });
    } catch (e) {
      if (String(e?.message).includes("NoOpenInvoices")) throw new HttpError(409, "Açık fatura yok. Önce demo ağını oluştur.");
      throw e;
    }
    const gas = pad(estimate);
    const hash = await sendWithRetry(() => wallet.writeContract({ address, abi: demoAbi, functionName: "settle", gas }));
    const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 25_000 });
    if (rc.status !== "success") throw new HttpError(502, `Takas işlemi başarısız oldu (${hash}).`);
    const [ev] = parseEventLogs({ abi: demoAbi, logs: rc.logs, eventName: "Settled" });
    const s = ev.args.stats;
    res.status(200).json({
      ok: true,
      txHash: hash,
      explorer: `${EXPLORER}/tx/${hash}`,
      session: Number(ev.args.session),
      gasLimit: gas.toString(),
      stats: {
        invoices: Number(s.invoices),
        participants: Number(s.participants),
        excluded: Number(s.excluded),
        grossWei: s.grossWei.toString(),
        cashWei: s.cashWei.toString(),
        savedWei: s.savedWei.toString(),
        feesWei: s.feesWei.toString(),
        gasUsed: Number(s.gasUsed),
      },
    });
  } catch (e) {
    unlock("settle");
    throw e;
  }
});
