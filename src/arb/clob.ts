import { Wallet } from "ethers";
import { Chain, ClobClient } from "@polymarket/clob-client";

/**
 * Read a required environment variable, throwing if it is missing or empty.
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

async function initClobClient(): Promise<ClobClient> {
  const host =
    process.env.CLOB_API_URL?.trim() || "https://clob.polymarket.com";

  const privateKey = getRequiredEnv("POLY_PRIVATE_KEY");
  const funderAddress = getRequiredEnv("POLY_PROXY_WALLET");

  const chainIdRaw = process.env.POLY_CHAIN_ID;
  const chainId: Chain =
    chainIdRaw && chainIdRaw.trim() !== ""
      ? (parseInt(chainIdRaw, 10) as Chain)
      : Chain.POLYGON;

  // Signature type: 2 for EOA-linked proxy (per your tentative-gameplan)
  const signatureTypeRaw = process.env.POLY_SIGNATURE_TYPE;
  const signatureType =
    signatureTypeRaw && signatureTypeRaw.trim() !== ""
      ? Number(signatureTypeRaw)
      : 2;

  const signer = new Wallet(privateKey);

  // Create client with signature type and funder upfront (required for proxy wallets).
  const client = new ClobClient(
    host,
    chainId,
    signer,
    undefined as any,
    signatureType as any,
    funderAddress,
  );

  // Derive API creds, with fallback to derive-only if create fails.
  let creds: any;
  try {
    creds = await client.createOrDeriveApiKey();
  } catch {
    creds = await client.deriveApiKey();
  }

  // Re-construct with creds set.
  const authedClient = new ClobClient(
    host,
    chainId,
    signer,
    creds,
    signatureType as any,
    funderAddress,
  );

  return authedClient;
}

let clobClientPromise: Promise<ClobClient> | null = null;

/**
 * Lazily initialized singleton CLOB client.
 * Derives/creates an API key on first use and reuses it thereafter.
 */
export function getClobClient(): Promise<ClobClient> {
  if (!clobClientPromise) {
    clobClientPromise = initClobClient();
  }
  return clobClientPromise;
}
