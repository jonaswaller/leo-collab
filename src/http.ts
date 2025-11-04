import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import http from "http";
import https from "https";
import { recordReq, recordResp } from "./rate.js";

const common = {
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 64 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 64 }),
  timeout: 2000, // keep short for low latency
};

export const axData = axios.create({
  ...common,
  baseURL: "https://data-api.polymarket.com",
});
export const axClob = axios.create({
  ...common,
  baseURL: "https://clob.polymarket.com",
});
export const axGamma = axios.create({
  ...common,
  baseURL: "https://gamma-api.polymarket.com",
});

// --- classify endpoints into buckets for rate accounting ---
function bucketFrom(config: AxiosRequestConfig): string {
  const base = (config.baseURL || "") + (config.url || "");
  const method = (config.method || "get").toUpperCase();
  // Data-API
  if (base.includes("data-api.polymarket.com/trades")) return "data:/trades";
  if (base.includes("data-api.polymarket.com")) return "data:general";
  // CLOB
  if (base.includes("clob.polymarket.com/order") && method === "POST")
    return "clob:post_order";
  if (base.includes("clob.polymarket.com/order") && method === "DELETE")
    return "clob:delete_order";
  if (base.includes("clob.polymarket.com/data/orders"))
    return "clob:get_orders";
  if (base.includes("clob.polymarket.com/data/trades"))
    return "clob:get_trades";
  if (base.includes("clob.polymarket.com/book")) return "clob:/book";
  return base.includes("clob.polymarket.com") ? "clob:general" : "other";
}

// --- attach interceptors to count requests + results ---
for (const inst of [axData, axClob, axGamma]) {
  inst.interceptors.request.use((cfg) => {
    recordReq(bucketFrom(cfg));
    return cfg;
  });
  inst.interceptors.response.use(
    (resp: AxiosResponse) => {
      recordResp(bucketFrom(resp.config), resp.status);
      return resp;
    },
    (err) => {
      const cfg = err?.config;
      recordResp(cfg ? bucketFrom(cfg) : "unknown", err?.response?.status || 0);
      return Promise.reject(err);
    },
  );
}
