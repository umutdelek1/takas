import { createPublicClient, defineChain, encodeFunctionData, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import deployment from "../deployment.js";
import { takasAbi } from "../abi.js";

export const CONTRACT = deployment.takas;
export const EXPLORER = "https://testnet.monadexplorer.com";

export const TEMP_COLLATERAL = parseEther("0.1");
export const DEBT_CHOICES = [parseEther("0.01"), parseEther("0.02"), parseEther("0.05")];

// RPC anahtarı tarayıcıya inmesin diye tüm istekler /api/rpc üzerinden geçer.
const rpcUrl = () => `${location.origin}/api/rpc`;

export const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl()] } },
  blockExplorers: { default: { name: "MonadExplorer", url: EXPLORER } },
});

// Aynı anda giden istekler tek POST'ta (JSON-RPC partisi) /api/rpc'ye gider.
export const client = createPublicClient({
  chain,
  transport: http(rpcUrl(), { retryCount: 2, retryDelay: 300, batch: true }),
  pollingInterval: 500,
});

const KEY = "takas.pk";

/** Geçici cüzdan: tarayıcıda üretilir, localStorage'da durur. */
export function loadWallet() {
  let pk = null;
  try {
    pk = localStorage.getItem(KEY);
  } catch {
    /* gizli sekme */
  }
  if (!pk) {
    pk = generatePrivateKey();
    try {
      localStorage.setItem(KEY, pk);
    } catch {
      /* kalıcı değil, oturum boyunca çalışır */
    }
  }
  return privateKeyToAccount(pk);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sözleşme yazma işlemi. Gas limiti = tahmin + 30.000 pay: çift/tek numaralı kayıt farklı maliyetli
 * olduğundan ve aynı anda gönderilen işlemlerde depolama durumu kayabildiğinden, tahmin tek başına
 * yetmeyebilir. Yeni gelen MON'u RPC henüz görmüyorsa tahmin başarısız olur; birkaç saniye beklenir.
 */
export async function write(account, functionName, args = [], value = 0n) {
  // Hazırlık tek turda: gas tahmini, nonce ve ücretler aynı partide istenir.
  let est, nonce, fees;
  for (let i = 0; ; i++) {
    try {
      [est, nonce, fees] = await Promise.all([
        // Hesap adresle verilir: yerel hesapta viem önce eth_fillTransaction dener, bir tur kaybedilir.
        client.estimateContractGas({ address: CONTRACT, abi: takasAbi, functionName, args, account: account.address, value }),
        client.getTransactionCount({ address: account.address, blockTag: "pending" }),
        client.estimateFeesPerGas(),
      ]);
      break;
    } catch (e) {
      const m = String(e?.message || "").toLowerCase();
      if (i < 3 && (m.includes("insufficient") || m.includes("balance") || m.includes("funds"))) {
        await sleep(1000 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  // Yerelde imzalanır, ham işlem olarak gönderilir (zincir kimliği ve ücret için ek tur yok).
  const raw = await account.signTransaction({
    chainId: chain.id,
    type: "eip1559",
    to: CONTRACT,
    data: encodeFunctionData({ abi: takasAbi, functionName, args }),
    value,
    nonce,
    gas: est + 30_000n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const hash = await client.sendRawTransaction({ serializedTransaction: raw });
  // Onay doğrudan makbuzla, 500 ms aralıkla sorulur.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const rc = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (rc) {
      if (rc.status !== "success") throw new Error("REVERTED");
      return { hash, rc };
    }
    if (Date.now() > deadline) throw new Error("timeout");
    await sleep(500);
  }
}

/** Hata → telefonda gösterilecek anlaşılır Türkçe mesaj. */
export function trError(e) {
  const m = `${e?.shortMessage || ""} ${e?.message || ""} ${e?.cause?.message || ""}`;
  const l = m.toLowerCase();
  if (m.includes("AlreadyRegistered")) return "Şirketin zaten kayıtlı.";
  if (m.includes("NotRegistered")) return "Önce şirketini kaydetmelisin.";
  if (m.includes("SelfInvoice")) return "Kendine borç yazamazsın.";
  if (m.includes("ZeroAmount")) return "Tutar sıfır olamaz.";
  if (m.includes("NotUnitMultiple")) return "Tutar çok küçük bir birime bölünemiyor.";
  if (m.includes("InsufficientCollateral")) return "Teminatın bu çekim için yetmiyor.";
  if (l.includes("insufficient funds") || l.includes("insufficient balance") || l.includes("exceeds the balance"))
    return "Cüzdanda yeterli MON yok. MON gelene kadar birkaç saniye bekle.";
  if (l.includes("timeout") || l.includes("timed out") || l.includes("took too long"))
    return "Ağ yavaş yanıt verdi. Birkaç saniye sonra tekrar dene.";
  if (l.includes("failed to fetch") || l.includes("network") || l.includes("429"))
    return "Bağlantı sorunu. İnternetini kontrol edip tekrar dene.";
  if (m.includes("REVERTED")) return "İşlem zincirde reddedildi. Tekrar dene.";
  return "İşlem gönderilemedi. Birkaç saniye sonra tekrar dene.";
}
