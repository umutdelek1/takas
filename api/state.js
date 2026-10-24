import { parseAbiItem } from "viem";
import { publicClient, deployment, takasAbi, requireDeployed, route, EXPLORER } from "./_lib.js";

const MAX_MEMBERS = 400n;
const MAX_INVOICES = 800n;

const settledEvent = takasAbi.find((x) => x.type === "event" && x.name === "Settled");

const big = (v) => v.toString();

function statsOut(s) {
  return {
    invoices: Number(s.invoices),
    participants: Number(s.participants),
    excluded: Number(s.excluded),
    grossWei: big(s.grossWei),
    cashWei: big(s.cashWei),
    savedWei: big(s.savedWei),
    feesWei: big(s.feesWei),
    gasUsed: Number(s.gasUsed),
  };
}

// Son takas bilgisi sunucu belleğinde de tutulur; aynı blok için RPC'ye tekrar gidilmez.
let lastCache = { block: -1n, value: null };

async function readLastSettle(address, block) {
  if (block === 0n) return null;
  if (lastCache.block === block) return lastCache.value;
  // Alchemy getLogs en fazla 10 blok kabul eder; tek bloklu aralık sorulur.
  const logs = await publicClient.getLogs({ address, event: settledEvent, fromBlock: block, toBlock: block });
  const log = logs[logs.length - 1];
  const value = log
    ? {
        session: Number(log.args.session),
        block: Number(block),
        txHash: log.transactionHash,
        explorer: `${EXPLORER}/tx/${log.transactionHash}`,
        stats: statsOut(log.args.stats),
      }
    : null;
  lastCache = { block, value };
  return value;
}

export default route(async (req, res) => {
  const address = requireDeployed();
  const c = (functionName, args = []) => ({ address, abi: takasAbi, functionName, args });
  const read = (functionName, args) => publicClient.readContract(c(functionName, args));

  const [fee, session, feeBalance, memberCount, openCount, lastBlock, cumGross, cumCash, preview, blockNumber] =
    await Promise.all([
      read("fee"),
      read("session"),
      read("feeBalance"),
      read("memberCount"),
      read("openInvoiceCount"),
      read("lastSettleBlock"),
      read("cumGrossUnits"),
      read("cumCashUnits"),
      read("previewSettle"),
      publicClient.getBlockNumber(),
    ]);

  const nM = memberCount < MAX_MEMBERS ? memberCount : MAX_MEMBERS;
  const nI = openCount < MAX_INVOICES ? openCount : MAX_INVOICES;
  const [members, invoices, last] = await Promise.all([
    nM > 0n ? read("membersPage", [0n, nM]) : [[], [], []],
    nI > 0n ? read("invoicesPage", [0n, nI]) : [[], [], []],
    readLastSettle(address, lastBlock),
  ]);

  res.setHeader("Cache-Control", "public, s-maxage=1, stale-while-revalidate=2");
  res.status(200).json({
    chainId: deployment.chainId,
    contract: address,
    block: Number(blockNumber),
    feeWei: big(fee),
    feeBalanceWei: big(feeBalance),
    session: Number(session),
    cumulative: {
      grossWei: big(cumGross * 1_000_000_000_000n),
      cashWei: big(cumCash * 1_000_000_000_000n),
    },
    members: members[0].map((a, i) => ({
      id: i,
      address: a,
      collateralWei: big(members[1][i]),
      sicil: Number(members[2][i]),
    })),
    memberCount: Number(memberCount),
    invoices: invoices[0].map((d, i) => ({
      debtor: d,
      creditor: invoices[1][i],
      amountWei: big(invoices[2][i]),
    })),
    invoiceCount: Number(openCount),
    preview: statsOut(preview),
    lastSettle: last,
  });
});
