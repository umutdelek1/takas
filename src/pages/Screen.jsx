import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useBench, useTakasState } from "../lib/api.js";
import { EXPLORER, CONTRACT } from "../lib/chain.js";
import { mon, monLabel, num, shortAddr } from "../lib/format.js";
import { merchantName } from "../lib/names.js";
import { Brand } from "./Brand.jsx";

const lc = (s) => (s || "").toLowerCase();

/** Sayıyı hedef değere akıcı biçimde taşır. */
function useTween(target, ms = 700) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = a + (target - a) * e;
      setV(cur);
      from.current = cur;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const toMon = (wei) => Number(wei) / 1e18;
const fmt = (n, d = 3) => n.toLocaleString("tr-TR", { maximumFractionDigits: d, minimumFractionDigits: 0 });

function Counter({ label, children, className = "" }) {
  return (
    <div className={`counter ${className}`}>
      <small>{label}</small>
      <div className="val mono">{children}</div>
    </div>
  );
}

function DebtGraph({ state }) {
  const W = 760;
  const H = 520;
  const { nodes, edges, max } = useMemo(() => {
    const byAddr = new Map(state.members.map((m) => [lc(m.address), m]));
    const agg = new Map();
    for (const i of state.invoices) {
      const k = `${lc(i.debtor)}>${lc(i.creditor)}`;
      agg.set(k, (agg.get(k) || 0n) + BigInt(i.amountWei));
    }
    const ids = new Set();
    const e = [];
    for (const [k, v] of agg) {
      const [d, c] = k.split(">");
      const dm = byAddr.get(d);
      const cm = byAddr.get(c);
      if (!dm || !cm) continue;
      ids.add(dm.id);
      ids.add(cm.id);
      e.push({ d: dm.id, c: cm.id, v: Number(v) });
    }
    const list = [...ids].sort((a, b) => a - b).slice(0, 60);
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 62;
    const pos = new Map(
      list.map((id, i) => {
        const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
        return [id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a }];
      }),
    );
    return {
      nodes: list.map((id) => ({ id, ...pos.get(id) })),
      edges: e.filter((x) => pos.has(x.d) && pos.has(x.c)).map((x) => ({ ...x, p: pos.get(x.d), q: pos.get(x.c) })),
      max: Math.max(1, ...e.map((x) => x.v)),
    };
  }, [state]);

  if (nodes.length === 0) {
    return (
      <div className="graph" style={{ display: "grid", placeItems: "center", minHeight: 360 }}>
        <p className="muted" style={{ fontSize: 20 }}>
          Henüz borç yok. Telefonundan dükkân aç, borç yaz!
        </p>
      </div>
    );
  }
  const small = nodes.length <= 28;
  return (
    <svg className="graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Borç ağı">
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#f2a541" />
        </marker>
      </defs>
      {edges.map((e, i) => {
        const dx = e.q.x - e.p.x;
        const dy = e.q.y - e.p.y;
        const len = Math.hypot(dx, dy) || 1;
        const sx = e.p.x + (dx / len) * 12;
        const sy = e.p.y + (dy / len) * 12;
        const ex = e.q.x - (dx / len) * 15;
        const ey = e.q.y - (dy / len) * 15;
        // hafif eğri: karşılıklı borçlar üst üste binmesin
        const mx = (sx + ex) / 2 - (dy / len) * 22;
        const my = (sy + ey) / 2 + (dx / len) * 22;
        return (
          <path
            key={i}
            d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`}
            fill="none"
            stroke="#f2a541"
            strokeOpacity="0.8"
            strokeWidth={1.2 + (e.v / max) * 4}
            markerEnd="url(#ah)"
          />
        );
      })}
      {nodes.map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={11} fill="#0f3d3e" />
          <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
            {merchantName(n.id)[0]}
          </text>
          {small && (
            <text
              x={n.x + Math.cos(n.a) * 22}
              y={n.y + Math.sin(n.a) * 22 + 4}
              textAnchor={Math.cos(n.a) > 0.2 ? "start" : Math.cos(n.a) < -0.2 ? "end" : "middle"}
              fontSize="12"
              fill="#12302f"
            >
              {merchantName(n.id)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function Compare({ bench }) {
  if (!bench?.monad || !bench?.ethereum) {
    return <p className="muted">Ölçüm sonuçları hazırlanıyor.</p>;
  }
  const eth = bench.ethereum;
  const firstOver = eth.points.find((p) => !p.fitsCap);
  const perEth = firstOver ? firstOver.gasPerMerchant : eth.points[eth.points.length - 1].gasPerMerchant;
  const ethMax = Math.floor(Number(eth.txGasCap) / perEth);
  const real = bench.monad.realSettle;
  const monMax = real?.merchants ?? bench.monad.points.filter((p) => p.ok).at(-1)?.merchants ?? 0;
  const top = Math.max(ethMax, monMax, 1);
  return (
    <div className="compare">
      <div>
        <div className="row">
          <b>Monad</b>
          <span className="mono">{num(monMax)} esnaf / tek işlem</span>
        </div>
        <div className="bar" style={{ width: `${(monMax / top) * 100}%` }} />
      </div>
      <div>
        <div className="row">
          <b>Ethereum</b>
          <span className="mono">≈ {num(ethMax)} esnaf / tek işlem</span>
        </div>
        <div className="bar eth" style={{ width: `${(ethMax / top) * 100}%` }} />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Ethereum'da işlem başına gas sınırı {num(eth.txGasCap)} (EIP-7825). Aynı kontrat, esnaf başına 2 fatura.{" "}
        <a href="#/olcum">Ayrıntılar</a>
      </p>
    </div>
  );
}

export default function Screen() {
  const { state, error } = useTakasState(1500);
  const bench = useBench();
  const [qr, setQr] = useState("");
  const link = `${location.origin}/#/play`;

  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 560, color: { dark: "#0f3d3e", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [link]);

  const openTotal = state ? state.invoices.reduce((s, i) => s + Number(i.amountWei), 0) / 1e18 : 0;
  const cash = state ? toMon(state.preview.cashWei) : 0;
  const cumSaved = state ? toMon(BigInt(state.cumulative.grossWei) - BigInt(state.cumulative.cashWei)) : 0;
  const treasury = state ? toMon(state.feeBalanceWei) : 0;

  const tOpen = useTween(openTotal);
  const tCash = useTween(cash);
  const tSaved = useTween(cumSaved);
  const tTreasury = useTween(treasury);
  const last = state?.lastSettle;

  return (
    <div className="screen">
      <div className="topbar">
        <Brand />
        <nav className="links">
          <a href="#/play">Telefon</a>
          <a href="#/host">Host</a>
          <a href="#/olcum">Ölçüm</a>
        </nav>
      </div>

      <div className="screen-grid">
        <div style={{ display: "grid", gap: 16 }}>
          <section className="card" style={{ textAlign: "center" }}>
            <h2>Katıl</h2>
            {qr ? <img className="qr" src={qr} alt="Katılmak için QR kodu okut" /> : <div className="qr" style={{ aspectRatio: "1" }} />}
            <p style={{ marginTop: 8, fontWeight: 700 }}>Telefonunla okut, dükkânını aç</p>
            <p className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
              {link}
            </p>
          </section>
          <section className="card">
            <h2>Çarşı</h2>
            <div className="row">
              <span className="muted">Esnaf</span>
              <b className="mono">{state ? num(state.memberCount) : "…"}</b>
            </div>
            <div className="row">
              <span className="muted">Açık fatura</span>
              <b className="mono">{state ? num(state.invoiceCount) : "…"}</b>
            </div>
            <div className="row">
              <span className="muted">Yapılan takas</span>
              <b className="mono">{state ? num(state.session) : "…"}</b>
            </div>
            <div className="row">
              <span className="muted">Ücret / fatura</span>
              <b className="mono">{state ? monLabel(state.feeWei, 5) : "…"}</b>
            </div>
          </section>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          {error && !state && <div className="card err">Bağlantı kurulamadı: {error}</div>}
          {state ? <DebtGraph state={state} /> : <div className="graph" style={{ minHeight: 360 }} />}
          <section className="card">
            <h2>Son takas</h2>
            {last ? (
              <>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <b>Takas #{last.session}</b>
                  <span>
                    {num(last.stats.invoices)} fatura · {num(last.stats.participants)} katılımcı · {num(last.stats.excluded)} dışlanan
                  </span>
                </div>
                <p style={{ marginTop: 6 }}>
                  {monLabel(last.stats.grossWei)} borç yerine yalnızca <b>{monLabel(last.stats.cashWei)}</b> nakit el değiştirdi.{" "}
                  <a href={last.explorer} target="_blank" rel="noreferrer">
                    İşlemi gör
                  </a>
                </p>
              </>
            ) : (
              <p className="muted">Henüz takas yapılmadı.</p>
            )}
          </section>
        </div>

        <div className="counters">
          <Counter label="Borç → gereken nakit">
            {fmt(tOpen)} <span className="arrow">→</span>
            <em>{fmt(tCash)}</em>
            <span style={{ fontSize: 16 }}> MON</span>
          </Counter>
          <Counter label="Esnaf tasarrufu" className="amber">
            <em>{fmt(tSaved)}</em>
            <span style={{ fontSize: 16 }}> MON</span>
          </Counter>
          <Counter label="TAKAS kasası">
            <em>{fmt(tTreasury, 4)}</em>
            <span style={{ fontSize: 16 }}> MON</span>
          </Counter>
          <section className="card">
            <h2>Monad / Ethereum</h2>
            <Compare bench={bench} />
          </section>
          <p className="muted" style={{ fontSize: 12 }}>
            Kontrat:{" "}
            <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
              {shortAddr(CONTRACT)}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
