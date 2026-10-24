import { useState } from "react";
import { postJson, useTakasState } from "../lib/api.js";
import { monLabel, num } from "../lib/format.js";
import { Brand } from "./Brand.jsx";

const TOKEN_KEY = "takas.hostToken";

function Stat({ label, value }) {
  return (
    <div className="row">
      <span className="muted">{label}</span>
      <b className="mono">{value}</b>
    </div>
  );
}

export default function Host() {
  const { state, error, refresh } = useTakasState(2000);
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [done, setDone] = useState(null);

  const saveToken = (v) => {
    setToken(v);
    try {
      localStorage.setItem(TOKEN_KEY, v);
    } catch {
      /* kalıcı değil */
    }
  };

  async function settle() {
    setBusy(true);
    setMsg(null);
    setDone(null);
    try {
      const r = await postJson("/api/settle", {}, { "x-host-token": token });
      setDone(r);
      refresh();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const p = state?.preview;
  return (
    <div className="phone">
      <div className="topbar">
        <Brand />
        <span className="pill">Host</span>
      </div>

      <section className="card">
        <h2>Host anahtarı</h2>
        <input
          type="password"
          value={token}
          placeholder="Host anahtarını yapıştır"
          onChange={(e) => saveToken(e.target.value.trim())}
          autoComplete="off"
        />
      </section>

      <section className="card">
        <h2>Takas önizlemesi</h2>
        {error && !state && <p className="err">Bağlantı kurulamadı: {error}</p>}
        {!state && !error && <p className="muted">Yükleniyor…</p>}
        {p && (
          <div className="debts">
            <Stat label="Esnaf" value={num(state.memberCount)} />
            <Stat label="Açık fatura" value={num(state.invoiceCount)} />
            <Stat label="Kapanacak fatura" value={num(p.invoices)} />
            <Stat label="Katılımcı" value={num(p.participants)} />
            <Stat label="Dışlanacak esnaf" value={num(p.excluded)} />
            <Stat label="Brüt borç" value={monLabel(p.grossWei)} />
            <Stat label="Gereken nakit" value={monLabel(p.cashWei)} />
            <Stat label="Esnaf tasarrufu" value={monLabel(p.savedWei)} />
            <Stat label="Takas ücreti (kasa)" value={monLabel(p.feesWei, 5)} />
          </div>
        )}
      </section>

      <button className="btn amber block" style={{ fontSize: 22, padding: 20 }} disabled={busy || !token || !p || state.invoiceCount === 0} onClick={settle}>
        {busy ? (
          <>
            <span className="spinner" />
            Takas yapılıyor…
          </>
        ) : (
          "TAKAS"
        )}
      </button>
      {state && state.invoiceCount === 0 && <p className="muted">Açık fatura yok; takas edilecek bir şey bekleniyor.</p>}
      {msg && <p className="err">{msg}</p>}

      {done && (
        <section className="card result">
          <h2>Takas #{done.session} tamam</h2>
          <div className="big mono">{monLabel(done.stats.savedWei)} tasarruf</div>
          <p style={{ marginTop: 6 }}>
            {num(done.stats.invoices)} fatura, {num(done.stats.participants)} katılımcı, {num(done.stats.excluded)} dışlanan. Nakit{" "}
            {monLabel(done.stats.cashWei)}; brüt {monLabel(done.stats.grossWei)}.
          </p>
          <p style={{ marginTop: 6 }}>
            Gas: {num(done.stats.gasUsed)} (limit {num(done.gasLimit)}).{" "}
            <a href={done.explorer} target="_blank" rel="noreferrer">
              İşlemi gör
            </a>
          </p>
        </section>
      )}
    </div>
  );
}
