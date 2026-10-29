(() => {
  const keyFor = (name) => `${location.protocol}//${location.hostname}:${location.port ?? 80}/cinehub-frontend/${name}`;
  function sessionInfo(storage = sessionStorage) {
    try {
      const user = JSON.parse(storage.getItem(keyFor("globalStoreUser")) || "null");
      return { loggedIn: typeof user?.accessToken === "string" && user.accessToken.length > 0 };
    } catch { return { loggedIn: false }; }
  }
  // Keep the cache across script injections; it never leaves the Showtimes tab.
  const ticketCache = globalThis.showtimesRadarTicketCache ||= new Map();
  const ticketCacheKey = (user, config) => JSON.stringify([user.accessToken, Number(config.eventId), config.ticketKeyword || "全票", Number(config.quantity), config.watchKey || ""]);
  async function ticketData(client, config, user, now, force = false) {
    const key = ticketCacheKey(user, config);
    const cached = ticketCache.get(key);
    if (!force && cached && now() >= cached.fetchedAt && now() - cached.fetchedAt < 15_000) return { ticketTypes: cached.ticketTypes, cached: true };
    const ticketTypes = await client.ticketTypes.list({ id: Number(config.eventId) });
    // Validate this exact event, keyword and quantity before marking it ready.
    chooseTicket(ticketTypes, config.ticketKeyword || "全票", Number(config.quantity));
    for (const [oldKey, entry] of ticketCache) if (now() - entry.fetchedAt >= 15_000) ticketCache.delete(oldKey);
    ticketCache.set(key, { ticketTypes, fetchedAt: now() });
    return { ticketTypes, cached: false };
  }
  async function prepare(client, config, { storage = sessionStorage, now = Date.now } = {}) {
    const user = JSON.parse(storage.getItem(keyFor("globalStoreUser")) || "null");
    if (!user?.accessToken) throw new Error("票種預載未完成：請確認秀泰分頁已登入");
    const eventId = Number(config.eventId), quantity = Number(config.quantity);
    if (!Number.isSafeInteger(eventId) || eventId < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 6) throw new Error("預載場次或張數不正確");
    client.auth.setBearerToken(user.accessToken, user.jwt ?? null);
    await ticketData(client, config, user, now);
    return { status: "prepared", message: "票種已預先載入，命中後將直接讀取最新座位圖（票種快取有效 15 秒）" };
  }
  const defaultCart = () => ({ expiredAt: null, userSessionId: "", memberCardNumber: "", memberId: "", invoiceCarrier: "", ticketTypesCount: {}, selectedPackageConcessions: [], selectedConcessions: [], seats: [], vouchers: {}, bankCardTokenType: null, bankCardToken: null, bankCardHash: "", cobrandCardToken: null, secondaryCardToken: null, vistaCoBrandCardNoHash: "", vistaSecondaryCardHash: "", corporation: null, program: null, event: null, ticketTypes: [], concessionTabs: [], finalConcessions: [], finalPrice: 0, concessionsToAdd: [], payment: { amount: 0, type: "linePay" } });

  async function loadClient() {
    const urls = [...document.querySelectorAll('link[href],script[src]')].map(el => el.href || el.src);
    urls.push(...performance.getEntriesByType("resource").map(entry => entry.name));
    for (const url of new Set(urls)) {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin || !/^\/assets\/showtimes-[\w-]+\.js$/.test(parsed.pathname)) continue;
      const module = await import(parsed.href);
      const client = Object.values(module).find(value => value?.cart?.lockSeats && value?.seats?.listForEvent && value?.app?.bootstrap);
      if (client) return client;
    }
    throw new Error("找不到秀泰官方 API 模組，請先開啟已登入的秀泰頁面或更新擴充功能");
  }

  function chooseTicket(ticketTypes, keyword, quantity) {
    const usable = ticketTypes.filter(ticket => !ticket.isCharityTicket && !(ticket.soldOutContents?.length) && !ticket.isVoucherTicket && !ticket.isReserveOnlyTicket && !ticket.isCoBrandTicket && !ticket.isBankTicket && Number.isInteger(ticket.ticketCount) && ticket.ticketCount > 0 && quantity % ticket.ticketCount === 0);
    const wanted = String(keyword || "全票").trim();
    const exact = usable.filter(ticket => ticket.name === wanted);
    const matches = exact.length ? exact : usable.filter(ticket => ticket.name.includes(wanted));
    const ticket = matches.length === 1 ? matches[0] : !matches.length && wanted === "全票" && usable.length === 1 ? usable[0] : null;
    if (!ticket) throw new Error(`找不到唯一符合「${wanted}」的票種，可選：${usable.map(ticket => ticket.name).join("、") || "無"}`);
    return { [ticket.id]: quantity / ticket.ticketCount };
  }

  function decodeSeatMap(response) {
    const map = response?.payload?.seatMap || response?.seatMap || response;
    if (!Array.isArray(map?.seats)) throw new Error("座位圖資料格式不正確");
    if (map.type === "vista-minimized-1") return { ...map, seats: map.seats.map(seat => {
      if (!Array.isArray(seat) || seat.length < 10 || !map.areas?.[seat[7]]) throw new Error("座位資料不完整");
      const [x, y, r, c, ri, ci, s, a, l, displayLabel] = seat;
      return { x, y, r, c, ri, ci, s, a, cc: map.areas[a], l, displayLabel };
    }) };
    if (map.seats.some(seat => !seat || Array.isArray(seat) || !Number.isInteger(seat.ri) || !Number.isInteger(seat.ci) || !seat.cc)) throw new Error("座位資料格式不正確");
    return map;
  }

  async function reserve(client, config, { storage = sessionStorage, now = Date.now, onProgress = () => {} } = {}) {
    const quantity = Number(config.quantity), eventId = Number(config.eventId);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 6 || !Number.isSafeInteger(eventId) || eventId < 1) throw new Error("場次或張數不正確");
    onProgress({ step: "connect", message: "檢查秀泰登入狀態與未完成訂票" });
    const user = JSON.parse(storage.getItem(keyFor("globalStoreUser")) || "null");
    if (!user?.accessToken) throw new Error("請先在目前的秀泰分頁登入");
    const pendingKey = keyFor("radarPendingCart");
    if (Number(storage.getItem(pendingKey)) > now()) throw new Error("上一筆 API 訂票結果尚未確認，請到秀泰檢查，或等待訂票保留時間結束後重試");
    const previous = JSON.parse(storage.getItem(keyFor("cart")) || "null");
    if (previous?.userSessionId && new Date(previous.expiredAt).valueOf() > now()) throw new Error("秀泰已有未完成的訂票，請先完成或取消後再重試");
    client.auth.setBearerToken(user.accessToken, user.jwt ?? null);
    const started = performance.now();
    const timings = [];
    const timed = async (name, request) => {
      const begin = performance.now();
      try { return await request(); }
      finally { timings.push(`${name} ${((performance.now() - begin) / 1000).toFixed(2)} 秒`); }
    };
    const context = config.sessionContext;
    const freshContext = context?.event?.id === eventId && context.program?.id === context.event.programId && context.corporation?.id === context.event.corporationId && now() >= context.fetchedAt && now() - context.fetchedAt < 10_000;
    onProgress({ step: "tickets", message: freshContext ? "沿用剛掃描的場次，並行取得票種與最新座位圖" : "正在並行取得場次、票種與最新座位圖" });
    // Read-only requests are independent; mutations below remain sequential.
    // Attach handlers to all requests immediately, including on early failure.
    const preparation = Promise.all([
      freshContext ? Promise.resolve({ events: [context.event], programs: [context.program], corporations: [context.corporation] }) : timed("場次", () => client.app.bootstrap()),
      timed("票種", async () => {
        const data = await ticketData(client, config, user, now);
        if (data.cached) onProgress({ step: "tickets", message: "已沿用預載票種，省略本次票種查詢；座位圖仍即時取得" });
        return data.ticketTypes;
      }),
      timed("座位圖", () => client.seats.listForEvent({ id: eventId })).then(decodeSeatMap)
    ]);
    const [bootstrap, ticketTypes, map] = await preparation;
    const event = (bootstrap.events || Object.values(bootstrap.eventsForCorporations || {}).flatMap(group => group.events || [])).find(event => event.id === eventId);
    if (!event || event.status !== "active") throw new Error("場次尚未開放或已下架，請繼續監看");
    if (!Number.isFinite(new Date(event.startedAt).valueOf()) || new Date(event.startedAt).valueOf() <= now() + 20 * 60_000) throw new Error("距離開演不足 20 分鐘，無法訂票");
    const program = bootstrap.programs.find(program => program.id === event.programId);
    const corporation = bootstrap.corporations.find(corporation => corporation.id === event.corporationId);
    if (!program || !corporation) throw new Error("場次的節目或影城資料不完整");
    onProgress({ step: "tickets", message: "場次、票種與座位圖已取得，正在設定張數" });
    const cart = { ...defaultCart(), event, program, corporation, ticketTypes, ticketTypesCount: chooseTicket(ticketTypes, config.ticketKeyword || "全票", quantity) };
    const selectedTicket = ticketTypes.find(ticket => cart.ticketTypesCount[ticket.id]);
    const ticketCount = cart.ticketTypesCount[selectedTicket.id];
    if (selectedTicket.isPackageTicket) {
      onProgress({ step: "tickets", message: `「${selectedTicket.name}」直接以套票購買，不另查套餐；附帶品項依秀泰套票內容處理` });
    }
    onProgress({ step: "tickets", message: `已設定「${selectedTicket.name}」${ticketCount} 份，共 ${quantity} 張` });
    onProgress({ step: "seats", message: `已取得最新座位圖，正在挑選座位（準備耗時 ${((performance.now() - started) / 1000).toFixed(2)} 秒）` });
    // Use API row/column indices for adjacency; retain the original API seat fields.
    const seats = map.seats.map(seat => ({ ...seat, row: `${seat.a}:${seat.ri}`, number: seat.ci, disabled: seat.s !== 0 && seat.s !== 7 }));
    const group = globalThis.ShowtimesSeatPlanner.chooseSeats(seats, quantity);
    if (group.length !== quantity) throw new Error(`目前沒有符合影城選位規則的 ${quantity} 個空位，請繼續監看`);
    cart.seats = group.map(({ cc, a, r, c, ri, ci, displayLabel }) => ({ cc, a, r, c, ri, ci, displayLabel }));
    // Keep a guard even when create times out before returning a session ID.
    onProgress({ step: "create", message: `已挑選 ${quantity} 張：${cart.seats.map(seat => seat.displayLabel).join("、")}，正在建立訂票` });
    storage.setItem(pendingKey, String(now() + 600_000));
    try {
      cart.userSessionId = await timed("建立訂票", () => client.cart.create(cart));
    } catch (error) { ticketCache.delete(ticketCacheKey(user, config)); throw error; }
    cart.expiredAt = new Date(now() + 600_000).toISOString();
    // Retain the server session for manual recovery if subsequent steps fail.
    storage.setItem(keyFor("cart"), JSON.stringify(cart));
    try {
      onProgress({ step: "lock", message: `正在保留 ${cart.seats.map(seat => seat.displayLabel).join("、")}` });
      await timed("保留座位", () => client.cart.lockSeats(cart));
      const apiSeconds = ((performance.now() - started) / 1000).toFixed(2);
      const detectedAt = Date.parse(config.detectedAt);
      const elapsed = Number.isFinite(detectedAt) && now() >= detectedAt ? `；命中至保留 ${((now() - detectedAt) / 1000).toFixed(2)} 秒` : "";
      onProgress({ step: "lock", message: `座位保留成功（API 流程 ${apiSeconds} 秒${elapsed}），接著確認金額` });
    } catch (error) {
      // Do not retry a mutation on an ambiguous timeout or silently change seats.
      throw new Error(`座位保留未確認：${error.message}。請在秀泰確認或取消目前訂票後重試`);
    }
    onProgress({ step: "price", message: "座位已保留，正在確認訂單金額" });
    const pricing = await timed("確認金額", () => client.cart.checkPrice(cart));
    Object.assign(cart, pricing);
    storage.setItem(keyFor("cart"), JSON.stringify(cart));
    storage.setItem(pendingKey, "0");
    onProgress({ step: "price", message: `API 耗時：${timings.join("；")}；總計 ${((performance.now() - started) / 1000).toFixed(2)} 秒（讀取請求並行）` });
    return { status: "reserved", message: `API 已保留 ${quantity} 張：${cart.seats.map(seat => seat.displayLabel).join("、")}，請確認訂單與付款`, url: `${location.origin}/ticketing/cart/confirmOrder` };
  }

  globalThis.ShowtimesApiBooking = {
    chooseTicket, decodeSeatMap, reserve, sessionInfo, prepare,
    async prefetch(config) {
      try { return await prepare(await loadClient(), config); }
      catch (error) { return { status: "error", message: error.message }; }
    },
    async run(config) {
      try {
        if (globalThis.showtimesRadarApiRunning) throw new Error("已有 API 訂票流程進行中");
        globalThis.showtimesRadarApiRunning = true;
        globalThis.ShowtimesApiProgress = [{ step: "connect", message: "正在載入秀泰 API 並連線已登入分頁" }];
        return await reserve(await loadClient(), config, { onProgress: progress => globalThis.ShowtimesApiProgress.push(progress) });
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : String(error) };
      } finally { globalThis.showtimesRadarApiRunning = false; }
    }
  };
})();
