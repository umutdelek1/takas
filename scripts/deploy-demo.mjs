// Herkese açık demo için AYRI bir TakasStress örneği yayınlar; src/deployment.js'e "demo" olarak yazar.
// Canlı Takas ve ölçüm kontratlarına dokunmaz.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeDeployData, formatEther, parseEther } from "viem";
import { clients, readArtifact, root } from "./_env.mjs";
import prev from "../src/deployment.js";

const { publicClient, walletClient, account } = clients();
if (!account) throw new Error("HOST_PRIVATE_KEY bulunamadı");
const balance = await publicClient.getBalance({ address: account.address });
console.log("bakiye:", formatEther(balance), "MON");

const { abi, bytecode } = readArtifact("TakasStress");
const data = bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`;
const args = [parseEther("0.0005")];
const est = await publicClient.estimateGas({ account, data: encodeDeployData({ abi, bytecode: data, args }) });
const gas = est + est / 20n + 20_000n;
const hash = await walletClient.deployContract({ abi, bytecode: data, args, gas });
const rc = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
if (rc.status !== "success") throw new Error(`deploy başarısız: ${hash}`);
console.log("demo TakasStress", rc.contractAddress, "limit", gas.toString());

writeFileSync(
  join(root, "src", "deployment.js"),
  `// scripts/deploy.mjs ve scripts/deploy-demo.mjs tarafından yazıldı.\nexport default ${JSON.stringify(
    { ...prev, demo: rc.contractAddress, demoDeployBlock: Number(rc.blockNumber) },
    null,
    2,
  )};\n`,
);
console.log("src/deployment.js güncellendi.");
