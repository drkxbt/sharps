/* Large trades across Polymarket as they happen. The Data API has no public stream of fills, so the tape polls the
   global trade feed for trades above a size and hands on only the ones it hasn't seen. */
import type { Client, Trade } from "./api.js";

export interface TapeRead {
  /** True for the first read, and the first read after the size changes: these carry the recent backlog. */
  backlog: boolean;
  /** On a backlog read, the cursor for the trades older than it, to pass to `tradePage`; null otherwise. */
  next: string | null;
}

export interface TapeOptions {
  /** The smallest trade passed on, in USD. */
  minUsd?: number;
  /** Milliseconds between polls. */
  every?: number;
  /** Trades read per poll. */
  limit?: number;
  /** Trades read for the backlog, up to the API's 1000. Defaults to `limit`. */
  backlog?: number;
  /** New trades, oldest first. A backlog read is always reported, even when it holds nothing new. */
  onTrades: (trades: Trade[], read: TapeRead) => void;
  onError?: (error: unknown) => void;
  /** Hold off while the page is hidden. On by default. */
  pauseWhenHidden?: boolean;
}

export interface Tape {
  /** Changes the size floor and reads the backlog again at once. */
  setMinUsd(minUsd: number): void;
  refresh(): void;
  stop(): void;
}

const REMEMBERED = 6000;

export function tape(api: Client, options: TapeOptions): Tape {
  let minUsd = options.minUsd ?? 10_000;
  const every = Math.max(2000, options.every ?? 8000);
  const limit = options.limit ?? 200;
  const backlog = Math.max(limit, options.backlog ?? limit);
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const seen = new Set<string>();
  const order: string[] = [];
  let needBacklog = true;
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
    const isBacklog = needBacklog;
    try {
      const page = await api.tradePage({ minUsd, limit: isBacklog ? backlog : limit, fresh: true, signal: current.signal });
      if (current.signal.aborted) return;
      needBacklog = false;
      const fresh = page.trades.filter((trade) => !seen.has(trade.id) && trade.usd >= minUsd);
      for (const trade of fresh) {
        seen.add(trade.id);
        order.push(trade.id);
      }
      while (order.length > REMEMBERED) seen.delete(order.shift()!);
      if (fresh.length || isBacklog) options.onTrades(fresh.sort((a, b) => a.time - b.time), { backlog: isBacklog, next: isBacklog ? page.next : null });
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
      // A new size is a new feed: its backlog is handed on whole, even trades seen under the old size.
      needBacklog = true;
      seen.clear();
      order.length = 0;
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
