import { CFG } from "./config.js";
import { ethers } from "ethers";
import { ClobClient } from "@polymarket/clob-client";

export async function makeClobClient() {
  const provider = new ethers.providers.JsonRpcProvider(
    "https://polygon-rpc.com",
    CFG.chainId,
  );
  const wallet = new ethers.Wallet(CFG.privateKey, provider);

  const base = new ClobClient(CFG.clobHost, CFG.chainId, wallet);

  // try derive first (if you already have a key), then create; swallow errors but log them
  let creds: any | undefined;
  try {
    creds = await base.deriveApiKey?.(); // newer client versions expose this
  } catch (e: any) {
    console.warn(
      "[CLOB] deriveApiKey failed; will try create",
      e?.response?.data || e,
    );
  }
  if (!creds) {
    try {
      creds = await base.createApiKey?.();
    } catch (e: any) {
      // Known: some envs see 400 "Could not create api key" but can still proceed.
      console.warn(
        "[CLOB] createApiKey failed; continuing without cached creds",
        e?.response?.data || e,
      );
    }
  }

  const client = new ClobClient(CFG.clobHost, CFG.chainId, wallet, creds);
  return { client, wallet };
}
