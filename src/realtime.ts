import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import { CFG } from "./config.js";

// Type definitions from real-time-data-client
type Message = {
  topic: string;
  type: string;
  timestamp: number;
  payload: any;
  connection_id: string;
};

export enum ConnectionStatus {
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
}

export type ActivityTrade = {
  asset: string; // tokenId
  bio?: string;
  conditionId: string;
  eventSlug?: string;
  icon?: string;
  name?: string;
  outcome?: string;
  outcomeIndex?: number;
  price: number;
  profileImage?: string;
  proxyWallet: string;
  pseudonym?: string;
  side: "BUY" | "SELL";
  size: number;
  slug?: string;
  timestamp: number;
  title?: string;
  transactionHash: string;
};

type TradeHandler = (trade: ActivityTrade) => void | Promise<void>;
type StatusHandler = (status: ConnectionStatus) => void;

export class PolymarketRealTimeClient {
  private client: RealTimeDataClient;
  private targetWallet: string;
  private onTradeHandler?: TradeHandler;
  private onStatusHandler?: StatusHandler;

  constructor(targetWallet: string) {
    this.targetWallet = targetWallet.toLowerCase();

    this.client = new RealTimeDataClient({
      host: CFG.rtDataHost,
      onConnect: this.handleConnect.bind(this),
      onMessage: this.handleMessage.bind(this),
      onStatusChange: this.handleStatusChange.bind(this),
      autoReconnect: true,
      pingInterval: 5000,
    });
  }

  private handleConnect(client: RealTimeDataClient) {
    console.log("[RT] Connected to Polymarket real-time data stream");

    // Subscribe to ALL activity trades (no filter = all trades)
    // We'll filter by proxyWallet in the message handler
    client.subscribe({
      subscriptions: [
        {
          topic: "activity",
          type: "trades",
          filters: "", // Empty = all trades across all markets
        },
      ],
    });

    console.log("[RT] Subscribed to activity/trades (all markets)");
  }

  private handleMessage(client: RealTimeDataClient, message: Message) {
    // Only process activity/trades messages
    if (message.topic !== "activity" || message.type !== "trades") {
      return;
    }

    const trade = message.payload as ActivityTrade;

    // Debug: Log all trades we see
    console.log(
      `[WS DEBUG] Trade from ${trade.proxyWallet.substring(0, 10)}... ${trade.side} ${trade.size} @ ${trade.price} (tx: ${trade.transactionHash.substring(0, 10)}...)`,
    );

    // Filter by target wallet
    if (trade.proxyWallet.toLowerCase() !== this.targetWallet) {
      return;
    }

    console.log(
      `[WS MATCH] ✅ Target trader detected! tx: ${trade.transactionHash.substring(0, 20)}...`,
    );

    // Call the registered handler
    if (this.onTradeHandler) {
      this.onTradeHandler(trade);
    }
  }

  private handleStatusChange(status: ConnectionStatus) {
    console.log(`[RT] Status: ${status}`);
    if (this.onStatusHandler) {
      this.onStatusHandler(status);
    }
  }

  public connect() {
    this.client.connect();
  }

  public disconnect() {
    this.client.disconnect();
  }

  public onTrade(handler: TradeHandler) {
    this.onTradeHandler = handler;
  }

  public onStatus(handler: StatusHandler) {
    this.onStatusHandler = handler;
  }
}
