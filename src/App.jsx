import { useEffect, useState } from "react";
import Screen from "./pages/Screen.jsx";
import Play from "./pages/Play.jsx";
import Host from "./pages/Host.jsx";
import Bench from "./pages/Bench.jsx";
import Demo from "./pages/Demo.jsx";

const routeOf = () => {
  const h = location.hash.replace(/^#\/?/, "");
  return h.split("?")[0] || "";
};

export default function App() {
  const [route, setRoute] = useState(routeOf());
  useEffect(() => {
    const on = () => setRoute(routeOf());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (route === "play") return <Play />;
  if (route === "host") return <Host />;
  if (route === "olcum") return <Bench />;
  if (route === "demo") return <Demo />;
  return <Screen />;
}
