import { useEffect, useRef, useState } from "react";

async function jsonOrError(r) {
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* boş gövde */
  }
  if (!r.ok) throw new Error(j?.error || `Sunucu hatası (${r.status})`);
  return j;
}

export const getState = (path = "/api/state") => fetch(path).then(jsonOrError);

export const postJson = (path, body, headers = {}) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  }).then(jsonOrError);

/** Kontrat durumunu düzenli aralıkla çeker. */
export function useTakasState(intervalMs = 2000, path = "/api/state") {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  const refresh = useRef(() => {});

  useEffect(() => {
    alive.current = true;
    let timer;
    const tick = async () => {
      try {
        const s = await getState(path);
        if (alive.current) {
          setState(s);
          setError(null);
        }
      } catch (e) {
        if (alive.current) setError(e.message);
      }
      if (alive.current) timer = setTimeout(tick, intervalMs);
    };
    refresh.current = () => {
      clearTimeout(timer);
      tick();
    };
    tick();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [intervalMs, path]);

  return { state, error, refresh: () => refresh.current() };
}

export function useBench() {
  const [bench, setBench] = useState(null);
  useEffect(() => {
    fetch("/bench.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setBench)
      .catch(() => setBench(null));
  }, []);
  return bench;
}
