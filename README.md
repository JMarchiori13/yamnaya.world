# yamnaya.world

Encontre casas de massagem e centros de massoterapia perto de você.

Site estático (HTML + CSS + JS puro) servido pelo GitHub Pages em `yamnaya.world`.

## Como funciona

- **Geolocalização**: usa a API `navigator.geolocation` do navegador para pegar sua posição (com permissão do usuário).
- **Busca por endereço**: fallback via [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap) quando você não quer ou não pode compartilhar a localização.
- **Locais**: consultados via [Overpass API](https://overpass-api.de/) em dados do OpenStreetMap, filtrando por:
  - `shop=massage`
  - `amenity=massage`, `amenity=spa`
  - `craft=massage`
  - `healthcare=massage`, `healthcare=physiotherapist`
  - `healthcare=alternative` com especialidade massagem/shiatsu/reflexologia/etc.
  - `leisure=spa`
- **Mapa**: [Leaflet](https://leafletjs.com/) + tiles OpenStreetMap.
- **Raio** configurável (1 / 2 / 5 / 10 / 20 km).

Cada resultado mostra nome, categoria, distância, horário, telefone, endereço e botões para rota (Google Maps), site, ligação direta e página OSM.

## Rodando localmente

Qualquer servidor estático serve. Ex.:

```sh
python3 -m http.server 8000
# abra http://localhost:8000
```

Geolocalização do navegador só funciona em `localhost` ou HTTPS.

## Arquivos

- `index.html` — marcação
- `styles.css` — tema escuro + layout responsivo
- `app.js` — geolocalização, geocoder, consulta Overpass e render do mapa/lista
- `CNAME` — domínio GitHub Pages

## Créditos

Dados de locais: contribuidores do [OpenStreetMap](https://www.openstreetmap.org/copyright) (licença ODbL).
