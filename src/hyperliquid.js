(function () {
  const INFO_URL = "https://api.hyperliquid.xyz/info";
  const WS_URL = "wss://api.hyperliquid.xyz/ws";
  const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

  function assertWallet(user) {
    if (!ADDRESS_PATTERN.test(user)) {
      throw new Error("Enter a full 42-character wallet address, e.g. 0x0000...0000.");
    }
  }

  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function uniqueKey(fill) {
    return [fill.hash, fill.oid, fill.time, fill.coin, fill.px, fill.sz, fill.side].join(":");
  }

  async function postInfo(body) {
    const response = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid ${body.type} failed with HTTP ${response.status}.`);
    }

    return response.json();
  }

  function choosePortfolioWindow(portfolio) {
    const preferred = ["perpDay", "day", "perpWeek", "week", "perpMonth", "month", "allTime"];
    for (const label of preferred) {
      const match = portfolio.find(([period]) => period === label);
      if (match?.[1]?.accountValueHistory?.length) return match[1];
    }
    return null;
  }

  function normalizeEquityHistory(portfolio, accountValue) {
    const window = Array.isArray(portfolio) ? choosePortfolioWindow(portfolio) : null;
    const history = window?.accountValueHistory ?? [];

    if (history.length) {
      return history.map(([time, equity]) => ({
        date: new Date(time).toISOString().slice(0, 10),
        equity: toNumber(equity)
      }));
    }

    return [
      {
        date: new Date().toISOString().slice(0, 10),
        equity: accountValue
      }
    ];
  }

  function normalizePositions(clearinghouseState, assetCtxs) {
    const ctxByCoin = new Map(
      assetCtxs
        .map((ctx) => [ctx.name ?? ctx.coin, ctx])
        .filter(([coin]) => Boolean(coin))
    );

    return (clearinghouseState.assetPositions ?? [])
      .map((asset) => asset.position ?? asset)
      .filter((position) => Math.abs(toNumber(position.szi)) > 0)
      .map((position) => {
        const size = toNumber(position.szi);
        const coin = position.coin;
        const ctx = ctxByCoin.get(coin);
        const entry = toNumber(position.entryPx);
        const exposure = Math.abs(toNumber(position.positionValue));
        const mark = toNumber(ctx?.markPx, entry);
        const leverage = toNumber(position.leverage?.value, 1);

        return {
          symbol: coin,
          side: size >= 0 ? "Long" : "Short",
          size: Math.abs(size),
          entry,
          mark,
          pnl: toNumber(position.unrealizedPnl),
          exposure,
          leverage
        };
      });
  }

  function normalizeFills(fills) {
    const seen = new Set();

    return (fills ?? [])
      .filter((fill) => {
        const key = uniqueKey(fill);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((fill) => ({
        time: new Date(fill.time).toISOString(),
        symbol: fill.coin,
        side: fill.side === "B" ? "Buy" : "Sell",
        size: toNumber(fill.sz),
        price: toNumber(fill.px),
        fee: toNumber(fill.fee),
        realizedPnl: toNumber(fill.closedPnl),
        holdHours: 0,
        raw: fill
      }))
      .sort((left, right) => new Date(right.time) - new Date(left.time));
  }

  function normalizeFunding(fundingRows) {
    return (fundingRows ?? []).map((row) => ({
      time: new Date(row.time).toISOString(),
      amount: toNumber(row.delta?.usdc ?? row.usdc ?? row.amount),
      raw: row
    }));
  }

  function normalizeSpotBalances(spotClearinghouseState, spotMetaAndAssetCtxs) {
    const meta = spotMetaAndAssetCtxs?.[0] ?? {};
    const contexts = spotMetaAndAssetCtxs?.[1] ?? [];
    const pairByToken = new Map();

    (meta.universe ?? []).forEach((pair, index) => {
      const baseToken = pair.tokens?.[0];
      const quoteToken = pair.tokens?.[1];
      if (quoteToken === 0 && baseToken !== undefined) {
        pairByToken.set(baseToken, {
          name: pair.name,
          markPx: toNumber(contexts[index]?.markPx ?? contexts[index]?.midPx)
        });
      }
    });

    return (spotClearinghouseState.balances ?? []).map((balance) => {
      const total = toNumber(balance.total);
      const token = Number(balance.token);
      const pair = pairByToken.get(token);
      const usdValue = balance.coin === "USDC" ? total : total * toNumber(pair?.markPx);

      return {
        coin: balance.coin,
        token,
        total,
        hold: toNumber(balance.hold),
        usdValue,
        mark: balance.coin === "USDC" ? 1 : toNumber(pair?.markPx),
        raw: balance
      };
    });
  }

  async function fetchPortfolio(user) {
    assertWallet(user);

    const endTime = Date.now();
    const startTime = endTime - 30 * 24 * 60 * 60 * 1000;
    const [
      clearinghouseState,
      portfolio,
      fills,
      funding,
      openOrders,
      metaAndAssetCtxs,
      spotClearinghouseState,
      spotMetaAndAssetCtxs
    ] = await Promise.all([
      postInfo({ type: "clearinghouseState", user }),
      postInfo({ type: "portfolio", user }),
      postInfo({ type: "userFillsByTime", user, startTime, endTime, aggregateByTime: true }),
      postInfo({ type: "userFunding", user, startTime, endTime }),
      postInfo({ type: "frontendOpenOrders", user }),
      postInfo({ type: "metaAndAssetCtxs" }),
      postInfo({ type: "spotClearinghouseState", user }),
      postInfo({ type: "spotMetaAndAssetCtxs" })
    ]);

    const universe = metaAndAssetCtxs?.[0]?.universe ?? [];
    const assetCtxs = Array.isArray(metaAndAssetCtxs?.[1])
      ? metaAndAssetCtxs[1].map((ctx, index) => ({
          ...ctx,
          name: universe[index]?.name
        }))
      : [];
    const accountValue = toNumber(clearinghouseState.marginSummary?.accountValue);
    const spotBalances = normalizeSpotBalances(spotClearinghouseState, spotMetaAndAssetCtxs);
    const portfolioValue = spotBalances.reduce((sum, balance) => sum + balance.usdValue, 0);

    return {
      accountName: "Hyperliquid Live",
      wallet: user,
      source: "hyperliquid-api",
      lastSync: new Date().toISOString(),
      equityHistory: normalizeEquityHistory(portfolio, accountValue),
      portfolioValue: portfolioValue || accountValue,
      perpsAccountValue: accountValue,
      spotBalances,
      positions: normalizePositions(clearinghouseState, assetCtxs),
      trades: normalizeFills(fills),
      funding: normalizeFunding(funding),
      openOrders: openOrders ?? [],
      raw: {
        clearinghouseState,
        spotClearinghouseState,
        portfolio,
        openOrders
      }
    };
  }

  function subscribe(user, handlers = {}) {
    assertWallet(user);
    const socket = new WebSocket(WS_URL);
    const subscriptions = [
      { type: "clearinghouseState", user },
      { type: "userFills", user, aggregateByTime: true },
      { type: "userFundings", user },
      { type: "userNonFundingLedgerUpdates", user },
      { type: "orderUpdates", user }
    ];

    socket.addEventListener("open", () => {
      subscriptions.forEach((subscription) => {
        socket.send(JSON.stringify({ method: "subscribe", subscription }));
      });
      handlers.onStatus?.("Live WS");
    });

    socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.channel && payload.channel !== "subscriptionResponse") {
        handlers.onUpdate?.(payload);
      }
    });

    socket.addEventListener("close", () => handlers.onStatus?.("WS Closed"));
    socket.addEventListener("error", () => handlers.onError?.(new Error("Hyperliquid websocket error.")));

    return () => socket.close();
  }

  window.hyperliquid = {
    fetchPortfolio,
    subscribe
  };
})();
