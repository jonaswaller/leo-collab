import { CFG } from "./config.js";
import { ethers } from "ethers";
import { ClobClient } from "@polymarket/clob-client";

export async function makeClobClient() {
  const provider = new ethers.providers.JsonRpcProvider(
    "https://polygon-rpc.com",
    CFG.chainId,
  );
  const wallet = new ethers.Wallet(CFG.privateKey, provider);

  // Derive or create API key once with a bare client
  let creds: any | undefined;
  try {
    creds = await new ClobClient(
      CFG.clobHost,
      CFG.chainId,
      wallet,
    ).createOrDeriveApiKey?.();
  } catch (e: any) {
    console.warn(
      "[CLOB] createOrDeriveApiKey failed (will try derive/create separately)",
      e?.response?.data || e,
    );
  }

  // Fall back to explicit derive/create paths if needed
  if (!creds) {
    try {
      creds = await new ClobClient(
        CFG.clobHost,
        CFG.chainId,
        wallet,
      ).deriveApiKey?.();
    } catch {}
  }
  if (!creds) {
    try {
      creds = await new ClobClient(
        CFG.clobHost,
        CFG.chainId,
        wallet,
      ).createApiKey?.();
    } catch (e: any) {
      console.warn("[CLOB] createApiKey failed", e?.response?.data || e);
    }
  }

  // 🚨 Hard-fail: you cannot place/cancel orders without API creds
  if (!creds) {
    throw new Error(
      "Could not create/derive API credentials. Check PRIVATE_KEY (0x-hex), system clock, and PROXY_WALLET for proxy mode."
    );
  }

  // IMPORTANT: pass signatureType + funder when using a proxy
  const signatureType = CFG.useProxy ? CFG.signatureType : 0;
  const funder = CFG.useProxy ? CFG.proxyWallet : undefined;

  const client = new ClobClient(
    CFG.clobHost,
    CFG.chainId,
    wallet,
    creds,
    signatureType,
    funder,
  );

  return { client, wallet };
}
