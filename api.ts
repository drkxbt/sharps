/* A small client for Polymarket's public Data and Gamma APIs. Every read here is public and needs no key; the
   client adds what a page that makes hundreds of calls needs: a cap on requests in flight, a short cache, one
   request for identical calls made at once, and retries that respect the API's rate limits. */

export type Window = "day" | "week" | "month" | "all";

/** The boards Polymarket ranks traders on. "overall" covers every market. */
export const CATEGORIES = ["overall", "politics", "sports", "crypto", "culture", "economics", "tech", "finance", "mentions", "weather", "esports"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Trader {
  rank: number;
  wallet: string;
  name: string;
  /** Profit and loss in USD over the board's window. */
  pnl: number;
  /** Shares traded over the window, both sides. */
  volume: number;
  image: string;
  /** X handle, without the @, when the trader linked one. */
  x: string;
  verified: boolean;
}

export interface Position {
  wallet: string;
  name: string;
  tokenId: string;
  conditionId: string;
  eventId: string;
  eventSlug: string;
  slug: string;
  title: string;
  icon: string;
  outcome: string;
  oppositeOutcome: string;
  status: string;
  /** Shares held now. */
  size: number;
  /** Average price paid per share, 0 to 1. */
  avgPrice: number;
  /** USD paid for the shares still held. */
  cost: number;
  /** Last price, 0 to 1. */
  price: number;
  /** USD the shares are worth at the last price. */
  value: number;
  realized: number;
  unrealized: number;
  pnl: number;
  /** Return on what was paid, in percent; on a closed position, the realized return. */
  percent: number;
  endDate: string;
  /** Milliseconds since the epoch. */
  firstEntry: number;
  lastActivity: number;
}

export interface Trade {
  /** Stable across polls: the transaction, the token and the side. */
  id: string;
  wallet: string;
  name: string;
  image: string;
  side: "BUY" | "SELL";
  tokenId: string;
  conditionId: string;
  title: string;
  slug: string;
  eventSlug: string;
  icon: string;
  outcome: string;
  size: number;
  price: number;
  /** size × price. */
  usd: number;
  /** Milliseconds since the epoch. */
  time: number;
}

export interface WalletStats {
  wallet: string;
  /** Distinct markets traded. */
  markets: number;
  biggestWin: number;
  /** Milliseconds since the epoch. */
  joined: number;
  /** Profit and loss on positions, realized and open, in USD. */
  pnl: number;
  realized: number;
  unrealized: number;
  /** Maker rebates and liquidity rewards: income from providing liquidity rather than from being right. */
  rebates: number;
}

export interface TradePage {
  /** Newest first. */
  trades: Trade[];
  /** The cursor for the next, older page; null at the end of the feed. */
  next: string | null;
}

export interface PnlPoint {
  time: number;
  pnl: number;
}

export interface ClientOptions {
  /** The Data API's address. Point it at a proxy where Polymarket can't be reached directly. */
  data?: string;
  /** The Gamma API's address. */
  gamma?: string;
  fetch?: typeof fetch;
  /** Requests in flight at once. */
  concurrency?: number;
  /** How long an answer is reused, in milliseconds. */
  ttl?: number;
}

interface Read {
  signal?: AbortSignal;
}

export interface Client {
  leaderboard(options?: Read & { window?: Window; category?: Category; by?: "pnl" | "volume"; limit?: number }): Promise<Trader[]>;
  /** Open positions come biggest first; closed ones newest first. `minUsd` drops open positions worth less. */
  positions(wallet: string, options?: Read & { status?: "open" | "closed"; limit?: number; minUsd?: number }): Promise<Position[]>;
  /** One wallet's place on a board, with its name and handle. `rank` is NaN when it isn't ranked there. */
  standing(wallet: string, options?: Read & { window?: Window; category?: Category }): Promise<(Trader & { volumeRank: number }) | null>;
  stats(wallet: string, options?: Read): Promise<WalletStats | null>;
  pnl(wallet: string, options?: Read & { interval?: "1d" | "1w" | "1m" | "all"; fidelity?: "1h" | "3h" | "12h" | "1d" }): Promise<PnlPoint[]>;
  /** Trades across all of Polymarket, or one wallet's, newest first. `fresh` skips the cache, for polling. */
  trades(options?: Read & { wallet?: string; minUsd?: number; limit?: number; fresh?: boolean }): Promise<Trade[]>;
  /** One page of the same feed, up to 1000 trades, with the cursor that reads further back. Pass the same wallet
   *  and size with the cursor: the cursor carries only where to resume. */
  tradePage(options?: Read & { wallet?: string; minUsd?: number; limit?: number; cursor?: string; fresh?: boolean }): Promise<TradePage>;
  /** The tag slugs of each event ("politics", "sports"…), keyed by event id. */
  eventTags(ids: string[], options?: Read): Promise<Map<string, string[]>>;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

type Row = Record<string, unknown>;

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
};
const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const ms = (seconds: unknown): number => (Number.isFinite(num(seconds)) ? num(seconds) * 1000 : NaN);
const WALLET = /^0x[0-9a-fA-F]{40}$/;

export function isWallet(value: string): boolean {
  return WALLET.test(value);
}

export function toTrader(row: Row): Trader {
  return {
    rank: num(row.rank),
    wallet: str(row.user_id ?? row.proxy_wallet ?? row.wallet).toLowerCase(),
    name: str(row.user_name ?? row.name),
    pnl: num(row.pnl),
    volume: num(row.volume),
    image: str(row.profile_image),
    x: str(row.x_username).replace(/^@/, ""),
    verified: row.verified === true,
  };
}

export function toPosition(row: Row): Position {
  return {
    wallet: str(row.proxy_wallet).toLowerCase(),
    name: str(row.name),
    tokenId: str(row.token_id),
    conditionId: str(row.condition_id),
    eventId: str(row.event_id),
    eventSlug: str(row.event_slug),
    slug: str(row.slug),
    title: str(row.title),
    icon: str(row.icon),
    outcome: str(row.outcome),
    oppositeOutcome: str(row.opposite_outcome),
    status: str(row.status),
    size: num(row.current_size),
    avgPrice: num(row.avg_price),
    cost: num(row.entry_cost_usdc),
    price: num(row.current_price),
    value: num(row.current_value),
    realized: num(row.realized_pnl),
    unrealized: num(row.unrealized_pnl),
    pnl: num(row.total_pnl),
    percent: row.status === "CLOSED" ? num(row.percent_realized_pnl) : num(row.percent_pnl),
    endDate: str(row.end_date),
    firstEntry: ms(row.first_entry_at),
    lastActivity: ms(row.last_event_at),
  };
}

export function toTrade(row: Row): Trade {
  const size = num(row.size);
  const price = num(row.price);
  const tokenId = str(row.token_id ?? row.asset_id);
  const side = row.side === "SELL" ? "SELL" : "BUY";
  return {
    id: `${str(row.transaction_hash)}:${tokenId}:${side}:${str(row.proxy_wallet ?? row.wallet)}`,
    wallet: str(row.proxy_wallet ?? row.wallet).toLowerCase(),
    name: str(row.name),
    image: str(row.profile_image),
    side,
    tokenId,
    conditionId: str(row.condition_id),
    title: str(row.title),
    slug: str(row.slug),
    eventSlug: str(row.event_slug),
    icon: str(row.icon),
    outcome: str(row.outcome),
    size,
    price,
    usd: size * price,
    time: ms(row.timestamp),
  };
}

export function toStats(row: Row | null): WalletStats | null {
  if (!row) return null;
  const totals = (row.all_time_pnl ?? {}) as Row;
  return {
    wallet: str(row.proxy_wallet).toLowerCase(),
    markets: num(row.trades),
    biggestWin: num(row.biggest_win),
    joined: ms(row.join_date),
    pnl: num(totals.position_pnl),
    realized: num(totals.realized_pnl),
    unrealized: num(totals.unrealized_pnl),
    rebates: (num(totals.maker_rebate) || 0) + (num(totals.taker_rebate) || 0) + (num(totals.reward_income) || 0),
  };
}

export function client(options: ClientOptions = {}): Client {
  const dataBase = (options.data ?? "https://data-api.polymarket.com").replace(/\/$/, "");
  const gammaBase = (options.gamma ?? "https://gamma-api.polymarket.com").replace(/\/$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const ttl = options.ttl ?? 30_000;
  const limit = Math.max(1, options.concurrency ?? 16);

  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  const tags = new Map<string, string[]>();
  const queue: (() => void)[] = [];
  let active = 0;

  async function slot<T>(work: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await work();
    } finally {
      active--;
      queue.shift()?.();
    }
  }

  async function request(url: string, signal?: AbortSignal, fresh = false): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let response: Response;
      try {
        // The API tells browsers to keep answers for five minutes, which would freeze a poll on the same address.
        response = await slot(() => doFetch(url, { signal, cache: fresh ? "no-store" : "default", headers: { accept: "application/json" } }));
      } catch (error) {
        if (signal?.aborted || attempt >= 2) throw error;
        await wait(400 * (attempt + 1), signal);
        continue;
      }
      if (response.ok) return response.json();
      // The API throttles by IP and says when to come back.
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const after = Number(response.headers.get("retry-after"));
        await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 600 * (attempt + 1), signal);
        continue;
      }
      let message = `${response.status} from ${new URL(url, "http://x").pathname}`;
      try {
        const body = (await response.json()) as Row;
        if (typeof body.error === "string") message = body.error;
      } catch {
        // Not JSON; the status says enough.
      }
      throw new ApiError(message, response.status);
    }
  }

  function get(base: string, path: string, params: Record<string, string | number | boolean | undefined>, read: Read & { fresh?: boolean } = {}): Promise<unknown> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
    const search = query.toString();
    const url = `${base}${path}${search ? `?${search}` : ""}`;
    const hit = cache.get(url);
    if (!read.fresh && hit && Date.now() - hit.at < ttl) return hit.value;
    const value = request(url, read.signal, read.fresh);
    cache.set(url, { at: Date.now(), value });
    // A failed or cancelled read isn't worth remembering.
    value.catch(() => cache.get(url)?.value === value && cache.delete(url));
    return value;
  }

  const rows = (body: unknown): Row[] => {
    const data = (body as Row | null)?.data;
    return Array.isArray(data) ? (data as Row[]) : [];
  };
  const cap = (value: number | undefined, fallback: number) => Math.min(1000, Math.max(1, Math.round(value ?? fallback)));

  async function tradePage({ wallet, minUsd, limit: count, cursor, fresh, signal }: Read & { wallet?: string; minUsd?: number; limit?: number; cursor?: string; fresh?: boolean } = {}): Promise<TradePage> {
    const body = (await get(
      dataBase,
      "/v2/trades",
      { user: wallet, limit: cap(count, 100), filter_type: minUsd ? "CASH" : undefined, filter_amount: minUsd || undefined, cursor },
      { signal, fresh },
    )) as Row | null;
    const next = (body?.pagination as Row | undefined)?.next_cursor;
    return { trades: rows(body).map(toTrade), next: typeof next === "string" && next ? next : null };
  }

  return {
    async leaderboard({ window = "month", category = "overall", by = "pnl", limit: count, signal } = {}) {
      const body = await get(dataBase, "/v2/leaderboard", { time_period: window, category, sort_by: by === "volume" ? "VOLUME" : "PNL", limit: cap(count, 50) }, { signal });
      return rows(body).map(toTrader).filter((trader) => isWallet(trader.wallet));
    },

    async positions(wallet, { status = "open", limit: count, minUsd, signal } = {}) {
      const body = await get(
        dataBase,
        "/v2/positions",
        {
          user: wallet,
          status: status === "closed" ? "CLOSED" : "OPEN",
          // Closed positions read newest first; open ones by what they're worth.
          sort_by: status === "closed" ? "TIMESTAMP" : "CURRENT_VALUE",
          limit: cap(count, 100),
        },
        { signal },
      );
      // The API can filter by value itself, but on large wallets that query times out, so the floor applies here.
      const positions = rows(body).map(toPosition);
      return minUsd ? positions.filter((position) => position.status === "CLOSED" || position.value >= minUsd) : positions;
    },

    async standing(wallet, { window = "month", category = "overall", signal } = {}) {
      const body = (await get(dataBase, "/v2/leaderboard", { user: wallet, time_period: window, category }, { signal })) as Row | null;
      const row = body?.data as Row | null;
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      return { ...toTrader({ ...row, rank: row.rank_pnl ?? NaN }), volumeRank: num(row.rank_volume) };
    },

    async stats(wallet, { signal } = {}) {
      const body = (await get(dataBase, "/v2/user-stats", { user: wallet }, { signal })) as Row | null;
      return toStats((body?.data as Row | null) ?? null);
    },

    async pnl(wallet, { interval = "1m", fidelity = "1d", signal } = {}) {
      const body = (await get(dataBase, "/v2/user-pnl", { user: wallet, interval, fidelity }, { signal })) as Row | null;
      const points = ((body?.data as Row | null)?.points ?? []) as Row[];
      return points.map((point) => ({ time: ms(point.timestamp), pnl: num(point.position_pnl) })).filter((point) => Number.isFinite(point.pnl));
    },

    async trades(options = {}) {
      return (await tradePage(options)).trades;
    },

    tradePage,

    async eventTags(ids, { signal } = {}) {
      const wanted = [...new Set(ids.filter(Boolean))].filter((id) => !tags.has(id));
      const batches: string[][] = [];
      for (let start = 0; start < wanted.length; start += 20) batches.push(wanted.slice(start, start + 20));
      await Promise.all(
        batches.map(async (batch) => {
          const url = `${gammaBase}/events?${batch.map((id) => `id=${encodeURIComponent(id)}`).join("&")}&limit=${batch.length}`;
          let events: Row[];
          try {
            events = (await request(url, signal)) as Row[];
          } catch (error) {
            if (signal?.aborted) throw error;
            // One batch failing leaves its events untagged for now; they're asked for again next time.
            return;
          }
          for (const event of Array.isArray(events) ? events : []) {
            const slugs = Array.isArray(event.tags) ? (event.tags as Row[]).map((tag) => str(tag.slug).toLowerCase()) : [];
            tags.set(str(event.id), slugs);
          }
          // An id Gamma doesn't know still gets an answer, so it isn't asked for again.
          for (const id of batch) if (!tags.has(id)) tags.set(id, []);
        }),
      );
      return new Map(ids.map((id) => [id, tags.get(id) ?? []]));
    },
  };
}

function wait(duration: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, duration);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
