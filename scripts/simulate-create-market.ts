/**
 * 1g gate: simulate `buildCreateMarketTxn` for xau-daily-up.
 *
 * Goal: verify that our Option<vector<u8>> BCS encoding (MoveOption +
 * MoveVector<U8>) produces a transaction that the Aptos node accepts
 * without deserialize failure. Only when this prints `vm_status:
 * "Executed successfully"` should we let the cron submit real txs.
 *
 * Run: `npx tsx scripts/simulate-create-market.ts`
 */
import "dotenv/config";
import {
  Account,
  AccountAddress,
  Ed25519PrivateKey,
  PrivateKey,
} from "@aptos-labs/ts-sdk";
import {
  aptos,
  buildCreateMarketTxn,
  fetchPythPrice,
  pythXauFeedId,
} from "../src/lib/aptos";
import {
  deriveMarketParams,
  MARKET_GROUPS,
  pythFeedForGroup,
} from "../src/lib/market-groups";

async function main() {
  const spec = MARKET_GROUPS["xau-daily-up"];
  if (!spec || spec.spawnStrategy.kind !== "create_market") {
    throw new Error("xau-daily-up not registered or wrong strategy");
  }

  const adminKeyRaw = process.env.APTOS_ADMIN_PRIVATE_KEY;
  if (!adminKeyRaw) throw new Error("APTOS_ADMIN_PRIVATE_KEY not set");
  const pk = new Ed25519PrivateKey(PrivateKey.formatPrivateKey(adminKeyRaw, "ed25519" as unknown as Parameters<typeof PrivateKey.formatPrivateKey>[1]));
  const admin = Account.fromPrivateKey({ privateKey: pk });
  console.log("admin:", admin.accountAddress.toString());
  console.log("xau feed:", pythXauFeedId());

  const feedId = pythFeedForGroup(spec);
  const { price, expo, publishTime } = await fetchPythPrice(feedId);
  console.log(`Pyth XAU: raw=${price} expo=${expo} publish_time=${publishTime}`);

  const nowSec = Math.floor(Date.now() / 1000);
  const derived = deriveMarketParams(spec, price, expo, nowSec);
  console.log("derived:", {
    strikeRaw: derived.strikeRaw.toString(),
    strikeDisplay: derived.strikeDisplay,
    closeTime: derived.closeTime,
    closeTimeIso: new Date(derived.closeTime * 1000).toISOString(),
    durationSec: derived.durationSec,
    thresholdType: derived.thresholdType,
    question: derived.question,
  });

  const payload = buildCreateMarketTxn({
    assetPythFeedId: feedId,
    strikePriceRaw: derived.strikeRaw,
    closeTimeSec: derived.closeTime,
    recurringGroupId: spec.groupId,
    recurringAutoSpawn: false,
    recurringDurationSeconds: derived.durationSec,
    marketType: spec.spawnStrategy.marketType,
    thresholdType: derived.thresholdType,
    feeBps: spec.spawnStrategy.feeBps,
    poolDepth: spec.poolDepth,
    maxTradeBps: spec.spawnStrategy.maxTradeBps,
    maxStalenessSec: spec.spawnStrategy.maxStalenessSec,
  });

  const txn = await aptos.transaction.build.simple({
    sender: admin.accountAddress,
    data: payload.data as Parameters<
      typeof aptos.transaction.build.simple
    >[0]["data"],
  });
  const [simResult] = await aptos.transaction.simulate.simple({
    signerPublicKey: admin.publicKey,
    transaction: txn,
  });

  console.log("---- simulate ----");
  console.log("success:", simResult.success);
  console.log("vm_status:", simResult.vm_status);
  console.log("gas_used:", simResult.gas_used);
  console.log("gas_unit_price:", simResult.gas_unit_price);
  if (!simResult.success) {
    console.log("FAIL — do not submit live. Full result below:");
    console.log(JSON.stringify(simResult, null, 2));
    process.exit(1);
  }
  console.log("OK — Option<vector<u8>> encoding + create_market args accepted.");
  void AccountAddress; // keep import tree-shake-safe
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
