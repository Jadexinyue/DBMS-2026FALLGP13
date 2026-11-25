/* ==========================================================================
   SmartDine Shared State Engine, 9003 Cross-Role Timeline & Navigation Shell
   ========================================================================== */
(function () {
  "use strict";

  const entryUrl = new URL(location.href);
  if (entryUrl.pathname.endsWith("/") || entryUrl.pathname.endsWith("/index.html")) {
    let runId = entryUrl.searchParams.get("run");
    if (runId === "new") {
      runId = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");
      entryUrl.searchParams.set("run", runId);
      if (location.protocol === "file:") location.replace(entryUrl.href);
      else history.replaceState(null, "", entryUrl.href);
    }
    if (/^[0-9a-f]{24}$/.test(runId)) sessionStorage.setItem("sd-walkthrough", runId);
    if (runId === "normal") sessionStorage.removeItem("sd-walkthrough");
  }
  const run = sessionStorage.getItem("sd-walkthrough");
  const STORAGE_KEY = "smartdine_static_state_v2" + (run ? ":" + run : "");
  const accountKey = run ? "sd-account:" + run : "sd-account";
  const tableKey = run ? "sd-qr-binding:" + run : "sd-qr-binding";

  // Centralized brand config (per 11-25 chat: brand name may be updated later in 1 place)
  const BRAND = {
    name: "SmartDine",
    tagline: "Modern American Casual Full-Service Restaurant",
  };


  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function nowStamp({milliseconds = false} = {}) {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return milliseconds ? stamp + "." + String(d.getMilliseconds()).padStart(3, "0") : stamp;
  }

  function setMenuImages(db) {
    for (const item of db.MENU_ITEM) {
      if (item.menu_item_id >= 101 && item.menu_item_id <= 120)
        item.image = "assets/images/menu/" + item.menu_item_id + ".webp";
    }
  }

  function buildInitialState() {
    const seed = deepClone(window.SMARTDINE_SQL_SEED);
    setMenuImages(seed);

    // Enrich CUSTOMER with demo password per 11-25 decision (phone + password login; username non-unique)
    seed.CUSTOMER.forEach((c) => {
      c.password = "123456";
    });

    // Enrich EMPLOYEE with demo credentials & multi-role tags (spec BR-21 preview)
    const multiRoles = {
      101: [1, 2],
      102: [2, 3],
      103: [2, 4],
      104: [3],
      105: [3],
      106: [3],
      107: [3],
      108: [3],
      109: [3],
      110: [4],
      111: [4],
      112: [5],
      113: [5],
      114: [6, 3],
      115: [6],
    };
    seed.EMPLOYEE.forEach((e) => {
      e.login_code = "EMP" + e.employee_id;
      e.password = "staff123";
      e.phone_placeholder = "+1-555-900-" + e.employee_id; // Hand-drawn p.7/p.13 placeholder
      e.qualified_roles = multiRoles[e.employee_id] || [e.role_id];
    });

    // Normalize initial RESTAURANT_TABLE status uppercase for 6-state consistency while preserving SQL snapshot
    seed.RESTAURANT_TABLE.forEach((t) => {
      t.sql_original_status = t.table_status;
      t.table_status = t.table_status.toUpperCase();
      t.maintenance_status = t.table_id === 14 ? "Needs maintenance" : "Good"; // Hand-drawn p.15 placeholder
    });

    // Enrich active orders 9046..9050 items to show realistic kitchen states while keeping sql_original_status
    seed.ORDER_ITEM.forEach((oi) => {
      oi.sql_original_status = oi.item_status;
      if (oi.item_status === "Cooking") {
        oi.item_status = oi.order_item_id % 3 === 0 ? "READY" : oi.order_item_id % 2 === 0 ? "PREPARING" : "QUEUED";
      } else if (oi.item_status === "Served") {
        oi.item_status = "SERVED";
      }
    });

    // Prototype placeholder data for hand-drawn features lacking SQL columns (explicitly tagged)
    const placeholders = {
      reviewReplies: {
        8001: "We’re glad you enjoyed the double burger and tableside ordering. We hope to see you again soon!",
        8002: "We’re glad the ribeye was cooked to your liking. We look forward to your next visit.",
      },
      dishRequests: [
        { id: "DR-01", type: "Add item", dish_name: "Smoky Honey BBQ Wings", ingredients: "Chicken wings, smoked honey sauce and celery", reason: "Popular during weekend dinner service", by: "Jacob Moore (112)", date: "2026-11-23", status: "Pending" },
        { id: "DR-02", type: "Stock alert", dish_name: "Cedar Plank Grilled Salmon", ingredients: "Salmon fillets are running low", reason: "Check how many portions are available today", by: "Abigail Jackson (113)", date: "2026-11-23", status: "Resolved" },
      ],
      staffRequests: [
        { id: "SR-01", emp_id: 109, emp_name: "Harper Wilson", role: "Server", type: "Time off", date: "2026-11-26", reason: "Requesting half a day off for a family matter", status: "Awaiting approval" },
        { id: "SR-02", emp_id: 106, emp_name: "Logan Davis", role: "Server", type: "Promotion", date: "2026-11-22", reason: "Requesting a shift supervisor role after one year of service", status: "Approved" },
      ],
      expensesPlaceholder: [
        { date: "2026-11-16", item: "Food supplies", amount: 420.00 },
        { date: "2026-11-16", item: "Utilities and refrigeration maintenance", amount: 115.00 },
        { date: "2026-11-23", item: "Beverage supplies", amount: 260.00 },
      ],
    };

    const state = {
      servicePoolRevision: 1,
      englishLabels: true,
      db: seed,
      placeholders,
      loggedInCustomer: null, // { customer_id, name, primary_phone } or null (anonymous)
      loggedInEmployee: null, // { employee_id, employee_name, role_id }
    };

    prepareOpenDinner(seed);
    return state;
  }

  // T09 starts mid-service with the two rounds from the team's restaurant scenario.
  function prepareOpenDinner(db) {
    const session = db.DINING_SESSION.find(s => s.session_id === 6003);
    session.session_status = "Active";
    session.left_at = null;
    db.RESTAURANT_TABLE.find(t => t.table_id === session.table_id).table_status = "ORDERED";
    db.ORDER.find(o => o.order_id === 9003).order_status = "Open";
    const items = new Map([[20007,"SERVED"], [20008,"READY"], [20009,"PREPARING"], [20010,"PREPARING"], [20011,"QUEUED"]]);
    for (const item of db.ORDER_ITEM) {
      if (items.has(item.order_item_id)) item.item_status = items.get(item.order_item_id);
    }
    for (const round of db.SUB_ORDER.filter(r => r.order_id === 9003)) round.status = "Preparing";
    for (const entry of db.POINT_TRANSACTION.filter(p => p.order_id === 9003)) {
      const member = db.MEMBERSHIP.find(m => m.membership_id === entry.membership_id);
      member.points_balance -= entry.net_change;
    }
    db.PAYMENT = db.PAYMENT.filter(p => p.order_id !== 9003);
    db.POINT_TRANSACTION = db.POINT_TRANSACTION.filter(p => p.order_id !== 9003);
    db.REVIEW = db.REVIEW.filter(r => r.session_id !== session.session_id);
    // These four sample payouts belong to the original, completed service.
    db.TIP_ALLOCATION = db.TIP_ALLOCATION.filter(a => a.pool_id !== 5003 || a.allocation_id < 13009 || a.allocation_id > 13012);
    updatePoolTotals(db);
  }

  function updatePoolTotals(db) {
    for (const pool of db.TIP_POOL) {
      pool.pool_total = round2(db.PAYMENT.filter(p => p.pool_id === pool.pool_id)
        .reduce((total, p) => total + Number(p.tip_amount), 0));
    }
  }

  // Migrate only built-in labels and original sample copy. Preserve guest and staff input.
  function translateSavedLabels(state) {
    if (state.englishLabels) return;
    const labels = {
      "待维护": "Needs maintenance",
      "良好": "Good",
      "添加菜品": "Add item",
      "删除菜品": "Remove item",
      "售罄提示": "Stock alert",
      "恢复售卖": "Restore availability",
      "停售": "Suspend sales",
      "待处理": "Pending",
      "已处理": "Resolved",
      "已批准": "Approved",
      "请假申请": "Time off",
      "升职申请": "Promotion",
      "辞职申请": "Resignation",
      "待审批": "Awaiting approval",
      "已通过": "Approved",
      "已否决": "Declined", "未通过": "Declined"
    };
    const label = value => Object.hasOwn(labels, value) ? labels[value] : value;
    const sampleText = {
      "感谢您喜欢我们的招牌双层汉堡和扫码点餐体验，欢迎再次光临！": "We’re glad you enjoyed the double burger and tableside ordering. We hope to see you again soon!",
      "很高兴肋眼牛排火候合您心意，期待下次再为您服务。": "We’re glad the ribeye was cooked to your liking. We look forward to your next visit.",
      "鸡翅、蜂蜜烟熏酱、芹菜": "Chicken wings, smoked honey sauce and celery",
      "周末晚市点单需求高": "Popular during weekend dinner service",
      "三文鱼柳库存偏紧": "Salmon fillets are running low",
      "留意当日可售份数": "Check how many portions are available today",
      "家中有事申请调休半天": "Requesting half a day off for a family matter",
      "服务满一年申请兼任 Shift Supervisor": "Requesting a shift supervisor role after one year of service",
      "食材补货": "Food supplies",
      "水电与冷链运维": "Utilities and refrigeration maintenance",
      "酒水饮品补货": "Beverage supplies",
      "三文鱼柳库存偏紧（演示占位）": "Salmon fillets are running low"
    };
    const sample = value => Object.hasOwn(sampleText, value) ? sampleText[value] : value;
    const {dishRequests, staffRequests, reviewReplies, expensesPlaceholder} = state.placeholders;
    for (const table of state.db.RESTAURANT_TABLE) table.maintenance_status = label(table.maintenance_status);
    for (const request of dishRequests) {
      request.type = label(request.type);
      request.status = label(request.status);
      if (request.by === "厨房") request.by = "Kitchen";
      if (request.id === "DR-01" || request.id === "DR-02") {
        request.ingredients = sample(request.ingredients);
        request.reason = sample(request.reason);
      }
    }
    for (const request of staffRequests) {
      request.type = label(request.type);
      request.status = label(request.status);
      if (request.id === "SR-01" || request.id === "SR-02") request.reason = sample(request.reason);
    }
    for (const id of [8001, 8002]) {
      if (Object.hasOwn(reviewReplies, id)) reviewReplies[id] = sample(reviewReplies[id]);
    }
    for (const row of expensesPlaceholder) {
      row.item = sample(row.item.replace(/（静态占位(?:，V1规格书排除)?）$/, ""));
    }
    state.englishLabels = true;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.db?.MENU_ITEM) {
          setMenuImages(parsed.db);
          if (!parsed.servicePoolRevision) {
            const db = parsed.db;
            const order = db.ORDER.find(o => o.order_id === 9003);
            const payment = db.PAYMENT.find(p => p.order_id === 9003);
            if (order?.order_status === "Open" || (payment && payment.paid_at !== "2026-11-16 15:50:00")) {
              db.TIP_ALLOCATION = db.TIP_ALLOCATION.filter(a => a.pool_id !== 5003 || a.allocation_id < 13009 || a.allocation_id > 13012);
              if (payment && payment.tip_amount > 0) {
                const previous = payment.pool_id;
                payment.pool_id = 5003;
                if (previous > 5010 && !db.PAYMENT.some(p => p.pool_id === previous) && !db.TIP_ALLOCATION.some(a => a.pool_id === previous)) {
                  db.TIP_POOL = db.TIP_POOL.filter(p => p.pool_id !== previous);
                }
              }
            }
            parsed.servicePoolRevision = 1;
          }
          consolidateAllocations(parsed.db);
          updatePoolTotals(parsed.db);
          const account = JSON.parse(sessionStorage.getItem(accountKey) || "{}");
          parsed.loggedInEmployee = account.employee || null;
          parsed.loggedInCustomer = account.customer || null;
          translateSavedLabels(parsed);
          return parsed;
        }
      }
    } catch (e) {
      // Ignore storage errors (e.g., private browsing)
    }
    const fresh = buildInitialState();
    saveState(fresh);
    return fresh;
  }

  function saveState(state) {
    try {
      const {loggedInCustomer, loggedInEmployee, ...business} = state;
      sessionStorage.setItem(accountKey, JSON.stringify({customer: loggedInCustomer, employee: loggedInEmployee}));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(business));
    } catch (e) {
      // Ignore quota errors
    }
  }

  // ---------- Query & Calculation Helpers ----------
  function getState() {
    if (!window.__SMARTDINE_STATE) {
      window.__SMARTDINE_STATE = loadState();
    }
    return window.__SMARTDINE_STATE;
  }

  function commit(state) {
    window.__SMARTDINE_STATE = state;
    saveState(state);
  }

  function businessAction(action) {
    const apply = () => {
      window.__SMARTDINE_STATE = loadState();
      return action();
    };
    return navigator.locks ? navigator.locks.request(STORAGE_KEY + ":write", apply) : apply();
  }

  function attendance(employeeId) {
    const {SHIFT, TIME_ENTRY} = getState().db;
    const shifts = new Map(SHIFT.map(s => [s.shift_id, s]));
    return TIME_ENTRY.map(entry => {
      const shift = shifts.get(entry.shift_id);
      const start = Date.parse(entry.clock_in.replace(" ", "T"));
      const end = entry.clock_out ? Date.parse(entry.clock_out.replace(" ", "T")) : null;
      const minutes = end === null ? 0 : Math.max(0, (end - start) / 60000 - Number(entry.break_minutes || 0));
      return {entry, shift, start, end, minutes, employeeId:shift?.employee_id ?? entry.employee_id, roleId:shift?.role_id ?? entry.role_id};
    }).filter(row => employeeId == null || row.employeeId === employeeId);
  }

  function tipPlan(pool) {
    const {TIP_ALLOCATION} = getState().db;
    const allocated = TIP_ALLOCATION.filter(a => a.pool_id === pool.pool_id).reduce((n,a) => n + Math.round(a.amount*100), 0);
    const remaining = Math.round(pool.pool_total*100) - allocated;
    const minutesByEmployee = new Map();
    const start = Date.parse(pool.period_start.replace(" ", "T"));
    const end = Date.parse(pool.period_end.replace(" ", "T"));
    for (const row of attendance()) {
      if (![3,6].includes(row.roleId) || !row.minutes) continue;
      const overlap = Math.max(0, Math.min(row.end,end) - Math.max(row.start,start));
      if (!overlap) continue;
      const minutes = row.minutes * overlap / (row.end - row.start);
      minutesByEmployee.set(row.employeeId, (minutesByEmployee.get(row.employeeId) || 0) + minutes);
    }
    const total = [...minutesByEmployee.values()].reduce((a,b) => a+b, 0);
    const shares = [...minutesByEmployee].map(([id, minutes]) => {
      const exact = Math.max(0, remaining) * minutes / total;
      return {id, minutes, cents:Math.floor(exact), fraction:exact-Math.floor(exact)};
    }).sort((a,b) => b.fraction-a.fraction || a.id-b.id);
    let pennies = remaining - shares.reduce((sum,p) => sum + p.cents, 0);
    for (const share of shares) if (pennies > 0) { share.cents++; share.roundingCent = 1; pennies--; }
    return {remaining, shares};
  }

  // Each employee has one balance per pool. Keep each posting and its calculation basis.
  function addToAllocation(balance, posting) {
    if (!balance.installments) balance.installments = [{...balance}];
    balance.installments.push(...(posting.installments || [posting]));
    balance.amount = (Math.round(balance.amount * 100) + Math.round(posting.amount * 100)) / 100;
    balance.rounding_cent = (balance.rounding_cent || 0) + (posting.rounding_cent || 0);
    if (posting.allocated_at >= balance.allocated_at) {
      balance.allocated_at = posting.allocated_at;
      balance.effective_minutes = posting.effective_minutes;
    }
  }

  function consolidateAllocations(db) {
    const balances = new Map();
    for (const row of db.TIP_ALLOCATION) {
      const key = row.pool_id + ":" + row.employee_id;
      const balance = balances.get(key);
      if (balance) addToAllocation(balance, row);
      else balances.set(key, row);
    }
    if (balances.size < db.TIP_ALLOCATION.length) db.TIP_ALLOCATION = [...balances.values()];
  }

  function allocateTips(poolId) {
    const st = getState();
    const pool = st.db.TIP_POOL.find(p => p.pool_id === poolId);
    if (!pool || ![1,2].includes(workingEmployee()?.role_id) || workingEmployee().employment_status !== "Active") return {ok:false,error:"This tip pool cannot be allocated."};
    const {remaining, shares} = tipPlan(pool);
    if (remaining <= 0 || !shares.length) return {ok:false,error:"There is no balance to allocate or no eligible time worked."};
    const rows = st.db.TIP_ALLOCATION;
    const timestamp = nowStamp();
    let id = nextId(rows.flatMap(row => [row, ...(row.installments || [])]), "allocation_id", 13041);
    for (const share of shares.filter(s => s.cents > 0)) {
      const posting = {amount:share.cents / 100, allocated_at:timestamp, effective_minutes:share.minutes, rounding_cent:share.roundingCent || 0};
      const balance = rows.find(a => a.pool_id === poolId && a.employee_id === share.id);
      if (balance) addToAllocation(balance, posting);
      else rows.push({allocation_id:id++, pool_id:poolId, employee_id:share.id, ...posting});
    }
    commit(st);
    return {ok:true};
  }

  function getMenuItem(id) {
    return getState().db.MENU_ITEM.find((m) => m.menu_item_id === Number(id));
  }
  function getCategory(id) {
    return getState().db.MENU_CATEGORY.find((c) => c.category_id === Number(id));
  }
  function getStation(id) {
    return getState().db.PREP_STATION.find((s) => s.station_id === Number(id));
  }
  function getEmployee(id) {
    return getState().db.EMPLOYEE.find((e) => e.employee_id === Number(id));
  }
  function getRole(id) {
    return getState().db.JOB_ROLE.find((r) => r.role_id === Number(id));
  }
  function getTable(id) {
    return getState().db.RESTAURANT_TABLE.find((t) => t.table_id === Number(id));
  }
  function getCustomer(id) {
    return getState().db.CUSTOMER.find((c) => c.customer_id === Number(id));
  }
  function getMembershipByCustomer(cid) {
    return getState().db.MEMBERSHIP.find((m) => m.customer_id === Number(cid));
  }

  function getActiveSessionForTable(tableId) {
    return getState().db.DINING_SESSION.find(
      (s) => s.table_id === Number(tableId) && s.session_status === "Active"
    );
  }

  function qrBinding() {
    const stored = sessionStorage.getItem(tableKey);
    if (stored) return JSON.parse(stored);
    const {db, loggedInCustomer} = getState();
    const bookings = new Set(db.RESERVATION.filter(r => loggedInCustomer && r.customer_id === loggedInCustomer.customer_id).map(r => r.reservation_id));
    const current = db.DINING_SESSION.filter(s => s.session_status === "Active" && bookings.has(s.reservation_id));
    if (current.length === 1) return {tableId:current[0].table_id, sessionId:current[0].session_id};
    return {tableId:null, sessionId:null};
  }

  function bindQrTable(tableId, expectedId) {
    const active = getActiveSessionForTable(tableId);
    const sessionId = expectedId ?? active?.session_id;
    sessionStorage.setItem(tableKey, JSON.stringify({tableId:Number(tableId), sessionId:sessionId ?? null}));
    return Boolean(active && sessionId === active.session_id);
  }

  function qrSession() {
    const bound = qrBinding();
    return getState().db.DINING_SESSION.find(s => s.session_id === bound.sessionId && s.table_id === bound.tableId);
  }

  function phoneDigits(value) {
    return String(value || "").replace(/[+\s().-]/g, "");
  }

  async function demoPasswordDigest(password, salt) {
    const bytes = new TextEncoder();
    if (!crypto.subtle) {
      const derived = await window.SmartDinePassword.derive(bytes.encode(password), bytes.encode(salt));
      return Array.from(derived, x => x.toString(16).padStart(2, "0")).join("");
    }
    const key = await crypto.subtle.importKey("raw", bytes.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({name:"PBKDF2", salt:bytes.encode(salt), iterations:160000, hash:"SHA-256"}, key, 256);
    return Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2,"0")).join("");
  }

  function escapeHtml(value) {
    const entities = {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"};
    return String(value ?? "").replace(/[&<>"']/g, ch => entities[ch]);
  }

  function getOrderForSession(sessionId) {
    return getState().db.ORDER.find((o) => o.session_id === Number(sessionId));
  }

  function customerReceipts() {
    const {db, loggedInCustomer} = getState();
    const customerId = loggedInCustomer?.customer_id;
    const bookings = new Set(customerId ? db.RESERVATION.filter(r => r.customer_id === customerId).map(r => r.reservation_id) : []);
    const sessions = new Set(db.DINING_SESSION.filter(s => bookings.has(s.reservation_id)).map(s => s.session_id));
    const bound = qrSession();
    if (bound) sessions.add(bound.session_id);
    const member = customerId && getMembershipByCustomer(customerId);
    const credited = new Set(member ? db.POINT_TRANSACTION.filter(p => p.membership_id === member.membership_id).map(p => p.order_id) : []);
    return db.ORDER.filter(o => o.order_status === "Paid" && (sessions.has(o.session_id) || credited.has(o.order_id)))
      .sort((a,b) => b.order_id - a.order_id);
  }

  function getSubOrdersForOrder(orderId) {
    return getState()
      .db.SUB_ORDER.filter((s) => s.order_id === Number(orderId))
      .sort((a, b) => a.sub_order_id - b.sub_order_id);
  }

  function getItemsForOrder(orderId) {
    const subs = getSubOrdersForOrder(orderId);
    const subIds = new Set(subs.map((s) => s.sub_order_id));
    return getState()
      .db.ORDER_ITEM.filter((i) => subIds.has(i.sub_order_id))
      .sort((a, b) => a.order_item_id - b.order_item_id);
  }

  function calcOrderSummary(orderId) {
    const st = getState();
    const order = st.db.ORDER.find((o) => o.order_id === Number(orderId));
    const items = getItemsForOrder(orderId);
    const activeItems = items.filter((i) => i.item_status !== "CANCELLED");
    const subtotal = round2(activeItems.reduce((sum, i) => sum + Number(i.unit_price), 0));
    const discount = order ? round2(order.discount_amount) : 0;
    const taxable = Math.max(0, round2(subtotal - discount));
    const tax = round2(taxable * 0.08);
    const totalBeforeTip = round2(taxable + tax);
    const payment = st.db.PAYMENT.find((p) => p.order_id === Number(orderId)) || null;
    const tip = payment ? round2(payment.tip_amount) : 0;
    const grandTotal = round2(totalBeforeTip + tip);
    return { order, items, activeItems, subtotal, discount, taxable, tax, totalBeforeTip, payment, tip, grandTotal };
  }

  function syncOrderAmounts(state, orderId) {
    const order = state.db.ORDER.find((o) => o.order_id === Number(orderId));
    if (!order) return;
    const subs = state.db.SUB_ORDER.filter((s) => s.order_id === Number(orderId));
    const subIds = new Set(subs.map((s) => s.sub_order_id));
    const activeItems = state.db.ORDER_ITEM.filter((i) => subIds.has(i.sub_order_id) && i.item_status !== "CANCELLED");
    const subtotal = round2(activeItems.reduce((s, i) => s + Number(i.unit_price), 0));
    const taxable = Math.max(0, round2(subtotal - Number(order.discount_amount || 0)));
    order.tax_amount = round2(taxable * 0.08);
    order.total_amount = round2(taxable + order.tax_amount);
  }

  // ---------- Domain Mutations (Cross-page Persistent) ----------
  function nextId(rows, pk, fallback) {
    if (!rows.length) return fallback;
    return Math.max(...rows.map((r) => Number(r[pk]) || 0)) + 1;
  }

  function submitSubOrder({ tableId, sessionId, channel, employeeId, cartItems }) {
    const st = getState();
    const table = st.db.RESTAURANT_TABLE.find((t) => t.table_id === Number(tableId));
    if (!table) return { ok: false, error: "Table not found." };
    if (channel === "Staff_POS" && getEmployee(employeeId)?.employment_status !== "Active") return {ok:false,error:"Select an active staff member."};
    const sess = st.db.DINING_SESSION.find((s) => s.table_id === table.table_id && s.session_status === "Active");
    if (!sess || (sessionId != null && sess.session_id !== sessionId)) {
      return {ok:false, error:"This table code has expired. Please check with the host."};
    }
    if (!cartItems || !cartItems.length) {
      return { ok: false, error: "Select at least one available item before submitting." };
    }

    for (const row of cartItems) {
      const dish = getMenuItem(row.menu_item_id);
      if (!dish || dish.availability !== "Available") return {ok: false, error: "An item in your cart is no longer available. Update your cart and try again."};
      if (!Number.isSafeInteger(row.qty) || row.qty < 1 || row.qty > 99) return {ok: false, error: "Choose between 1 and 99 of each item."};
    }
    let order = st.db.ORDER.find((o) => o.session_id === sess.session_id);
    if (order && order.order_status === "Paid") {
      return { ok: false, error: `Order #${order.order_id} has been paid. No items can be added.` };
    }

    if (!order) {
      const newOrderId = sess.session_id === 6003 ? 9003 : nextId(st.db.ORDER, "order_id", 9051);
      order = {
        order_id: newOrderId,
        session_id: sess.session_id,
        order_status: "Open",
        discount_amount: 0,
        tax_amount: 0,
        total_amount: 0,
      };
      st.db.ORDER.push(order);
    }

    const subId = nextId(st.db.SUB_ORDER, "sub_order_id", 10070);
    const sub = {
      sub_order_id: subId,
      order_id: order.order_id,
      employee_id: channel === "Staff_POS" ? Number(employeeId || 109) : null,
      channel: channel || "QR_Code",
      submitted_at: nowStamp(),
      status: "Preparing",
    };
    st.db.SUB_ORDER.push(sub);

    let nextItemId = Math.max(29001, nextId(st.db.ORDER_ITEM, "order_item_id", 20200));
    const createdItems = [];
    cartItems.forEach((ci) => {
      const mi = st.db.MENU_ITEM.find((m) => m.menu_item_id === Number(ci.menu_item_id));
      const qty = ci.qty;
      // BR-10: each portion is an independent ORDER_ITEM row with unit_price snapshot (FR-O07)
      for (let q = 0; q < qty; q++) {
        const oi = {
          order_item_id: nextItemId++,
          sub_order_id: subId,
          menu_item_id: mi.menu_item_id,
          unit_price: round2(mi.current_price),
          item_status: "QUEUED",
          notes: ci.notes ? String(ci.notes).trim() : null,
        };
        st.db.ORDER_ITEM.push(oi);
        createdItems.push(oi);
      }
    });


    table.table_status = "ORDERED";
    syncOrderAmounts(st, order.order_id);
    commit(st);
    return { ok: true, orderId: order.order_id, subOrderId: subId, count: createdItems.length };
  }

  function advanceOrderItemStatus(orderItemId, targetStatus) {
    const st = getState();
    const item = st.db.ORDER_ITEM.find((i) => i.order_item_id === Number(orderItemId));
    if (!item) return { ok: false, error: "Order item not found." };
    if (item.item_status === "CANCELLED") return { ok: false, error: "A cancelled item cannot change status." };

    const flow = ["QUEUED", "PREPARING", "READY", "SERVED"];
    const next = flow[flow.indexOf(item.item_status) + 1];
    if (!next || !flow.includes(item.item_status) || (targetStatus && targetStatus !== next)) {
      return {ok: false, error: "The item status has changed. Check its current status and try again."};
    }
    item.item_status = next;

    // Update SUB_ORDER status if all non-cancelled items are SERVED
    const sub = st.db.SUB_ORDER.find((s) => s.sub_order_id === item.sub_order_id);
    if (sub) {
      const sibs = st.db.ORDER_ITEM.filter((i) => i.sub_order_id === sub.sub_order_id && i.item_status !== "CANCELLED");
      sub.status = sibs.length && sibs.every((i) => i.item_status === "SERVED") ? "Served" : "Preparing";
    }
    commit(st);
    return { ok: true, item };
  }

  function cancelOrderItem(orderItemId) {
    const st = getState();
    const item = st.db.ORDER_ITEM.find((i) => i.order_item_id === Number(orderItemId));
    if (!item) return { ok: false, error: "Item not found." };
    const sub = st.db.SUB_ORDER.find((s) => s.sub_order_id === item.sub_order_id);
    const ord = sub ? st.db.ORDER.find((o) => o.order_id === sub.order_id) : null;
    if (ord && ord.order_status === "Paid") {
      return { ok: false, error: "Items on a paid order cannot be cancelled." };
    }
    if (item.item_status !== "QUEUED") {
      return {ok:false, error:"Preparation has started. This item can no longer be cancelled."};
    }
    item.item_status = "CANCELLED";
    if (ord) syncOrderAmounts(st, ord.order_id);
    commit(st);
    return { ok: true, item };
  }

  function settlePayment({ orderId, method, tipAmount, employeeId, membershipId, redeem100 }) {
    const st = getState();
    const ord = st.db.ORDER.find((o) => o.order_id === Number(orderId));
    if (!ord) return { ok: false, error: "Order not found." };
    if (ord.order_status === "Paid" || st.db.PAYMENT.some((p) => p.order_id === ord.order_id)) {
      return { ok: false, error: `Order #${ord.order_id} has already been paid.` };
    }

    if (!Number.isFinite(Number(tipAmount)) || Number(tipAmount) < 0) return {ok:false, error:"Enter a valid tip amount, or enter 0."};
    if (!calcOrderSummary(orderId).activeItems.length) return {ok:false, error:"There are no items to pay for."};
    const tip = round2(Number(tipAmount));
    let member = membershipId ? st.db.MEMBERSHIP.find((m) => m.membership_id === Number(membershipId)) : null;

    if (membershipId && !member) return {ok:false, error:"Member ID not found. Check the number and try again."};
    if (redeem100 && (!member || (employeeId == null && member.customer_id !== st.loggedInCustomer?.customer_id))) {
      return {ok:false, error:"Sign in to your own rewards account to redeem points."};
    }

    // Optional 100-point redemption ($10 discount) if member has >= 100 pts
    let redeemed = 0;
    if (member && redeem100) {
      if (member.points_balance < 100) {
        return { ok: false, error: `Member #${member.membership_id} has ${member.points_balance} points. At least 100 points are required.` };
      }
      ord.discount_amount = 10.0;
      redeemed = 100;
    } else {
      ord.discount_amount = Number(ord.discount_amount || 0);
    }
    syncOrderAmounts(st, ord.order_id);

    const payId = ord.order_id === 9003 ? 11003 : nextId(st.db.PAYMENT, "payment_id", 11050);
    const paidAt = nowStamp();
    const session = st.db.DINING_SESSION.find(s => s.session_id === ord.session_id);
    const serviceTime = session?.seated_at || paidAt;
    let pool = st.db.TIP_POOL.find(p => p.period_start <= serviceTime && serviceTime <= p.period_end);
    if (tip > 0 && !pool) {
      const day = serviceTime.slice(0, 10);
      const existing = st.db.TIP_POOL.filter(p => p.period_start.startsWith(day) || p.period_end.startsWith(day));
      const before = existing.map(p => p.period_end).filter(end => end < serviceTime).sort().pop();
      const after = existing.map(p => p.period_start).filter(start => start > serviceTime).sort()[0];
      const adjacent = (stamp, seconds) => {
        const time = new Date(stamp.replace(" ", "T"));
        time.setSeconds(time.getSeconds() + seconds);
        return day + " " + time.toTimeString().slice(0,8);
      };
      pool = {pool_id:nextId(st.db.TIP_POOL, "pool_id", 5011), period_start:before ? adjacent(before,1) : day + " 00:00:00",
        period_end:after ? adjacent(after,-1) : day + " 23:59:59", pool_total:0};
      st.db.TIP_POOL.push(pool);
    }
    const pay = {
      payment_id: payId,
      order_id: ord.order_id,
      employee_id: employeeId == null ? null : Number(employeeId),
      pool_id: tip > 0 ? pool.pool_id : null,
      amount: round2(ord.total_amount), // SQL convention: order total before tip; grand paid = amount + tip_amount
      tip_amount: tip,
      method: method || "Debit Card",
      paid_at: paidAt,
    };
    st.db.PAYMENT.push(pay);
    ord.order_status = "Paid";

    // Mark session table as PAID (NOT AVAILABLE yet! BR-05 / UC-11)
    const sess = st.db.DINING_SESSION.find((s) => s.session_id === ord.session_id);
    if (sess) {
      const tbl = st.db.RESTAURANT_TABLE.find((t) => t.table_id === sess.table_id);
      if (tbl) tbl.table_status = "PAID";
    }

    updatePoolTotals(st.db);

    // Bonus #2 Trigger simulation: Single membership POINT_TRANSACTION per order (FR-L03 / BR-17)
    let ptRec = null;
    if (member) {
      const earned = Math.round(ord.total_amount);
      const net = earned - redeemed;
      const ptId = ord.order_id === 9003 ? 12003 : nextId(st.db.POINT_TRANSACTION, "point_txn_id", 12030);
      ptRec = {
        point_txn_id: ptId,
        membership_id: member.membership_id,
        order_id: ord.order_id,
        earned_points: earned,
        redeemed_points: redeemed,
        net_change: net,
        created_at: paidAt,
      };
      st.db.POINT_TRANSACTION.push(ptRec);
      member.points_balance = Number(member.points_balance) + net;
    }

    commit(st);
    return { ok: true, payment: pay, pointTxn: ptRec, grandTotal: round2(pay.amount + pay.tip_amount) };
  }

  function seatGuest({ tableId, guestCount, reservationId, waitlistId }) {
    const st = getState();
    const tbl = st.db.RESTAURANT_TABLE.find((t) => t.table_id === Number(tableId));
    if (!tbl) return { ok: false, error: "Select a valid table." };
    if (tbl.table_status !== "AVAILABLE" && tbl.table_status !== "RESERVED") {
      return {ok:false, error:`${tbl.table_number} is unavailable. Choose a clean, available table.`};
    }
    if (st.db.DINING_SESSION.some((s) => s.table_id === tbl.table_id && s.session_status === "Active")) {
      return { ok: false, error: `Table ${tbl.table_number} already has an active dining session.` };
    }
    if (!Number.isInteger(Number(guestCount)) || Number(guestCount) < 1 || Number(guestCount) > 8) return {ok:false, error:"Each table can seat 1 to 8 guests."};
    const booking = reservationId ? st.db.RESERVATION.find(r => r.reservation_id === Number(reservationId)) : null;
    const waiting = waitlistId ? st.db.WAITLIST_ENTRY.find(w => w.waitlist_id === Number(waitlistId)) : null;
    if ((reservationId && booking?.status !== "Confirmed") || (waitlistId && waiting?.status !== "Waiting") || (reservationId && waitlistId)) {
      return {ok:false, error:"This reservation or waitlist entry has already been handled. Refresh the list."};
    }
    if (Number(guestCount) > tbl.capacity) {
      return { ok: false, error: `Party size (${guestCount}) exceeds the capacity of ${tbl.table_number} (${tbl.capacity} seats).` };
    }

    const sessId = nextId(st.db.DINING_SESSION, "session_id", 6051);
    const sess = {
      session_id: sessId,
      table_id: tbl.table_id,
      reservation_id: reservationId ? Number(reservationId) : null,
      waitlist_id: waitlistId ? Number(waitlistId) : null,
      seated_at: nowStamp(),
      left_at: null,
      guest_count: Number(guestCount),
      session_status: "Active",
    };
    st.db.DINING_SESSION.push(sess);
    tbl.table_status = "SEATED";

    if (reservationId) {
      const res = st.db.RESERVATION.find((r) => r.reservation_id === Number(reservationId));
      if (res) res.status = "Completed";
    }
    if (waitlistId) {
      const wl = st.db.WAITLIST_ENTRY.find((w) => w.waitlist_id === Number(waitlistId));
      if (wl) wl.status = "Seated";
    }
    commit(st);
    return { ok: true, session: sess, table: tbl };
  }

  function canCloseOrder(order) {
    if (!order || order.order_status === "Paid") return true;
    const items = getItemsForOrder(order.order_id);
    return items.length > 0 && items.every(i => i.item_status === "CANCELLED");
  }

  function markGuestLeft(tableId) {
    const st = getState();
    const tbl = st.db.RESTAURANT_TABLE.find((t) => t.table_id === Number(tableId));
    const sess = st.db.DINING_SESSION.find((s) => s.table_id === Number(tableId) && s.session_status === "Active");
    if (!tbl || !sess) return { ok: false, error: "There is no active visit at this table." };
    const ord = st.db.ORDER.find((o) => o.session_id === sess.session_id);
    if (!canCloseOrder(ord)) {
      return { ok: false, error: `Order #${ord.order_id} is unpaid. Settle the bill before confirming departure.` };
    }
    if (ord && ord.order_status !== "Paid") ord.order_status = "Cancelled";
    sess.left_at = nowStamp();
    sess.session_status = "Completed";
    tbl.table_status = "DIRTY"; // BR-05: must go through DIRTY before AVAILABLE
    commit(st);
    return { ok: true, table: tbl, session: sess };
  }

  function markTableCleaned(tableId) {
    const st = getState();
    const tbl = st.db.RESTAURANT_TABLE.find((t) => t.table_id === Number(tableId));
    if (!tbl) return { ok: false, error: "Table not found." };
    if (tbl.table_status !== "DIRTY" || getActiveSessionForTable(tableId)) return {ok:false, error:"Confirm the guests have left before marking the table clean."};
    tbl.table_status = "AVAILABLE";
    commit(st);
    return { ok: true, table: tbl };
  }

  // ---------- UI Helpers ----------
  const statuses = {
      AVAILABLE: ["badge-ok", "Available"],
      SEATED: ["badge-info", "Seated"],
      ORDERED: ["badge-burgundy", "Dining"],
      OCCUPIED: ["badge-burgundy", "Occupied"],
      PAID: ["badge-info", "Paid"],
      DIRTY: ["badge-warn", "Needs cleaning"],
      RESERVED: ["badge-gold", "Reserved"],
      BLOCKED: ["badge-neutral", "Inactive"],
      OPEN: ["badge-warn", "Open"],
      ACTIVE: ["badge-ok", "Open"],
      COMPLETED: ["badge-neutral", "Completed"],
      CONFIRMED: ["badge-ok", "Confirmed"],
      CANCELLED: ["badge-danger", "Cancelled"],
      WAITING: ["badge-warn", "Waiting"],
      QUEUED: ["badge-neutral", "Queued"],
      PREPARING: ["badge-warn", "Preparing"],
      COOKING: ["badge-warn", "Preparing"],
      READY: ["badge-ok", "Ready to serve"],
      SERVED: ["badge-info", "Served"],
      GOLD: ["badge-gold", "Gold member"],
      SCHEDULED: ["badge-info", "Scheduled"],
      "NO-SHOW": ["badge-neutral","No-show"],
      "NO_SHOW": ["badge-neutral","No-show"],
      "UNAVAILABLE": ["badge-danger", "Unavailable"],
    };
  function statusLabel(status) {
    return statuses[String(status).toUpperCase()]?.[1] || String(status || "");
  }

  function memberTier(member) {
    return member.member_status === "Active" ? "Standard" : member.member_status;
  }

  function statusBadge(status) {
    const hit = statuses[String(status).toUpperCase()] || ["badge-neutral", status];
    return `<span class="badge ${hit[0]}">${escapeHtml(hit[1])}</span>`;
  }

  function toast(msg, type) {
    let box = document.getElementById("sd-toast-container");
    if (!box) {
      box = document.createElement("div");
      box.id = "sd-toast-container";
      box.className = "toast-container";
      document.body.appendChild(box);
    }
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function formatWorkMinutes(minutes) {
    if (minutes > 0 && minutes < 1 / 60) return "Under 1 sec";
    if (minutes > 0 && minutes < 1) return round2(minutes * 60) + " sec";
    return round2(minutes) + " min";
  }

  function formatWorkHours(minutes) {
    return minutes > 0 && minutes < 60 ? formatWorkMinutes(minutes) : (minutes / 60).toFixed(2) + " hours";
  }

  function countLabel(count, singular, plural = singular + "s") {
    return count + " " + (Number(count) === 1 ? singular : plural);
  }

  function formatMoney(v) {
    return "$" + round2(v).toFixed(2);
  }

  // ---------- Shared Chrome & Shell Renderer ----------
  const PUBLIC_NAV = [
    { href: "index.html", id: "index", label: "Home" },
    { href: "reservations.html", id: "reservations", label: "Reservations" },
    { href: "waitlist.html", id: "waitlist", label: "Waitlist" },
    { href: "qr-order.html", id: "qr-order", label: "Order at table" },
    { href: "customer-center.html", id: "customer-center", label: "My dining" },
    { href: "cashier.html?mode=self", id: "cashier", label: "Table checkout" },
    { href: "auth.html", id: "auth", label: "Sign in / Register" },
  ];

  const STAFF_NAV = [
    { section: "Service", items: [
      { href: "host.html", id: "host", label: "Host station" },
      { href: "server.html", id: "server", label: "Server POS" },
      { href: "kitchen.html", id: "kitchen", label: "Kitchen" },
      { href: "cashier.html", id: "cashier", label: "Checkout" },
      { href: "staff-profile.html", id: "staff-profile", label: "My work" },
    ]},
    { section: "Management", items: [
      { href: "manager-dashboard.html", id: "manager-dashboard", label: "Manager overview" },
      { href: "manager-ops.html", id: "manager-ops", label: "Operations" },
      { href: "manager-tips.html", id: "manager-tips", label: "Tip allocation" },
    ]},
    { section: "Guest services", items: [
      { href: "index.html", id: "index", label: "Restaurant home" },
      { href: "qr-order.html", id: "qr-order", label: "Tableside menu" },
      { href: "auth.html", id: "auth", label: "Sign in / Register" },
    ]},
  ];

  const STAFF_ENTRIES = {
    1: ["manager-dashboard", "manager-ops", "manager-tips", "host", "server", "cashier", "kitchen"],
    2: ["manager-dashboard", "manager-ops", "manager-tips", "host", "server", "cashier", "kitchen"],
    3: ["server", "cashier"],
    4: ["host"],
    5: ["kitchen"],
    6: ["kitchen"]
  };

  function workingEmployee() {
    const login = getState().loggedInEmployee;
    return login && getEmployee(login.employee_id);
  }

  function reportQueryTime(milliseconds) {
    const output = document.querySelector("#sd-query-time");
    if (!output) return;
    output.hidden = !Number.isFinite(milliseconds) || milliseconds < 0;
    output.textContent = output.hidden ? "" : "Query time " + milliseconds.toFixed(1) + " ms";
  }

  function renderFooter() {
    return `<footer class="site-footer"><strong>${BRAND.name}</strong><span id="sd-query-time" hidden></span><a href="reservations.html">Book a table</a></footer>`;
  }

  function initShell(config) {
    const st = getState();
    document.title = document.title.replace(/SmartDine/g, BRAND.name);
    document.querySelectorAll("[data-restaurant-name]").forEach(node => node.textContent = BRAND.name);
    const employee = workingEmployee();
    const allowed = new Set([...(STAFF_ENTRIES[employee?.role_id] || []), "staff-profile"]);
    const hostReceipt = config.activePage === "cashier" && config.dbRole === "host" && employee?.role_id === 4;
    if (config.mode !== "public" &&
        (!employee || employee.employment_status !== "Active" || (!allowed.has(config.activePage) && !hostReceipt))) {
      location.replace(employee?.employment_status === "Active" ? (STAFF_ENTRIES[employee.role_id]?.[0] || "staff-profile") + ".html" : "auth.html?role=staff");
      return false;
    }

    if (employee && config.mode !== "public") {
      for (const link of document.querySelectorAll('main a[href], .topbar-actions a[href]')) {
        const url = new URL(link.href);
        const page = url.pathname.split("/").pop().replace(".html", "");
        if (STAFF_NAV[0].items.concat(STAFF_NAV[1].items).some(it => it.id === page) &&
            !allowed.has(page) && !(page === "cashier" && url.searchParams.get("mode") === "receipt")) link.remove();
      }
    }
    if (config.mode === "public") {
      const hdrSlot = document.getElementById("sd-header");
      if (hdrSlot) {
        const navHtml = PUBLIC_NAV.filter(n => n.id !== "auth" || (!st.loggedInCustomer && !employee)).map(
          (n) => `<a href="${n.href}" class="${config.activePage === n.id ? "active" : ""}">${n.label}</a>`
        ).join("");
        const userChip = st.loggedInCustomer
          ? `<a href="customer-center.html" class="badge badge-gold">👤 ${escapeHtml(st.loggedInCustomer.name)} (${escapeHtml(st.loggedInCustomer.primary_phone)})</a>`
          : employee ? `<a class="badge badge-neutral" href="${(STAFF_ENTRIES[employee.role_id] || ["staff-profile"])[0]}.html">My workspace</a>` : "";
        hdrSlot.innerHTML = `
          <header class="public-header">
            <div class="public-header-inner">
              <a class="brand-lockup" href="index.html">
                <span class="brand-mark">${escapeHtml(BRAND.name.charAt(0))}</span>
                <span>
                  <span class="brand-title">${BRAND.name}</span><br/>
                  <span class="brand-sub">${BRAND.tagline}</span>
                </span>
              </a>
              <nav class="public-nav">${navHtml}</nav>
              <div class="account-actions">${userChip}${st.loggedInCustomer ? '<button class="btn btn-sm btn-ghost" id="sd-signout" type="button">Sign out</button>' : ''}</div>
            </div>
          </header>
        `;
      }
      const ftrSlot = document.getElementById("sd-footer");
      if (ftrSlot) ftrSlot.innerHTML = renderFooter();
    } else {
      const sideSlot = document.getElementById("sd-sidebar");
      if (sideSlot) {
        const emp = employee;
        const roleObj = emp ? getRole(emp.role_id) : null;
        const navBlocks = STAFF_NAV.map((sec) => {
          const items = sec.items.filter(it => !employee || sec.section === "Guest services" || allowed.has(it.id))
            .map((it) => `<li><a href="${it.href}" class="${config.activePage === it.id ? "active" : ""}"><span>${it.label}</span></a></li>`)
            .join("");
          if (!items) return "";
          return `<div class="sidebar-section-title">${sec.section}</div><ul class="sidebar-nav">${items}</ul>`;
        }).join("");
        sideSlot.innerHTML = `
          <div class="sidebar-brand">
            <span class="brand-mark">${escapeHtml(BRAND.name.charAt(0))}</span>
            <div>
              <div class="brand-title">${BRAND.name}</div>
              <div class="brand-sub">Restaurant operations</div>
            </div>
          </div>
          <button type="button" class="staff-nav-toggle" aria-expanded="false">Workspace menu</button>
          <div class="sidebar-role-badge">
            <div class="role-name">${config.portalLabel || "Staff workspace"}</div>
            <div class="role-meta">${escapeHtml(emp.employee_name)} · ${roleObj ? roleObj.role_name : ""}</div>
          </div>
          ${employee ? '<button class="btn btn-sm" id="sd-signout">Sign out</button>' : ""}
          ${navBlocks}
        `;
      }
      const ftrSlot = document.getElementById("sd-footer");
      if (ftrSlot) ftrSlot.innerHTML = renderFooter();
    }

    const toggle = document.querySelector(".staff-nav-toggle");
    if (toggle) toggle.onclick = () => {
      const opened = toggle.closest(".sidebar").classList.toggle("show-nav");
      toggle.setAttribute("aria-expanded", String(opened));
    };
    const signout = document.getElementById("sd-signout");
    if (signout) signout.onclick = () => {
      const current = getState();
      current.loggedInCustomer = null;
      current.loggedInEmployee = null;
      current.currentCustomerId = null;
      commit(current);
      location.href = "auth.html";
    };

    function refresh() {
      if (config.onStateChange) config.onStateChange();
    }
    window.addEventListener("storage", event => {
      if (event.key !== STORAGE_KEY) return;
      const previous = getState();
      window.__SMARTDINE_STATE = loadState();
      const next = getState();
      if (previous.loggedInCustomer?.customer_id !== next.loggedInCustomer?.customer_id ||
          previous.loggedInEmployee?.employee_id !== next.loggedInEmployee?.employee_id ||
          (employee && getEmployee(employee.employee_id)?.employment_status !== employee.employment_status)) {
        location.reload();
      } else refresh();
    });
    window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
    const shell = document.querySelector(".app-shell");
    if (shell) shell.hidden = false;
    return true;


  }

  window.SmartDineApp = {
    BRAND,
    getState,
    reloadStoredState() { window.__SMARTDINE_STATE = loadState(); },
    commit,
    getMenuItem,
    getCategory,
    getStation,
    getEmployee,
    getRole,
    getTable,
    getCustomer,
    getMembershipByCustomer,
    getActiveSessionForTable,
    getOrderForSession,
    bindQrTable,
    qrBinding,
    businessAction, attendance, allocateTips, tipPlan,
    canCloseOrder,
    reportQueryTime,
    workingEmployee,
    demoPasswordDigest,
    phoneDigits,
    qrSession,
    escapeHtml,
    getSubOrdersForOrder,
    customerReceipts,
    getItemsForOrder,
    calcOrderSummary,
    syncOrderAmounts,
    nextId,
    submitSubOrder,
    advanceOrderItemStatus,
    cancelOrderItem,
    settlePayment,
    seatGuest,
    markGuestLeft,
    markTableCleaned,
    statusBadge,
    statusLabel,
    memberTier,
    toast,
    formatWorkMinutes,
    formatWorkHours,
    countLabel,
    formatMoney,
    round2,
    nowStamp,
    initShell,
  };
})();
