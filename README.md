# sharps

See where Polymarket's best traders have their money. Flow adds up the open positions of the top wallets, so you can see which markets they're piling into, what they paid and how one-sided they are. The tape shows every large trade as it happens, with a star on the ones from traders on the board. Open any wallet for its profit over time, what it holds and its record, or browse the board by category and window. Everything comes from Polymarket's public API, with no key and no account. Plain TypeScript, no dependencies.

Use it live at [drk.vc/sharps](https://drk.vc/sharps).

![A MacBook and an iPhone running the tracker in Safari: Flow lists the markets the month's top thirty traders hold, the top one opens to show who holds it and what they paid, the biggest holder's wallet opens in a card in the middle of the screen with their profit and open positions, the tape of large trades narrows to traders on the board, and the board shows the month's top traders, each with a chart of their profit; on the iPhone the wallet rises from the bottom as a sheet](demo/preview.webp)

Trackers like this usually keep the useful parts behind a paid plan: the price a wallet got in at, alerts when a big wallet trades, more than a handful of wallets. This one is MIT licensed: use it in a product, change it, ship it.

- **Flow.** The open positions of the board's top traders, added up outcome by outcome: how many of them hold it, how much it's worth, the average price they paid, where it trades now, and what they hold on the other side of the same market. Sort by the most traders, the most money, the furthest in profit or the latest. Markets priced under 2¢ or over 98¢ are left out, since they're all but decided.
- **The tape.** Every trade of $1K, $5K, $10K, $50K or $100K and up across Polymarket, polled every few seconds. It starts with the last thousand trades of that size, about a day's worth at $10K, and reads a thousand further back each time you reach its last page. Narrow it to traders on the board, and turn on browser notifications for their large trades.
- **Wallets.** Profit since joining, markets traded, biggest win and join date; profit over the last thirty days; open positions with the price paid and the price now; a win rate over the last 200 closed positions, with the best and worst; and every trade the wallet has made, read a thousand at a time. A wallet whose income is mostly maker rebates and rewards is marked as a likely market maker, since its profit comes from providing liquidity more than from calling outcomes.
- **The board.** Polymarket's own leaderboard, its top 1000 by profit, for all markets or one category (politics, sports, crypto, culture, economy, tech, finance, mentions, weather, esports) over today, this week, this month or all time. Each row carries a small chart of the trader's profit over the same window. A trader without a profile picture gets an avatar drawn from their address: their own, and the same everywhere.
- **Twenty to a page.** Every list, from Flow and the tape to the board, a market's holders and a wallet's positions, shows twenty at a time with page numbers under it.
- **Shareable.** The view, window, category, sort, tape size and open wallet are plain state, handed to you on every change, so a page can keep them in its URL.
- **Gentle on the API.** Reads share a cache, identical reads made at once share one request, at most sixteen run at a time, and a `429` waits as long as the API asks.
- **Accessible.** The views are tabs, the filters are toggle buttons, every icon button has a label, tables have headers, and a wallet opens in a modal dialog that keeps focus and closes with Escape or a click outside it. On a phone the dialog is a sheet from the bottom that a pull on its top closes.
- **Content Security Policy.** Nothing writes a `style` attribute or a `<style>` tag, so it runs under `style-src 'self'`. Profile pictures and market icons load from Polymarket's image host; pass `image` to route them through your own, or `images: false` to draw every trader's avatar from their address.

## Install

The package is not on npm. Install it from GitHub, which builds it on the way in:

```bash
npm install github:drkxbt/sharps
```

It installs as `@drkxbt/sharps`. Import it and its stylesheet:

```js
import { sharps } from "@drkxbt/sharps";
import "@drkxbt/sharps/sharps.css";
```

## Usage

```js
const app = sharps(document.querySelector("#traders"), {
  state: { view: "flow", window: "week", category: "politics" },
  onStateChange(state) {
    // Keep it in the URL, say.
  },
});

app.setState({ view: "tape", minUsd: 50_000, sharpsOnly: true });
app.openWallet("0x…");
app.destroy();
```

| Option | Default | |
| - | - | - |
| `state` | Flow, month, all markets | Where to start: `view` (`"flow"`, `"tape"`, `"board"`), `window` (`"day"`, `"week"`, `"month"`, `"all"`), `category`, `wallet`, `flowSort` (`"wallets"`, `"value"`, `"edge"`, `"recent"`), `minUsd`, `sharpsOnly`. |
| `depth` | `200` | How many of the board's top traders Flow reads, up to 1000. |
| `live` | `true` | Poll for new trades while the tape is showing. |
| `images` | `true` | Profile pictures and market icons. Off draws avatars and initials instead. |
| `image` | | Rewrites an image's address before it loads. |
| `theme` | light | `"dark"`, or `"auto"` to follow the system. |
| `data`, `gamma` | Polymarket | The Data and Gamma API addresses, for a proxy. |
| `fetch`, `concurrency`, `ttl` | | Passed to the client. |
| `api` | | A client to share with the rest of your page. |

### Just the data

The client and the analysis work without the interface, in the browser or in Node 18 and later:

```js
import { client, flow, sortFlow, trackRecord, tape } from "@drkxbt/sharps";

const api = client();
const top = await api.leaderboard({ window: "month", category: "crypto", limit: 50 });
const holdings = await Promise.all(top.map(async (trader) => ({ trader, positions: await api.positions(trader.wallet, { minUsd: 100 }) })));
const rows = sortFlow(flow(holdings), "value");

const record = trackRecord(await api.positions(top[0].wallet, { status: "closed", limit: 200 }));

const feed = tape(api, { minUsd: 25_000, onTrades: (trades) => console.log(trades) });
```

`client()` reads the board (`leaderboard`, `standing`), a wallet (`positions`, `stats`, `pnl`, `trades`), the trade feed a page at a time with a cursor (`tradePage`) and the tags of events (`eventTags`). Every number comes back as a JavaScript number, every time in milliseconds, and every wallet in lower case. A value the API didn't give is `NaN`, never zero.

## Theming

Every colour and size is a custom property on `.sx`, such as `--sx-bg`, `--sx-text`, `--sx-up`, `--sx-down`, `--sx-accent` and `--sx-radius`. Set them on the container or a parent to restyle it.

## Where Polymarket is blocked

Polymarket can't be reached from some networks. Point the client at a same-origin proxy and every read goes through your own host. On Vercel, two rewrites are enough:

```json
{
  "rewrites": [
    { "source": "/pm/data/:path*", "destination": "https://data-api.polymarket.com/:path*" },
    { "source": "/pm/gamma/:path*", "destination": "https://gamma-api.polymarket.com/:path*" }
  ]
}
```

```js
sharps(element, { data: "/pm/data", gamma: "/pm/gamma" });
```

Showing Polymarket's data where Polymarket itself is blocked may have legal consequences there. Check before you publish.

## How it works

- The board is `GET /v2/leaderboard` on Polymarket's Data API, which ranks up to a thousand traders by profit for a window and a category.
- Flow reads the top traders' open positions (`GET /v2/positions`, the fifty largest per wallet), keeps those worth $100 or more, and adds them up by outcome token. The average price is the cost of the shares still held divided by their number, so it's weighted by size. For a category other than all markets, each position's event is looked up on the Gamma API and kept when its tags match.
- The Data API has no public stream of fills, so the tape polls the global trade feed (`GET /v2/trades`) for trades above the chosen size and passes on only the ones it hasn't seen. Its first read takes a thousand trades, the most one page holds, and the page's cursor reads further back.
- A wallet's record counts its last 200 closed positions; a position that closed within fifty cents of even counts as neither a win nor a loss.

## What it doesn't do yet

- Flow reads each trader's fifty largest open positions. Measured on the month's top 200, those held 97% of the money in the markets Flow shows, at half the download of the largest hundred. A wallet's own view reads its largest hundred.
- The tape polls, so a burst of trades bigger than one read can slip past. Smaller sizes are more likely to.
- Combos (multi-leg positions) are left out.

## Demo

```bash
git clone https://github.com/drkxbt/sharps
cd sharps
npm install
npm run demo
```

Then open http://localhost:4331/demo/. The demo reads live data. `demo/tour.html` plays the preview above on a MacBook and an iPhone, replaying reads recorded from the API on October 27, 2026 (UTC) (`demo/sample/recorded.json.gz`) so that every loop shows the same thing.

## Tests

```bash
npm test
```

The tests cover the formatting, the mapping of API rows, Flow's sums and sorts, the track record, the client's queries, cache, retries and errors, and the tape.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Not affiliated with Polymarket. Past profit says nothing certain about the next trade, and nothing here is advice.
