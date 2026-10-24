import { useBench } from "../lib/api.js";
import { num } from "../lib/format.js";
import { Brand } from "./Brand.jsx";

const W = 860;
const H = 420;
const M = { l: 70, r: 20, t: 20, b: 46 };

function Chart({ bench }) {
  const eth = bench.ethereum.points.map((p) => ({ x: p.merchants, y: Number(p.gasEstimate), over: !p.fitsCap }));
  const mon = bench.monad.points.filter((p) => p.ok).map((p) => ({ x: p.merchants, y: Number(p.gasEstimate) }));
  const cap = Number(bench.ethereum.txGasCap);
  const xMax = Math.max(...eth.map((p) => p.x), ...mon.map((p) => p.x));
  const yMax = Math.max(...eth.map((p) => p.y), ...mon.map((p) => p.y), cap) * 1.05;
  const sx = (x) => M.l + (x / xMax) * (W - M.l - M.r);
  const sy = (y) => H - M.b - (y / yMax) * (H - M.t - M.b);
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join(" ");
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  const failed = bench.ethereum.overLimitSettle;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Esnaf sayısına göre settle gas">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} stroke="#e3d8c2" />
          <text x={M.l - 8} y={sy(t) + 4} textAnchor="end" fontSize="12" fill="#4f6b69">
            {(t / 1e6).toFixed(0)}M
          </text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <text key={t} x={sx(t * xMax)} y={H - M.b + 20} textAnchor="middle" fontSize="12" fill="#4f6b69">
          {num(Math.round(t * xMax))}
        </text>
      ))}
      <text x={(W + M.l) / 2} y={H - 6} textAnchor="middle" fontSize="13" fill="#4f6b69">
        esnaf sayısı (esnaf başına 2 fatura)
      </text>
      <line x1={M.l} x2={W - M.r} y1={sy(cap)} y2={sy(cap)} stroke="#b3412f" strokeDasharray="6 5" strokeWidth="2" />
      <text x={W - M.r - 4} y={sy(cap) - 6} textAnchor="end" fontSize="12" fontWeight="700" fill="#b3412f">
        Ethereum işlem sınırı {num(cap)} (EIP-7825)
      </text>
      <path d={path(eth)} fill="none" stroke="#8a8a8a" strokeWidth="3" />
      <path d={path(mon)} fill="none" stroke="#1c6b66" strokeWidth="3" />
      {eth.map((p) => (
        <circle key={`e${p.x}`} cx={sx(p.x)} cy={sy(p.y)} r="4.5" fill={p.over ? "#b3412f" : "#8a8a8a"} />
      ))}
      {mon.map((p) => (
        <circle key={`m${p.x}`} cx={sx(p.x)} cy={sy(p.y)} r="5" fill="#1c6b66" />
      ))}
      {failed && (
        <text x={sx(failed.merchants) + 8} y={sy(Number(failed.gasEstimateNeeded)) - 8} fontSize="12" fill="#b3412f" fontWeight="700">
          sınırda düştü
        </text>
      )}
      <g fontSize="13">
        <rect x={M.l + 10} y={M.t + 4} width="12" height="12" fill="#1c6b66" />
        <text x={M.l + 28} y={M.t + 15}>Monad testnet</text>
        <rect x={M.l + 130} y={M.t + 4} width="12" height="12" fill="#8a8a8a" />
        <text x={M.l + 148} y={M.t + 15}>Ethereum kuralları (anvil, prague)</text>
      </g>
    </svg>
  );
}

export default function Bench() {
  const bench = useBench();
  const ready = bench?.monad && bench?.ethereum;
  const real = bench?.monad?.realSettle;
  const over = bench?.ethereum?.overLimitSettle;

  return (
    <div className="wide">
      <div className="topbar">
        <Brand />
        <nav className="links">
          <a href="#/">Büyük ekran</a>
          <a href="#/play">Telefon</a>
        </nav>
      </div>

      <section className="card">
        <h2>settle() gas ölçümü</h2>
        {!bench && <p className="muted">Yükleniyor…</p>}
        {bench && !ready && <p className="muted">Ölçüm sonuçları henüz tamamlanmadı.</p>}
        {ready && <Chart bench={bench} />}
      </section>

      {ready && (
        <>
          <section className="card">
            <h2>Nasıl okunur?</h2>
            <p>
              Aynı kontrat (TakasStress) iki ortamda büyütüldü. Ethereum'da bir işlem en fazla {num(bench.ethereum.txGasCap)} gas
              harcayabilir; sınırı aşan boyutta settle() gönderilince işlem düşer ve hiçbir esnaf takasa giremez. Monad testnet'te
              aynı iş tek işlemde tamamlandı.
            </p>
          </section>

          <section className="card">
            <h2>Gerçek işlemler</h2>
            <table>
              <thead>
                <tr>
                  <th>Ortam</th>
                  <th>Esnaf</th>
                  <th>Fatura</th>
                  <th>Gas</th>
                  <th>Sonuç</th>
                </tr>
              </thead>
              <tbody>
                {real && !real.error && (
                  <tr>
                    <td>Monad testnet</td>
                    <td>{num(real.merchants)}</td>
                    <td>{num(real.invoices)}</td>
                    <td>{num(Number(real.gasUsedEvent))}</td>
                    <td>
                      <a href={real.explorer} target="_blank" rel="noreferrer">
                        {real.status === "success" ? "başarılı ✓" : real.status}
                      </a>
                    </td>
                  </tr>
                )}
                {over && (
                  <tr>
                    <td>Ethereum (sınır {num(over.gasLimit)})</td>
                    <td>{num(over.merchants)}</td>
                    <td>{num(over.invoices)}</td>
                    <td>gereken ≈ {num(Number(over.gasEstimateNeeded))}</td>
                    <td className="err">{over.status === "reverted" ? "gas yetmedi, düştü" : over.status}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {real?.gasLimit && (
              <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                Monad tüm gas limitini ücretlendirdiği için işlem limiti tahmin + küçük pay olarak verildi ({num(Number(real.gasLimit))}); makbuzdaki gasUsed limiti
                gösterir, gerçek tüketim Settled olayındaki gasUsed değeridir.
              </p>
            )}
          </section>

          <section className="card">
            <h2>Ölçüm noktaları</h2>
            <table>
              <thead>
                <tr>
                  <th>Esnaf</th>
                  <th>Monad gas</th>
                  <th>esnaf başına</th>
                  <th>Ethereum gas</th>
                  <th>esnaf başına</th>
                </tr>
              </thead>
              <tbody>
                {[...new Set([...bench.monad.points.map((p) => p.merchants), ...bench.ethereum.points.map((p) => p.merchants)])]
                  .sort((a, b) => a - b)
                  .map((n) => {
                    const m = bench.monad.points.find((p) => p.merchants === n && p.ok);
                    const e = bench.ethereum.points.find((p) => p.merchants === n);
                    return (
                      <tr key={n}>
                        <td>{num(n)}</td>
                        <td>{m ? num(Number(m.gasEstimate)) : "–"}</td>
                        <td>{m ? num(m.gasPerMerchant) : "–"}</td>
                        <td className={e && !e.fitsCap ? "err" : ""}>{e ? num(Number(e.gasEstimate)) : "–"}</td>
                        <td>{e ? num(e.gasPerMerchant) : "–"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              Kırmızı: Ethereum işlem sınırını aşan boyut. Monad ölçümü için harcanan: {Number(bench.monad.spentMon).toFixed(1)} MON.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
