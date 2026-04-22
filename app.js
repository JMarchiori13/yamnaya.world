(() => {
  "use strict";

  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
  ];
  const NOMINATIM = "https://nominatim.openstreetmap.org";

  const els = {
    map: document.getElementById("map"),
    results: document.getElementById("results"),
    status: document.getElementById("status"),
    locate: document.getElementById("locate"),
    radius: document.getElementById("radius"),
    searchForm: document.getElementById("searchForm"),
    searchInput: document.getElementById("searchInput"),
    filters: document.getElementById("filters"),
  };

  const FILTERS = [
    { id: "all", label: "Todos" },
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

  async function overpassQuery(query) {
    let lastErr;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Falha ao consultar Overpass");
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

  function detectedTypes(item) {
    return FILTERS
      .filter((f) => f.id !== "all" && matchesFilter(item, f.id))
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
    if (f.categories && f.categories.includes(item.category)) return true;
    if (f.keywords) {
      const hay = itemHaystack(item);
      return f.keywords.some((k) => hay.includes(k));
    }
    return false;
  }

  function countFor(filterId) {
    return rawItems.reduce((n, it) => n + (matchesFilter(it, filterId) ? 1 : 0), 0);
  }

  function renderFilters() {
    els.filters.innerHTML = "";
    const hasData = rawItems.length > 0;
    for (const f of FILTERS) {
      const count = hasData ? countFor(f.id) : null;
      if (hasData && f.id !== "all" && count === 0) continue;
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
      });
      els.filters.appendChild(btn);
    }
  }

  function applyFilter() {
    const filtered = rawItems.filter((it) => matchesFilter(it, activeFilter));
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
    if (!rawItems.length) return;
    setStatus(`<strong>${filtered.length}</strong> de ${rawItems.length} local(is)${label}.`);
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
      li.innerHTML = `
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="meta">
          <span class="tag">${escapeHtml(item.category)}</span>
          ${types.map((t) => `<span class="tag type">${escapeHtml(t)}</span>`).join("")}
          ${distance != null ? `<span>📍 ${formatDistance(distance)}</span>` : ""}
          ${price ? `<span class="price">💰 ${escapeHtml(price)}</span>` : ""}
          ${item.opening ? `<span>🕒 ${escapeHtml(item.opening)}</span>` : ""}
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

  async function searchNearby(lat, lon, radius) {
    setStatus(`Procurando casas de massagem em ${(radius / 1000).toFixed(0)} km…`, "loading");
    clearMarkers();
    rawItems = [];
    renderFilters();

    if (searchCircle) map.removeLayer(searchCircle);
    searchCircle = L.circle([lat, lon], {
      radius,
      color: "#22c55e",
      weight: 1,
      fillOpacity: 0.06,
    }).addTo(map);

    try {
      const data = await overpassQuery(buildOverpassQuery(lat, lon, radius));
      const items = (data.elements || [])
        .map(normalizeElement)
        .filter(Boolean)
        .filter((el, i, arr) => arr.findIndex((x) => x.id === el.id) === i);

      origin = { lat, lon };
      items.sort((a, b) => haversine(lat, lon, a.lat, a.lon) - haversine(lat, lon, b.lat, b.lon));

      rawItems = items;
      renderFilters();
      applyFilter();

      if (items.length) {
        const group = L.featureGroup([userMarker, ...markers.values(), searchCircle].filter(Boolean));
        if (group.getLayers().length) map.fitBounds(group.getBounds().pad(0.15));
      } else {
        map.setView([lat, lon], 14);
        setStatus("Nenhum local encontrado. Tente aumentar o raio ou outra região.", "error");
      }
    } catch (err) {
      console.error(err);
      setStatus("Erro ao buscar: " + err.message + ". Tente novamente.", "error");
    }
  }

  function placeUser(lat, lon) {
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([lat, lon], { icon: userIcon, title: "Você está aqui" }).addTo(map);
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
        const { latitude, longitude } = pos.coords;
        placeUser(latitude, longitude);
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

  els.locate.addEventListener("click", locateMe);

  els.radius.addEventListener("change", () => {
    if (userMarker) {
      const { lat, lng } = userMarker.getLatLng();
      searchNearby(lat, lng, Number(els.radius.value));
    }
  });

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

  renderFilters();
})();
