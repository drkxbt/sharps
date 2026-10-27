import { test } from "node:test";
import assert from "node:assert/strict";
import {
  client,
  displayName,
  flow,
  formatAge,
  formatCents,
  formatCentsChange,
  formatPercent,
  formatPnl,
  formatUsd,
  inCategory,
  pageList,
  rebateShare,
  shortWallet,
  sortFlow,
  sparkline,
  tape,
  toPosition,
  toStats,
  toTrade,
  toTrader,
  trackRecord,
} from "../dist/index.js";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);

test("money, prices and percentages read the way Polymarket writes them", () => {
  assert.equal(formatUsd(1_240_000), "$1.24M");
  assert.equal(formatUsd(48_210), "$48.2K");
  assert.equal(formatUsd(820.4), "$820");
  assert.equal(formatUsd(-3_400_000), "−$3.4M");
  assert.equal(formatUsd(NaN), "–");
  assert.equal(formatPnl(75_035), "+$75K");
  assert.equal(formatPnl(-5_454), "−$5,454");
  assert.equal(formatPnl(0.2), "$0");
  assert.equal(formatCents(0.62), "62¢");
  assert.equal(formatCents(0.7099), "71¢");
  assert.equal(formatCents(0.755), "75.5¢");
  assert.equal(formatCents(0.0004), "<0.1¢");
  assert.equal(formatCents(0.9996), ">99.9¢");
  assert.equal(formatCents(1), "100¢");
  assert.equal(formatCentsChange(0.045), "+4.5¢");
  assert.equal(formatCentsChange(-0.13), "−13¢");
  assert.equal(formatCentsChange(0), "0¢");
  assert.equal(formatPercent(93.2), "93%");
  assert.equal(formatPercent(4.25, true), "+4.3%");
  assert.equal(formatPercent(-0.04), "0%");
});

test("ages, wallets and unnamed traders", () => {
  const now = 1_000_000_000;
  assert.equal(formatAge(now - 8_000, now), "8s");
  assert.equal(formatAge(now - 4 * 60_000, now), "4m");
  assert.equal(formatAge(now - 3 * 3_600_000, now), "3h");
  assert.equal(formatAge(now - 2 * 86_400_000, now), "2d");
  assert.equal(shortWallet("0xf0318c32136c2db7fec88b84869aee6a1106c80c"), "0xf031…c80c");
  assert.equal(displayName("BreakTheBank", A), "BreakTheBank");
  // Polymarket's placeholder names are the wallet plus a timestamp.
  assert.equal(displayName("0xB985b597F5598a975C42032749386D765826B70d-1781959038065", "0xb985b597f5598a975c42032749386d765826b70d"), "0xb985…b70d");
  assert.equal(displayName("", A), shortWallet(A));
});

test("API rows become plain records with numbers and milliseconds", () => {
  const trader = toTrader({ rank: 1, user_id: "0xF0318C32136C2DB7FEC88B84869AEE6A1106C80C", pnl: 4173971.5, volume: 44350192.9, user_name: "BreakTheBank", profile_image: "", x_username: "@someone", verified: false });
  assert.equal(trader.wallet, "0xf0318c32136c2db7fec88b84869aee6a1106c80c");
  assert.equal(trader.x, "someone");
  assert.equal(trader.pnl, 4173971.5);

  const position = toPosition({ proxy_wallet: A, token_id: "1", condition_id: "c", current_size: 454675.9778, avg_price: 0.7099, entry_cost_usdc: 322805.6, current_price: 0.875, current_value: 397841.48, realized_pnl: -63.4, unrealized_pnl: 75035.8, total_pnl: 74972.4, percent_pnl: 23.24, percent_realized_pnl: -34.7, status: "OPEN", title: "T", outcome: "No", first_entry_at: 1785930377, last_event_at: 1789743523 });
  assert.equal(position.percent, 23.24);
  assert.equal(position.firstEntry, 1785930377000);
  assert.equal(toPosition({ status: "CLOSED", percent_pnl: 0, percent_realized_pnl: 198.7 }).percent, 198.7);

  const trade = toTrade({ proxy_wallet: B, side: "SELL", token_id: "9", size: 10, price: 0.356, timestamp: 1793125353, transaction_hash: "0xabc", outcome: "Yes" });
  assert.equal(trade.side, "SELL");
  assert.ok(Math.abs(trade.usd - 3.56) < 1e-9);
  assert.equal(trade.time, 1793125353000);
  assert.ok(trade.id.startsWith("0xabc:9:SELL"));

  const stats = toStats({ proxy_wallet: A, trades: 1289, biggest_win: 1409061.7, join_date: 1769123843, all_time_pnl: { position_pnl: 12349546.4, realized_pnl: 12123851.8, unrealized_pnl: 225694.6, maker_rebate: 375352.9, taker_rebate: 26018.3, reward_income: 58570.3 } });
  assert.equal(stats.markets, 1289);
  assert.equal(Math.round(stats.rebates), 459942);
  assert.equal(toStats(null), null);
});

const trader = (wallet, rank, name = wallet.slice(2, 6)) => ({ rank, wallet, name, pnl: 1000, volume: 1, image: "", x: "", verified: false });
const position = (fields) => ({
  wallet: A, name: "", tokenId: "t1", conditionId: "c1", eventId: "e1", eventSlug: "ev", slug: "m", title: "Will it happen?", icon: "",
  outcome: "Yes", oppositeOutcome: "No", status: "OPEN", size: 100, avgPrice: 0.4, cost: 40, price: 0.6, value: 60,
  realized: 0, unrealized: 20, pnl: 20, percent: 50, endDate: "", firstEntry: 1000, lastActivity: 2000, ...fields,
});

test("flow adds up what the traders hold, outcome by outcome", () => {
  const rows = flow([
    { trader: trader(A, 1), positions: [position({ size: 100, cost: 40, value: 60 }), position({ tokenId: "t2", outcome: "No", size: 50, cost: 10, value: 20, price: 0.4, unrealized: 10 })] },
    { trader: trader(B, 2), positions: [position({ size: 300, cost: 150, value: 180, avgPrice: 0.5, unrealized: 30, firstEntry: 500, lastActivity: 3000, price: 0.61 })] },
    { trader: trader(C, 3), positions: [position({ tokenId: "t3", conditionId: "c3", price: 0.99, value: 990 })] },
  ]);
  // The market at 99¢ is all but decided and stays out.
  assert.deepEqual(rows.map((row) => row.tokenId), ["t1", "t2"]);
  const [yes, no] = rows;
  assert.equal(yes.holders.length, 2);
  assert.equal(yes.holders[0].trader.wallet, B, "biggest holder first");
  assert.equal(yes.value, 240);
  assert.equal(yes.cost, 190);
  // Weighted by shares: 190 paid for 400 shares.
  assert.equal(yes.avgPrice, 0.475);
  // The freshest price wins.
  assert.equal(yes.price, 0.61);
  assert.ok(Math.abs(yes.edge - 0.135) < 1e-9);
  assert.equal(yes.pnl, 50);
  assert.equal(yes.against, 20);
  assert.equal(yes.share, 240 / 260);
  assert.equal(yes.firstEntry, 500);
  assert.equal(yes.lastActivity, 3000);
  assert.equal(no.against, 240);
});

test("flow counts a wallet once and skips closed and dust positions", () => {
  const rows = flow(
    [
      { trader: trader(A, 1), positions: [position({}), position({ status: "CLOSED" })] },
      { trader: trader(A, 1), positions: [position({})] },
      { trader: trader(B, 2), positions: [position({ value: 50 })] },
    ],
    { minValue: 55 },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].holders.length, 1);
  assert.equal(rows[0].value, 60);
});

test("flow sorts by traders, money, profit and recency", () => {
  const rows = flow([
    { trader: trader(A, 1), positions: [position({ tokenId: "x", value: 500, cost: 400, size: 1000, price: 0.5, lastActivity: 10 }), position({ tokenId: "y", conditionId: "c2", value: 100, cost: 10, size: 100, price: 0.5, lastActivity: 30 })] },
    { trader: trader(B, 2), positions: [position({ tokenId: "y", conditionId: "c2", value: 100, cost: 10, size: 100, price: 0.5, lastActivity: 20 })] },
  ]);
  assert.deepEqual(sortFlow(rows.slice(), "wallets").map((row) => row.tokenId), ["y", "x"]);
  assert.deepEqual(sortFlow(rows.slice(), "value").map((row) => row.tokenId), ["x", "y"]);
  assert.deepEqual(sortFlow(rows.slice(), "edge").map((row) => row.tokenId), ["y", "x"]);
  assert.deepEqual(sortFlow(rows.slice(), "recent").map((row) => row.tokenId), ["y", "x"]);
});

test("categories match on the event's tags", () => {
  assert.equal(inCategory(["epl", "soccer", "sports"], "sports"), true);
  assert.equal(inCategory(["sports"], "politics"), false);
  assert.equal(inCategory(["pop-culture"], "culture"), true);
  assert.equal(inCategory([], "overall"), true);
});

test("a record counts wins and losses, not trades closed near even", () => {
  const record = trackRecord([position({ realized: 1200 }), position({ realized: -300 }), position({ realized: 0.2 }), position({ realized: 50 }), position({ realized: NaN })]);
  assert.equal(record.wins, 2);
  assert.equal(record.losses, 1);
  assert.equal(record.winRate, 2 / 3);
  assert.equal(record.realized, 950.2);
  assert.equal(record.best.realized, 1200);
  assert.equal(record.worst.realized, -300);
  assert.ok(Number.isNaN(trackRecord([]).winRate));
});

test("rebates show a market maker's share of income", () => {
  assert.equal(rebateShare(0, 100), 0);
  assert.equal(rebateShare(300, 100), 0.75);
  assert.equal(rebateShare(100, -500), 1);
});

test("sparklines fit the box and mark zero", () => {
  const { line, area, zero } = sparkline([0, 10, -10, 20], 100, 20, 0);
  assert.ok(line.startsWith("M0.0,"));
  assert.ok(line.includes("L100.0,0.0"), "the high point touches the top");
  assert.ok(Math.abs(zero - 40 / 3) < 1e-9);
  assert.ok(area.endsWith("Z"));
  assert.equal(sparkline([5], 100, 20).line, "");
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push(url);
    fn.inits.push(init);
    for (const [pattern, reply] of routes) {
      if (url.includes(pattern)) {
        const value = typeof reply === "function" ? reply(url, calls.length) : reply;
        if (value instanceof Response) return value;
        return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
  };
  fn.calls = calls;
  fn.inits = [];
  return fn;
}

test("the client builds v2 queries, caches answers and shares a request made twice", async () => {
  const fetch = fakeFetch([["/v2/leaderboard", { data: [{ rank: 1, user_id: A, pnl: 5, volume: 9, user_name: "a" }, { rank: 2, user_id: "not-a-wallet", pnl: 1 }] }]]);
  const api = client({ fetch, data: "https://proxy.test/pm/data/" });
  const [first, second] = await Promise.all([api.leaderboard({ window: "week", category: "politics", limit: 20 }), api.leaderboard({ window: "week", category: "politics", limit: 20 })]);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0], "https://proxy.test/pm/data/v2/leaderboard?time_period=week&category=politics&sort_by=PNL&limit=20");
  assert.equal(first.length, 1, "rows without a wallet are dropped");
  assert.deepEqual(first, second);
  await api.leaderboard({ window: "week", category: "politics", limit: 20 });
  assert.equal(fetch.calls.length, 1, "served from the cache");
});

test("the client waits out a rate limit and retries", async () => {
  let attempts = 0;
  const fetch = fakeFetch([
    ["/v2/user-stats", () => (++attempts === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "0.01" } }) : { data: { proxy_wallet: A, trades: 3, all_time_pnl: {} } })],
  ]);
  const stats = await client({ fetch }).stats(A);
  assert.equal(attempts, 2);
  assert.equal(stats.markets, 3);
});

test("the client reports the API's error message", async () => {
  const fetch = fakeFetch([["/v2/positions", new Response(JSON.stringify({ error: "required query param 'user' or 'condition' not provided" }), { status: 400 })]]);
  await assert.rejects(client({ fetch }).positions(A), (error) => error.name === "ApiError" && error.status === 400 && /required query param/.test(error.message));
});

test("open positions below the floor are dropped after reading", async () => {
  const fetch = fakeFetch([["/v2/positions", { data: [{ proxy_wallet: A, token_id: "1", current_value: 500, status: "OPEN" }, { proxy_wallet: A, token_id: "2", current_value: 20, status: "OPEN" }] }]]);
  const positions = await client({ fetch }).positions(A, { minUsd: 100 });
  assert.deepEqual(positions.map((item) => item.tokenId), ["1"]);
  assert.ok(!fetch.calls[0].includes("filter_type"), "the floor isn't sent, since it times out on large wallets");
});

test("event tags are fetched in batches of twenty and remembered", async () => {
  const fetch = fakeFetch([["/events", (url) => [...new URL(url).searchParams.getAll("id")].filter((id) => id !== "missing").map((id) => ({ id, tags: [{ slug: id === "1" ? "Politics" : "sports" }] }))]]);
  const api = client({ fetch, gamma: "https://g.test" });
  const ids = ["1", ...Array.from({ length: 21 }, (_, index) => String(index + 2)), "missing"];
  const tags = await api.eventTags(ids);
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(tags.get("1"), ["politics"]);
  assert.deepEqual(tags.get("missing"), []);
  await api.eventTags(["1", "missing"]);
  assert.equal(fetch.calls.length, 2);
});

test("the tape hands on each large trade once, oldest first", async () => {
  let poll = 0;
  const rows = [
    { proxy_wallet: A, side: "BUY", token_id: "1", size: 20000, price: 0.5, timestamp: 200, transaction_hash: "0x2" },
    { proxy_wallet: B, side: "SELL", token_id: "2", size: 50000, price: 0.4, timestamp: 100, transaction_hash: "0x1" },
  ];
  const fetch = fakeFetch([["/v2/trades", () => ({ data: poll++ === 0 ? rows : [{ proxy_wallet: C, side: "BUY", token_id: "3", size: 40000, price: 0.5, timestamp: 300, transaction_hash: "0x3" }, ...rows] })]]);
  const api = client({ fetch });
  const batches = [];
  const feed = tape(api, { minUsd: 10_000, every: 2000, onTrades: (trades) => batches.push(trades.map((trade) => trade.time)) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  feed.refresh();
  await new Promise((resolve) => setTimeout(resolve, 20));
  feed.stop();
  assert.deepEqual(batches, [[100_000, 200_000], [300_000]]);
  assert.ok(fetch.calls[0].includes("filter_type=CASH&filter_amount=10000"));
  assert.ok(fetch.inits.every((init) => init.cache === "no-store"), "polls skip the browser's cache");
});

test("pagers list every page up to seven, then the ends and the neighbours", () => {
  assert.deepEqual(pageList(1, 1), [1]);
  assert.deepEqual(pageList(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageList(1, 12), [1, 2, 3, 4, 5, 0, 12]);
  assert.deepEqual(pageList(6, 12), [1, 0, 5, 6, 7, 0, 12]);
  assert.deepEqual(pageList(12, 12), [1, 0, 8, 9, 10, 11, 12]);
});
