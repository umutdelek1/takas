import { isAddress, parseEther, getAddress } from "viem";
import { publicClient, hostWallet, route, HttpError, sendWithRetry, sleep } from "./_lib.js";

const DRIP = parseEther("0.2");

// Aynı örnek içinde eşzamanlı çift istekleri engeller; kalıcı kural zincirden okunur.
const inFlight = new Set();

export default route(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Yalnızca POST.");
  const raw = req.body?.address;
  if (typeof raw !== "string" || !isAddress(raw)) throw new HttpError(400, "Geçersiz cüzdan adresi.");
  const to = getAddress(raw);
  if (inFlight.has(to)) throw new HttpError(429, "Bu cüzdana zaten gönderiliyor.");
  inFlight.add(to);
  try {
    // Her adrese bir kez: yeni cüzdanın bakiyesi 0 ve işlem sayısı 0 olmalı.
    const [balance, nonce] = await Promise.all([
      publicClient.getBalance({ address: to }),
      publicClient.getTransactionCount({ address: to }),
    ]);
    if (balance > 0n || nonce > 0) {
      res.status(200).json({ ok: true, already: true });
      return;
    }
    const wallet = hostWallet();
    const hash = await sendWithRetry(() => wallet.sendTransaction({ to, value: DRIP, gas: 21_000n }));
    const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500, timeout: 20_000 });
    if (rc.status !== "success") throw new HttpError(502, "MON gönderimi başarısız oldu.");
    // Yeni bakiyenin RPC'ye yayılmasını bekle.
    for (let i = 0; i < 8; i++) {
      if ((await publicClient.getBalance({ address: to })) >= DRIP) break;
      await sleep(400);
    }
    res.status(200).json({ ok: true, hash });
  } finally {
    inFlight.delete(to);
  }
});
