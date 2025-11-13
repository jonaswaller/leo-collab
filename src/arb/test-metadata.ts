/**
 * Test script to verify CLOB metadata extraction
 *
 * Validates that we're correctly capturing:
 * - Token IDs
 * - Condition IDs
 * - Tick sizes
 * - Minimum order sizes
 * - Neg-risk status
 *
 * Run: npx tsx src/arb/test-metadata.ts
 */

import "dotenv/config";
import { discoverPolymarkets } from "./discovery.js";

async function main() {
  console.log("🧪 Testing CLOB metadata extraction...\n");

  // Discover markets
  console.log("📊 Discovering Polymarket markets...");
  const markets = await discoverPolymarkets();
  console.log(`   ✓ Found ${markets.length} markets\n`);

  // Analyze metadata completeness
  let withTokenIds = 0;
  let withConditionId = 0;
  let withTickSize = 0;
  let withMinOrderSize = 0;
  let withNegRisk = 0;
  let fullyComplete = 0;

  for (const market of markets) {
    if (market.clobTokenIds && market.clobTokenIds.length >= 2) withTokenIds++;
    if (market.conditionId) withConditionId++;
    if (market.tickSize) withTickSize++;
    if (market.minOrderSize) withMinOrderSize++;
    if (market.negRisk !== undefined) withNegRisk++;

    if (
      market.clobTokenIds &&
      market.clobTokenIds.length >= 2 &&
      market.conditionId &&
      market.tickSize &&
      market.minOrderSize
    ) {
      fullyComplete++;
    }
  }

  console.log("📈 Metadata Completeness:");
  console.log(`   • Markets with Token IDs: ${withTokenIds}/${markets.length} (${((withTokenIds / markets.length) * 100).toFixed(1)}%)`);
  console.log(`   • Markets with Condition ID: ${withConditionId}/${markets.length} (${((withConditionId / markets.length) * 100).toFixed(1)}%)`);
  console.log(`   • Markets with Tick Size: ${withTickSize}/${markets.length} (${((withTickSize / markets.length) * 100).toFixed(1)}%)`);
  console.log(`   • Markets with Min Order Size: ${withMinOrderSize}/${markets.length} (${((withMinOrderSize / markets.length) * 100).toFixed(1)}%)`);
  console.log(`   • Markets with Neg-Risk Status: ${withNegRisk}/${markets.length} (${((withNegRisk / markets.length) * 100).toFixed(1)}%)`);
  console.log(`   • Fully Complete (all fields): ${fullyComplete}/${markets.length} (${((fullyComplete / markets.length) * 100).toFixed(1)}%)\n`);

  // Show sample markets with complete metadata
  console.log("📋 Sample Markets with Complete Metadata:\n");
  const completeMarkets = markets.filter(
    (m) =>
      m.clobTokenIds &&
      m.clobTokenIds.length >= 2 &&
      m.conditionId &&
      m.tickSize &&
      m.minOrderSize,
  );

  for (let i = 0; i < Math.min(5, completeMarkets.length); i++) {
    const m = completeMarkets[i];
    if (!m) continue;

    console.log(`${i + 1}. ${m.sport.toUpperCase()} - ${m.eventTitle}`);
    console.log(`   Market: ${m.marketQuestion}`);
    console.log(`   Token IDs: [${m.clobTokenIds?.join(", ")}]`);
    console.log(`   Condition ID: ${m.conditionId}`);
    console.log(`   Tick Size: ${m.tickSize}`);
    console.log(`   Min Order Size: ${m.minOrderSize} shares`);
    console.log(`   Neg-Risk: ${m.negRisk ? "Yes" : "No"}`);
    console.log(`   Outcomes: ${m.outcome1Name} / ${m.outcome2Name}`);
    console.log("");
  }

  // Show markets missing critical metadata
  const missingTokenIds = markets.filter(
    (m) => !m.clobTokenIds || m.clobTokenIds.length < 2,
  );
  const missingConditionId = markets.filter((m) => !m.conditionId);

  if (missingTokenIds.length > 0) {
    console.log(`⚠️  WARNING: ${missingTokenIds.length} markets missing Token IDs`);
    console.log("   These markets CANNOT be traded until Token IDs are available\n");
    
    // Show first 3 examples
    for (let i = 0; i < Math.min(3, missingTokenIds.length); i++) {
      const m = missingTokenIds[i];
      if (!m) continue;
      console.log(`   • ${m.sport.toUpperCase()} - ${m.eventTitle}`);
      console.log(`     ${m.marketQuestion}`);
    }
    console.log("");
  }

  if (missingConditionId.length > 0) {
    console.log(`⚠️  WARNING: ${missingConditionId.length} markets missing Condition ID`);
    console.log("   These markets CANNOT be traded until Condition ID is available\n");
  }

  // Summary
  console.log("✅ Metadata extraction test complete!\n");
  console.log("📊 Summary:");
  console.log(`   • ${fullyComplete} markets are ready for trading (have all required metadata)`);
  console.log(`   • ${markets.length - fullyComplete} markets need additional metadata`);
  
  if (fullyComplete === 0) {
    console.log("\n❌ CRITICAL: No markets have complete metadata!");
    console.log("   This means we cannot place any orders yet.");
    console.log("   Check if Gamma API is returning clobTokenIds and conditionId fields.");
  } else if (fullyComplete < markets.length * 0.5) {
    console.log("\n⚠️  WARNING: Less than 50% of markets have complete metadata");
    console.log("   Some markets may not be tradeable");
  } else {
    console.log("\n✅ Good! Most markets have complete metadata and are ready for trading");
  }
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
