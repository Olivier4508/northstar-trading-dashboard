const roadmap = [
  {
    status: "V2 live",
    title: "Read-only Hyperliquid account sync",
    body:
      "Wallet sync now calls Hyperliquid info endpoints for portfolio, fills, funding, account state, open orders, and current positions."
  },
  {
    status: "Ready now",
    title: "CSV fallback import",
    body:
      "Import manual ledgers or external venue exports when API data is incomplete. The V1 parser expects a compact normalized trade file."
  },
  {
    status: "V2 live",
    title: "Realtime refresh triggers",
    body:
      "The app subscribes to user fills, funding, ledger updates, order updates, and clearinghouse state, then refreshes the normalized ledger."
  },
  {
    status: "Later",
    title: "Trading and broker abstraction",
    body:
      "Once the ledger is trusted, add signed execution adapters for Hyperliquid and then expand the same account model to Webull."
  }
];

const assistantSuggestions = [
  "What is driving my open risk?",
  "Which symbol made me the most money?",
  "How good are my HYPE trades?",
  "Why was my last week red?",
  "What should V2 add next?"
];

const elements = {
  dataTape: document.querySelector("#data-tape"),
  overviewGrid: document.querySelector("#overview-grid"),
  tradingviewDeck: document.querySelector("#tradingview-deck"),
  chartAddForm: document.querySelector("#chart-add-form"),
  chartSymbolInput: document.querySelector("#chart-symbol-input"),
  chartQuickList: document.querySelector("#chart-quick-list"),
  riskStrip: document.querySelector("#risk-strip"),
  symbolTable: document.querySelector("#symbol-table"),
  positionsTable: document.querySelector("#positions-table"),
  tradesTable: document.querySelector("#trades-table"),
  insightsList: document.querySelector("#insights-list"),
  roadmapList: document.querySelector("#roadmap-list"),
  assistantMessages: document.querySelector("#assistant-messages"),
  assistantSuggestions: document.querySelector("#assistant-suggestions"),
  assistantStatus: document.querySelector("#assistant-status"),
  positionCount: document.querySelector("#position-count"),
  tradeCount: document.querySelector("#trade-count"),
  walletForm: document.querySelector("#wallet-form"),
  walletInput: document.querySelector("#wallet-input"),
  csvInput: document.querySelector("#csv-input"),
  csvFileName: document.querySelector("#csv-file-name"),
  assistantForm: document.querySelector("#assistant-form"),
  assistantInput: document.querySelector("#assistant-input"),
  syncStatus: document.querySelector("#sync-status"),
  walletSubmit: document.querySelector("#wallet-submit"),
  demoReset: document.querySelector("#demo-reset")
};

const storageKeys = {
  chartWidgets: "northstar.chartWidgets",
  metricOrder: "northstar.metricOrder",
  assistantMessages: "northstar.assistantMessages",
  lastWallet: "northstar.lastWallet"
};

const assistantContextLimits = {
  recentTrades: 30,
  fundingRows: 20,
  conversationMessages: 8
};

const flashState = new Map();
let draggedChartId = null;
let draggedMetricId = null;

const defaultChartWidgets = [
  { id: "chart-hype", symbol: "BINANCE:HYPEUSDT.P" },
  { id: "chart-btc", symbol: "BINANCE:BTCUSDT" },
  { id: "chart-eth", symbol: "BINANCE:ETHUSDT" }
];

const cryptoQuickSymbols = [
  ["HYPE", "BINANCE:HYPEUSDT.P"],
  ["BTC", "BINANCE:BTCUSDT"],
  ["ETH", "BINANCE:ETHUSDT"],
  ["SOL", "BINANCE:SOLUSDT"],
  ["XRP", "BINANCE:XRPUSDT"],
  ["BNB", "BINANCE:BNBUSDT"],
  ["DOGE", "BINANCE:DOGEUSDT"],
  ["SUI", "BINANCE:SUIUSDT"],
  ["AVAX", "BINANCE:AVAXUSDT"],
  ["LINK", "BINANCE:LINKUSDT"]
];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const currencyPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const state = {
  dataset: structuredClone(window.mockPortfolio),
  metrics: null,
  chartWidgets: loadChartWidgets(),
  messages: loadAssistantMessages()
};

const liveSync = {
  wallet: null,
  stopWebsocket: null,
  refreshTimer: null,
  pollTimer: null,
  syncing: false
};

function formatCurrency(value) {
  return currencyPrecise.format(value);
}

function formatCompactCurrency(value) {
  return currency.format(value);
}

function formatSignedCurrency(value) {
  const formatted = formatCurrency(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

function formatPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function valueClass(value) {
  return value >= 0 ? "value-positive" : "value-negative";
}

function compactNumber(value) {
  return integer.format(value);
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function loadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadChartWidgets() {
  const widgets = loadJson(storageKeys.chartWidgets, null);
  return Array.isArray(widgets) && widgets.length ? widgets : structuredClone(defaultChartWidgets);
}

function loadAssistantMessages() {
  const messages = loadJson(storageKeys.assistantMessages, null);
  if (Array.isArray(messages) && messages.length) return messages;

  return [
    {
      role: "assistant",
      text:
        "This V2 is running on a demo Hyperliquid-style ledger. Connect a wallet address to load live read-only Hyperliquid data, or import a CSV to replace the trade history."
    }
  ];
}

function persistAssistantMessages() {
  saveJson(storageKeys.assistantMessages, state.messages.slice(-80));
}

function pushAssistantMessage(message) {
  state.messages.push(message);
  persistAssistantMessages();
}

function normalizeTradingViewSymbol(input) {
  const raw = input.trim().toUpperCase();
  if (!raw) return "BINANCE:BTCUSDT";
  if (raw.includes(":")) return raw;
  if (raw.includes("/")) return raw.replace("/", "");

  const cryptoSymbols = new Set(["BTC", "ETH", "SOL", "HYPE", "DOGE", "XRP", "BNB", "AVAX", "ARB", "LINK", "SUI"]);
  if (cryptoSymbols.has(raw)) {
    if (raw === "HYPE") return "BINANCE:HYPEUSDT.P";
    return `BINANCE:${raw}USDT`;
  }

  return `NASDAQ:${raw}`;
}

function renderTradingViewWidget(widget) {
  const host = document.querySelector(`[data-chart-widget="${widget.id}"] .tradingview-host`);
  if (!host) return;

  host.innerHTML = `
    <div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
    </div>
  `;

  const container = host.querySelector(".tradingview-widget-container");
  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  script.async = true;
  script.textContent = JSON.stringify({
    autosize: true,
    symbol: widget.symbol,
    interval: "60",
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "en",
    withdateranges: true,
    allow_symbol_change: true,
    details: true,
    calendar: false,
    hide_side_toolbar: false,
    hide_top_toolbar: false,
    hide_legend: false,
    hide_volume: false,
    support_host: "https://www.tradingview.com",
    backgroundColor: "#10191c",
    gridColor: "rgba(232, 238, 238, 0.08)",
    save_image: true
  });
  container.appendChild(script);
}

function renderTradingViewDeck() {
  elements.tradingviewDeck.innerHTML = state.chartWidgets
    .map(
      (widget) => `
        <article class="tradingview-card" data-chart-widget="${widget.id}" draggable="true">
          <div class="tradingview-card__bar">
            <span class="drag-handle" title="Drag to reorder">::</span>
            <form class="chart-symbol-form" data-chart-symbol-form="${widget.id}">
              <input value="${widget.symbol}" aria-label="TradingView symbol" />
              <button class="button button--ghost" type="submit">Load</button>
            </form>
            <button class="icon-button icon-button--danger" data-delete-chart="${widget.id}" type="button" aria-label="Delete chart">x</button>
          </div>
          <div class="tradingview-host"></div>
        </article>
      `
    )
    .join("");

  state.chartWidgets.forEach(renderTradingViewWidget);
}

function renderChartQuickList() {
  elements.chartQuickList.innerHTML = cryptoQuickSymbols
    .map(
      ([label, symbol]) => `
        <button class="quick-symbol" type="button" data-quick-symbol="${symbol}">
          ${label}
        </button>
      `
    )
    .join("");
}

function addChartWidget(symbol) {
  const widget = {
    id: `chart-${Date.now()}`,
    symbol: normalizeTradingViewSymbol(symbol)
  };

  state.chartWidgets.unshift(widget);
  saveJson(storageKeys.chartWidgets, state.chartWidgets);
  renderTradingViewDeck();
}

function setAssistantStatus(label, mode = "idle") {
  elements.assistantStatus.textContent = label;
  elements.assistantStatus.className = `assistant-status assistant-status--${mode}`;
}

function buildAssistantContext() {
  const metrics = state.metrics ?? computeMetrics(state.dataset);
  const recentTrades = metrics.trades.slice(0, assistantContextLimits.recentTrades).map((trade) => ({
    time: trade.time,
    symbol: trade.symbol,
    side: trade.side,
    size: trade.size,
    price: trade.price,
    fee: trade.fee,
    realizedPnl: trade.realizedPnl,
    netPnl: trade.realizedPnl - trade.fee,
    notional: trade.size * trade.price,
    holdHours: trade.holdHours
  }));

  return {
    app: {
      name: "Northstar Trading Dashboard",
      version: "V2",
      designDecisions: [
        "Portfolio Value uses Hyperliquid spotClearinghouseState when available because it reflects the unified account balance.",
        "Perps Account is kept as a separate metric because clearinghouseState marginSummary.accountValue can be much lower than unified portfolio value.",
        "TradingView widgets are official Advanced Chart embeds, not custom-drawn charts.",
        "The assistant is server-backed when the hosted or local app has a Gemini or Groq API key configured; otherwise browser fallback answers are used.",
        "No trading keys, private keys, or signed execution requests are used in the current version."
      ]
    },
    account: {
      wallet: state.dataset.wallet,
      source: state.dataset.source,
      lastSync: state.dataset.lastSync,
      portfolioValue: metrics.portfolioValue,
      perpsAccountValue: metrics.perpsAccountValue,
      cashAndSpotValue: metrics.cashAndSpotValue,
      openOrders: state.dataset.openOrders ?? [],
      spotBalances: state.dataset.spotBalances ?? []
    },
    metrics: {
      totalReturnPct: metrics.totalReturnPct,
      realized: metrics.realized,
      unrealized: metrics.unrealized,
      netPnl: metrics.netPnl,
      fundingNet: metrics.fundingNet,
      totalFees: metrics.totalFees,
      grossVolume: metrics.grossVolume,
      totalExposure: metrics.totalExposure,
      marginUsed: metrics.marginUsed,
      avgLeverage: metrics.avgLeverage,
      winRate: metrics.winRate,
      profitFactor: metrics.profitFactor,
      payoffRatio: metrics.payoffRatio,
      expectancy: metrics.expectancy,
      avgWinner: metrics.avgWinner,
      avgLoser: metrics.avgLoser,
      bestDay: metrics.bestDay,
      worstDay: metrics.worstDay,
      maxDrawdown: metrics.maxDrawdown
    },
    positions: metrics.positions,
    symbolAttribution: metrics.symbolAttribution,
    recentTrades,
    funding: (state.dataset.funding ?? []).slice(0, assistantContextLimits.fundingRows),
    chartWidgets: state.chartWidgets,
    conversationHistory: state.messages.slice(-assistantContextLimits.conversationMessages)
  };
}

async function askLlmAssistant(question) {
  const assistantUrl =
    window.location.protocol === "file:"
      ? "http://127.0.0.1:3000/api/assistant"
      : "/api/assistant";

  let response;

  try {
    response = await fetch(assistantUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        context: buildAssistantContext()
      })
    });
  } catch {
    throw new Error(
      "the assistant API is not reachable. If you are running locally, start launch-dashboard.sh; if this is hosted, check the deployment and selected provider API key."
    );
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? `Assistant request failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  return data.answer;
}

function setSyncStatus(label, mode = "pending") {
  elements.syncStatus.textContent = label;
  elements.syncStatus.className = `status-pill status-pill--${mode}`;
}

function setWalletSubmit(isSyncing) {
  elements.walletSubmit.disabled = isSyncing;
  elements.walletSubmit.textContent = isSyncing ? "Syncing" : "Live Sync";
}

function byDayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupBy(items, selector) {
  return items.reduce((groups, item) => {
    const key = selector(item);
    groups[key] ??= [];
    groups[key].push(item);
    return groups;
  }, {});
}

function deriveImportedDataset(rows) {
  const sortedTrades = rows
    .map((row) => ({
      time: row.time,
      symbol: row.symbol,
      side: row.side,
      size: Number(row.size),
      price: Number(row.price),
      fee: Number(row.fee ?? 0),
      realizedPnl: Number(row.realizedPnl ?? 0),
      holdHours: Number(row.holdHours ?? 0)
    }))
    .filter((row) => row.time && row.symbol && Number.isFinite(row.price))
    .sort((left, right) => new Date(left.time) - new Date(right.time));

  let runningEquity = 100000;
  const daily = new Map();

  for (const trade of sortedTrades) {
    const day = byDayKey(trade.time);
    const impact = trade.realizedPnl - trade.fee;
    daily.set(day, (daily.get(day) ?? 0) + impact);
  }

  const equityHistory = [...daily.entries()].map(([date, pnl]) => {
    runningEquity += pnl;
    return { date, equity: Number(runningEquity.toFixed(2)) };
  });

  return {
    accountName: "Imported CSV",
    wallet: state.dataset.wallet,
    source: "csv-import",
    lastSync: new Date().toISOString(),
    equityHistory,
    positions: [],
    trades: sortedTrades.reverse(),
    funding: []
  };
}

function computeMetrics(dataset) {
  const equityHistory = dataset.equityHistory ?? [];
  const positions = dataset.positions ?? [];
  const trades = dataset.trades ?? [];
  const funding = dataset.funding ?? [];
  const spotBalances = dataset.spotBalances ?? [];

  const perpsAccountValue = dataset.perpsAccountValue ?? equityHistory.at(-1)?.equity ?? 0;
  const portfolioValue = dataset.portfolioValue ?? perpsAccountValue;
  const cashAndSpotValue = spotBalances.length
    ? spotBalances.reduce((sum, balance) => sum + balance.usdValue, 0)
    : portfolioValue;
  const latestEquity = portfolioValue;
  const accountCurveValue = equityHistory.at(-1)?.equity ?? perpsAccountValue;
  const startingEquity = equityHistory[0]?.equity ?? accountCurveValue;
  const totalReturnPct = startingEquity ? ((accountCurveValue - startingEquity) / startingEquity) * 100 : 0;
  const realized = trades.reduce((sum, trade) => sum + trade.realizedPnl - trade.fee, 0);
  const unrealized = positions.reduce((sum, position) => sum + position.pnl, 0);
  const netPnl = realized + unrealized + funding.reduce((sum, item) => sum + item.amount, 0);
  const fundingNet = funding.reduce((sum, item) => sum + item.amount, 0);
  const totalFees = trades.reduce((sum, trade) => sum + trade.fee, 0);
  const winners = trades.filter((trade) => trade.realizedPnl > 0);
  const losers = trades.filter((trade) => trade.realizedPnl <= 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.realizedPnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + trade.realizedPnl, 0));
  const profitFactor = grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const winRate = trades.length ? (winners.length / trades.length) * 100 : 0;
  const avgWinner = average(winners.map((trade) => trade.realizedPnl));
  const avgLoser = average(losers.map((trade) => trade.realizedPnl));
  const payoffRatio = Math.abs(avgLoser) ? avgWinner / Math.abs(avgLoser) : avgWinner > 0 ? Infinity : 0;
  const grossVolume = trades.reduce((sum, trade) => sum + trade.size * trade.price, 0);
  const totalExposure = positions.reduce((sum, position) => sum + position.exposure, 0);
  const avgHold = average(trades.map((trade) => trade.holdHours).filter(Boolean));
  const expectancy = trades.length ? realized / trades.length : 0;
  const avgLeverage = average(positions.map((position) => position.leverage));
  const marginUsed = positions.reduce((sum, position) => sum + position.exposure / Math.max(position.leverage, 1), 0);

  const groupedBySymbol = groupBy(trades, (trade) => trade.symbol);
  const symbolAttribution = Object.entries(groupedBySymbol)
    .map(([symbol, symbolTrades]) => ({
      symbol,
      pnl: symbolTrades.reduce((sum, trade) => sum + trade.realizedPnl - trade.fee, 0),
      volume: symbolTrades.reduce((sum, trade) => sum + trade.size * trade.price, 0),
      avgHold: average(symbolTrades.map((trade) => trade.holdHours).filter(Boolean)),
      winRate:
        symbolTrades.length > 0
          ? (symbolTrades.filter((trade) => trade.realizedPnl > 0).length / symbolTrades.length) * 100
          : 0,
      count: symbolTrades.length
    }))
    .sort((left, right) => right.pnl - left.pnl);

  const groupedByDay = groupBy(trades, (trade) => byDayKey(trade.time));
  const dailyPnl = Object.entries(groupedByDay)
    .map(([date, dayTrades]) => ({
      date,
      pnl: dayTrades.reduce((sum, trade) => sum + trade.realizedPnl - trade.fee, 0)
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const bestDay = [...dailyPnl].sort((left, right) => right.pnl - left.pnl)[0] ?? { date: "-", pnl: 0 };
  const worstDay = [...dailyPnl].sort((left, right) => left.pnl - right.pnl)[0] ?? { date: "-", pnl: 0 };

  const peak = { value: -Infinity };
  let maxDrawdown = 0;
  for (const point of equityHistory) {
    if (point.equity > peak.value) peak.value = point.equity;
    if (peak.value > 0) {
      const drawdown = ((point.equity - peak.value) / peak.value) * 100;
      maxDrawdown = Math.min(maxDrawdown, drawdown);
    }
  }

  return {
    latestEquity,
    accountCurveValue,
    portfolioValue,
    perpsAccountValue,
    cashAndSpotValue,
    totalReturnPct,
    realized,
    unrealized,
    netPnl,
    fundingNet,
    grossProfit,
    grossLoss,
    profitFactor,
    payoffRatio,
    totalFees,
    grossVolume,
    totalExposure,
    avgHold,
    expectancy,
    avgLeverage,
    marginUsed,
    winRate,
    avgWinner,
    avgLoser,
    bestDay,
    worstDay,
    maxDrawdown,
    dailyPnl,
    symbolAttribution,
    positions,
    trades,
    equityHistory
  };
}

function createMetricCards(metrics) {
  const cards = [
    {
      id: "portfolio-value",
      label: "Portfolio Value",
      value: formatCompactCurrency(metrics.latestEquity),
      numeric: metrics.latestEquity,
      delta: "unified account",
      positive: metrics.latestEquity >= 0
    },
    {
      id: "perps-account",
      label: "Perps Account",
      value: formatCompactCurrency(metrics.perpsAccountValue),
      numeric: metrics.perpsAccountValue,
      delta: `${formatPercent(metrics.totalReturnPct)} curve return`,
      positive: metrics.totalReturnPct >= 0
    },
    {
      id: "cash-spot",
      label: "Cash / Spot",
      value: formatCompactCurrency(metrics.cashAndSpotValue),
      numeric: metrics.cashAndSpotValue,
      delta: "spotClearinghouseState",
      positive: metrics.cashAndSpotValue >= 0
    },
    {
      id: "net-pnl",
      label: "Net PnL",
      value: formatSignedCurrency(metrics.netPnl),
      numeric: metrics.netPnl,
      delta: "realized + open + funding",
      positive: metrics.netPnl >= 0
    },
    {
      id: "realized",
      label: "Realized",
      value: formatCompactCurrency(metrics.realized),
      numeric: metrics.realized,
      delta: `${metrics.trades.length} fills`,
      positive: metrics.realized >= 0
    },
    {
      id: "unrealized",
      label: "Unrealized",
      value: formatCompactCurrency(metrics.unrealized),
      numeric: metrics.unrealized,
      delta: `${metrics.positions.length} positions`,
      positive: metrics.unrealized >= 0
    },
    {
      id: "win-rate",
      label: "Win Rate",
      value: `${metrics.winRate.toFixed(1)}%`,
      numeric: metrics.winRate,
      delta: `${metrics.symbolAttribution.length} symbols`,
      positive: metrics.winRate >= 50
    },
    {
      id: "profit-factor",
      label: "Profit Factor",
      value: Number.isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : "INF",
      numeric: Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 999,
      delta: `${formatCurrency(metrics.grossProfit)} / ${formatCurrency(metrics.grossLoss)}`,
      positive: metrics.profitFactor >= 1
    },
    {
      id: "payoff-ratio",
      label: "Payoff Ratio",
      value: Number.isFinite(metrics.payoffRatio) ? metrics.payoffRatio.toFixed(2) : "INF",
      numeric: Number.isFinite(metrics.payoffRatio) ? metrics.payoffRatio : 999,
      delta: `${formatCurrency(metrics.avgWinner)} avg win`,
      positive: metrics.payoffRatio >= 1
    },
    {
      id: "expectancy",
      label: "Expectancy",
      value: formatCurrency(metrics.expectancy),
      numeric: metrics.expectancy,
      delta: "net per fill",
      positive: metrics.expectancy >= 0
    },
    {
      id: "drawdown",
      label: "Drawdown",
      value: `${metrics.maxDrawdown.toFixed(1)}%`,
      numeric: metrics.maxDrawdown,
      delta: `${formatSignedCurrency(metrics.worstDay.pnl)} worst day`,
      positive: metrics.maxDrawdown > -5
    },
    {
      id: "exposure",
      label: "Exposure",
      value: formatCompactCurrency(metrics.totalExposure),
      numeric: metrics.totalExposure,
      delta: `${metrics.avgLeverage.toFixed(1)}x avg lev`,
      positive: metrics.unrealized >= 0
    },
    {
      id: "margin",
      label: "Margin",
      value: formatCompactCurrency(metrics.marginUsed),
      numeric: metrics.marginUsed,
      delta: "estimated used",
      positive: metrics.marginUsed < metrics.latestEquity
    },
    {
      id: "fees",
      label: "Fees",
      value: formatCurrency(metrics.totalFees),
      numeric: metrics.totalFees,
      delta: `${formatPercent(metrics.totalFees / Math.max(metrics.grossVolume, 1) * 100)} of volume`,
      positive: metrics.totalFees < Math.abs(metrics.realized)
    },
    {
      id: "funding",
      label: "Funding",
      value: formatSignedCurrency(metrics.fundingNet),
      numeric: metrics.fundingNet,
      delta: "net funding",
      positive: metrics.fundingNet >= 0
    },
    {
      id: "volume",
      label: "Volume",
      value: formatCompactCurrency(metrics.grossVolume),
      numeric: metrics.grossVolume,
      delta: `${metrics.avgHold.toFixed(1)}h avg hold`,
      positive: true
    },
    {
      id: "best-day",
      label: "Best Day",
      value: formatSignedCurrency(metrics.bestDay.pnl),
      numeric: metrics.bestDay.pnl,
      delta: metrics.bestDay.date,
      positive: metrics.bestDay.pnl >= 0
    }
  ];

  const metricOrder = loadJson(storageKeys.metricOrder, []);
  const orderedCards = [...cards].sort((left, right) => {
    const leftIndex = metricOrder.indexOf(left.id);
    const rightIndex = metricOrder.indexOf(right.id);
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });

  elements.overviewGrid.innerHTML = orderedCards
    .map(
      (card) => `
        <article class="metric-card ${card.positive ? "metric-card--positive" : "metric-card--negative"}" draggable="true" data-metric-id="${card.id}">
          <p class="metric-card__label">${card.label}</p>
          <div class="metric-card__value" data-flash-key="metric:${card.id}" data-flash-value="${card.numeric}">${card.value}</div>
          <div class="metric-card__delta ${card.positive ? "metric-card__delta--positive" : "metric-card__delta--negative"}">
            ${card.delta}
          </div>
        </article>
      `
    )
    .join("");
}

function renderDataTape(metrics) {
  const topSymbol = metrics.symbolAttribution[0];
  const biggestPosition = [...metrics.positions].sort((left, right) => right.exposure - left.exposure)[0];
  const items = [
    ["wallet", "Wallet", state.dataset.wallet, state.dataset.wallet],
    ["source", "Source", state.dataset.source.replaceAll("-", " "), state.dataset.source],
    ["sync", "Last Sync", formatDateTime(state.dataset.lastSync), state.dataset.lastSync],
    ["top-symbol", "Top Symbol", topSymbol ? `${topSymbol.symbol} ${formatSignedCurrency(topSymbol.pnl)}` : "-", topSymbol?.pnl ?? 0],
    ["max-exposure", "Max Exposure", biggestPosition ? `${biggestPosition.symbol} ${formatCompactCurrency(biggestPosition.exposure)}` : "Flat", biggestPosition?.exposure ?? 0],
    ["best-worst", "Best / Worst", `${formatSignedCurrency(metrics.bestDay.pnl)} / ${formatSignedCurrency(metrics.worstDay.pnl)}`, metrics.bestDay.pnl + metrics.worstDay.pnl]
  ];

  elements.dataTape.innerHTML = items
    .map(
      ([id, label, value, flashValue]) => `
        <div class="tape-item">
          <span class="tape-item__label">${label}</span>
          <span class="tape-item__value" data-flash-key="tape:${id}" data-flash-value="${flashValue}">${value}</span>
        </div>
      `
    )
    .join("");
}

function renderRiskStrip(metrics) {
  const worstPosition = [...metrics.positions].sort((left, right) => left.pnl - right.pnl)[0];
  const bestPosition = [...metrics.positions].sort((left, right) => right.pnl - left.pnl)[0];
  const riskItems = [
    ["Open Exposure", formatCompactCurrency(metrics.totalExposure), metrics.unrealized],
    ["Open PnL", formatSignedCurrency(metrics.unrealized), metrics.unrealized],
    ["Est. Margin", formatCompactCurrency(metrics.marginUsed), metrics.latestEquity - metrics.marginUsed],
    ["Avg Leverage", `${metrics.avgLeverage.toFixed(1)}x`, metrics.avgLeverage <= 3 ? 1 : -1],
    ["Best Position", bestPosition ? `${bestPosition.symbol} ${formatSignedCurrency(bestPosition.pnl)}` : "-", bestPosition?.pnl ?? 0],
    ["Worst Position", worstPosition ? `${worstPosition.symbol} ${formatSignedCurrency(worstPosition.pnl)}` : "-", worstPosition?.pnl ?? 0]
  ];

  elements.riskStrip.innerHTML = riskItems
    .map(
      ([label, value, bias]) => `
        <div class="risk-item">
          <span class="risk-item__label">${label}</span>
          <span class="risk-item__value ${valueClass(bias)}" data-flash-key="risk:${label}" data-flash-value="${bias}">${value}</span>
        </div>
      `
    )
    .join("");
}

function buildLineChart(points) {
  if (!points.length) {
    return "<p class='muted-label'>No equity history yet.</p>";
  }

  const width = 720;
  const height = 280;
  const padding = 30;
  const values = points.map((point) => point.equity);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(maxValue - minValue, 1);

  const coords = points.map((point, index) => {
    const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((point.equity - minValue) / range) * (height - padding * 2);
    return { x, y, label: point.date };
  });

  const linePath = coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`).join(" ");
  const areaPath = `${linePath} L ${coords.at(-1).x} ${height - padding} L ${coords[0].x} ${height - padding} Z`;
  const yGuides = [0, 0.5, 1].map((ratio) => {
    const y = padding + ratio * (height - padding * 2);
    const value = maxValue - ratio * range;
    return { y, value };
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Equity curve chart">
      ${yGuides
        .map(
          (guide) => `
            <line class="chart__grid" x1="${padding}" y1="${guide.y}" x2="${width - padding}" y2="${guide.y}"></line>
            <text class="chart__axis" x="${padding}" y="${guide.y - 6}">${integer.format(guide.value)}</text>
          `
        )
        .join("")}
      <path class="chart__area" d="${areaPath}"></path>
      <path class="chart__line" d="${linePath}"></path>
      ${coords
        .filter((_, index) => index === 0 || index === coords.length - 1 || index === Math.floor(coords.length / 2))
        .map(
          (coord) => `
            <text class="chart__axis" x="${coord.x - 18}" y="${height - 8}">${coord.label.slice(5)}</text>
          `
        )
        .join("")}
    </svg>
  `;
}

function renderPositions(positions) {
  if (!positions.length) {
    elements.positionsTable.innerHTML = "<p class='muted-label'>No open positions loaded.</p>";
    elements.positionCount.textContent = "Flat";
    return;
  }

  elements.positionCount.textContent = `${positions.length} live positions`;
  elements.positionsTable.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Side</th>
          <th>Size</th>
          <th>Exposure</th>
          <th>Entry</th>
          <th>Mark</th>
          <th>PnL</th>
          <th>ROE</th>
          <th>Lev</th>
        </tr>
      </thead>
      <tbody>
        ${positions
          .map(
            (position) => `
              <tr>
                <td><span class="badge">${position.symbol}</span></td>
                <td><span class="side-pill side-pill--${position.side.toLowerCase()}">${position.side}</span></td>
                <td>${decimal.format(position.size)}</td>
                <td>${formatCompactCurrency(position.exposure)}</td>
                <td>${formatCurrency(position.entry)}</td>
                <td data-flash-key="position:${position.symbol}:mark" data-flash-value="${position.mark}">${formatCurrency(position.mark)}</td>
                <td class="${valueClass(position.pnl)}" data-flash-key="position:${position.symbol}:pnl" data-flash-value="${position.pnl}">${formatSignedCurrency(position.pnl)}</td>
                <td class="${valueClass(position.pnl)}" data-flash-key="position:${position.symbol}:roe" data-flash-value="${position.pnl}">${formatPercent((position.pnl / Math.max(position.exposure / position.leverage, 1)) * 100)}</td>
                <td>${position.leverage.toFixed(1)}x</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderSymbolTable(symbols) {
  if (!symbols.length) {
    elements.symbolTable.innerHTML = "<p class='muted-label'>No symbol attribution loaded.</p>";
    return;
  }

  elements.symbolTable.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Coin</th>
          <th>PnL</th>
          <th>Win</th>
          <th>Fills</th>
          <th>Volume</th>
          <th>Avg Hold</th>
        </tr>
      </thead>
      <tbody>
        ${symbols
          .map(
            (symbol) => `
              <tr>
                <td><span class="badge">${symbol.symbol}</span></td>
                <td class="${valueClass(symbol.pnl)}" data-flash-key="symbol:${symbol.symbol}:pnl" data-flash-value="${symbol.pnl}">${formatSignedCurrency(symbol.pnl)}</td>
                <td>${symbol.winRate.toFixed(1)}%</td>
                <td>${symbol.count}</td>
                <td>${formatCompactCurrency(symbol.volume)}</td>
                <td>${symbol.avgHold ? `${symbol.avgHold.toFixed(1)}h` : "-"}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderTrades(trades) {
  elements.tradeCount.textContent = `${trades.length} recent fills`;

  elements.tradesTable.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Symbol</th>
          <th>Side</th>
          <th>Size</th>
          <th>Price</th>
          <th>Fee</th>
          <th>Realized</th>
          <th>Net</th>
          <th>Hold</th>
          <th>Notional</th>
        </tr>
      </thead>
      <tbody>
        ${trades
          .map(
            (trade) => `
              <tr>
                <td>${formatDateTime(trade.time)}</td>
                <td><span class="badge">${trade.symbol}</span></td>
                <td><span class="side-pill side-pill--${trade.side.toLowerCase() === "buy" ? "long" : "short"}">${trade.side}</span></td>
                <td>${decimal.format(trade.size)}</td>
                <td data-flash-key="trade:${trade.time}:${trade.symbol}:price" data-flash-value="${trade.price}">${formatCurrency(trade.price)}</td>
                <td>${formatCurrency(trade.fee)}</td>
                <td class="${valueClass(trade.realizedPnl)}" data-flash-key="trade:${trade.time}:${trade.symbol}:realized" data-flash-value="${trade.realizedPnl}">${formatSignedCurrency(trade.realizedPnl)}</td>
                <td class="${valueClass(trade.realizedPnl - trade.fee)}" data-flash-key="trade:${trade.time}:${trade.symbol}:net" data-flash-value="${trade.realizedPnl - trade.fee}">${formatSignedCurrency(trade.realizedPnl - trade.fee)}</td>
                <td>${trade.holdHours ? `${trade.holdHours.toFixed(1)}h` : "-"}</td>
                <td>${formatCompactCurrency(trade.size * trade.price)}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderInsights(metrics) {
  const topSymbol = metrics.symbolAttribution[0];
  const weakestSymbol = [...metrics.symbolAttribution].sort((left, right) => left.pnl - right.pnl)[0];
  const openRisk = [...metrics.positions].sort((left, right) => Math.abs(right.exposure) - Math.abs(left.exposure))[0];

  const insights = [
    {
      title: "Best engine",
      body: topSymbol
        ? `${topSymbol.symbol} contributed ${formatSignedCurrency(topSymbol.pnl)} across ${topSymbol.count} trades with a ${topSymbol.winRate.toFixed(0)}% hit rate.`
        : "No symbol attribution yet."
    },
    {
      title: "Largest drag",
      body: weakestSymbol
        ? `${weakestSymbol.symbol} is the weakest contributor so far at ${formatSignedCurrency(weakestSymbol.pnl)}. That is where journaling and setup review should start.`
        : "No losing symbols yet."
    },
    {
      title: "Current concentration",
      body: openRisk
        ? `${openRisk.symbol} is your biggest active exposure at ${formatCompactCurrency(openRisk.exposure)}. It deserves the tightest monitoring and best execution context.`
        : "No live concentration because no positions are loaded."
    },
    {
      title: "Quality of wins",
      body: `Average winner is ${formatCurrency(metrics.avgWinner)} while average loser is ${formatCurrency(metrics.avgLoser)}. That gives the assistant enough context to discuss expectancy instead of only win rate.`
    }
  ];

  elements.insightsList.innerHTML = insights
    .map(
      (insight) => `
        <article class="insight">
          <h3>${insight.title}</h3>
          <p>${insight.body}</p>
        </article>
      `
    )
    .join("");
}

function renderRoadmap() {
  elements.roadmapList.innerHTML = roadmap
    .map(
      (item) => `
        <article class="queue-item">
          <span class="queue-item__status">${item.status}</span>
          <h3>${item.title}</h3>
          <p>${item.body}</p>
        </article>
      `
    )
    .join("");
}

function renderAssistant() {
  elements.assistantSuggestions.innerHTML = assistantSuggestions
    .map((question) => `<button class="chip" type="button" data-question="${question}">${question}</button>`)
    .join("");

  elements.assistantMessages.innerHTML = state.messages
    .map(
      (message) => `
        <article class="message message--${message.role}">
          <div class="message__meta">${message.role === "assistant" ? "Desk Assistant" : "You"}</div>
          <p>${message.text}</p>
        </article>
      `
    )
    .join("");

  requestAnimationFrame(() => {
    elements.assistantMessages.scrollTop = elements.assistantMessages.scrollHeight;
  });
}

function renderStatus() {
  const source =
    state.dataset.source === "csv-import"
      ? "CSV Import"
      : state.dataset.source === "hyperliquid-api"
        ? "Live API"
        : "Mock Sync";
  const live = state.dataset.source === "hyperliquid-api";
  elements.syncStatus.textContent = source;
  elements.syncStatus.className = `status-pill ${live ? "status-pill--live" : "status-pill--pending"}`;
}

function applyValueFlashes() {
  document.querySelectorAll("[data-flash-key]").forEach((element) => {
    const key = element.getAttribute("data-flash-key");
    const rawValue = element.getAttribute("data-flash-value") ?? element.textContent;
    const previous = flashState.get(key);

    if (previous !== undefined && String(previous) !== String(rawValue)) {
      const previousNumber = Number(previous);
      const nextNumber = Number(rawValue);
      const direction =
        Number.isFinite(previousNumber) && Number.isFinite(nextNumber)
          ? nextNumber >= previousNumber
            ? "flash-up"
            : "flash-down"
          : "flash-neutral";

      element.classList.remove("flash-up", "flash-down", "flash-neutral");
      void element.offsetWidth;
      element.classList.add(direction);
    }

    flashState.set(key, rawValue);
  });
}

function rerender() {
  state.metrics = computeMetrics(state.dataset);
  renderDataTape(state.metrics);
  createMetricCards(state.metrics);
  renderRiskStrip(state.metrics);
  renderPositions(state.metrics.positions);
  renderSymbolTable(state.metrics.symbolAttribution);
  renderTrades(state.metrics.trades);
  renderInsights(state.metrics);
  renderRoadmap();
  renderAssistant();
  renderStatus();
  applyValueFlashes();
}

function answerAssistant(question, metrics) {
  const prompt = question.toLowerCase();
  const topSymbol = metrics.symbolAttribution[0];
  const worstSymbol = [...metrics.symbolAttribution].sort((left, right) => left.pnl - right.pnl)[0];
  const hypeStats = metrics.symbolAttribution.find((item) => item.symbol === "HYPE");
  const largestPosition = [...metrics.positions].sort((left, right) => right.exposure - left.exposure)[0];

  if (prompt.includes("open risk") || prompt.includes("risk")) {
    if (!largestPosition) return "You do not have open positions loaded right now, so the risk panel is effectively flat.";
    return `${largestPosition.symbol} is your largest active exposure at ${formatCompactCurrency(largestPosition.exposure)} with ${formatSignedCurrency(largestPosition.pnl)} open PnL. Across all live positions, open PnL is ${formatSignedCurrency(metrics.unrealized)}.`;
  }

  if (prompt.includes("most money") || prompt.includes("best symbol") || prompt.includes("which symbol")) {
    if (!topSymbol) return "I do not have enough trade history yet to rank symbols.";
    return `${topSymbol.symbol} is the top contributor so far with ${formatSignedCurrency(topSymbol.pnl)} across ${topSymbol.count} trades and a ${topSymbol.winRate.toFixed(0)}% win rate.`;
  }

  if (prompt.includes("hype")) {
    if (!hypeStats) return "There are no HYPE trades in the current ledger.";
    return `HYPE is contributing ${formatSignedCurrency(hypeStats.pnl)} across ${hypeStats.count} trades with a ${hypeStats.winRate.toFixed(0)}% hit rate. In V2 we should break that out by setup, hold time, and market regime.`;
  }

  if (prompt.includes("last week") || prompt.includes("red")) {
    return `Your worst day in the current sample was ${metrics.worstDay.date} at ${formatSignedCurrency(metrics.worstDay.pnl)}. The weakest symbol overall is ${worstSymbol?.symbol ?? "n/a"}, which suggests the drawdown came more from symbol selection and execution than from a broad collapse in hit rate.`;
  }

  if (prompt.includes("v2") || prompt.includes("next")) {
    return "The next useful step is a real assistant backend with journal tags, symbol-specific drilldowns, and guarded SQL-style analytics over the normalized ledger.";
  }

  return `Right now I can answer from the loaded ledger: Portfolio Value is ${formatCompactCurrency(metrics.portfolioValue)}, Perps Account is ${formatCompactCurrency(metrics.perpsAccountValue)}, realized PnL is ${formatSignedCurrency(metrics.realized)}, win rate is ${metrics.winRate.toFixed(1)}%, and your best symbol is ${topSymbol?.symbol ?? "n/a"}.`;
}

function stopLiveSync() {
  liveSync.stopWebsocket?.();
  liveSync.stopWebsocket = null;
  clearTimeout(liveSync.refreshTimer);
  clearInterval(liveSync.pollTimer);
  liveSync.refreshTimer = null;
  liveSync.pollTimer = null;
  liveSync.wallet = null;
}

function scheduleLiveRefresh(delay = 12000) {
  if (!liveSync.wallet) return;
  clearTimeout(liveSync.refreshTimer);
  liveSync.refreshTimer = setTimeout(() => {
    syncHyperliquidWallet(liveSync.wallet, { silent: true });
  }, delay);
}

function startLiveWatch(wallet) {
  if (liveSync.wallet === wallet && liveSync.stopWebsocket) return;

  stopLiveSync();
  liveSync.wallet = wallet;
  liveSync.stopWebsocket = window.hyperliquid.subscribe(wallet, {
    onStatus: (label) => {
      if (state.dataset.source === "hyperliquid-api") setSyncStatus(label, "live");
    },
    onUpdate: () => scheduleLiveRefresh(),
    onError: (error) => {
      pushAssistantMessage({ role: "assistant", text: error.message });
      renderAssistant();
    }
  });
  liveSync.pollTimer = setInterval(() => scheduleLiveRefresh(0), 3 * 60 * 1000);
}

async function syncHyperliquidWallet(wallet, { silent = false } = {}) {
  if (liveSync.syncing) return;
  liveSync.syncing = true;

  if (!silent) {
    setSyncStatus("Syncing", "pending");
    setWalletSubmit(true);
  }

  try {
    const dataset = await window.hyperliquid.fetchPortfolio(wallet);
    state.dataset = dataset;
    elements.csvFileName.textContent = "No file loaded";
    saveJson(storageKeys.lastWallet, wallet);

    if (!silent) {
      pushAssistantMessage({
        role: "assistant",
        text: `Loaded live Hyperliquid data for ${wallet}. The dashboard is now using portfolio history, fills, funding, positions, and websocket-triggered refreshes.`
      });
    }

    rerender();
    startLiveWatch(wallet);
  } catch (error) {
    setSyncStatus("Sync Error", "error");
    pushAssistantMessage({
      role: "assistant",
      text: `Live sync failed: ${error.message}`
    });
    renderAssistant();
  } finally {
    liveSync.syncing = false;
    if (!silent) setWalletSubmit(false);
  }
}

function parseCsv(text) {
  const [headerLine, ...rawLines] = text.split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];

  const headers = headerLine.split(",").map((item) => item.trim());
  return rawLines.map((line) => {
    const values = line.split(",").map((item) => item.trim());
    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

elements.walletForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const wallet = elements.walletInput.value.trim();
  if (!wallet) {
    pushAssistantMessage({
      role: "assistant",
      text: "Enter a full Hyperliquid wallet address and I will load the live read-only account data."
    });
    renderAssistant();
    return;
  }

  syncHyperliquidWallet(wallet);
});

elements.csvInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const rows = parseCsv(await file.text());
  elements.csvFileName.textContent = file.name;
  stopLiveSync();
  state.dataset = deriveImportedDataset(rows);
  pushAssistantMessage({
    role: "assistant",
    text: `Imported ${rows.length} CSV rows and rebuilt the dashboard from that ledger. Live positions are empty because the CSV path is trade-history only in V2.`
  });
  rerender();
});

elements.assistantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = elements.assistantInput.value.trim();
  if (!question) return;

  pushAssistantMessage({ role: "user", text: question });
  elements.assistantInput.value = "";
  renderAssistant();

  setAssistantStatus("Thinking", "busy");

  try {
    const answer = await askLlmAssistant(question);
    pushAssistantMessage({ role: "assistant", text: answer });
    setAssistantStatus("LLM Ready", "ready");
  } catch (error) {
    const fallback = answerAssistant(question, state.metrics);
    pushAssistantMessage({
      role: "assistant",
      text: `${fallback} Local LLM fallback used because ${error.message}`
    });
    setAssistantStatus("Fallback", "fallback");
  }

  renderAssistant();
});

elements.assistantSuggestions.addEventListener("click", (event) => {
  const target = event.target.closest("[data-question]");
  if (!target) return;
  const question = target.getAttribute("data-question");
  elements.assistantInput.value = question;
  elements.assistantForm.requestSubmit();
});

elements.chartAddForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addChartWidget(elements.chartSymbolInput.value);
  elements.chartSymbolInput.value = "";
});

elements.chartQuickList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick-symbol]");
  if (!button) return;
  addChartWidget(button.getAttribute("data-quick-symbol"));
});

elements.tradingviewDeck.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-chart-symbol-form]");
  if (!form) return;
  event.preventDefault();

  const id = form.getAttribute("data-chart-symbol-form");
  const input = form.querySelector("input");
  const widget = state.chartWidgets.find((item) => item.id === id);
  if (!widget) return;

  widget.symbol = normalizeTradingViewSymbol(input.value);
  saveJson(storageKeys.chartWidgets, state.chartWidgets);
  renderTradingViewDeck();
});

elements.tradingviewDeck.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-chart]");
  if (!deleteButton) return;

  const id = deleteButton.getAttribute("data-delete-chart");
  state.chartWidgets = state.chartWidgets.filter((widget) => widget.id !== id);
  if (!state.chartWidgets.length) {
    state.chartWidgets = structuredClone(defaultChartWidgets);
  }
  saveJson(storageKeys.chartWidgets, state.chartWidgets);
  renderTradingViewDeck();
});

elements.tradingviewDeck.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-chart-widget]");
  if (!card) return;
  draggedChartId = card.getAttribute("data-chart-widget");
  card.classList.add("is-dragging");
});

elements.tradingviewDeck.addEventListener("dragend", (event) => {
  event.target.closest("[data-chart-widget]")?.classList.remove("is-dragging");
  draggedChartId = null;
});

elements.tradingviewDeck.addEventListener("dragover", (event) => {
  if (!draggedChartId) return;
  event.preventDefault();
});

elements.tradingviewDeck.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-chart-widget]");
  if (!target || !draggedChartId) return;
  event.preventDefault();

  const targetId = target.getAttribute("data-chart-widget");
  const draggedIndex = state.chartWidgets.findIndex((widget) => widget.id === draggedChartId);
  const targetIndex = state.chartWidgets.findIndex((widget) => widget.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

  const [dragged] = state.chartWidgets.splice(draggedIndex, 1);
  state.chartWidgets.splice(targetIndex, 0, dragged);
  saveJson(storageKeys.chartWidgets, state.chartWidgets);
  renderTradingViewDeck();
});

elements.overviewGrid.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-metric-id]");
  if (!card) return;
  draggedMetricId = card.getAttribute("data-metric-id");
  card.classList.add("is-dragging");
});

elements.overviewGrid.addEventListener("dragend", (event) => {
  event.target.closest("[data-metric-id]")?.classList.remove("is-dragging");
  draggedMetricId = null;
});

elements.overviewGrid.addEventListener("dragover", (event) => {
  if (!draggedMetricId) return;
  event.preventDefault();
});

elements.overviewGrid.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-metric-id]");
  if (!target || !draggedMetricId) return;
  event.preventDefault();

  const cards = [...elements.overviewGrid.querySelectorAll("[data-metric-id]")].map((card) =>
    card.getAttribute("data-metric-id")
  );
  const draggedIndex = cards.indexOf(draggedMetricId);
  const targetIndex = cards.indexOf(target.getAttribute("data-metric-id"));
  if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

  const [dragged] = cards.splice(draggedIndex, 1);
  cards.splice(targetIndex, 0, dragged);
  saveJson(storageKeys.metricOrder, cards);
  createMetricCards(state.metrics);
});

elements.demoReset.addEventListener("click", () => {
  stopLiveSync();
  state.dataset = structuredClone(window.mockPortfolio);
  elements.csvFileName.textContent = "No file loaded";
  pushAssistantMessage({
    role: "assistant",
    text: "Demo portfolio restored. Enter a wallet any time to switch back to live Hyperliquid read-only sync."
  });
  rerender();
});

const rememberedWallet = loadJson(storageKeys.lastWallet, "");
if (rememberedWallet) {
  elements.walletInput.value = rememberedWallet;
}

renderChartQuickList();
renderTradingViewDeck();
rerender();
