# yamnaya.world

Encontre casas de massagem, spas e centros de bem-estar perto de você — com avaliações reais do Google e TripAdvisor.

Site estático (HTML + CSS + JS puro, zero build, zero tracker) servido pelo GitHub Pages em `yamnaya.world`.

## Funcionalidades

- **Localização** — `navigator.geolocation` com círculo de precisão do GPS e botão "centralizar em mim" no mapa.
- **Busca por endereço** — via [Nominatim](https://nominatim.openstreetmap.org/) com autocomplete (↑↓ Enter Esc).
- **Locais** — via [Overpass API](https://overpass-api.de/) em dados do OpenStreetMap (`shop=massage`, `amenity=massage|spa`, `craft=massage`, `healthcare=massage`, `leisure=spa`). Foco em relaxamento/bem-estar.
- **Avaliações** — cada card traz link-out para **Google Maps** e **TripAdvisor** pré-preenchidos com nome + coord, abrindo as avaliações reais em nova aba. Zero backend, zero chave de API.
- **Preço** — quando o OSM tem `fee`/`charge`, o valor aparece em destaque; `fee=no` vira "Grátis".
- **Filtros** — chips por tipo de massagem (Tailandesa, Shiatsu, Sueca, Reflexologia, Ayurveda, etc.), além de **⭐ Favoritos**, **🟢 Aberto agora**, **♿ Acessível** e **♀ Feminino**.
- **Ordenação** — mais próximos / aberto agora / nome (A-Z).
- **Aberto agora** — parser inline de `opening_hours` (cobre `24/7`, `Mo-Fr 09:00-18:00`, pausas e múltiplas regras). Badge verde/vermelho com horário de fechamento ou próxima abertura.
- **Favoritos** — ★ persiste em `localStorage` e aparece mesmo fora da área atual do mapa.
- **Cache Overpass** — resultados em `localStorage` por 4h com badge "📦 dados de Xh atrás" e botão "🔄 Atualizar".
- **Retry/timeout** — `AbortController` de 30s e backoff exponencial entre 3 endpoints Overpass.
- **URL compartilhável** — cada busca grava `?lat&lon&r&f` via `history.replaceState`; colar em outra aba reproduz o mesmo resultado.
- **Auto-restore** — reabre a página no último estado (30 min TTL) sem perguntar de novo.
- **Dedup fuzzy** — duplicatas de OSM com nome equivalente e < 50m são fundidas (mantém a com mais tags).
- **PWA** — instalável (manifest + service worker) e abre offline após a primeira visita.
- **Vazio → contribua** — quando nada é encontrado, link abre o iD editor do OSM na coord para cadastrar o local.
- **Acessibilidade** — combobox ARIA no autocomplete, labels nos controles, respeita prefers-reduced-motion via CSS default.

## Rodando localmente

Qualquer servidor estático serve:

```sh
python3 -m http.server 8000
# abra http://localhost:8000
```

Geolocalização, PWA e service worker só funcionam em `localhost` ou HTTPS.

## Arquivos

- `index.html` — marcação, meta Open Graph/Twitter, links PWA.
- `styles.css` — tema escuro, responsivo, bottom-sheet mobile.
- `app.js` — geolocalização, Overpass + cache + retry, Nominatim + autocomplete, parser opening_hours, filtros, favoritos, dedup, URL state.
- `manifest.webmanifest` — metadados PWA.
- `sw.js` — service worker cache-first dos estáticos (Leaflet + shell). Não cacheia tiles/Overpass/Nominatim.
- `icon.svg` — ícone PWA em SVG único.
- `CNAME` — domínio GitHub Pages.

## Limites

- **Reviews embedadas**: não é possível exibir notas/fotos do Google ou TripAdvisor dentro do card sem backend + chave paga. Por isso usamos link-out.
- **Opening hours**: o parser cobre os formatos comuns. Quando a sintaxe é atípica, o card mostra a string crua do OSM (fallback honesto).
- **Cobertura**: depende da qualidade do OSM na região. Se achar pouco, o botão "➕ adicione um local ao OpenStreetMap" direciona para a contribuição.

## Créditos

Dados: contribuidores do [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL). Geocoder: [Nominatim](https://nominatim.openstreetmap.org/). Mapa: [Leaflet](https://leafletjs.com/). Tiles: [OpenStreetMap](https://www.openstreetmap.org/).
