import { useBench } from "../lib/api.js";
import { num } from "../lib/format.js";
import { Brand } from "./Brand.jsx";
import { Tag } from "./Tag.jsx";

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
  const real = bench.monad.realSettle;
  const failed = bench.ethereum.overLimitSettle;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="İşletme sayısına göre settle gas">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} stroke="#DFE4EE" />
          <text x={M.l - 8} y={sy(t) + 4} textAnchor="end" fontSize="12" fill="#566175">
            {(t / 1e6).toFixed(0)}M
          </text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <text key={t} x={sx(t * xMax)} y={H - M.b + 20} textAnchor="middle" fontSize="12" fill="#566175">
          {num(Math.round(t * xMax))}
        </text>
      ))}
      <text x={(W + M.l) / 2} y={H - 6} textAnchor="middle" fontSize="13" fill="#566175">
        işletme sayısı (işletme başına 2 fatura)
      </text>
      <line x1={M.l} x2={W - M.r} y1={sy(cap)} y2={sy(cap)} stroke="#DC2626" strokeDasharray="6 5" strokeWidth="2" />
      <text x={W - M.r - 4} y={sy(cap) - 6} textAnchor="end" fontSize="12" fontWeight="700" fill="#DC2626">
        Ethereum işlem sınırı {num(cap)} (EIP-7825)
      </text>
      <path d={path(eth)} fill="none" stroke="#64748B" strokeWidth="3" />
      <path d={path(mon)} fill="none" stroke="#6E54FF" strokeWidth="3" />
      {eth.map((p) => (
        <circle key={`e${p.x}`} cx={sx(p.x)} cy={sy(p.y)} r="4.5" fill={p.over ? "#DC2626" : "#64748B"} />
      ))}
      {mon.map((p) => (
        <circle key={`m${p.x}`} cx={sx(p.x)} cy={sy(p.y)} r="5" fill="#6E54FF" />
      ))}
      {real && real.status === "success" && (
        <g>
          <circle cx={sx(real.merchants)} cy={sy(Number(real.gasUsedEvent))} r="9" fill="none" stroke="#059669" strokeWidth="3" />
          <text x={sx(real.merchants) - 14} y={sy(Number(real.gasUsedEvent)) - 14} textAnchor="end" fontSize="12" fontWeight="700" fill="#059669">
            gerçek işlem (ölçülen)
          </text>
        </g>
      )}
      {failed && (
        <text x={sx(failed.merchants) + 8} y={sy(Number(failed.gasEstimateNeeded)) - 10} fontSize="12" fill="#DC2626" fontWeight="700">
          sınırda düştü (ölçülen)
        </text>
      )}
      <g fontSize="13" fill="#0E1726">
        <rect x={M.l + 10} y={M.t + 4} width="12" height="12" fill="#6E54FF" />
        <text x={M.l + 28} y={M.t + 15}>Monad testnet</text>
        <rect x={M.l + 130} y={M.t + 4} width="12" height="12" fill="#64748B" />
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
  const derived = bench?.ethereum?.derived;

  return (
    <div className="wide">
      <div className="topbar">
        <Brand />
        <nav className="links">
          <a href="#/">Tanıtım</a>
          <a href="#/ekran">Ekran</a>
          <a href="#/play">Telefon</a>
        </nav>
      </div>

      <div>
        <h1 className="hero-title">20.000 fatura, tek işlem</h1>
        <p className="muted" style={{ marginTop: 10, maxWidth: 680 }}>
          Aynı kontrat iki ortamda büyütüldü. Ethereum'da bir işlem en fazla {bench ? num(bench.ethereum.txGasCap) : "16.777.216"} gas harcayabilir;
          sınırı aşan boyutta settle() düşer ve hiçbir işletme takasa giremez. Monad testnet'te 10.000 işletmenin 20.000 faturası tek işlemde kapandı.
        </p>
        <div className="row" style={{ justifyContent: "flex-start", marginTop: 14, flexWrap: "wrap" }}>
          <Tag kind="ölçülen" />
          <span className="muted">gerçek işlem makbuzu ve Settled olayı</span>
          <Tag kind="tahmin" />
          <span className="muted">eth_estimateGas, işlem gönderilmedi</span>
          <Tag kind="hesaplanan" />
          <span className="muted">ölçülen/tahmin değerlerden türetildi</span>
        </div>
      </div>

      <section className="card">
        <h2>settle() gas</h2>
        {!bench && <p className="muted">Yükleniyor…</p>}
        {bench && !ready && <p className="muted">Ölçüm sonuçları henüz tamamlanmadı.</p>}
        {ready && <Chart bench={bench} />}
      </section>

      {ready && (
        <>
          <section className="card">
            <h2>Gerçek işlemler</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ortam</th>
                    <th>İşletme</th>
                    <th>Fatura</th>
                    <th>Gas</th>
                    <th>Sonuç</th>
                    <th>Kaynak</th>
                  </tr>
                </thead>
                <tbody>
                  {real && !real.error && (
                    <tr>
                      <td>Monad testnet</td>
                      <td className="num">{num(real.merchants)}</td>
                      <td className="num">{num(real.invoices)}</td>
                      <td className="num">{num(Number(real.gasUsedEvent))}</td>
                      <td>
                        <a href={real.explorer} target="_blank" rel="noreferrer">
                          {real.status === "success" ? "başarılı, işlemi gör" : real.status}
                        </a>
                      </td>
                      <td>
                        <Tag kind={real.kind} />
                      </td>
                    </tr>
                  )}
                  {over && (
                    <tr>
                      <td>Ethereum (sınır {num(over.gasLimit)})</td>
                      <td className="num">{num(over.merchants)}</td>
                      <td className="num">{num(over.invoices)}</td>
                      <td className="num">gereken ≈ {num(Number(over.gasEstimateNeeded))}</td>
                      <td className="debt">{over.status === "reverted" ? "gas yetmedi, düştü" : over.status}</td>
                      <td>
                        <Tag kind={over.kind} />
                      </td>
                    </tr>
                  )}
                  {derived && (
                    <tr>
                      <td>Ethereum, tek işleme sığan</td>
                      <td className="num">≈ {num(derived.maxMerchantsPerTx)}</td>
                      <td className="num">≈ {num(derived.maxMerchantsPerTx * 2)}</td>
                      <td className="num">≤ {num(bench.ethereum.txGasCap)}</td>
                      <td className="muted" style={{ whiteSpace: "normal", textAlign: "right" }}>
                        sınır ÷ işletme başı gas
                      </td>
                      <td>
                        <Tag kind={derived.kind} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {real?.gasLimit && (
              <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                Monad tüm gas limitini ücretlendirdiği için limit tahmin + küçük pay olarak verildi ({num(Number(real.gasLimit))}). Makbuzdaki
                gasUsed limiti gösterir; gerçek tüketim Settled olayındaki gasUsed değeridir.
              </p>
            )}
          </section>

          <section className="card">
            <h2>Ölçüm noktaları</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>İşletme</th>
                    <th>Monad gas</th>
                    <th>işletme başına</th>
                    <th>Ethereum gas</th>
                    <th>işletme başına</th>
                    <th>Kaynak</th>
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
                          <td className="num">{num(n)}</td>
                          <td className="num">{m ? num(Number(m.gasEstimate)) : "–"}</td>
                          <td className="num">{m ? num(m.gasPerMerchant) : "–"}</td>
                          <td className={`num ${e && !e.fitsCap ? "debt" : ""}`}>{e ? num(Number(e.gasEstimate)) : "–"}</td>
                          <td className="num">{e ? num(e.gasPerMerchant) : "–"}</td>
                          <td>
                            <Tag kind={(m || e)?.kind} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              Kırmızı: Ethereum işlem sınırını aşan boyut. Monad ölçümü için harcanan: {Number(bench.monad.spentMon).toFixed(1)} MON.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
