import { CFG } from "./config.js";

export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillPerMs: number;
  private last = Date.now();

  constructor(tokensPerSecond: number, burstSeconds = 1.0) {
    this.capacity = tokensPerSecond * burstSeconds;
    this.tokens = this.capacity;
    this.refillPerMs = tokensPerSecond / 1000;
  }
  take(cost = 1): boolean {
    const now = Date.now();
    const dt = now - this.last;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + dt * this.refillPerMs);
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }
}

export function nextDelay(base = CFG.pollMs) {
  return base;
}
