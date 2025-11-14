import { AssetType, BalanceAllowanceResponse } from "@polymarket/clob-client";
import { getClobClient } from "./clob.js";

export interface WalletState {
  usdcBalance: number;
  usdcAllowance: number;
}

/**
 * Safely parse a numeric string or number into a finite number.
 */
function parseDecimal(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeBalanceResponse(resp: BalanceAllowanceResponse): WalletState {
  return {
    // USDC on Polygon uses 6 decimals; the CLOB balance/allowance fields are
    // expressed in base units. Convert to human-readable USDC.
    usdcBalance: parseDecimal(resp.balance) / 1_000_000,
    usdcAllowance: parseDecimal(resp.allowance) / 1_000_000,
  };
}

/**
 * Fetch Polymarket USDC balance and allowance for the configured account.
 *
 * Uses the CLOB `/balance-allowance` endpoint with `asset_type=COLLATERAL`.
 */
export async function fetchWalletState(): Promise<WalletState> {
  const client = await getClobClient();

  const resp = await client.getBalanceAllowance({
    asset_type: AssetType.COLLATERAL,
  });

  return normalizeBalanceResponse(resp);
}

/**
 * Dynamic bankroll in USD for Kelly sizing.
 *
 * For now this is simply the on-platform USDC balance; later we can subtract
 * position exposure and pending orders (Phase 2/5 integration).
 */
export async function getBankrollUSD(): Promise<number> {
  const { usdcBalance } = await fetchWalletState();
  return usdcBalance;
}
