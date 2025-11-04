import { axGamma } from "./http.js";

export type GammaMarket = {
  id: string;
  conditionId: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  enableOrderBook?: boolean;
  acceptingOrders?: boolean;
  outcomes?: string; // stringified JSON
  shortOutcomes?: string; // stringified JSON
  clobTokenIds?: string; // stringified JSON array, order matches outcomes
};

export async function resolveHandleToProxyWallet(
  handle: string,
): Promise<string> {
  // If it's already a wallet address (starts with 0x and is 42 chars), return it
  if (handle.startsWith("0x") && handle.length === 42) {
    return handle.toLowerCase();
  }

  // Try direct profile lookup
  try {
    const cleanHandle = handle.replace("@", "");
    const { data } = await axGamma.get(`/profile/${cleanHandle}`);
    if (data?.proxyWallet) {
      console.log(`Found profile ${cleanHandle}: ${data.proxyWallet}`);
      return data.proxyWallet;
    }
  } catch (e: any) {
    console.log("Direct profile lookup failed, trying search...");
  }

  // Fall back to search
  const { data } = await axGamma.get("/public-search", {
    params: { q: handle },
  });
  const profiles = (data?.profiles ?? []) as any[];
  const match = profiles.find(
    (p) => (p.pseudonym || "").toLowerCase() === handle.toLowerCase(),
  );
  const wallet = (match || profiles[0])?.proxyWallet;
  if (!wallet)
    throw new Error(
      `No proxyWallet found for ${handle}. Try using the wallet address directly in TARGET_HANDLE.`,
    );
  return wallet as string;
}

export async function getMarketByCondition(
  conditionId: string,
): Promise<GammaMarket | null> {
  const { data } = await axGamma.get("/markets", {
    params: { condition_ids: conditionId, limit: 1 },
  });
  return Array.isArray(data) && data.length > 0
    ? (data[0] as GammaMarket)
    : null;
}

export function pickTokenId(
  m: GammaMarket,
  outcomeIndex: number,
): string | null {
  try {
    const arr = JSON.parse(m.clobTokenIds || "[]") as string[];
    return arr[outcomeIndex] ?? null;
  } catch {
    return null;
  }
}
