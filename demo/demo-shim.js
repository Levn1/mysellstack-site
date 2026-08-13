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

  var qs = new URLSearchParams(window.location.search);
  var STATE = (window.__BW_DEMO_STATE__ = {
    theme: qs.get("theme") || "aurora",
    product: qs.get("product") || "15000934023279",
    seq: 0,
  });

  var DAY = 24 * 3600 * 1000;
  var serviceToProduct = {};
  Object.keys(DATA.products).forEach(function (pid) {
    serviceToProduct[DATA.products[pid].config.service.id] = pid;
  });

  function themedServiceImage(kind, theme) {
    var a = (theme && theme.headerBgColor) || "#355C55";
    var b = (theme && theme.primaryColor) || "#6F9F8E";
    var fg = (theme && theme.headerTextColor) || "#ffffff";
    var defs =
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + a + '"/>' +
      '<stop offset="1" stop-color="' + b + '"/>' +
      "</linearGradient></defs>";
    var glyph;
    if (kind === "events") {
      glyph =
        '<circle cx="240" cy="190" r="58" fill="' + fg + '" opacity=".95"/>' +
        '<g stroke="' + fg + '" stroke-width="13" stroke-linecap="round" opacity=".8">' +
        '<path d="M240 96v-26M306 122l19-19M332 190h26M306 258l19 19M174 122l-19-19M148 190h-26M174 258l-19 19"/></g>' +
        '<path d="M118 400c42-62 82-38 122-38s80-24 122 38c-48 22-92 30-122 30s-74-8-122-30z" fill="' + fg + '" opacity=".92"/>';
    } else {
      glyph =
        '<g fill="' + fg + '" opacity=".94">' +
        '<ellipse cx="240" cy="322" rx="118" ry="44"/>' +
        '<ellipse cx="240" cy="256" rx="92" ry="37" opacity=".85"/>' +
        '<ellipse cx="240" cy="200" rx="64" ry="29" opacity=".75"/></g>' +
        '<g stroke="' + fg + '" stroke-width="11" stroke-linecap="round" fill="none" opacity=".9">' +
        '<path d="M152 124c14-26 34-26 48 0M218 100c14-26 34-26 48 0M284 124c14-26 34-26 48 0"/></g>';
    }
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480">' +
      defs + '<rect width="480" height="480" fill="url(#g)"/>' + glyph + "</svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

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
      cfg.service.imageUrl = themedServiceImage(p.kind, cfg.theme);
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

})();
