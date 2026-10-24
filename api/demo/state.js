import { route, rpcDiag } from "../_lib.js";
import { demoState, scenarioOf } from "../_demo.js";

export default route(async (req, res) => {
  const [s, timing] = await demoState(scenarioOf(req));
  res.setHeader("Cache-Control", "public, s-maxage=1, stale-while-revalidate=5");
  res.setHeader("Server-Timing", timing);
  res.setHeader("x-takas-rpc", `primary=${rpcDiag.primaryValid ? "ok" : "bad"};ws=${rpcDiag.primaryHadWhitespace ? 1 : 0}`);
  res.status(200).json(s);
});