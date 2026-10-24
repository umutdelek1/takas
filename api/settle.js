import { timingSafeEqual } from "node:crypto";
import {
  publicClient,
  hostWallet,
  takasAbi,
  requireDeployed,
  route,
  HttpError,
  sendWithRetry,
  pad,
  EXPLORER,
} from "./_lib.js";
import { parseEventLogs } from "viem";

function tokenOk(given) {
  const want = process.env.HOST_TOKEN || "";
  if (!want || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default route(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Yalnızca POST.");
  if (!tokenOk(req.headers["x-host-token"] || req.body?.token)) throw new HttpError(401, "Host anahtarı hatalı.");
  const address = requireDeployed();

  const wallet = hostWallet();
  const account = wallet.account;
  // Gas limiti = tahmin + küçük pay (Monad tüm limiti ücretlendirir).
  let estimate;
  try {
    estimate = await publicClient.estimateContractGas({ address, abi: takasAbi, functionName: "settle", account });
  } catch (e) {
    if (String(e?.message).includes("NoOpenInvoices")) throw new HttpError(409, "Açık fatura yok, takas edilecek bir şey yok.");
    throw e;
  }
  const gas = pad(estimate);
  const hash = await sendWithRetry(() =>
    wallet.writeContract({ address, abi: takasAbi, functionName: "settle", gas }),
  );
  const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 30_000 });
  if (rc.status !== "success") throw new HttpError(502, `Takas işlemi başarısız oldu (${hash}).`);

  const [ev] = parseEventLogs({ abi: takasAbi, logs: rc.logs, eventName: "Settled" });
  const s = ev.args.stats;
  res.status(200).json({
    ok: true,
    txHash: hash,
    explorer: `${EXPLORER}/tx/${hash}`,
    session: Number(ev.args.session),
    gasLimit: gas.toString(),
    gasUsedReceipt: rc.gasUsed.toString(),
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
});
