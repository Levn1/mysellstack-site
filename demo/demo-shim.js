// Demo transport for the REAL booking widget.
//
// The widget bundle (demo/widget.js — the exact asset the theme extension
// ships) talks to Shopify's app proxy at /apps/booking/*. On this static
// site there is no proxy, so this shim, loaded BEFORE the widget, patches
// window.fetch to answer those requests locally:
//   /config        -> captured real config, with the demo's selected theme
//   /availability  -> slot patterns captured from the demo shop, replayed
//                     onto whatever date window the widget asks for (the
//                     cycle length is a multiple of 7, so weekday rhythms
//                     are preserved and the demo never goes stale)
//   /holds, /book  -> pretend success after a realistic pause
// Everything else on the page fetches normally. Bookings made here go
// nowhere: nothing is stored and no email is sent.
(function () {
  "use strict";
  var DATA = window.__BW_DEMO_DATA__;
  if (!DATA) return;

  var STATE = (window.__BW_DEMO_STATE__ = {
    theme: "aurora",
    product: "15000934023279",
    seq: 0,
  });

  var DAY = 24 * 3600 * 1000;
  var serviceToProduct = {};
  Object.keys(DATA.products).forEach(function (pid) {
    serviceToProduct[DATA.products[pid].config.service.id] = pid;
  });

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function pause() {
    return new Promise(function (r) {
      setTimeout(r, 220 + Math.random() * 260);
    });
  }

  // Replay captured slot tuples onto [from, to]. Tuples are
  // [dayOffset, minutesUTC, durationMin, staffIdx|spots] relative to the
  // capture window's first UTC midnight (baseMs); the position of any
  // real date inside the repeating cycle keeps weekdays aligned because
  // cycleDays is a multiple of 7.
  function expandSlots(pid, fromISO, toISO, staffId) {
    var p = DATA.products[pid];
    var from = new Date(fromISO).getTime();
    var to = new Date(toISO).getTime();
    var lead = Date.now() + 2 * 3600 * 1000; // nothing bookable in the next 2h
    var out = [];
    var startDay = Math.floor((from - p.baseMs) / DAY) - 1;
    var endDay = Math.ceil((to - p.baseMs) / DAY) + 1;
    for (var d = startDay; d <= endDay; d++) {
      var pos = ((d % p.cycleDays) + p.cycleDays) % p.cycleDays;
      var dayStart = p.baseMs + d * DAY;
      for (var i = 0; i < p.slots.length; i++) {
        var t = p.slots[i];
        if (t[0] !== pos) continue;
        var startsAt = dayStart + t[1] * 60000;
        var endsAt = startsAt + t[2] * 60000;
        if (startsAt < from || startsAt > to || startsAt < lead) continue;
        var staff = p.config.staff;
        if (p.kind === "events") {
          out.push({
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            staffId: staff[0] ? staff[0].id : null,
            staffIds: staff.map(function (s) { return s.id; }),
            staffMode: "co_teaching",
            eventId: "demo_evt_" + d + "_" + t[1],
            availableSpots: t[3],
          });
        } else {
          var member = staff[t[3]] || staff[0];
          if (staffId && (!member || member.id !== staffId)) continue;
          out.push({
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            staffId: member ? member.id : null,
            staffIds: member ? [member.id] : [],
            staffMode: "specific",
            eventId: null,
            availableSpots: 1,
          });
        }
      }
    }
    out.sort(function (a, b) { return a.startsAt < b.startsAt ? -1 : 1; });
    return out;
  }

  function route(u) {
    var path = u.pathname.replace(/^\/apps\/booking/, "");
    if (path === "/config") {
      var pid = u.searchParams.get("product_id") || STATE.product;
      var p = DATA.products[pid];
      if (!p) return jsonResponse({ bookable: false }, 200);
      var cfg = JSON.parse(JSON.stringify(p.config));
      cfg.theme = Object.assign({}, cfg.theme, DATA.themes[STATE.theme] || {});
      // Keep the whole flow on-page: pay-on-arrival confirms through
      // /book (which we fake) instead of adding to a Shopify cart that
      // does not exist here.
      cfg.service.noCheckoutMode = "pay_on_arrival";
      // Show more of the product in the demo: the solo service gets the
      // customer-facing staff picker, and both carry a service image.
      if (p.kind === "open") cfg.service.staffSelection = "customer_picks";
      if (p.image) cfg.service.imageUrl = p.image;
      return jsonResponse(cfg);
    }
    if (path === "/availability") {
      var sid = u.searchParams.get("service_id");
      var owner = serviceToProduct[sid];
      if (!owner) return jsonResponse({ slots: [] });
      return jsonResponse({
        slots: expandSlots(
          owner,
          u.searchParams.get("from"),
          u.searchParams.get("to"),
          u.searchParams.get("staff_id"),
        ),
      });
    }
    if (path === "/holds") {
      STATE.seq += 1;
      return jsonResponse({
        holdId: "demo_hold_" + STATE.seq,
        signature: "demo",
        expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      });
    }
    if (path === "/book") {
      return jsonResponse({ ok: true, bookingId: "demo_booking_" + STATE.seq });
    }
    if (path === "/next-slots") return jsonResponse({ services: {} });
    if (path === "/bookable-products") return jsonResponse({ products: [] });
    if (path === "/services-directory") return jsonResponse({ services: [], display: {} });
    return jsonResponse({ error: "demo: unknown endpoint" }, 404);
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/apps/booking/") !== 0) return realFetch(input, init);
    var u = new URL(url, window.location.origin);
    return pause().then(function () { return route(u); });
  };

  // (Re)mount the widget for the current product + theme. The bundle
  // guards against double-init with a window flag, so a remount resets
  // the flag, swaps in a fresh container, and re-executes the script.
  window.__BW_DEMO_REMOUNT__ = function () {
    var holder = document.getElementById("demo-widget-holder");
    if (!holder) return;
    var p = DATA.products[STATE.product];
    holder.innerHTML = "";
    var el = document.createElement("div");
    el.setAttribute("data-booking-widget-inline", "");
    el.setAttribute("data-product-id", STATE.product);
    el.setAttribute("data-product-price", p.price);
    el.setAttribute("data-product-price-cents", String(p.cents));
    el.setAttribute("data-product-currency", "USD");
    holder.appendChild(el);
    window.__bw_widget_initialized__ = false;
    STATE.seq += 1;
    var s = document.createElement("script");
    s.src = "demo/widget.js?remount=" + STATE.seq;
    document.body.appendChild(s);
  };
})();
