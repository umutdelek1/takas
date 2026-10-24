// API işleyicisini yerelde çağırır: node scripts/call-api.mjs state|drip|settle [json-gövde]
import { loadEnv } from "./_env.mjs";

loadEnv();
const [name, body] = process.argv.slice(2);
const mod = await import(`../api/${name}.js`);
const req = {
  method: name === "state" ? "GET" : "POST",
  headers: { "x-host-token": process.env.HOST_TOKEN || "" },
  body: body ? JSON.parse(body) : {},
};
const res = {
  headers: {},
  setHeader(k, v) {
    this.headers[k] = v;
  },
  status(c) {
    this.code = c;
    return this;
  },
  json(o) {
    console.log(this.code, JSON.stringify(o, null, 1).slice(0, 3000));
  },
};
await mod.default(req, res);
