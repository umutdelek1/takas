// Telefon akışının sürelerini canlı site üzerinden ölçer: MON bağışı, şirket kaydı, borç yazma.
//   node scripts/measure-phone.mjs <site> <old|new>
// old: arayüzün önceki yolu (tahmin → writeContract → waitForTransactionReceipt)
// new: paralel hazırlık (tahmin + nonce + ücret tek partide) → yerel imza → ham işlem → 500 ms makbuz sorgusu
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { takasAbi } from "../src/abi.js";

const site = process.argv[2] || "https://takas-six.vercel.app";
const mode = process.argv[3] || "new";
const rpc = `${site}/api/rpc`;
const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc, { batch: mode === "new" }), pollingInterval: 500 });
const state = await (await fetch(`${site}/api/state`)).json();
const address = state.contract;
const creditor = state.members[0]?.address;
const account = privateKeyToAccount(generatePrivateKey());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const t = async (name, fn) => {
  const s = Date.now();
  const v = await fn();
  rows.push([name, Date.now() - s]);
  return v;
};

await t("drip (MON bağışı)", async () => {
  const r = await fetch(`${site}/api/drip`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address }),
  });
  if (!r.ok) throw new Error(`drip ${r.status}`);
});

async function oldWrite(functionName, args, value) {
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const est = await t(`${functionName}: gas tahmini`, () =>
    client.estimateContractGas({ address, abi: takasAbi, functionName, args, account, value }),
  );
  const hash = await t(`${functionName}: gönderim`, () =>
    wallet.writeContract({ address, abi: takasAbi, functionName, args, value, gas: est + 30_000n }),
  );
  await t(`${functionName}: onay bekleme`, () => client.waitForTransactionReceipt({ hash, pollingInterval: 500 }));
}

async function newWrite(functionName, args, value) {
  const data = encodeFunctionData({ abi: takasAbi, functionName, args });
  const [gas, nonce, fees] = await t(`${functionName}: hazırlık (paralel)`, () =>
    Promise.all([
      client.estimateGas({ account, to: address, data, value }),
      client.getTransactionCount({ address: account.address, blockTag: "pending" }),
      client.estimateFeesPerGas(),
    ]),
  );
  const raw = await account.signTransaction({
    chainId: 10143,
    type: "eip1559",
    to: address,
    data,
    value,
    nonce,
    gas: gas + 30_000n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const hash = await t(`${functionName}: gönderim`, () => client.sendRawTransaction({ serializedTransaction: raw }));
  await t(`${functionName}: onay bekleme`, async () => {
    for (;;) {
      const rc = await client.getTransactionReceipt({ hash }).catch(() => null);
      if (rc) return rc;
      await sleep(500);
    }
  });
}

const write = mode === "new" ? newWrite : oldWrite;
const s1 = Date.now();
await write("register", [], parseEther("0.1"));
rows.push(["register: TOPLAM (butondan onaya)", Date.now() - s1]);
if (creditor) {
  const s2 = Date.now();
  await write("owe", [creditor, parseEther("0.01")], 0n);
  rows.push(["owe: TOPLAM (butondan onaya)", Date.now() - s2]);
}
console.log(`mod=${mode}`);
for (const [n, ms] of rows) console.log(`${n.padEnd(36)} ${String(ms).padStart(6)} ms`);
