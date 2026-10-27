/* The analysis, kept apart from the network and the page so it can be tested on plain data. */
import type { Category, Position, Trader } from "./api.js";

/** The Gamma tag slugs that put an event on each board. */
export const CATEGORY_TAGS: Record<Category, string[]> = {
  overall: [],
  politics: ["politics", "elections", "geopolitics"],
  sports: ["sports"],
  crypto: ["crypto", "crypto-prices"],
  culture: ["culture", "pop-culture"],
  economics: ["economy", "economics", "fed"],
  tech: ["tech", "technology", "ai"],
  finance: ["finance", "business", "stocks"],
  mentions: ["mentions"],
  weather: ["weather", "climate"],
  esports: ["esports"],
};

export function inCategory(tags: readonly string[], category: Category): boolean {
  if (category === "overall") return true;
  return CATEGORY_TAGS[category].some((tag) => tags.includes(tag));
}

export interface Holding {
  trader: Trader;
  position: Position;
}

export interface FlowRow {
  tokenId: string;
  conditionId: string;
  title: string;
  slug: string;
  eventSlug: string;
  icon: string;
  outcome: string;
  oppositeOutcome: string;
  /** The last price, 0 to 1. */
  price: number;
  /** Who holds it, biggest first. */
  holders: Holding[];
  /** USD the traders' shares are worth now. */
  value: number;
  /** USD they paid for them. */
  cost: number;
  /** What they paid per share on average, weighted by size. */
  avgPrice: number;
  /** How far the price has moved from what they paid, in dollars per share. Above zero, the market has come their way. */
  edge: number;
  /** Their open profit or loss on it, in USD. */
  pnl: number;
  /** USD the same traders hold on the other outcomes of this market. */
  against: number;
  /** How one-sided they are: this outcome's share of everything they hold in the market, 0 to 1. */
  share: number;
  /** When the first of them bought in, in milliseconds. */
  firstEntry: number;
  /** When any of them last traded it. */
  lastActivity: number;
}

export interface FlowOptions {
  /** Leave out outcomes priced within this distance of 0 or 1: a market that's all but decided says little. */
  settled?: number;
  /** Leave out holdings worth less than this, in USD. */
  minValue?: number;
}

/** Where a group of traders' money sits right now: one row per outcome they hold, with how many of them hold it,
 *  how much, at what average price, and how much they hold against it. */
export function flow(holdings: readonly { trader: Trader; positions: readonly Position[] }[], { settled = 0.02, minValue = 0 }: FlowOptions = {}): FlowRow[] {
  const rows = new Map<string, FlowRow>();
  const byCondition = new Map<string, number>();
  const size = new Map<string, number>();

  for (const { trader, positions } of holdings) {
    for (const position of positions) {
      if (position.status && position.status !== "OPEN") continue;
      if (!(position.value >= minValue) || !(position.size > 0)) continue;
      byCondition.set(position.conditionId, (byCondition.get(position.conditionId) ?? 0) + position.value);
      if (!(position.price > settled && position.price < 1 - settled)) continue;

      let row = rows.get(position.tokenId);
      if (!row) {
        row = {
          tokenId: position.tokenId,
          conditionId: position.conditionId,
          title: position.title,
          slug: position.slug,
          eventSlug: position.eventSlug,
          icon: position.icon,
          outcome: position.outcome,
          oppositeOutcome: position.oppositeOutcome,
          price: position.price,
          holders: [],
          value: 0,
          cost: 0,
          avgPrice: NaN,
          edge: NaN,
          pnl: 0,
          against: 0,
          share: 1,
          firstEntry: Infinity,
          lastActivity: -Infinity,
        };
        rows.set(position.tokenId, row);
      }
      // A wallet listed twice (it can sit on two boards) counts once.
      if (row.holders.some((holding) => holding.trader.wallet === trader.wallet)) continue;
      row.holders.push({ trader, position });
      row.value += position.value;
      row.cost += position.cost;
      row.pnl += Number.isFinite(position.unrealized) ? position.unrealized : 0;
      size.set(position.tokenId, (size.get(position.tokenId) ?? 0) + position.size);
      // Rows can disagree on the last price by a tick; the most recently touched one is freshest.
      if (!(position.lastActivity < row.lastActivity)) row.price = position.price;
      if (position.firstEntry < row.firstEntry) row.firstEntry = position.firstEntry;
      if (position.lastActivity > row.lastActivity) row.lastActivity = position.lastActivity;
    }
  }

  for (const row of rows.values()) {
    const shares = size.get(row.tokenId) ?? 0;
    row.avgPrice = shares > 0 ? row.cost / shares : NaN;
    row.edge = row.price - row.avgPrice;
    row.against = Math.max(0, (byCondition.get(row.conditionId) ?? row.value) - row.value);
    row.share = row.value + row.against > 0 ? row.value / (row.value + row.against) : 1;
    row.holders.sort((a, b) => b.position.value - a.position.value);
  }
  return sortFlow([...rows.values()], "wallets");
}

export type FlowSort = "wallets" | "value" | "edge" | "recent";

export function sortFlow(rows: FlowRow[], by: FlowSort): FlowRow[] {
  const key: Record<FlowSort, (row: FlowRow) => number> = {
    wallets: (row) => row.holders.length * 1e12 + row.value,
    value: (row) => row.value,
    edge: (row) => (Number.isFinite(row.edge) ? row.edge : -Infinity),
    recent: (row) => row.lastActivity,
  };
  return rows.sort((a, b) => key[by](b) - key[by](a));
}

export interface TrackRecord {
  /** Closed positions counted. */
  closed: number;
  wins: number;
  losses: number;
  /** Wins over decided positions, 0 to 1; NaN with none decided. */
  winRate: number;
  /** Realized profit over the positions counted, in USD. */
  realized: number;
  best: Position | null;
  worst: Position | null;
}

/** A wallet's record over the closed positions given. Positions that closed within fifty cents of even count as
 *  neither, so a wallet doesn't get a win for selling at cost. */
export function trackRecord(closed: readonly Position[]): TrackRecord {
  let wins = 0;
  let losses = 0;
  let realized = 0;
  let best: Position | null = null;
  let worst: Position | null = null;
  for (const position of closed) {
    const result = position.realized;
    if (!Number.isFinite(result)) continue;
    realized += result;
    if (result > 0.5) wins++;
    else if (result < -0.5) losses++;
    if (!best || result > best.realized) best = position;
    if (!worst || result < worst.realized) worst = position;
  }
  return { closed: closed.length, wins, losses, winRate: wins + losses ? wins / (wins + losses) : NaN, realized, best, worst };
}

/** The share of a wallet's profit that came from rebates and rewards rather than from its positions, 0 to 1. A high
 *  share marks a market maker: its edge is in providing liquidity, not in calling outcomes. */
export function rebateShare(rebates: number, pnl: number): number {
  if (!(rebates > 0)) return 0;
  const total = rebates + Math.max(0, pnl);
  return total > 0 ? rebates / total : 0;
}

/** An SVG path for a line through the points, scaled to fit the box, and the y of zero within it. */
export function sparkline(values: readonly number[], width: number, height: number, pad = 1): { line: string; area: string; zero: number } {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return { line: "", area: "", zero: height / 2 };
  let min = Math.min(...finite, 0);
  let max = Math.max(...finite, 0);
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const x = (index: number) => (index / (finite.length - 1)) * width;
  const y = (value: number) => pad + (1 - (value - min) / (max - min)) * (height - pad * 2);
  const points = finite.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  const zero = y(0);
  return { line: `M${points.join("L")}`, area: `M0,${zero.toFixed(1)}L${points.join("L")}L${width},${zero.toFixed(1)}Z`, zero };
}
