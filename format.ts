/** Shown for a value the API didn't give, so a gap never reads as zero. */
export const EMPTY = "–";

const MINUS = "−";

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1e4) return Math.round(abs).toLocaleString("en-US");
  // Rounded before the unit is picked, so 999.6M reads 1B rather than 1000M.
  const rounded = Number(abs.toPrecision(3));
  if (rounded >= 1e9) return `${trim(rounded / 1e9)}B`;
  if (rounded >= 1e6) return `${trim(rounded / 1e6)}M`;
  return `${trim(rounded / 1e3)}K`;
}

// Three significant figures reads well at every size: 1.24M, 12.4M, 124M. Only zeros after a decimal point go.
function trim(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const text = value.toFixed(digits);
  return digits ? text.replace(/\.?0+$/, "") : text;
}

const valid = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** $1.24M, $48.2K, $820. */
export function formatUsd(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  return `${value < 0 ? MINUS : ""}$${compact(value)}`;
}

/** +$1.24M or −$48.2K, for profit and loss. */
export function formatPnl(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  if (Math.abs(value) < 0.5) return "$0";
  return `${value > 0 ? "+" : MINUS}$${compact(value)}`;
}

/** A share price the way Polymarket shows it: 62¢, 0.4¢, 99.6¢. Prices are dollars between 0 and 1. */
export function formatCents(price: number | null | undefined): string {
  if (!valid(price)) return EMPTY;
  const cents = price * 100;
  if (cents > 0 && cents < 0.1) return "<0.1¢";
  if (cents < 100 && cents > 99.9) return ">99.9¢";
  const rounded = Math.round(cents * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}¢`;
}

/** A move in cents with its sign: +12¢, −3.5¢. */
export function formatCentsChange(change: number | null | undefined): string {
  if (!valid(change)) return EMPTY;
  const cents = Math.round(change * 1000) / 10;
  if (cents === 0) return "0¢";
  return `${cents > 0 ? "+" : MINUS}${Math.abs(cents).toFixed(Number.isInteger(cents) ? 0 : 1)}¢`;
}

/** 12%, +12%, −3.4%. `signed` adds the plus. */
export function formatPercent(value: number | null | undefined, signed = false): string {
  if (!valid(value)) return EMPTY;
  const abs = Math.abs(value);
  const text = abs >= 100 ? Math.round(abs).toLocaleString("en-US") : abs >= 10 ? abs.toFixed(0) : abs.toFixed(1).replace(/\.0$/, "");
  if (text === "0") return "0%";
  return `${value < 0 ? MINUS : signed ? "+" : ""}${text}%`;
}

/** Outcome shares, rounded: 454.7K shares. */
export function formatShares(value: number | null | undefined): string {
  if (!valid(value)) return EMPTY;
  return compact(value);
}

/** How long ago, in the units a feed uses: 8s, 4m, 3h, 2d. */
export function formatAge(time: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/** 0xf031…c80c. */
export function shortWallet(wallet: string): string {
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

/** Polymarket names wallets that never set a username after the wallet and a timestamp. Those read better short. */
export function displayName(name: string, wallet: string): string {
  if (!name || /^0x[0-9a-f]{40}(-\d+)?$/i.test(name)) return shortWallet(wallet);
  return name;
}
