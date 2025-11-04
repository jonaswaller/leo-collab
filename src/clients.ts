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
      console.warn(
        "[CLOB] createApiKey failed; continuing without cached creds",
        e?.response?.data || e,
      );
    }
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
