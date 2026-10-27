import { CATEGORIES, client, isWallet, type Category, type Client, type ClientOptions, type Position, type Trade, type TradePage, type Trader, type Window } from "./api.js";
import { displayName, EMPTY, formatAge, formatCents, formatCentsChange, formatPercent, formatPnl, formatUsd, shortWallet } from "./format.js";
import { flow, inCategory, pageList, rebateShare, sortFlow, sparkline, trackRecord, type FlowRow, type FlowSort } from "./model.js";
import { tape, type Tape } from "./tape.js";
import { walletAvatar } from "./avatar.js";

export type View = "board" | "flow" | "tape";

/** Everything a person can change, as plain data: put it in the URL to make a view shareable. */
export interface SharpsState {
  view: View;
  window: Window;
  category: Category;
  /** The wallet open in the side panel. */
  wallet: string | null;
  flowSort: FlowSort;
  /** The smallest trade on the tape, in USD. */
  minUsd: number;
  /** Show only trades by wallets on the board. */
  sharpsOnly: boolean;
}

export interface SharpsOptions extends ClientOptions {
  /** A client to share with the rest of the page; one is made from the other options otherwise. */
  api?: Client;
  state?: Partial<SharpsState>;
  /** How many of the board's top traders Flow reads. */
  depth?: number;
  /** Profile pictures and market icons, which load from Polymarket's image host. Off draws initials instead. */
  images?: boolean;
  /** Rewrites an image's address before it loads, to send images through your own host; return "" to skip one. */
  image?: (url: string) => string;
  /** Poll for new trades while the tape is showing. On by default. */
  live?: boolean;
  theme?: "light" | "dark" | "auto";
  onStateChange?: (state: SharpsState) => void;
}

export interface Sharps {
  readonly state: SharpsState;
  setState(next: Partial<SharpsState>): void;
  openWallet(wallet: string): void;
  closeWallet(): void;
  destroy(): void;
}

const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: "flow", label: "Flow", hint: "What the top traders hold now" },
  { key: "tape", label: "Tape", hint: "Large trades as they happen" },
  { key: "board", label: "Board", hint: "The traders who made the most" },
];
const WINDOWS: { key: Window; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All time" },
];
const CATEGORY_LABELS: Record<Category, string> = {
  overall: "All",
  politics: "Politics",
  sports: "Sports",
  crypto: "Crypto",
  culture: "Culture",
  economics: "Economy",
  tech: "Tech",
  finance: "Finance",
  mentions: "Mentions",
  weather: "Weather",
  esports: "Esports",
};
const FLOW_SORTS: { key: FlowSort; label: string; hint: string }[] = [
  { key: "wallets", label: "Most traders", hint: "Held by the most top traders" },
  { key: "value", label: "Most money", hint: "The most USD held" },
  { key: "edge", label: "Most in profit", hint: "The price has moved furthest past what they paid" },
  { key: "recent", label: "Latest", hint: "Traded most recently" },
];
const TAPE_SIZES = [1000, 5000, 10_000, 50_000, 100_000];
// Long lists show twenty at a time, with page numbers under them.
const PAGE = 20;
// Trades are read a thousand at a time, the most the API gives in one page; the tape keeps up to five thousand.
const TRADE_READ = 1000;
const TAPE_KEEP = 5000;
const BOARD_PREFIX: Record<Window, string> = { day: "today's", week: "this week's", month: "this month's", all: "the all-time" };
const PNL_WINDOWS: Record<Window, { interval: "1d" | "1w" | "1m" | "all"; fidelity: "1h" | "3h" | "1d" }> = {
  day: { interval: "1d", fidelity: "1h" },
  week: { interval: "1w", fidelity: "3h" },
  month: { interval: "1m", fidelity: "1d" },
  all: { interval: "all", fidelity: "1d" },
};

const ICONS = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  out: '<path d="M14 5h5v5M19 5l-8 8M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  bellOn: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5Z" fill="currentColor"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4.2h4.2"/>',
  sharp: '<path d="M12 3.5 14.4 9l5.9.5-4.5 3.9 1.4 5.8L12 16.1 6.8 19.2l1.4-5.8L3.7 9.5 9.6 9Z" fill="currentColor"/>',
};

export function sharps(container: HTMLElement, options: SharpsOptions = {}): Sharps {
  const api = options.api ?? client(options);
  const images = options.images ?? true;
  const imageUrl = options.image ?? ((url: string) => url);
  const live = options.live ?? true;
  const depth = Math.max(5, Math.min(1000, options.depth ?? 200));
  const state: SharpsState = {
    view: "flow",
    window: "month",
    category: "overall",
    wallet: null,
    flowSort: "wallets",
    minUsd: 10_000,
    sharpsOnly: false,
    ...clean(options.state ?? {}),
  };

  const root = element("div", "sx");
  if (options.theme && options.theme !== "light") root.dataset.theme = options.theme;
  container.replaceChildren(root);

  /* ---------- Chrome: views, window, categories ---------- */

  const head = element("div", "sx-head");
  const tabs = element("div", "sx-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "View");
  const tabButtons = new Map<View, HTMLButtonElement>();
  const panels = new Map<View, HTMLElement>();
  const id = `sx-${Math.random().toString(36).slice(2, 8)}`;
  for (const view of VIEWS) {
    const button = element("button", "sx-tab", view.label);
    button.type = "button";
    button.id = `${id}-tab-${view.key}`;
    button.title = view.hint;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `${id}-panel-${view.key}`);
    button.addEventListener("click", () => setState({ view: view.key }));
    tabButtons.set(view.key, button);
    tabs.append(button);
  }
  tabs.addEventListener("keydown", (event) => {
    const order = VIEWS.map((view) => view.key);
    const index = order.indexOf(state.view);
    const next = event.key === "ArrowRight" ? order[(index + 1) % order.length] : event.key === "ArrowLeft" ? order[(index + order.length - 1) % order.length] : null;
    if (!next) return;
    event.preventDefault();
    setState({ view: next });
    tabButtons.get(next)?.focus();
  });

  const windowGroup = segmented("Window", WINDOWS, () => state.window, (key) => setState({ window: key }));
  head.append(tabs, windowGroup.element);

  const categoryRow = element("div", "sx-cats");
  categoryRow.setAttribute("role", "group");
  categoryRow.setAttribute("aria-label", "Category");
  const categoryButtons = new Map<Category, HTMLButtonElement>();
  for (const category of CATEGORIES) {
    const button = element("button", "sx-chip", CATEGORY_LABELS[category]);
    button.type = "button";
    button.addEventListener("click", () => setState({ category }));
    categoryButtons.set(category, button);
    categoryRow.append(button);
  }

  for (const view of VIEWS) {
    const panel = element("section", "sx-panel");
    panel.id = `${id}-panel-${view.key}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `${id}-tab-${view.key}`);
    panel.dataset.panel = view.key;
    panels.set(view.key, panel);
  }
  root.append(head, categoryRow, ...panels.values());

  /* ---------- Board ---------- */

  const boardPanel = panels.get("board")!;
  const boardNote = element("p", "sx-note");
  const boardTable = element("table", "sx-table sx-board");
  const boardCaption = element("caption", "sx-sr");
  const boardHead = element("thead", "");
  boardHead.append(tableRow("tr", [headCell("#", "sx-rank"), headCell("Trader", "sx-who"), headCell("Profit", "sx-num"), headCell("Trend", "sx-trend"), headCell("Volume", "sx-num sx-hide-sm", "Shares traded in the window, both sides")]));
  const boardBody = element("tbody", "");
  boardTable.append(boardCaption, boardHead, boardBody);
  const boardScroll = element("div", "sx-scroll", undefined, [boardTable]);
  const boardPager = pager("Board pages", () => {
    renderBoard();
    keepInView(boardScroll);
  });
  boardPanel.append(boardNote, boardScroll, boardPager.element);
  let board: Trader[] = [];
  let boardLoad: AbortController | undefined;

  const trendObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(onTrendVisible, { rootMargin: "200px" });
  const trendQueue = new WeakMap<Element, Trader>();

  async function loadBoard() {
    boardLoad?.abort();
    const load = (boardLoad = new AbortController());
    busy(boardPanel, true);
    if (!board.length) boardBody.replaceChildren(...skeletonRows(8, 5));
    try {
      const traders = await api.leaderboard({ window: state.window, category: state.category, limit: 1000, signal: load.signal });
      if (load.signal.aborted) return;
      board = traders;
      renderBoard();
    } catch (error) {
      if (load.signal.aborted) return;
      boardBody.replaceChildren(stateRow(5, failure(error), loadBoard));
    } finally {
      if (boardLoad === load) busy(boardPanel, false);
    }
  }

  function renderBoard() {
    const windowLabel = WINDOWS.find((item) => item.key === state.window)!.label.toLowerCase();
    boardCaption.textContent = `Top traders by profit, ${CATEGORY_LABELS[state.category]}, ${windowLabel}`;
    boardNote.textContent = `Ranked by profit ${state.window === "all" ? "since they joined" : state.window === "day" ? "today" : `this ${state.window}`}${state.category === "overall" ? "" : ` in ${CATEGORY_LABELS[state.category].toLowerCase()} markets`}. Pick a trader to see what they hold.`;
    if (!board.length) {
      boardBody.replaceChildren(stateRow(5, "Nobody on this board yet. Try a longer window."));
      boardPager.update(0);
      return;
    }
    boardPager.update(board.length);
    trendObserver?.disconnect();
    const trends: HTMLElement[] = [];
    boardBody.replaceChildren(
      ...board.slice((boardPager.page - 1) * PAGE, boardPager.page * PAGE).map((trader) => {
        const tr = element("tr", "sx-row");
        const trend = element("td", "sx-trend");
        trend.append(element("span", "sx-spark is-empty"));
        trendQueue.set(trend, trader);
        trends.push(trend);
        tr.append(
          cell("sx-rank", String(trader.rank)),
          traderCell(trader, () => openWallet(trader.wallet, tr)),
          cell(`sx-num ${tone(trader.pnl)}`, formatPnl(trader.pnl)),
          trend,
          cell("sx-num sx-muted sx-hide-sm", formatUsd(trader.volume).replace("$", "")),
        );
        tr.addEventListener("click", (event) => {
          if ((event.target as Element).closest("a, button")) return;
          openWallet(trader.wallet, tr);
        });
        return tr;
      }),
    );
    for (const trend of trends) trendObserver?.observe(trend);
  }

  function onTrendVisible(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      trendObserver?.unobserve(entry.target);
      const trader = trendQueue.get(entry.target);
      if (!trader) continue;
      const span = entry.target.firstElementChild as HTMLElement;
      const window = state.window;
      api
        .pnl(trader.wallet, PNL_WINDOWS[window])
        .then((points) => {
          if (window !== state.window || !span.isConnected) return;
          // Over a window the line starts at zero, so it shows what was made in it.
          const base = window === "all" ? 0 : points[0]?.pnl ?? 0;
          span.replaceWith(spark(points.map((point) => point.pnl - base), 96, 24));
        })
        .catch(() => span.classList.add("is-failed"));
    }
  }

  /* ---------- Flow ---------- */

  const flowPanel = panels.get("flow")!;
  const flowNote = element("p", "sx-note");
  const flowTools = element("div", "sx-tools");
  const sortGroup = segmented("Sort", FLOW_SORTS, () => state.flowSort, (key) => setState({ flowSort: key }));
  flowTools.append(sortGroup.element);
  const flowProgress = element("div", "sx-progress");
  flowProgress.setAttribute("role", "status");
  const flowList = element("ol", "sx-flow");
  const flowPager = pager("Flow pages", () => {
    renderFlow();
    keepInView(flowList);
  });
  flowPanel.append(flowNote, flowTools, flowProgress, flowList, flowPager.element);
  let flowRows: FlowRow[] = [];
  let flowLoad: AbortController | undefined;
  let flowKey = "";
  const openRows = new Set<string>();

  async function loadFlow() {
    const key = `${state.window}|${state.category}`;
    if (key === flowKey && flowRows.length) return renderFlow();
    flowLoad?.abort();
    const load = (flowLoad = new AbortController());
    const signal = load.signal;
    busy(flowPanel, true);
    flowRows = [];
    openRows.clear();
    flowPager.reset();
    flowPager.update(0);
    flowList.replaceChildren(...Array.from({ length: 5 }, () => element("li", "sx-flow-item is-skeleton")));
    const windowLabel = WINDOWS.find((item) => item.key === state.window)!.label.toLowerCase();
    flowNote.textContent = `Open positions of the top ${depth} traders by profit (${windowLabel}${state.category === "overall" ? "" : `, ${CATEGORY_LABELS[state.category].toLowerCase()}`}), added up by outcome. Each trader's 50 largest positions count, and markets priced under 2¢ or over 98¢ are left out.`;
    try {
      progress(`Reading the board…`, 0);
      const traders = await api.leaderboard({ window: state.window, category: state.category, limit: depth, signal });
      let done = 0;
      let missed = 0;
      // A trader's 50 largest positions hold nearly all of what they have in play (97% for the month's top 200 when
      // measured) at half the download of their largest 100.
      const holdings = await Promise.all(
        traders.map(async (trader) => {
          const positions = await api.positions(trader.wallet, { limit: 50, minUsd: 100, signal }).catch((error) => {
            if (signal.aborted) throw error;
            missed++;
            return [] as Position[];
          });
          progress(`Reading positions: ${++done} of ${traders.length} traders`, done / traders.length);
          return { trader, positions };
        }),
      );
      let picked = holdings;
      if (state.category !== "overall") {
        progress("Matching markets to the category…", 1);
        const tags = await api.eventTags(
          holdings.flatMap((holding) => holding.positions.map((position) => position.eventId)),
          { signal },
        );
        picked = holdings.map(({ trader, positions }) => ({ trader, positions: positions.filter((position) => inCategory(tags.get(position.eventId) ?? [], state.category)) }));
      }
      if (signal.aborted) return;
      if (missed) flowNote.textContent += ` ${missed} of the ${traders.length} couldn't be read just now, so they're missing; try again in a minute.`;
      flowRows = flow(picked, { minValue: 100 });
      flowKey = missed ? "" : key;
      progress("", 1);
      renderFlow();
    } catch (error) {
      if (signal.aborted) return;
      progress("", 0);
      flowList.replaceChildren(stateItem(failure(error), () => {
        flowKey = "";
        loadFlow();
      }));
    } finally {
      if (flowLoad === load) busy(flowPanel, false);
    }
  }

  function progress(text: string, share: number) {
    flowProgress.textContent = text;
    flowProgress.hidden = !text;
    flowProgress.style.setProperty("--sx-progress", String(share));
  }

  function renderFlow() {
    if (!flowRows.length) {
      flowList.replaceChildren(stateItem("None of these traders holds an open position here right now."));
      flowPager.update(0);
      return;
    }
    const rows = sortFlow(flowRows.slice(), state.flowSort).slice(0, 80);
    flowPager.update(rows.length);
    flowList.replaceChildren(...rows.slice((flowPager.page - 1) * PAGE, flowPager.page * PAGE).map(flowItem));
  }

  function flowItem(row: FlowRow): HTMLLIElement {
    const item = element("li", "sx-flow-item");
    const summary = element("button", "sx-flow-head");
    summary.type = "button";
    summary.setAttribute("aria-expanded", String(openRows.has(row.tokenId)));
    const title = element("span", "sx-flow-title");
    title.append(marketIcon(row.icon, row.title), element("span", "sx-flow-name", row.title));
    const outcome = outcomeChip(row.outcome);
    const faces = element("span", "sx-faces");
    for (const holding of row.holders.slice(0, 4)) faces.append(avatar(holding.trader.wallet, holding.trader.image));
    const count = element("span", "sx-faces-count", `${row.holders.length} ${row.holders.length === 1 ? "trader" : "traders"}`);
    faces.append(count);

    const facts = element("span", "sx-facts");
    facts.append(
      fact("Held", formatUsd(row.value)),
      fact("They paid", formatCents(row.avgPrice)),
      fact("Now", formatCents(row.price)),
      fact("Move", formatCentsChange(row.edge), tone(row.edge)),
      fact("One-sided", formatPercent(row.share * 100), row.share < 0.6 ? "is-split" : ""),
    );
    const chevron = icon(ICONS.chevron, "sx-chevron");
    summary.append(title, element("span", "sx-flow-meta", undefined, [outcome, faces]), facts, chevron);
    summary.addEventListener("click", () => {
      const open = !openRows.has(row.tokenId);
      if (open) openRows.add(row.tokenId);
      else openRows.delete(row.tokenId);
      summary.setAttribute("aria-expanded", String(open));
      detail.hidden = !open;
    });

    const detail = element("div", "sx-flow-detail");
    detail.hidden = !openRows.has(row.tokenId);
    const table = element("table", "sx-table sx-holders");
    const thead = element("thead", "");
    thead.append(tableRow("tr", [headCell("Trader", "sx-who"), headCell("Held", "sx-num"), headCell("Paid", "sx-num"), headCell("Open profit", "sx-num")]));
    const tbody = element("tbody", "");
    const holderPager = pager("Holder pages", drawHolders);
    function drawHolders() {
      holderPager.update(row.holders.length);
      tbody.replaceChildren(
        ...row.holders.slice((holderPager.page - 1) * PAGE, holderPager.page * PAGE).map((holding) => {
          const tr = element("tr", "sx-row");
          tr.append(
            traderCell(holding.trader, () => openWallet(holding.trader.wallet, summary)),
            cell("sx-num", formatUsd(holding.position.value)),
            cell("sx-num sx-muted", formatCents(holding.position.avgPrice)),
            cell(`sx-num ${tone(holding.position.unrealized)}`, formatPnl(holding.position.unrealized)),
          );
          return tr;
        }),
      );
    }
    drawHolders();
    table.append(thead, tbody);
    const against = row.against > 0 ? element("p", "sx-note", `The same traders hold ${formatUsd(row.against)} on the other side of this market.`) : null;
    const link = externalLink(marketUrl(row.eventSlug, row.slug), "Open on Polymarket");
    detail.append(element("div", "sx-scroll", undefined, [table]), holderPager.element, ...(against ? [against] : []), link);
    item.append(summary, detail);
    return item;
  }

  /* ---------- Tape ---------- */

  const tapePanel = panels.get("tape")!;
  const tapeTools = element("div", "sx-tools");
  const sizeLabel = element("label", "sx-field");
  const sizeSelect = element("select", "sx-select");
  for (const size of TAPE_SIZES) {
    const option = element("option", "", `${formatUsd(size)}+`);
    option.value = String(size);
    sizeSelect.append(option);
  }
  sizeSelect.addEventListener("change", () => setState({ minUsd: Number(sizeSelect.value) }));
  sizeLabel.append(element("span", "sx-field-label", "Size"), sizeSelect);
  const onlyLabel = element("label", "sx-switch");
  const onlyInput = element("input", "");
  onlyInput.type = "checkbox";
  onlyInput.setAttribute("role", "switch");
  onlyInput.addEventListener("change", () => setState({ sharpsOnly: onlyInput.checked }));
  onlyLabel.append(onlyInput, element("span", "sx-switch-track"), element("span", "sx-field-label", "Top traders only"));
  const notifyButton = iconButton("sx-icon-button", "Notify me when a top trader makes a large trade", ICONS.bell);
  notifyButton.setAttribute("aria-pressed", "false");
  notifyButton.hidden = typeof Notification === "undefined";
  const liveDot = element("span", "sx-live", "Live");
  liveDot.title = "New trades appear on their own";
  tapeTools.append(sizeLabel, onlyLabel, element("span", "sx-grow"), liveDot, notifyButton);
  const tapeNote = element("p", "sx-note");
  const tapeTable = element("table", "sx-table sx-tape");
  const tapeHead = element("thead", "");
  tapeHead.append(tableRow("tr", [headCell("When", "sx-when"), headCell("Trader", "sx-who"), headCell("Trade", "sx-what"), headCell("Price", "sx-num sx-hide-sm"), headCell("Size", "sx-num")]));
  const tapeBody = element("tbody", "");
  tapeTable.append(tapeHead, tapeBody);
  const tapeScroll = element("div", "sx-scroll", undefined, [tapeTable]);
  const tapePager = pager(
    "Tape pages",
    () => {
      renderTape();
      keepInView(tapeScroll);
      // Landing on the last page reads the next thousand older trades, so the next page is there when wanted.
      if (tapePager.page === tapePager.pages && tapeOlder) loadOlderTrades();
    },
    { has: () => Boolean(tapeOlder), load: () => loadOlderTrades() },
  );
  const tapeStatus = element("p", "sx-note sx-feed-status");
  tapeStatus.setAttribute("aria-live", "polite");
  tapePanel.append(tapeTools, tapeNote, tapeScroll, tapePager.element, tapeStatus);

  let tapeFeed: Tape | undefined;
  let trades: Trade[] = [];
  let tapeOlder: string | null = null;
  let tapeOlderRead: Promise<boolean> | null = null;
  let tapeOlderFailed = false;
  let primed = false;
  let notify = false;
  const sharpWallets = new Map<string, Trader>();
  let sharpKey = "";
  const clock = setInterval(() => {
    for (const time of tapeBody.querySelectorAll<HTMLElement>("[data-time]")) time.textContent = formatAge(Number(time.dataset.time));
  }, 5000);

  async function loadSharps() {
    const key = `${state.window}|${state.category}`;
    if (key === sharpKey) return;
    sharpKey = key;
    try {
      // The top 250 on the board: wide enough to catch most of their trades, narrow enough that a star still means something.
      const traders = await api.leaderboard({ window: state.window, category: state.category, limit: 250 });
      if (sharpKey !== key) return;
      sharpWallets.clear();
      for (const trader of traders) sharpWallets.set(trader.wallet, trader);
      renderTape();
    } catch {
      sharpKey = "";
    }
  }

  function runTape() {
    const wanted = live && (state.view === "tape" || notify);
    if (wanted && !tapeFeed) {
      tapeFeed = tape(api, {
        minUsd: state.minUsd,
        backlog: TRADE_READ,
        onTrades(fresh, read) {
          if (read.backlog) {
            // A backlog starts the list over: the size it was read at is the size it shows.
            trades = fresh.slice().sort((a, b) => b.time - a.time);
            tapeOlder = read.next;
            tapeOlderFailed = false;
            primed = true;
            renderTape();
            return;
          }
          const known = new Set(trades.map((trade) => trade.id));
          const added = fresh.filter((trade) => !known.has(trade.id));
          trades = [...added, ...trades].sort((a, b) => b.time - a.time).slice(0, TAPE_KEEP);
          notifyAbout(added);
          renderTape(new Set(added.map((trade) => trade.id)));
        },
        onError(error) {
          if (!trades.length) tapeBody.replaceChildren(stateRow(5, failure(error), () => tapeFeed?.refresh()));
          liveDot.classList.add("is-stale");
        },
      });
    } else if (!wanted && tapeFeed) {
      tapeFeed.stop();
      tapeFeed = undefined;
    }
  }

  async function loadOlderTrades(): Promise<boolean> {
    if (!tapeOlder) return false;
    if (tapeOlderRead) return tapeOlderRead;
    const cursor = tapeOlder;
    const minUsd = state.minUsd;
    tapeOlderFailed = false;
    tapeOlderRead = (async () => {
      drawTapeStatus(true);
      try {
        const page = await api.tradePage({ minUsd, limit: TRADE_READ, cursor });
        // The size changed while this was reading: its trades belong to the old feed.
        if (minUsd !== state.minUsd || cursor !== tapeOlder) return false;
        const known = new Set(trades.map((trade) => trade.id));
        trades = [...trades, ...page.trades.filter((trade) => !known.has(trade.id))].slice(0, TAPE_KEEP);
        tapeOlder = trades.length >= TAPE_KEEP ? null : page.next;
        return true;
      } catch {
        tapeOlderFailed = true;
        return false;
      } finally {
        tapeOlderRead = null;
        renderTape();
      }
    })();
    return tapeOlderRead;
  }

  // Under the pages: how far back the tape reaches, and whether it is reading further.
  function drawTapeStatus(loading = Boolean(tapeOlderRead)) {
    const oldest = trades[trades.length - 1];
    const parts: Node[] = [];
    if (oldest) parts.push(document.createTextNode(`${trades.length.toLocaleString("en-US")} trades, back to ${formatAge(oldest.time)} ago`));
    if (loading) parts.push(document.createTextNode(`${parts.length ? ". " : ""}Reading older trades…`));
    else if (tapeOlderFailed) {
      parts.push(document.createTextNode(`${parts.length ? ". " : ""}Couldn't read older trades.`));
      parts.push(retryButton(() => loadOlderTrades()));
    }
    tapeStatus.replaceChildren(...parts);
  }

  function renderTape(fresh = new Set<string>()) {
    liveDot.classList.remove("is-stale");
    drawTapeStatus();
    const matching = trades.filter((trade) => trade.usd >= state.minUsd && (!state.sharpsOnly || sharpWallets.has(trade.wallet)));
    tapePager.update(matching.length);
    const shown = matching.slice((tapePager.page - 1) * PAGE, tapePager.page * PAGE);
    tapeNote.textContent = `Every trade of ${formatUsd(state.minUsd)} or more across Polymarket${state.sharpsOnly ? `, by the top 250 traders on ${boardName(state)}.` : `. A star marks one of the top 250 on ${boardName(state)}.`}`;
    if (!shown.length) {
      tapeBody.replaceChildren(stateRow(5, tapeFeed && primed ? "No trades this size yet. They show up here as they happen." : "Listening for trades…"));
      return;
    }
    tapeBody.replaceChildren(
      ...shown.map((trade) => {
        const tr = element("tr", `sx-row${fresh.has(trade.id) ? " is-new" : ""}`);
        const when = cell("sx-when sx-muted", formatAge(trade.time));
        when.dataset.time = String(trade.time);
        const sharp = sharpWallets.get(trade.wallet);
        const who = traderCell({ rank: sharp?.rank ?? NaN, wallet: trade.wallet, name: trade.name, pnl: NaN, volume: NaN, image: trade.image, x: sharp?.x ?? "", verified: false }, () => openWallet(trade.wallet, tr), Boolean(sharp));
        const what = element("td", "sx-what");
        const side = element("span", `sx-side ${trade.side === "BUY" ? "is-buy" : "is-sell"}`, trade.side === "BUY" ? "Bought" : "Sold");
        const outcome = outcomeChip(trade.outcome);
        const market = element("a", "sx-market", trade.title);
        market.href = marketUrl(trade.eventSlug, trade.slug);
        market.target = "_blank";
        market.rel = "noopener noreferrer";
        what.append(side, outcome, market);
        tr.append(when, who, what, cell("sx-num sx-muted sx-hide-sm", formatCents(trade.price)), cell("sx-num sx-strong", formatUsd(trade.usd)));
        return tr;
      }),
    );
  }

  function notifyAbout(added: Trade[]) {
    if (!notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const trade of added) {
      const sharp = sharpWallets.get(trade.wallet);
      if (!sharp || trade.usd < state.minUsd) continue;
      new Notification(`${displayName(trade.name, trade.wallet)} ${trade.side === "BUY" ? "bought" : "sold"} ${formatUsd(trade.usd)}`, {
        body: `${trade.outcome} on ${trade.title} at ${formatCents(trade.price)}`,
        tag: trade.id,
      });
    }
  }

  notifyButton.addEventListener("click", async () => {
    if (!notify && Notification.permission !== "granted") {
      const answer = await Notification.requestPermission();
      if (answer !== "granted") return;
    }
    notify = !notify;
    notifyButton.setAttribute("aria-pressed", String(notify));
    notifyButton.replaceChildren(icon(notify ? ICONS.bellOn : ICONS.bell));
    const label = notify ? "Stop notifications" : "Notify me when a top trader makes a large trade";
    notifyButton.setAttribute("aria-label", label);
    notifyButton.title = label;
    loadSharps();
    runTape();
  });

  /* ---------- Wallet panel ---------- */

  // A modal dialog sits in the top layer, so it covers the screen even when a parent of the app is transformed,
  // and it keeps focus inside without help.
  const dialog = element("dialog", "sx-wallet");
  const sheet = element("div", "sx-wallet-inner");
  dialog.append(sheet);
  root.append(dialog);
  // A click on the dimmed page lands on the dialog itself, outside its content.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) setState({ wallet: null });
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    setState({ wallet: null });
  });

  // On a phone the wallet is a sheet: pull it down by its top to close it.
  const narrow = typeof matchMedia === "undefined" ? null : matchMedia("(max-width: 560px)");
  let drag: { y: number; t: number; dy: number } | null = null;
  sheet.addEventListener("pointerdown", (event) => {
    const target = event.target as Element;
    if (!narrow?.matches || !target.closest(".sx-wallet-head, .sx-grab") || target.closest("a, button")) return;
    drag = { y: event.clientY, t: performance.now(), dy: 0 };
    try {
      sheet.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone can't be captured; the drag still follows it while it lasts.
    }
    dialog.style.transition = "none";
  });
  sheet.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dy = event.clientY - drag.y;
    // A pull upward gives a little and stops; a pull down follows the finger.
    drag.dy = dy > 0 ? dy : dy / 6;
    dialog.style.transform = `translateY(${drag.dy}px)`;
  });
  const release = () => {
    if (!drag) return;
    const { dy, t } = drag;
    drag = null;
    dialog.style.transition = "";
    dialog.style.transform = "";
    if (dy > dialog.offsetHeight * 0.25 || dy / Math.max(1, performance.now() - t) > 0.5) setState({ wallet: null });
  };
  sheet.addEventListener("pointerup", release);
  sheet.addEventListener("pointercancel", release);
  let walletLoad: AbortController | undefined;
  let opener: HTMLElement | null = null;
  let shownWallet: string | null = null;

  function openWallet(wallet: string, from?: HTMLElement) {
    opener = from ?? (document.activeElement as HTMLElement | null);
    setState({ wallet });
  }

  function showWallet(wallet: string | null) {
    if (wallet === shownWallet) return;
    shownWallet = wallet;
    walletLoad?.abort();
    if (!wallet) {
      if (dialog.open) dialog.close();
      root.classList.remove("has-wallet");
      opener?.focus({ preventScroll: true });
      opener = null;
      return;
    }
    const load = (walletLoad = new AbortController());
    const signal = load.signal;
    const known = board.find((trader) => trader.wallet === wallet) ?? sharpWallets.get(wallet);
    root.classList.add("has-wallet");

    const close = iconButton("sx-icon-button sx-close", "Close", ICONS.close);
    close.addEventListener("click", () => setState({ wallet: null }));
    const name = element("h2", "sx-wallet-name", known ? displayName(known.name, wallet) : shortWallet(wallet));
    dialog.setAttribute("aria-label", `Trader ${name.textContent}`);
    const address = element("div", "sx-wallet-id");
    const copy = iconButton("sx-icon-button sx-copy", "Copy the wallet address", ICONS.copy);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(wallet);
        copy.replaceChildren(icon(ICONS.check));
        setTimeout(() => copy.replaceChildren(icon(ICONS.copy)), 1400);
      } catch {
        // Clipboard access can be refused; the address is on screen to select by hand.
      }
    });
    address.append(element("code", "sx-address", shortWallet(wallet)), copy);
    const links = element("div", "sx-wallet-links");
    const profile = externalLink(`https://polymarket.com/profile/${wallet}`, "Polymarket profile");
    links.append(profile);
    const top = element("header", "sx-wallet-head");
    let face = avatar(wallet, known?.image ?? "", "is-large");
    const place = element("p", "sx-place");
    top.append(face, element("div", "sx-wallet-title", undefined, [name, place, address, links]), close);

    // A wallet opened from a link or the tape isn't on the loaded board, so its name, handle and rank come from
    // its standing on the current board.
    const scope = boardName(state);
    api
      .standing(wallet, { window: state.window, category: state.category, signal })
      .then((standing) => {
        if (signal.aborted) return;
        const trader = standing ?? known;
        if (trader?.name) {
          name.textContent = displayName(trader.name, wallet);
          dialog.setAttribute("aria-label", `Trader ${name.textContent}`);
          const fresh = avatar(wallet, trader.image, "is-large");
          face.replaceWith(fresh);
          face = fresh;
        }
        if (trader?.x) profile.after(externalLink(`https://x.com/${encodeURIComponent(trader.x)}`, `@${trader.x}`));
        place.textContent = standing && Number.isFinite(standing.rank) ? `Number ${standing.rank.toLocaleString("en-US")} on ${scope}, ${formatPnl(standing.pnl)}` : `Not ranked on ${scope}`;
      })
      .catch(() => place.remove());

    const stats = element("dl", "sx-stats");
    const chart = element("div", "sx-chart");
    const positions = element("div", "sx-section");
    const record = element("div", "sx-section");
    const recent = element("div", "sx-section");
    stats.append(...["Profit, all time", "Markets traded", "Biggest win", "Joined"].map((label) => statItem(label, "")));
    chart.append(element("span", "sx-chart-empty"));
    for (const section of [positions, record, recent]) section.append(element("div", "sx-skeleton-block"));
    const body = element("div", "sx-wallet-body", undefined, [stats, chart, positions, record, recent]);
    const grab = element("span", "sx-grab");
    grab.setAttribute("aria-hidden", "true");
    sheet.replaceChildren(grab, top, body);
    body.scrollTop = 0;
    if (!dialog.open) dialog.showModal();
    close.focus({ preventScroll: true });

    api
      .stats(wallet, { signal })
      .then((data) => {
        if (signal.aborted) return;
        stats.replaceChildren(
          statItem("Profit, all time", data ? formatPnl(data.pnl) : EMPTY, data ? tone(data.pnl) : ""),
          statItem("Markets traded", data && Number.isFinite(data.markets) ? data.markets.toLocaleString("en-US") : EMPTY),
          statItem("Biggest win", data ? formatUsd(data.biggestWin) : EMPTY),
          statItem("Joined", data && Number.isFinite(data.joined) ? new Date(data.joined).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : EMPTY),
        );
        if (data && rebateShare(data.rebates, data.pnl) > 0.3) {
          stats.after(element("p", "sx-note sx-callout", `${formatUsd(data.rebates)} of this wallet's income is maker rebates and rewards. It likely makes markets, so its profit comes from providing liquidity more than from calling outcomes.`));
        }
      })
      .catch(() => stats.replaceChildren(element("p", "sx-note", "Couldn't load this wallet's totals.")));

    api
      .pnl(wallet, { interval: "1m", fidelity: "1d", signal })
      .then((points) => {
        if (signal.aborted) return;
        const values = points.map((point) => point.pnl);
        const change = values.length > 1 ? values[values.length - 1] - values[0] : NaN;
        chart.replaceChildren(
          element("div", "sx-chart-head", undefined, [element("span", "sx-label", "Profit, last 30 days"), element("span", `sx-chart-change ${tone(change)}`, formatPnl(change))]),
          spark(values, 360, 72, "sx-spark-large"),
        );
      })
      .catch(() => chart.replaceChildren());

    api
      .positions(wallet, { limit: 100, signal })
      .then((open) => {
        if (signal.aborted) return;
        const total = open.reduce((sum, position) => sum + (Number.isFinite(position.value) ? position.value : 0), 0);
        positions.replaceChildren(sectionHead("Open positions", open.length ? `${formatUsd(total)} in ${open.length}${open.length === 100 ? "+" : ""}` : ""), open.length ? positionList(open) : element("p", "sx-note", "Nothing open right now."));
      })
      .catch(() => positions.replaceChildren(sectionHead("Open positions", ""), element("p", "sx-note", "Couldn't load positions.")));

    api
      .positions(wallet, { status: "closed", limit: 200, signal })
      .then((closed) => {
        if (signal.aborted) return;
        const result = trackRecord(closed);
        const list = element("dl", "sx-stats sx-stats-small");
        list.append(
          statItem("Won", Number.isFinite(result.winRate) ? formatPercent(result.winRate * 100) : EMPTY),
          statItem("Wins / losses", `${result.wins} / ${result.losses}`),
          statItem("Realized", formatPnl(result.realized), tone(result.realized)),
        );
        const extremes = element("div", "sx-extremes");
        if (result.best && result.best.realized > 0) extremes.append(extreme("Best", result.best));
        if (result.worst && result.worst.realized < 0) extremes.append(extreme("Worst", result.worst));
        record.replaceChildren(sectionHead("Record", result.closed ? `last ${result.closed} closed` : ""), result.closed ? list : element("p", "sx-note", "No closed positions yet."), extremes);
      })
      .catch(() => record.replaceChildren(sectionHead("Record", ""), element("p", "sx-note", "Couldn't load the record.")));

    walletTrades(wallet, recent, signal);
  }

  function walletTrades(wallet: string, box: HTMLElement, signal: AbortSignal) {
    let list: Trade[] = [];
    let next: string | null = null;
    let reading: Promise<boolean> | null = null;
    const items = element("ul", "sx-trades");
    const tradePager = pager(
      "Trade pages",
      () => {
        draw();
        keepInView(items);
        if (tradePager.page === tradePager.pages && next) readMore();
      },
      { has: () => Boolean(next), load: () => readMore() },
    );

    function draw() {
      tradePager.update(list.length);
      items.replaceChildren(...list.slice((tradePager.page - 1) * PAGE, tradePager.page * PAGE).map(tradeItem));
      const count = list.length ? `${list.length.toLocaleString("en-US")}${next ? "+" : ""}` : "";
      box.replaceChildren(sectionHead("Trades", count), list.length ? items : element("p", "sx-note", "No trades yet."), tradePager.element);
    }

    function readMore(): Promise<boolean> {
      if (!next) return Promise.resolve(false);
      if (reading) return reading;
      const cursor = next;
      reading = api
        .tradePage({ wallet, limit: TRADE_READ, cursor, signal })
        .then((page) => {
          if (signal.aborted) return false;
          const known = new Set(list.map((trade) => trade.id));
          list = [...list, ...page.trades.filter((trade) => !known.has(trade.id))];
          next = page.next;
          draw();
          return true;
        })
        .catch(() => false)
        .finally(() => (reading = null));
      return reading;
    }

    api
      .tradePage({ wallet, limit: TRADE_READ, signal })
      .then((page: TradePage) => {
        if (signal.aborted) return;
        list = page.trades;
        next = page.next;
        draw();
      })
      .catch(() => box.replaceChildren(sectionHead("Trades", ""), element("p", "sx-note", "Couldn't load trades.")));
  }

  function tradeItem(trade: Trade): HTMLLIElement {
    const li = element("li", "sx-trade");
    li.append(
      element("span", `sx-side ${trade.side === "BUY" ? "is-buy" : "is-sell"}`, trade.side === "BUY" ? "Bought" : "Sold"),
      element("span", "sx-trade-text", `${trade.outcome} · ${trade.title}`),
      element("span", "sx-num", formatUsd(trade.usd)),
      element("span", "sx-num sx-muted", `${formatCents(trade.price)} · ${formatAge(trade.time)}`),
    );
    return li;
  }

  function positionList(open: Position[]): HTMLElement {
    const list = element("ul", "sx-positions");
    const positionPager = pager("Position pages", () => {
      draw();
      keepInView(list);
    });
    function draw() {
      positionPager.update(open.length);
      list.replaceChildren(...open.slice((positionPager.page - 1) * PAGE, positionPager.page * PAGE).map(positionItem));
    }
    draw();
    return element("div", "", undefined, [list, positionPager.element]);
  }

  function positionItem(position: Position): HTMLLIElement {
    const li = element("li", "sx-position");
    const link = element("a", "sx-position-title", position.title);
    link.href = marketUrl(position.eventSlug, position.slug);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const top = element("div", "sx-position-top", undefined, [marketIcon(position.icon, position.title), link]);
    const facts = element("div", "sx-position-facts");
    facts.append(
      outcomeChip(position.outcome),
      element("span", "sx-muted", `${formatCents(position.avgPrice)} → ${formatCents(position.price)}`),
      element("span", "sx-grow"),
      element("span", "sx-num", formatUsd(position.value)),
      element("span", `sx-num ${tone(position.unrealized)}`, formatPnl(position.unrealized)),
    );
    li.append(top, facts);
    return li;
  }

  function extreme(label: string, position: Position): HTMLElement {
    const box = element("p", "sx-extreme");
    box.append(element("span", "sx-label", label), element("span", "sx-extreme-text", `${position.outcome} · ${position.title}`), element("span", `sx-num ${tone(position.realized)}`, formatPnl(position.realized)));
    return box;
  }

  /* ---------- State ---------- */

  function setState(next: Partial<SharpsState>) {
    const before = { ...state };
    Object.assign(state, clean(next));
    apply(before);
    options.onStateChange?.({ ...state });
  }

  function apply(before: SharpsState | null) {
    for (const [key, button] of tabButtons) {
      const selected = key === state.view;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const [key, section] of panels) section.hidden = key !== state.view;
    root.dataset.view = state.view;
    windowGroup.sync();
    sortGroup.sync();
    for (const [key, button] of categoryButtons) button.setAttribute("aria-pressed", String(key === state.category));
    sizeSelect.value = String(TAPE_SIZES.includes(state.minUsd) ? state.minUsd : 10_000);
    onlyInput.checked = state.sharpsOnly;

    const scopeChanged = !before || before.window !== state.window || before.category !== state.category;
    if (scopeChanged) {
      board = [];
      boardPager.reset();
    }
    if (before && before.flowSort !== state.flowSort) flowPager.reset();
    if (!before || scopeChanged || before.minUsd !== state.minUsd || before.sharpsOnly !== state.sharpsOnly) tapePager.reset();
    if (state.view === "board" && (scopeChanged || before?.view !== "board" && !board.length)) loadBoard();
    if (state.view === "flow" && (scopeChanged || before?.view !== "flow" || before?.flowSort !== state.flowSort)) loadFlow();
    if (before && before.minUsd !== state.minUsd) {
      trades = [];
      tapeOlder = null;
      tapeOlderFailed = false;
      tapeFeed?.setMinUsd(state.minUsd);
    }
    if (state.view === "tape" || notify) {
      if (scopeChanged || before?.view !== "tape") loadSharps();
      if (before && (before.minUsd !== state.minUsd || before.sharpsOnly !== state.sharpsOnly || before.view !== state.view)) renderTape();
    }
    runTape();
    showWallet(state.wallet);
  }

  /* ---------- Small builders that need options ---------- */

  /** The trader's profile picture over the avatar drawn from their address, which shows when there is none. */
  function avatar(wallet: string, image: string, extra = ""): HTMLElement {
    const disc = element("span", `sx-avatar ${extra}`.trim());
    disc.setAttribute("aria-hidden", "true");
    disc.append(walletAvatar(wallet));
    const src = images && image ? imageUrl(image) : "";
    if (src) {
      const img = element("img", "");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = src;
      img.addEventListener("error", () => img.remove());
      disc.append(img);
    }
    return disc;
  }

  function marketIcon(src: string, title: string): HTMLElement {
    const box = element("span", "sx-icon");
    box.setAttribute("aria-hidden", "true");
    box.style.setProperty("--sx-hue", String(hue(title)));
    const url = images && src ? imageUrl(src) : "";
    if (url) {
      const img = element("img", "");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = url;
      img.addEventListener("error", () => img.remove());
      box.append(img);
    }
    return box;
  }

  function traderCell(trader: Trader, onOpen: () => void, sharp = false): HTMLTableCellElement {
    const td = element("td", "sx-who");
    const button = element("button", "sx-trader");
    button.type = "button";
    button.append(avatar(trader.wallet, trader.image));
    const name = element("span", "sx-trader-name", displayName(trader.name, trader.wallet));
    button.append(name);
    if (sharp) {
      const star = icon(ICONS.sharp, "sx-star");
      const label = element("span", "sx-sr", `, number ${trader.rank} on the board`);
      button.append(star, label);
      button.title = `Number ${trader.rank} on the board`;
    }
    if (trader.verified) button.append(icon(ICONS.check, "sx-verified"), element("span", "sx-sr", ", verified"));
    button.addEventListener("click", onOpen);
    td.append(button);
    if (trader.x) td.append(element("span", "sx-handle", `@${trader.x}`));
    return td;
  }

  apply(null);
  options.onStateChange?.({ ...state });

  return {
    get state() {
      return { ...state };
    },
    setState,
    openWallet(wallet) {
      if (isWallet(wallet)) openWallet(wallet.toLowerCase());
    },
    closeWallet() {
      setState({ wallet: null });
    },
    destroy() {
      boardLoad?.abort();
      flowLoad?.abort();
      walletLoad?.abort();
      tapeFeed?.stop();
      trendObserver?.disconnect();
      clearInterval(clock);
      root.remove();
    },
  };
}

/* ---------- Pure helpers ---------- */

function clean(next: Partial<SharpsState>): Partial<SharpsState> {
  const out: Partial<SharpsState> = {};
  if (next.view && VIEWS.some((view) => view.key === next.view)) out.view = next.view;
  if (next.window && WINDOWS.some((item) => item.key === next.window)) out.window = next.window;
  if (next.category && (CATEGORIES as readonly string[]).includes(next.category)) out.category = next.category;
  if (next.flowSort && FLOW_SORTS.some((item) => item.key === next.flowSort)) out.flowSort = next.flowSort;
  if (typeof next.minUsd === "number" && next.minUsd >= 0) out.minUsd = next.minUsd;
  if (typeof next.sharpsOnly === "boolean") out.sharpsOnly = next.sharpsOnly;
  if (next.wallet === null) out.wallet = null;
  else if (typeof next.wallet === "string" && isWallet(next.wallet)) out.wallet = next.wallet.toLowerCase();
  return out;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string, children?: Node[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (children) node.append(...children);
  return node;
}

function icon(paths: string, className = ""): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `sx-svg ${className}`.trim());
  svg.innerHTML = paths;
  return svg;
}

function iconButton(className: string, label: string, paths: string): HTMLButtonElement {
  const button = element("button", className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(paths));
  return button;
}

function segmented<K extends string>(label: string, items: { key: K; label: string; hint?: string }[], current: () => K, pick: (key: K) => void) {
  const group = element("div", "sx-segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  const buttons = items.map((item) => {
    const button = element("button", "sx-segment", item.label);
    button.type = "button";
    if (item.hint) button.title = item.hint;
    button.addEventListener("click", () => pick(item.key));
    group.append(button);
    return [item.key, button] as const;
  });
  return {
    element: group,
    sync() {
      for (const [key, button] of buttons) button.setAttribute("aria-pressed", String(key === current()));
    },
  };
}

function tableRow(tag: "tr", cells: HTMLElement[]): HTMLTableRowElement {
  const tr = element(tag, "");
  tr.append(...cells);
  return tr;
}

function headCell(text: string, className: string, hint = ""): HTMLTableCellElement {
  const th = element("th", className, text);
  th.scope = "col";
  if (hint) th.title = hint;
  return th;
}

function cell(className: string, text: string): HTMLTableCellElement {
  return element("td", className, text);
}

function stateRow(span: number, text: string, retry?: () => void): HTMLTableRowElement {
  const tr = element("tr", "sx-state-row");
  const td = element("td", "sx-state");
  td.colSpan = span;
  td.append(element("span", "", text));
  if (retry) td.append(retryButton(retry));
  tr.append(td);
  return tr;
}

function stateItem(text: string, retry?: () => void): HTMLLIElement {
  const li = element("li", "sx-state");
  li.append(element("span", "", text));
  if (retry) li.append(retryButton(retry));
  return li;
}

function retryButton(retry: () => void): HTMLButtonElement {
  const button = iconButton("sx-icon-button", "Try again", ICONS.retry);
  button.addEventListener("click", retry);
  return button;
}

function skeletonRows(count: number, span: number): HTMLTableRowElement[] {
  return Array.from({ length: count }, () => {
    const tr = element("tr", "sx-skeleton-row");
    const td = element("td", "");
    td.colSpan = span;
    td.append(element("span", "sx-skeleton"));
    tr.append(td);
    return tr;
  });
}

function busy(panel: HTMLElement, on: boolean) {
  panel.setAttribute("aria-busy", String(on));
}

function failure(error: unknown): string {
  if (error instanceof TypeError) return "Couldn't reach Polymarket. Check the connection and try again.";
  const status = (error as { status?: number })?.status;
  if (status === 429) return "Polymarket is asking for a pause. Try again in a few seconds.";
  return "Polymarket didn't answer as expected. Try again.";
}

function fact(label: string, value: string, extra = ""): HTMLElement {
  const box = element("span", `sx-fact ${extra}`.trim());
  box.append(element("span", "sx-label", label), element("span", "sx-value", value));
  return box;
}

function statItem(label: string, value: string, extra = ""): HTMLElement {
  const box = element("div", "sx-stat");
  box.append(element("dt", "sx-label", label), element("dd", `sx-value ${extra}`.trim(), value));
  return box;
}

function sectionHead(title: string, aside: string): HTMLElement {
  const head = element("div", "sx-section-head");
  head.append(element("h3", "sx-section-title", title));
  if (aside) head.append(element("span", "sx-muted", aside));
  return head;
}

function externalLink(href: string, text: string): HTMLAnchorElement {
  const link = element("a", "sx-link", text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.append(icon(ICONS.out));
  return link;
}

function spark(values: number[], width: number, height: number, extra = ""): SVGSVGElement | HTMLElement {
  const { line, area, zero } = sparkline(values, width, height, 2);
  if (!line) return element("span", "sx-spark is-empty");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", `sx-spark ${extra} ${tone(values[values.length - 1] - values[0])}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const base = document.createElementNS(svg.namespaceURI, "line");
  base.setAttribute("x1", "0");
  base.setAttribute("x2", String(width));
  base.setAttribute("y1", zero.toFixed(1));
  base.setAttribute("y2", zero.toFixed(1));
  base.setAttribute("class", "sx-spark-zero");
  const fill = document.createElementNS(svg.namespaceURI, "path");
  fill.setAttribute("d", area);
  fill.setAttribute("class", "sx-spark-area");
  const stroke = document.createElementNS(svg.namespaceURI, "path");
  stroke.setAttribute("d", line);
  stroke.setAttribute("class", "sx-spark-line");
  svg.append(fill, base, stroke);
  return svg;
}

function tone(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) return "";
  return value > 0 ? "is-up" : "is-down";
}

function boardName(state: SharpsState): string {
  return `${BOARD_PREFIX[state.window]} ${state.category === "overall" ? "" : `${CATEGORY_LABELS[state.category].toLowerCase()} `}board`;
}

// Some markets name no outcome on a fill; an empty chip would read as a glitch.
function outcomeChip(outcome: string): HTMLElement | Text {
  return outcome ? element("span", `sx-outcome ${outcomeTone(outcome)}`, outcome) : document.createTextNode("");
}

function outcomeTone(outcome: string): string {
  const name = outcome.toLowerCase();
  if (name === "yes" || name === "up" || name === "over") return "is-yes";
  if (name === "no" || name === "down" || name === "under") return "is-no";
  return "";
}

function marketUrl(eventSlug: string, slug: string): string {
  if (eventSlug && slug && eventSlug !== slug) return `https://polymarket.com/event/${encodeURIComponent(eventSlug)}/${encodeURIComponent(slug)}`;
  if (eventSlug) return `https://polymarket.com/event/${encodeURIComponent(eventSlug)}`;
  return `https://polymarket.com/market/${encodeURIComponent(slug)}`;
}

function hue(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return hash % 360;
}

interface Pager {
  readonly element: HTMLElement;
  readonly page: number;
  readonly pages: number;
  /** Sets how many items there are, and draws the page numbers. */
  update(total: number): void;
  /** Back to the first page, for a new list. */
  reset(): void;
}

/** `more` is for lists that can read further: past the last page, Next reads more and then turns to it. */
function pager(label: string, onPage: (page: number) => void, more?: { has: () => boolean; load: () => Promise<boolean> }): Pager {
  const nav = element("nav", "sx-pager");
  nav.setAttribute("aria-label", label);
  let page = 1;
  let pages = 1;

  function go(next: number) {
    page = Math.min(Math.max(1, next), pages);
    draw();
    // The buttons are drawn again, so the focus moves to the page now showing.
    nav.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true });
    onPage(page);
  }

  function draw() {
    nav.hidden = pages <= 1 && !more?.has();
    if (nav.hidden) {
      nav.replaceChildren();
      return;
    }
    const previous = iconButton("sx-page sx-page-step", "Previous page", ICONS.back);
    previous.disabled = page === 1;
    previous.addEventListener("click", () => go(page - 1));
    const next = iconButton("sx-page sx-page-step", "Next page", ICONS.chevron);
    next.disabled = page === pages && !more?.has();
    next.addEventListener("click", async () => {
      if (page < pages) return go(page + 1);
      if (!more?.has()) return;
      next.disabled = true;
      next.setAttribute("aria-busy", "true");
      await more.load();
      if (page < pages) go(page + 1);
      else draw();
    });
    const numbers = pageList(page, pages).map((number) => {
      if (!number) {
        const gap = element("span", "sx-page-gap", "…");
        gap.setAttribute("aria-hidden", "true");
        return gap;
      }
      const button = element("button", "sx-page", String(number));
      button.type = "button";
      button.setAttribute("aria-label", `Page ${number}`);
      if (number === page) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => go(number));
      return button;
    });
    nav.replaceChildren(previous, ...numbers, next);
  }

  return {
    element: nav,
    get page() {
      return page;
    },
    get pages() {
      return pages;
    },
    update(total) {
      pages = Math.max(1, Math.ceil(total / PAGE));
      if (page > pages) page = pages;
      draw();
    },
    reset() {
      page = 1;
    },
  };
}

// After a page change the list's top comes back into view, so the new page starts where the eye is.
function keepInView(target: HTMLElement) {
  if (target.getBoundingClientRect().top >= 0) return;
  const still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
}
