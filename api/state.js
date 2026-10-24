import { publicClient, deployment, takasAbi, requireDeployed, route, EXPLORER, stopwatch, rpcDiag } from "./_lib.js";

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

async function readLastSettle(address, block, sw) {
  if (block === 0n) return null;
  if (lastCache.block === block) return lastCache.value;
  // Alchemy getLogs en fazla 10 blok kabul eder; yalnızca son takasın bloğu sorulur.
  const logs = await sw.time(
    "getLogs",
    publicClient.getLogs({ address, event: settledEvent, fromBlock: block, toBlock: block }),
  );
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
  const sw = stopwatch();
  const address = requireDeployed();
  const read = (functionName, args = []) =>
    sw.time(functionName, publicClient.readContract({ address, abi: takasAbi, functionName, args }));

  // Tüm okumalar aynı anda: viem bunları tek Multicall3 eth_call'ında birleştirir. Sayfalı listeler
  // üst sınırla istenir; kontrat sayıyı kendisi kırpar, böylece ikinci bir tur gerekmez.
  const [fee, session, feeBalance, memberCount, openCount, lastBlock, cumGross, cumCash, preview, members, invoices, blockNumber] =
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
      read("membersPage", [0n, MAX_MEMBERS]),
      read("invoicesPage", [0n, MAX_INVOICES]),
      sw.time("blockNumber", publicClient.getBlockNumber({ cacheTime: 0 })),
    ]);
  const last = await readLastSettle(address, lastBlock, sw);

  res.setHeader("Cache-Control", "public, s-maxage=1, stale-while-revalidate=5");
  res.setHeader("Server-Timing", sw.header());
  res.setHeader("x-takas-rpc", `primary=${rpcDiag.primaryValid ? "ok" : "bad"};ws=${rpcDiag.primaryHadWhitespace ? 1 : 0}`);
  sw.log("state");
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
