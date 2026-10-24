import { keccak256 } from "viem";
import { rpcUrls, sleep, HttpError } from "./_lib.js";

// Telefonlar RPC anahtarını görmesin ve tek noktadan yeniden deneme/yedek RPC uygulansın diye
// yalnızca gerekli JSON-RPC yöntemleri iletilir.
const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_estimateGas",
  "eth_call",
  "eth_sendRawTransaction",
]);

async function post(url, payload) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    let json = null;
    try {
      json = await r.json();
    } catch {
      /* gövde JSON değil */
    }
    return { status: r.status, json };
  } catch (e) {
    return { status: 0, json: null, error: e };
  } finally {
    clearTimeout(timer);
  }
}

const errText = (r) => String(r.json?.error?.message || "").toLowerCase();
const transient = (r) => r.status === 0 || r.status === 429 || r.status >= 500;

/** Okuma yöntemleri: 429/5xx'te yeniden dene, sonra yedek RPC. */
async function forward(payload) {
  let last = null;
  for (const url of rpcUrls()) {
    for (let i = 0; i < 3; i++) {
      const r = await post(url, payload);
      last = r;
      if (!transient(r)) return r;
      await sleep(250 * (i + 1));
    }
  }
  return last;
}

/**
 * İmzalı işlemi yayınlar. Yeni gelen MON'u RPC henüz görmediyse ("insufficient balance") aynı imzalı
 * işlem 1-2-3 sn arayla yeniden yayınlanır. Birincil RPC geçerli işlemi reddederse yedek denenir.
 */
async function broadcast(payload) {
  const raw = payload.params?.[0];
  const hash = typeof raw === "string" ? keccak256(raw) : null;
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    let insufficient = false;
    for (const url of rpcUrls()) {
      const r = await post(url, payload);
      last = r;
      if (r.json?.result) return r;
      const m = errText(r);
      if (m.includes("already known") || m.includes("known transaction") || m.includes("already imported")) {
        return { status: 200, json: { jsonrpc: "2.0", id: payload.id, result: hash } };
      }
      if (m.includes("nonce too low")) return r;
      if (m.includes("insufficient")) insufficient = true;
    }
    if (!insufficient && !transient(last)) return last;
    await sleep(1000 * (attempt + 1));
  }
  return last;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Yalnızca POST.");
    const b = req.body;
    if (!b || Array.isArray(b) || typeof b.method !== "string") throw new HttpError(400, "Geçersiz JSON-RPC isteği.");
    if (!ALLOWED.has(b.method)) throw new HttpError(403, "Bu yöntem kapalı.");
    const payload = { jsonrpc: "2.0", id: b.id ?? 1, method: b.method, params: b.params ?? [] };
    const r = b.method === "eth_sendRawTransaction" ? await broadcast(payload) : await forward(payload);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(r?.json ?? { jsonrpc: "2.0", id: payload.id, error: { code: -32000, message: "RPC yanıt vermedi" } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    res.status(status).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: e.message || "hata" } });
  }
}
