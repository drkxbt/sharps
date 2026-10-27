/* Large trades across Polymarket as they happen. The Data API has no public stream of fills, so the tape polls the
   global trade feed for trades above a size and hands on only the ones it hasn't seen. */
import type { Client, Trade } from "./api.js";

export interface TapeOptions {
  /** The smallest trade passed on, in USD. */
  minUsd?: number;
  /** Milliseconds between polls. */
  every?: number;
  /** Trades read per poll. */
  limit?: number;
  /** New trades, oldest first. The first call carries the recent backlog. */
  onTrades: (trades: Trade[]) => void;
  onError?: (error: unknown) => void;
  /** Hold off while the page is hidden. On by default. */
  pauseWhenHidden?: boolean;
}

export interface Tape {
  /** Changes the size floor and polls again at once. */
  setMinUsd(minUsd: number): void;
  refresh(): void;
  stop(): void;
}

const REMEMBERED = 4000;

export function tape(api: Client, options: TapeOptions): Tape {
  let minUsd = options.minUsd ?? 10_000;
  const every = Math.max(2000, options.every ?? 8000);
  const limit = options.limit ?? 200;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const seen = new Set<string>();
  const order: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let stopped = false;

  const hidden = () => pauseWhenHidden && typeof document !== "undefined" && document.visibilityState === "hidden";

  async function poll() {
    clearTimeout(timer);
    if (stopped) return;
    if (hidden()) return;
    controller?.abort();
    const current = (controller = new AbortController());
    try {
      const trades = await api.trades({ minUsd, limit, fresh: true, signal: current.signal });
      if (current.signal.aborted) return;
      const fresh = trades.filter((trade) => !seen.has(trade.id) && trade.usd >= minUsd);
      for (const trade of fresh) {
        seen.add(trade.id);
        order.push(trade.id);
      }
      while (order.length > REMEMBERED) seen.delete(order.shift()!);
      if (fresh.length) options.onTrades(fresh.sort((a, b) => a.time - b.time));
    } catch (error) {
      if (!current.signal.aborted) options.onError?.(error);
    } finally {
      if (!stopped && controller === current) timer = setTimeout(poll, every);
    }
  }

  const onVisibility = () => {
    if (!hidden()) poll();
  };
  if (pauseWhenHidden && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  poll();

  return {
    setMinUsd(value) {
      minUsd = Math.max(0, value);
      poll();
    },
    refresh: poll,
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
