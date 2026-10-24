// TAKAS settle() referans uygulaması (bağımsız, sade JS).
// Kontrattan farklı olarak her dışlama turunda her şeyi baştan hesaplar; sonuçlar birebir aynı olmalı.
//
// Kullanım (forge FFI): node test/js/takas-ref.cjs <seed>
//   → rastgele senaryo + beklenen sonuçlar, abi.encode(uint256[]) olarak hex.

"use strict";

/**
 * Tek takas seansı. Tutarlar birim (1e12 wei) cinsinden BigInt.
 * state = { fee: BigInt, coll: BigInt[], sicil: number[], invoices: {d, c, a: BigInt}[] }
 * state'i yerinde günceller, özeti döndürür.
 */
function settle(state) {
  const n = state.coll.length;
  const excluded = new Array(n).fill(false);
  let credit, debit, cnt;

  for (;;) {
    credit = new Array(n).fill(0n);
    debit = new Array(n).fill(0n);
    cnt = new Array(n).fill(0);
    for (const { d, c, a } of state.invoices) {
      if (excluded[d] || excluded[c]) continue;
      debit[d] += a;
      credit[c] += a;
      cnt[d] += 1;
    }
    const failing = [];
    for (let i = 0; i < n; i++) {
      if (excluded[i] || cnt[i] === 0) continue;
      const net = debit[i] > credit[i] ? debit[i] - credit[i] : 0n;
      if (net + BigInt(cnt[i]) * state.fee > state.coll[i]) failing.push(i);
    }
    if (failing.length === 0) break;
    for (const i of failing) excluded[i] = true; // turdaki herkes aynı anda
  }

  const s = { invoices: 0n, participants: 0n, excluded: 0n, gross: 0n, cash: 0n, fees: 0n };
  for (let i = 0; i < n; i++) {
    if (excluded[i]) {
      s.excluded += 1n;
      continue;
    }
    if (cnt[i] === 0 && credit[i] === 0n) continue;
    const f = BigInt(cnt[i]) * state.fee;
    s.participants += 1n;
    s.invoices += BigInt(cnt[i]);
    s.gross += debit[i];
    if (debit[i] > credit[i]) s.cash += debit[i] - credit[i];
    s.fees += f;
    state.coll[i] = state.coll[i] + credit[i] - debit[i] - f;
    if (state.coll[i] < 0n) throw new Error("negatif teminat");
    state.sicil[i] += cnt[i];
  }
  state.invoices = state.invoices.filter(({ d, c }) => excluded[d] || excluded[c]);
  return s;
}

// mulberry32: küçük deterministik PRNG
function rng(seed) {
  let t = seed >>> 0;
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const int = (k) => Math.floor(next() * k); // [0, k)
  return { next, int };
}

function randomInvoices(r, n, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const d = r.int(n);
    let c = r.int(n - 1);
    if (c >= d) c++;
    const a = BigInt(r.next() < 0.1 ? 1 + r.int(5000) : 1 + r.int(400));
    out.push({ d, c, a });
  }
  return out;
}

function scenario(seed) {
  const r = rng(seed);
  const n = 2 + r.int(11);
  const fee = r.next() < 0.3 ? 0n : BigInt(1 + r.int(30));
  const coll = Array.from({ length: n }, () => (r.next() < 0.2 ? 0n : BigInt(r.int(r.next() < 0.5 ? 800 : 6000))));
  const inv1 = randomInvoices(r, n, 1 + r.int(40));
  const topup = Array.from({ length: n }, () => (r.next() < 0.5 ? 0n : BigInt(r.int(1000))));
  const inv2 = randomInvoices(r, n, r.int(15));
  return { n, fee, coll, inv1, topup, inv2 };
}

function sessionBlock(s, state) {
  const out = [s.invoices, s.participants, s.excluded, s.gross, s.cash, s.fees, BigInt(state.invoices.length)];
  for (const { d, c, a } of state.invoices) out.push(BigInt(d), BigInt(c), a);
  out.push(...state.coll, ...state.sicil.map(BigInt));
  return out;
}

const ZERO = { invoices: 0n, participants: 0n, excluded: 0n, gross: 0n, cash: 0n, fees: 0n };

function run(seed) {
  const sc = scenario(seed);
  const flat = [BigInt(sc.n), sc.fee, ...sc.coll, BigInt(sc.inv1.length)];
  for (const { d, c, a } of sc.inv1) flat.push(BigInt(d), BigInt(c), a);
  flat.push(...sc.topup, BigInt(sc.inv2.length));
  for (const { d, c, a } of sc.inv2) flat.push(BigInt(d), BigInt(c), a);

  const state = { fee: sc.fee, coll: [...sc.coll], sicil: new Array(sc.n).fill(0), invoices: [...sc.inv1] };
  flat.push(...sessionBlock(settle(state), state));

  for (let i = 0; i < sc.n; i++) state.coll[i] += sc.topup[i];
  state.invoices.push(...sc.inv2);
  const s2 = state.invoices.length ? settle(state) : ZERO; // kontrat boş seansta revert eder; test atlar
  flat.push(...sessionBlock(s2, state));
  return flat;
}

function encodeUintArray(values) {
  const word = (v) => {
    if (v < 0n) throw new Error("negatif değer");
    return v.toString(16).padStart(64, "0");
  };
  return "0x" + word(32n) + word(BigInt(values.length)) + values.map(word).join("");
}

if (require.main === module) {
  const seed = Number(BigInt(process.argv[2] || "1") % 4294967296n);
  process.stdout.write(encodeUintArray(run(seed)));
}

module.exports = { settle, scenario, run };
