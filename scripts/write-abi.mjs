// Derlenmiş Takas ABI'sini uygulamanın okuyacağı src/abi.js dosyasına yazar.
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readArtifact, root } from "./_env.mjs";

const { abi } = readArtifact("Takas");
writeFileSync(join(root, "src", "abi.js"), `// scripts/write-abi.mjs tarafından üretildi.\nexport const takasAbi = ${JSON.stringify(abi)};\n`);

const dep = join(root, "src", "deployment.js");
if (!existsSync(dep)) {
  writeFileSync(
    dep,
    `// scripts/deploy.mjs tarafından yazılır.\nexport default { chainId: 10143, takas: null, stress: null, deployBlock: 0 };\n`,
  );
}
console.log("src/abi.js yazıldı:", abi.length, "giriş");
