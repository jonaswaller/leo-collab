import WebSocket from "ws";

export type WSLastTradeEvent = {
  event_type: "last_trade_price";
  asset_id: string; // tokenId
  market: string; // conditionId
  price: string;
  side: "BUY" | "SELL";
  size: string;
  timestamp: number;
};

export type WSBookEvent = {
  event_type: "book";
  asset_id: string;
  market: string;
  hash: string;
  timestamp: number;
  // ... other book fields
};

export type WSPriceChangeEvent = {
  event_type: "price_change";
  asset_id: string;
  market: string;
  price: string;
  timestamp: number;
};

export type WSTickSizeChangeEvent = {
  event_type: "tick_size_change";
  asset_id: string;
  market: string;
  tick_size: string;
  timestamp: number;
};

export type WSEvent =
  | WSLastTradeEvent
  | WSBookEvent
  | WSPriceChangeEvent
  | WSTickSizeChangeEvent;

export class MarketWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private subscribedTokens = new Set<string>(); // Track by tokenId, not conditionId
  private onLastTradeCallback?: (trade: WSLastTradeEvent) => void;
  private onTickSizeChangeCallback?: (event: WSTickSizeChangeEvent) => void;
  private isConnecting = false;

  private readonly WS_URL =
    "wss://ws-subscriptions-clob.polymarket.com/ws/market";

  connect(
    onLastTrade?: (trade: WSLastTradeEvent) => void,
    onTickSizeChange?: (event: WSTickSizeChangeEvent) => void,
  ) {
    // If we don't have any tokens yet, defer the connection to avoid idle closes
    if (this.subscribedTokens.size === 0) return;
    if (this.ws || this.isConnecting) return;
    this.isConnecting = true;

    if (onLastTrade) this.onLastTradeCallback = onLastTrade;
    if (onTickSizeChange) this.onTickSizeChangeCallback = onTickSizeChange;

    this.ws = new WebSocket(this.WS_URL);

    this.ws.on("open", () => {
      console.log("[WS] Connected to Polymarket WebSocket");
      this.isConnecting = false;

      // Start keepalive ping every 10 seconds
      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send("PING");
        }
      }, 10000);

      // Resubscribe to tokens after reconnect
      this.flushSubscription();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      const raw = data.toString();

      // Handle PONG response
      if (raw === "PONG") return;

      try {
        const event = JSON.parse(raw) as WSEvent;
        this.handleEvent(event);
      } catch (e) {
        console.warn("[WS] Failed to parse message:", raw.substring(0, 100));
      }
    });

    this.ws.on("error", (err: Error) => {
      console.warn("[WS] Error:", err.message);
    });

    this.ws.on("close", () => {
      console.log("[WS] Connection closed, reconnecting in 5s...");
      this.cleanup();
      this.reconnectTimer = setTimeout(
        () =>
          this.connect(this.onLastTradeCallback, this.onTickSizeChangeCallback),
        5000,
      );
    });
  }

  // Send the full subscription set
  private flushSubscription() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedTokens.size === 0) return;
    this.ws.send(
      JSON.stringify({
        type: "market",
        assets_ids: Array.from(this.subscribedTokens),
      }),
    );
    console.log(`[WS] Subscribed to ${this.subscribedTokens.size} tokens`);
  }

  private handleEvent(event: WSEvent) {
    if (event.event_type === "last_trade_price" && this.onLastTradeCallback) {
      this.onLastTradeCallback(event);
    } else if (
      event.event_type === "tick_size_change" &&
      this.onTickSizeChangeCallback
    ) {
      this.onTickSizeChangeCallback(event);
    }
    // Ignore book and price_change events for now
  }

  subscribeToToken(tokenId: string) {
    this.subscribedTokens.add(tokenId);
    // If not connected yet, connect now that we have at least 1 token
    if (!this.ws)
      this.connect(this.onLastTradeCallback, this.onTickSizeChangeCallback);
    this.flushSubscription();
  }

  unsubscribeFromToken(tokenId: string) {
    this.subscribedTokens.delete(tokenId);

    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.subscribedTokens.size > 0
    ) {
      this.flushSubscription();
    }
  }

  private cleanup() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.ws = null;
    this.isConnecting = false;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
    }
    this.cleanup();
    this.subscribedTokens.clear();
  }
}
