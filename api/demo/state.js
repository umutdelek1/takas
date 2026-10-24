import { route } from "../_lib.js";
import { demoState, scenarioOf } from "../_demo.js";

export default route(async (req, res) => {
  const s = await demoState(scenarioOf(req));
  res.setHeader("Cache-Control", "public, s-maxage=1, stale-while-revalidate=2");
  res.status(200).json(s);
});
