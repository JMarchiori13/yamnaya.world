(() => {
  "use strict";

  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
  ];
  const NOMINATIM = "https://nominatim.openstreetmap.org";
  const OVERPASS_TIMEOUT_MS = 30000;
  const OVERPASS_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

  const STORE = {
    get(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
    del(key) {
      try { localStorage.removeItem(key); } catch {}
    },
  };

  function geohash5(lat, lon) {
    return `${lat.toFixed(3)},${lon.toFixed(3)}`;
  }
  function overpassCacheKey(lat, lon, radius) {
    return `cache:overpass:${geohash5(lat, lon)}:${radius}`;
  }
  function readOverpassCache(lat, lon, radius) {
    const entry = STORE.get(overpassCacheKey(lat, lon, radius));
    if (!entry || !entry.ts || !entry.data) return null;
    const age = Date.now() - entry.ts;
    if (age > OVERPASS_CACHE_TTL_MS) return null;
    return { data: entry.data, ageMs: age };
  }
  function writeOverpassCache(lat, lon, radius, data) {
    STORE.set(overpassCacheKey(lat, lon, radius), { data, ts: Date.now() });
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function getFavorites() { return STORE.get("favorites") || {}; }
  function isFavorite(id) { return Boolean(getFavorites()[id]); }
  function toggleFavorite(item) {
    const favs = getFavorites();
    if (favs[item.id]) {
      delete favs[item.id];
    } else {
      favs[item.id] = {
        id: item.id,
        name: item.name,
        lat: item.lat,
        lon: item.lon,
        category: item.category,
        phone: item.phone,
        website: item.website,
        opening: item.opening,
        address: item.address,
        tags: item.tags,
        savedAt: Date.now(),
      };
    }
    STORE.set("favorites", favs);
  }

  const els = {
    map: document.getElementById("map"),
    results: document.getElementById("results"),
    status: document.getElementById("status"),
    locate: document.getElementById("locate"),
    radius: document.getElementById("radius"),
    searchForm: document.getElementById("searchForm"),
    searchInput: document.getElementById("searchInput"),
    suggestions: document.getElementById("suggestions"),
    filters: document.getElementById("filters"),
    sortBy: document.getElementById("sortBy"),
  };

  const FILTERS = [
    { id: "all", label: "Todos" },
    { id: "favorites", label: "⭐ Favoritos", special: "favorites" },
    { id: "openNow", label: "🟢 Aberto agora", special: "openNow" },
    { id: "wheelchair", label: "♿ Acessível", tagTest: (t) => t.wheelchair === "yes" || t.wheelchair === "limited" },
    { id: "female", label: "♀ Feminino", tagTest: (t) => t.female === "yes", keywords: ["feminin", "women only", "mulheres", "só mulher"] },
    { id: "thai", label: "Tailandesa", keywords: ["thai", "tailandes"] },
    { id: "swedish", label: "Sueca", keywords: ["swedish", "sueca", "sueco"] },
    { id: "shiatsu", label: "Shiatsu", keywords: ["shiatsu"] },
    { id: "relax", label: "Relaxante", keywords: ["relax"] },
    { id: "reflex", label: "Reflexologia", keywords: ["reflex"] },
    { id: "lymph", label: "Drenagem linfática", keywords: ["lymph", "linfátic", "linfatic", "drenagem"] },
    { id: "tantric", label: "Tântrica", keywords: ["tantric", "tântric"] },
    { id: "ayurveda", label: "Ayurveda", keywords: ["ayurved"] },
    { id: "hotstone", label: "Pedras quentes", keywords: ["hot stone", "hot-stone", "pedras quentes", "pedra quente"] },
    { id: "chair", label: "Quick/Cadeira", keywords: ["quick massage", "chair massage", "cadeira"] },
    { id: "spa", label: "Spa", categories: ["Spa", "Sauna"] },
  ];
  let activeFilter = "all";
  let rawItems = [];
  let origin = null;

  const map = L.map(els.map, { zoomControl: true }).setView([-14.235, -51.9253], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const LocateControl = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create("button", "leaflet-bar locate-btn");
      btn.type = "button";
      btn.title = "Centralizar em mim";
      btn.innerHTML = "⌖";
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, "click", () => {
        if (userMarker) {
          const { lat, lng } = userMarker.getLatLng();
          map.setView([lat, lng], Math.max(map.getZoom(), 15));
        } else {
          locateMe();
        }
      });
      return btn;
    },
  });
  new LocateControl({ position: "topleft" }).addTo(map);

  const userIcon = L.divIcon({
    className: "user-marker",
    html: '<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 3px rgba(59,130,246,0.35);"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

  const placeIcon = L.divIcon({
    className: "place-marker",
    html: '<div style="font-size:22px;line-height:22px;">💆</div>',
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  });

  let userMarker = null;
  let searchCircle = null;
  const markers = new Map();
  let currentItems = [];

  function setStatus(msg, kind = "") {
    els.status.className = "status" + (kind ? " " + kind : "");
    els.status.innerHTML = msg;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function formatDistance(m) {
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
  }

  function tagsToCategory(tags = {}) {
    if (tags.shop === "massage") return "Massagem";
    if (tags.leisure === "spa" || tags.amenity === "spa") return "Spa";
    if (tags.amenity === "sauna") return "Sauna";
    if (tags.amenity === "massage" || tags.craft === "massage") return "Massagem";
    if (tags.healthcare === "massage") return "Massoterapia";
    return "Bem-estar";
  }

  const CURRENCY_SYMBOLS = { BRL: "R$", USD: "US$", EUR: "€", GBP: "£" };

  const DOW = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

  function parseDayToken(token) {
    const days = new Set();
    for (const part of token.split(",")) {
      const p = part.trim();
      if (p.includes("-")) {
        const [a, b] = p.split("-").map((x) => x.trim());
        if (DOW[a] == null || DOW[b] == null) return null;
        let d = DOW[a];
        for (let i = 0; i < 7; i++) {
          days.add(d);
          if (d === DOW[b]) break;
          d = (d + 1) % 7;
        }
      } else {
        if (DOW[p] == null) return null;
        days.add(DOW[p]);
      }
    }
    return days;
  }

  function parseOpeningHours(str, now = new Date()) {
    if (!str || typeof str !== "string") return { state: "unknown" };
    const s = str.trim();
    if (!s) return { state: "unknown" };
    if (s === "24/7") return { state: "open", always: true };

    const dow = now.getDay();
    const minutes = now.getHours() * 60 + now.getMinutes();

    let foundOpen = false;
    let nextClose = null;
    let nextOpen = null;

    for (const rule of s.split(";").map((x) => x.trim()).filter(Boolean)) {
      const idx = rule.search(/\d/);
      if (idx === -1) continue;
      const daysPart = rule.slice(0, idx).trim();
      const timesPart = rule.slice(idx).trim();

      let days;
      if (!daysPart) {
        days = new Set([0, 1, 2, 3, 4, 5, 6]);
      } else {
        days = parseDayToken(daysPart);
        if (!days) return { state: "unknown" };
      }
      if (!days.has(dow)) continue;

      for (const range of timesPart.split(",").map((x) => x.trim())) {
        const m = range.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
        if (!m) return { state: "unknown" };
        const startMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        let endMin = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
        if (endMin === 0) endMin = 24 * 60;
        if (endMin <= startMin) endMin = 24 * 60;
        if (minutes >= startMin && minutes < endMin) {
          foundOpen = true;
          if (nextClose == null || endMin < nextClose) nextClose = endMin;
        } else if (minutes < startMin) {
          if (nextOpen == null || startMin < nextOpen) nextOpen = startMin;
        }
      }
    }

    if (foundOpen) return { state: "open", closesAtMin: nextClose };
    if (nextOpen != null) return { state: "closed", opensAtMin: nextOpen };
    return { state: "closed" };
  }

  function formatTime(min) {
    const h = String(Math.floor(min / 60) % 24).padStart(2, "0");
    const m = String(min % 60).padStart(2, "0");
    return `${h}:${m}`;
  }

  function openingBadgeHtml(str, now = new Date()) {
    const r = parseOpeningHours(str, now);
    if (r.state === "open") {
      if (r.always) return `<span class="open-now">🟢 Aberto 24h</span>`;
      if (r.closesAtMin != null) return `<span class="open-now">🟢 Aberto · fecha ${formatTime(r.closesAtMin)}</span>`;
      return `<span class="open-now">🟢 Aberto</span>`;
    }
    if (r.state === "closed") {
      if (r.opensAtMin != null) return `<span class="closed">🔴 Fechado · abre ${formatTime(r.opensAtMin)}</span>`;
      return `<span class="closed">🔴 Fechado</span>`;
    }
    return null;
  }

  function isOpenNow(str, now = new Date()) {
    return parseOpeningHours(str, now).state === "open";
  }

  function priceLabel(tags = {}) {
    if (tags.fee === "no") return "Grátis";
    const value = tags.charge || (tags.fee && tags.fee !== "yes" ? tags.fee : null);
    if (!value) return null;
    const currency = tags["fee:currency"] || tags["charge:currency"];
    if (currency && !/[^\d]/.test(value)) {
      const sym = CURRENCY_SYMBOLS[currency] || currency;
      return `${sym} ${value}`;
    }
    return value;
  }

  function cityFromTags(tags = {}) {
    return tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || tags["addr:suburb"] || "";
  }

  function googleReviewUrl(item) {
    const q = [item.name, cityFromTags(item.tags)].filter(Boolean).join(" ");
    const query = q ? `${q} ${item.lat},${item.lon}` : `${item.lat},${item.lon}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  const NAME_STOPWORDS = /\b(massagem|massage|spa|clinica|clínica|center|centro|studio|estudio|terapia|therapy|casa|house)\b/gi;
  function normalizeName(name) {
    return (name || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(NAME_STOPWORDS, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function dedupFuzzy(items) {
    const out = [];
    for (const item of items) {
      const norm = normalizeName(item.name);
      if (!norm) { out.push(item); continue; }
      const dup = out.find((other) =>
        normalizeName(other.name) === norm &&
        haversine(item.lat, item.lon, other.lat, other.lon) < 50
      );
      if (!dup) {
        out.push(item);
        continue;
      }
      const itemTags = Object.keys(item.tags || {}).length;
      const dupTags = Object.keys(dup.tags || {}).length;
      if (itemTags > dupTags) {
        const idx = out.indexOf(dup);
        out[idx] = item;
      }
    }
    return out;
  }

  function tripadvisorSearchUrl(item) {
    const q = [item.name, cityFromTags(item.tags)].filter(Boolean).join(" ");
    return `https://www.tripadvisor.com/Search?q=${encodeURIComponent(q || item.name)}`;
  }

  function formatAddress(tags = {}) {
    const parts = [];
    const street = tags["addr:street"];
    const num = tags["addr:housenumber"];
    if (street) parts.push(num ? `${street}, ${num}` : street);
    if (tags["addr:suburb"]) parts.push(tags["addr:suburb"]);
    if (tags["addr:city"]) parts.push(tags["addr:city"]);
    if (tags["addr:state"]) parts.push(tags["addr:state"]);
    return parts.join(" · ");
  }

  function buildOverpassQuery(lat, lon, radius) {
    return `
      [out:json][timeout:25];
      (
        node(around:${radius},${lat},${lon})[shop=massage];
        way(around:${radius},${lat},${lon})[shop=massage];
        node(around:${radius},${lat},${lon})[amenity=massage];
        way(around:${radius},${lat},${lon})[amenity=massage];
        node(around:${radius},${lat},${lon})[craft=massage];
        way(around:${radius},${lat},${lon})[craft=massage];
        node(around:${radius},${lat},${lon})[healthcare=massage];
        way(around:${radius},${lat},${lon})[healthcare=massage];
        node(around:${radius},${lat},${lon})[leisure=spa];
        way(around:${radius},${lat},${lon})[leisure=spa];
        node(around:${radius},${lat},${lon})[amenity=spa];
        way(around:${radius},${lat},${lon})[amenity=spa];
      );
      out center tags;
    `;
  }

  let currentOverpassController = null;

  async function overpassFetch(endpoint, query, signal) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
      signal,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function overpassQuery(query) {
    if (currentOverpassController) currentOverpassController.abort();
    currentOverpassController = new AbortController();
    const { signal } = currentOverpassController;
    const timeoutId = setTimeout(() => currentOverpassController.abort(), OVERPASS_TIMEOUT_MS);

    let lastErr;
    const backoff = [0, 500, 1000, 2000];
    try {
      for (let attempt = 0; attempt < backoff.length; attempt++) {
        const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
        if (attempt > 0) {
          const jitter = Math.floor(Math.random() * 250);
          await sleep(backoff[attempt] + jitter);
        }
        if (signal.aborted) throw new Error("Busca cancelada");
        try {
          return await overpassFetch(endpoint, query, signal);
        } catch (err) {
          if (err.name === "AbortError") throw new Error("Tempo esgotado");
          lastErr = err;
        }
      }
      throw lastErr || new Error("Falha ao consultar Overpass");
    } finally {
      clearTimeout(timeoutId);
      currentOverpassController = null;
    }
  }

  function normalizeElement(el) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) return null;
    const tags = el.tags || {};
    return {
      id: `${el.type}/${el.id}`,
      lat,
      lon,
      name: tags.name || tags["name:pt"] || "Sem nome",
      category: tagsToCategory(tags),
      phone: tags.phone || tags["contact:phone"],
      website: tags.website || tags["contact:website"],
      opening: tags.opening_hours,
      address: formatAddress(tags),
      tags,
    };
  }

  const HIDDEN_FROM_TAGS = new Set(["all", "openNow", "favorites"]);
  function detectedTypes(item) {
    return FILTERS
      .filter((f) => !HIDDEN_FROM_TAGS.has(f.id) && matchesFilter(item, f.id))
      .map((f) => f.label);
  }

  function clearMarkers() {
    for (const m of markers.values()) map.removeLayer(m);
    markers.clear();
  }

  function itemHaystack(item) {
    const t = item.tags || {};
    return [
      item.name, item.category,
      t.massage, t.cuisine,
      t["healthcare:speciality"], t["healthcare:speciality:pt"],
      t.description, t["description:pt"],
      t.alt_name, t.short_name,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function matchesFilter(item, filterId) {
    const f = FILTERS.find((x) => x.id === filterId);
    if (!f || f.id === "all") return true;
    if (f.special === "openNow") return item.opening ? isOpenNow(item.opening) : false;
    if (f.special === "favorites") return isFavorite(item.id);
    if (f.tagTest && f.tagTest(item.tags || {})) return true;
    if (f.categories && f.categories.includes(item.category)) return true;
    if (f.keywords) {
      const hay = itemHaystack(item);
      return f.keywords.some((k) => hay.includes(k));
    }
    return false;
  }

  function countFor(filterId) {
    if (filterId === "favorites") return Object.keys(getFavorites()).length;
    return rawItems.reduce((n, it) => n + (matchesFilter(it, filterId) ? 1 : 0), 0);
  }

  function renderFilters() {
    els.filters.innerHTML = "";
    const hasData = rawItems.length > 0;
    const favCount = Object.keys(getFavorites()).length;
    for (const f of FILTERS) {
      const count = hasData || f.id === "favorites" ? countFor(f.id) : null;
      const forceShow = (f.id === "favorites" && favCount > 0) || f.id === activeFilter;
      if (hasData && f.id !== "all" && count === 0 && !forceShow) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (activeFilter === f.id ? " active" : "");
      btn.dataset.id = f.id;
      btn.innerHTML = escapeHtml(f.label) + (count != null ? ` <span class="count">${count}</span>` : "");
      btn.addEventListener("click", () => {
        if (activeFilter === f.id) return;
        activeFilter = f.id;
        renderFilters();
        applyFilter();
        if (lastSearch) {
          saveState(lastSearch.lat, lastSearch.lon, lastSearch.radius, activeFilter);
          writeURLState(lastSearch.lat, lastSearch.lon, lastSearch.radius, activeFilter);
        }
      });
      els.filters.appendChild(btn);
    }
  }

  function sortItems(items, key) {
    const now = new Date();
    const byDist = (a, b) => origin
      ? haversine(origin.lat, origin.lon, a.lat, a.lon) - haversine(origin.lat, origin.lon, b.lat, b.lon)
      : 0;
    if (key === "name") {
      return [...items].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
    }
    if (key === "open") {
      return [...items].sort((a, b) => {
        const ao = a.opening && isOpenNow(a.opening, now) ? 0 : 1;
        const bo = b.opening && isOpenNow(b.opening, now) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return byDist(a, b);
      });
    }
    return [...items].sort(byDist);
  }

  function sourceForFilter() {
    if (activeFilter === "favorites") {
      const rawIds = new Set(rawItems.map((i) => i.id));
      const favs = Object.values(getFavorites());
      const extras = favs.filter((f) => !rawIds.has(f.id));
      return [...rawItems, ...extras];
    }
    return rawItems;
  }

  function applyFilter() {
    const filtered = sortItems(
      sourceForFilter().filter((it) => matchesFilter(it, activeFilter)),
      els.sortBy ? els.sortBy.value : "dist"
    );
    clearMarkers();
    for (const item of filtered) {
      const marker = L.marker([item.lat, item.lon], { icon: placeIcon })
        .addTo(map)
        .bindPopup(popupHtml(item));
      marker.on("click", () => {
        const li = els.results.querySelector(`li[data-id="${CSS.escape(item.id)}"]`);
        if (li) {
          document.querySelectorAll("#results li.active").forEach((n) => n.classList.remove("active"));
          li.classList.add("active");
          li.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
      markers.set(item.id, marker);
    }
    renderResults(filtered, origin);

    const active = FILTERS.find((x) => x.id === activeFilter);
    const label = active && active.id !== "all" ? ` · filtro: <strong>${escapeHtml(active.label)}</strong>` : "";
    if (activeFilter === "favorites" && filtered.length && markers.size) {
      const group = L.featureGroup([...markers.values()]);
      map.fitBounds(group.getBounds().pad(0.15));
    }
    if (!rawItems.length && activeFilter !== "favorites") return;
    const total = activeFilter === "favorites" ? filtered.length : rawItems.length;
    setStatus(`<strong>${filtered.length}</strong> de ${total} local(is)${label}.`);
  }

  function renderResults(items, origin) {
    els.results.innerHTML = "";
    currentItems = items;
    if (!items.length) {
      els.results.innerHTML = '<li class="meta" style="color:var(--muted)">Nada encontrado no raio selecionado. Aumente o raio ou tente outro endereço.</li>';
      return;
    }
    for (const item of items) {
      const li = document.createElement("li");
      li.dataset.id = item.id;

      const distance = origin ? haversine(origin.lat, origin.lon, item.lat, item.lon) : null;
      const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lon}`;
      const osm = `https://www.openstreetmap.org/${item.id}`;

      const types = detectedTypes(item);
      const price = priceLabel(item.tags);
      const reviewUrl = googleReviewUrl(item);
      const taUrl = tripadvisorSearchUrl(item);
      const fav = isFavorite(item.id);
      li.innerHTML = `
        <div class="name">
          <button type="button" class="fav ${fav ? "on" : "off"}" title="${fav ? "Remover dos favoritos" : "Salvar nos favoritos"}" aria-pressed="${fav}">${fav ? "★" : "☆"}</button>
          ${escapeHtml(item.name)}
        </div>
        <div class="meta">
          <span class="tag">${escapeHtml(item.category)}</span>
          ${types.map((t) => `<span class="tag type">${escapeHtml(t)}</span>`).join("")}
          ${distance != null ? `<span>📍 ${formatDistance(distance)}</span>` : ""}
          ${price ? `<span class="price">💰 ${escapeHtml(price)}</span>` : ""}
          ${item.opening ? (openingBadgeHtml(item.opening) || `<span>🕒 ${escapeHtml(item.opening)}</span>`) : ""}
          ${item.phone ? `<span>📞 ${escapeHtml(item.phone)}</span>` : ""}
        </div>
        ${item.address ? `<div class="addr">${escapeHtml(item.address)}</div>` : ""}
        <div class="actions">
          <a class="review-btn google" href="${reviewUrl}" target="_blank" rel="noopener">⭐ Avaliações no Google</a>
          <a class="review-btn ta" href="${taUrl}" target="_blank" rel="noopener">🌴 TripAdvisor</a>
          <a href="${gmaps}" target="_blank" rel="noopener">🧭 Rota</a>
          ${item.website ? `<a href="${escapeAttr(item.website)}" target="_blank" rel="noopener">🌐 Site</a>` : ""}
          ${item.phone ? `<a href="tel:${escapeAttr(item.phone)}">📞 Ligar</a>` : ""}
          <a href="${osm}" target="_blank" rel="noopener">ℹ️ OSM</a>
        </div>
      `;

      li.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        if (e.target.closest("button.fav")) {
          e.stopPropagation();
          toggleFavorite(item);
          renderFilters();
          applyFilter();
          return;
        }
        map.setView([item.lat, item.lon], Math.max(map.getZoom(), 16));
        const marker = markers.get(item.id);
        if (marker) marker.openPopup();
        document.querySelectorAll("#results li.active").forEach((n) => n.classList.remove("active"));
        li.classList.add("active");
      });

      els.results.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function popupHtml(item) {
    const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lon}`;
    const price = priceLabel(item.tags);
    return `
      <strong>${escapeHtml(item.name)}</strong>
      <div>${escapeHtml(item.category)}${price ? ` · <span style="color:#86efac">💰 ${escapeHtml(price)}</span>` : ""}</div>
      ${item.address ? `<div style="margin-top:4px;color:#94a3b8">${escapeHtml(item.address)}</div>` : ""}
      ${item.phone ? `<div style="margin-top:4px">📞 <a href="tel:${escapeAttr(item.phone)}">${escapeHtml(item.phone)}</a></div>` : ""}
      ${item.website ? `<div style="margin-top:4px">🌐 <a href="${escapeAttr(item.website)}" target="_blank" rel="noopener">Site</a></div>` : ""}
      <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
        <a href="${googleReviewUrl(item)}" target="_blank" rel="noopener">⭐ Google</a>
        <a href="${tripadvisorSearchUrl(item)}" target="_blank" rel="noopener">🌴 TripAdvisor</a>
        <a href="${gmaps}" target="_blank" rel="noopener">🧭 Rota</a>
      </div>
    `;
  }

  let lastSearch = null;
  const STATE_TTL_MS = 30 * 60 * 1000;

  function saveState(lat, lon, radius, filter) {
    STORE.set("state", { lat, lon, radius, filter, ts: Date.now() });
  }
  function loadFreshState() {
    const s = STORE.get("state");
    if (!s || !s.ts) return null;
    if (Date.now() - s.ts > STATE_TTL_MS) return null;
    return s;
  }

  function writeURLState(lat, lon, radius, filter) {
    const p = new URLSearchParams();
    p.set("lat", lat.toFixed(5));
    p.set("lon", lon.toFixed(5));
    p.set("r", String(radius));
    if (filter && filter !== "all") p.set("f", filter);
    const newUrl = `${location.pathname}?${p.toString()}${location.hash}`;
    history.replaceState(null, "", newUrl);
  }
  function readURLState() {
    const p = new URLSearchParams(location.search);
    const lat = parseFloat(p.get("lat"));
    const lon = parseFloat(p.get("lon"));
    const r = parseInt(p.get("r"), 10);
    const f = p.get("f");
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(r)) return null;
    return { lat, lon, radius: r, filter: f || "all" };
  }

  function formatAge(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    return `${h} h`;
  }

  function renderCacheBadge({ fromCache, ageMs }) {
    const el = document.getElementById("cacheBadge");
    if (!el) return;
    if (!fromCache) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `📦 dados de ${escapeHtml(formatAge(ageMs))} atrás <button type="button" id="refreshNow">🔄 Atualizar</button>`;
    const btn = document.getElementById("refreshNow");
    if (btn) btn.addEventListener("click", () => {
      if (lastSearch) searchNearby(lastSearch.lat, lastSearch.lon, lastSearch.radius, { force: true });
    });
  }

  async function searchNearby(lat, lon, radius, opts = {}) {
    lastSearch = { lat, lon, radius };
    const { force = false } = opts;
    setStatus(`Procurando locais de bem-estar em ${(radius / 1000).toFixed(0)} km…`, "loading");
    clearMarkers();
    rawItems = [];
    renderFilters();
    renderCacheBadge({ fromCache: false });

    if (searchCircle) map.removeLayer(searchCircle);
    searchCircle = L.circle([lat, lon], {
      radius,
      color: "#22c55e",
      weight: 1,
      fillOpacity: 0.06,
    }).addTo(map);

    try {
      let data, fromCache = false, ageMs = 0;
      const cached = force ? null : readOverpassCache(lat, lon, radius);
      if (cached) {
        data = cached.data;
        fromCache = true;
        ageMs = cached.ageMs;
      } else {
        data = await overpassQuery(buildOverpassQuery(lat, lon, radius));
        writeOverpassCache(lat, lon, radius, data);
      }

      const raw = (data.elements || [])
        .map(normalizeElement)
        .filter(Boolean)
        .filter((el, i, arr) => arr.findIndex((x) => x.id === el.id) === i);

      origin = { lat, lon };
      raw.sort((a, b) => haversine(lat, lon, a.lat, a.lon) - haversine(lat, lon, b.lat, b.lon));
      const items = dedupFuzzy(raw);

      rawItems = items;
      renderFilters();
      applyFilter();
      renderCacheBadge({ fromCache, ageMs });
      saveState(lat, lon, radius, activeFilter);
      writeURLState(lat, lon, radius, activeFilter);

      if (items.length) {
        const group = L.featureGroup([userMarker, ...markers.values(), searchCircle].filter(Boolean));
        if (group.getLayers().length) map.fitBounds(group.getBounds().pad(0.15));
      } else {
        map.setView([lat, lon], 14);
        const osmEdit = `https://www.openstreetmap.org/edit?editor=id#map=18/${lat.toFixed(5)}/${lon.toFixed(5)}`;
        setStatus(
          `Nenhum local encontrado. Aumente o raio ou <a href="${osmEdit}" target="_blank" rel="noopener">➕ adicione um local ao OpenStreetMap</a>.`,
          "error"
        );
      }
    } catch (err) {
      console.error(err);
      setStatus("Erro ao buscar: " + err.message + ". Tente novamente.", "error");
    }
  }

  let userAccuracyCircle = null;
  function placeUser(lat, lon, accuracy) {
    if (userMarker) map.removeLayer(userMarker);
    if (userAccuracyCircle) { map.removeLayer(userAccuracyCircle); userAccuracyCircle = null; }
    userMarker = L.marker([lat, lon], { icon: userIcon, title: "Você está aqui" }).addTo(map);
    if (accuracy && accuracy > 0) {
      userAccuracyCircle = L.circle([lat, lon], {
        radius: accuracy,
        color: "#3b82f6",
        weight: 1,
        fillColor: "#3b82f6",
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(map);
    }
    map.setView([lat, lon], 14);
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setStatus("Seu navegador não suporta geolocalização. Use a busca por endereço.", "error");
      return;
    }
    setStatus("Obtendo sua localização…", "loading");
    els.locate.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        els.locate.disabled = false;
        const { latitude, longitude, accuracy } = pos.coords;
        placeUser(latitude, longitude, accuracy);
        searchNearby(latitude, longitude, Number(els.radius.value));
      },
      (err) => {
        els.locate.disabled = false;
        const msgs = {
          1: "Permissão de localização negada. Busque por endereço abaixo.",
          2: "Localização indisponível. Tente novamente ou busque por endereço.",
          3: "Tempo esgotado. Tente novamente.",
        };
        setStatus(msgs[err.code] || "Erro ao obter localização.", "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function geocode(query) {
    const url = `${NOMINATIM}/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const arr = await res.json();
    if (!arr.length) return null;
    return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon), display: arr[0].display_name };
  }

  let suggestController = null;
  let suggestDebounce = null;
  let suggestIndex = -1;
  let suggestItems = [];

  function hideSuggestions() {
    if (!els.suggestions) return;
    els.suggestions.classList.add("hidden");
    els.suggestions.innerHTML = "";
    els.searchInput.setAttribute("aria-expanded", "false");
    suggestIndex = -1;
    suggestItems = [];
  }

  function renderSuggestions(list) {
    if (!els.suggestions) return;
    els.suggestions.innerHTML = "";
    if (!list.length) { hideSuggestions(); return; }
    suggestItems = list;
    suggestIndex = -1;
    list.forEach((item, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = `sugg-${i}`;
      const main = item.name || item.display_name.split(",")[0];
      const rest = item.display_name.replace(main, "").replace(/^,\s*/, "");
      li.innerHTML = `<div>${escapeHtml(main)}</div><div class="sec">${escapeHtml(rest)}</div>`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pickSuggestion(i);
      });
      els.suggestions.appendChild(li);
    });
    els.suggestions.classList.remove("hidden");
    els.searchInput.setAttribute("aria-expanded", "true");
  }

  function highlightSuggestion(idx) {
    const nodes = els.suggestions.querySelectorAll("li");
    nodes.forEach((n, i) => n.setAttribute("aria-selected", i === idx ? "true" : "false"));
    if (idx >= 0 && nodes[idx]) {
      nodes[idx].scrollIntoView({ block: "nearest" });
      els.searchInput.setAttribute("aria-activedescendant", `sugg-${idx}`);
    } else {
      els.searchInput.removeAttribute("aria-activedescendant");
    }
  }

  function pickSuggestion(i) {
    const s = suggestItems[i];
    if (!s) return;
    els.searchInput.value = s.display_name;
    hideSuggestions();
    const lat = parseFloat(s.lat);
    const lon = parseFloat(s.lon);
    if (!isFinite(lat) || !isFinite(lon)) return;
    placeUser(lat, lon);
    searchNearby(lat, lon, Number(els.radius.value));
  }

  async function fetchSuggestions(q) {
    if (suggestController) suggestController.abort();
    suggestController = new AbortController();
    const url = `${NOMINATIM}/search?format=json&limit=5&addressdetails=0&q=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(url, {
        headers: { "Accept-Language": "pt-BR" },
        signal: suggestController.signal,
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
      return null;
    }
  }

  els.locate.addEventListener("click", locateMe);

  const sidebarEl = document.querySelector(".sidebar");
  const toggleBtn = document.getElementById("toggleSidebar");
  if (toggleBtn && sidebarEl) {
    const pref = STORE.get("sidebarCollapsed");
    if (pref) {
      sidebarEl.classList.add("collapsed");
      toggleBtn.textContent = "▸";
      toggleBtn.setAttribute("aria-expanded", "false");
    }
    toggleBtn.addEventListener("click", () => {
      const collapsed = sidebarEl.classList.toggle("collapsed");
      toggleBtn.textContent = collapsed ? "▸" : "▾";
      toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      STORE.set("sidebarCollapsed", collapsed);
      setTimeout(() => map.invalidateSize(), 220);
    });
  }

  els.radius.addEventListener("change", () => {
    if (userMarker) {
      const { lat, lng } = userMarker.getLatLng();
      searchNearby(lat, lng, Number(els.radius.value));
    }
  });

  if (els.sortBy) {
    const savedSort = STORE.get("sort");
    if (savedSort && [...els.sortBy.options].some((o) => o.value === savedSort)) {
      els.sortBy.value = savedSort;
    }
    els.sortBy.addEventListener("change", () => {
      STORE.set("sort", els.sortBy.value);
      if (rawItems.length) applyFilter();
    });
  }

  if (els.suggestions && els.searchInput) {
    els.searchInput.addEventListener("input", () => {
      const q = els.searchInput.value.trim();
      clearTimeout(suggestDebounce);
      if (q.length < 3) { hideSuggestions(); return; }
      suggestDebounce = setTimeout(async () => {
        const list = await fetchSuggestions(q);
        if (list) renderSuggestions(list);
      }, 300);
    });
    els.searchInput.addEventListener("keydown", (e) => {
      if (els.suggestions.classList.contains("hidden")) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        suggestIndex = Math.min(suggestIndex + 1, suggestItems.length - 1);
        highlightSuggestion(suggestIndex);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        suggestIndex = Math.max(suggestIndex - 1, 0);
        highlightSuggestion(suggestIndex);
      } else if (e.key === "Enter" && suggestIndex >= 0) {
        e.preventDefault();
        pickSuggestion(suggestIndex);
      } else if (e.key === "Escape") {
        hideSuggestions();
      }
    });
    els.searchInput.addEventListener("blur", () => {
      setTimeout(hideSuggestions, 100);
    });
  }

  els.searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = els.searchInput.value.trim();
    if (!q) return;
    setStatus(`Buscando "${escapeHtml(q)}"…`, "loading");
    try {
      const loc = await geocode(q);
      if (!loc) { setStatus("Endereço não encontrado.", "error"); return; }
      placeUser(loc.lat, loc.lon);
      searchNearby(loc.lat, loc.lon, Number(els.radius.value));
    } catch (err) {
      setStatus("Erro ao buscar endereço: " + err.message, "error");
    }
  });

  function applyValidRadius(r) {
    const options = Array.from(els.radius.options).map((o) => Number(o.value));
    const closest = options.reduce((a, b) => Math.abs(b - r) < Math.abs(a - r) ? b : a, options[0]);
    els.radius.value = String(closest);
    return closest;
  }

  function init() {
    renderFilters();
    const urlState = readURLState();
    if (urlState) {
      applyValidRadius(urlState.radius);
      activeFilter = urlState.filter;
      placeUser(urlState.lat, urlState.lon);
      searchNearby(urlState.lat, urlState.lon, Number(els.radius.value));
      return;
    }
    const saved = loadFreshState();
    if (saved) {
      applyValidRadius(saved.radius);
      activeFilter = saved.filter || "all";
      placeUser(saved.lat, saved.lon);
      searchNearby(saved.lat, saved.lon, Number(els.radius.value));
    }
  }

  init();
})();
