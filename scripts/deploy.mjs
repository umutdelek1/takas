// Takas ve TakasStress'i Monad testnet'e yayınlar.
//   node scripts/deploy.mjs --check   → yalnızca adres ve bakiye (anahtar yazdırılmaz)
//   node scripts/deploy.mjs           → deploy
// Monad gas LİMİTİ üzerinden ücretlendirdiği için her işlemde limit = tahmin + küçük pay.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, parseEther } from "viem";
import { clients, readArtifact, root } from "./_env.mjs";

const MIN_BALANCE = parseEther("150");
const FEE = parseEther("0.0005");
const pad = (g) => g + g / 20n + 20_000n;

const { publicClient, walletClient, account } = clients();
if (!account) {
  console.error("HOST_PRIVATE_KEY bulunamadı (contracts/.env).");
  process.exit(1);
}
const balance = await publicClient.getBalance({ address: account.address });
console.log("adres :", account.address);
console.log("bakiye:", formatEther(balance), "MON");
if (process.argv.includes("--check")) process.exit(0);
if (balance < MIN_BALANCE) {
  console.error("Bakiye 150 MON'dan az, durdum.");
  process.exit(2);
}

async function deploy(name, args) {
  const { abi, bytecode } = readArtifact(name);
  const data = bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`;
  const gas = pad(await publicClient.estimateGas({ account, data: encode(abi, data, args) }));
  const hash = await walletClient.deployContract({ abi, bytecode: data, args, gas });
  const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
  if (rc.status !== "success") throw new Error(`${name} deploy başarısız: ${hash}`);
  console.log(name, rc.contractAddress, "gas", rc.gasUsed.toString(), "limit", gas.toString());
  return { address: rc.contractAddress, block: Number(rc.blockNumber) };
}

import { encodeDeployData } from "viem";
function encode(abi, bytecode, args) {
  return encodeDeployData({ abi, bytecode, args });
}

// --stress-only: yayındaki Takas'a dokunmadan yalnızca ölçüm kontratını yeniler.
const prev = (await import("../src/deployment.js")).default;
const stressOnly = process.argv.includes("--stress-only") && prev.takas;
const takas = stressOnly ? { address: prev.takas, block: prev.deployBlock } : await deploy("Takas", [FEE]);
const stress = await deploy("TakasStress", [FEE]);
writeFileSync(
  join(root, "src", "deployment.js"),
  `// scripts/deploy.mjs tarafından yazıldı.\nexport default ${JSON.stringify(
    { ...prev, chainId: 10143, takas: takas.address, stress: stress.address, deployBlock: takas.block },
    null,
    2,
  )};\n`,
);
console.log("src/deployment.js yazıldı.");
