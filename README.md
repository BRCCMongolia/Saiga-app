# Saiga survey

БНХТ баг-4-ийн бөхөний шугаман трансектын (distance sampling) хээрийн бүртгэлийн апп. 2017 оны цаасан маягтыг орлоно.

- Android, iPhone хоёулан дээр холбоосоор нээгдэнэ, интернэтгүй ажиллана (PWA).
- Өгөгдөл утсанд шууд хадгалагдана (IndexedDB), интернэттэй үед Google Sheet рүү өөрөө илгээнэ.
- Экспорт: трансект бүрээр ZIP (xlsx, kmz, gpx, зураг), бүх өгөгдөл нэг ZIP.

## Суулгах (утсан дээр)
1. Холбоосыг нээнэ.
2. iPhone: Safari > Share > Add to Home Screen. Android: Chrome > ⋮ > Add to Home screen / Install app.
3. Үргэлж нүүр дэлгэцийн дүрсээр нээнэ (iPhone дээр Safari ба нүүр дэлгэцийн апп өгөгдлөө тусад нь хадгалдаг).
4. Хээрт гарахаас өмнө Wi-Fi-тай газар Тохиргоо > Газрын зураг татах.

## Google Sheet
`apps-script/Code.gs` доторх зааврын дагуу Apps Script вэб апп болгон байршуулаад /exec холбоосыг Тохиргоонд тавина.

## Бүтэц
- `index.html`, `sw.js` (офлайн кэш), `manifest.webmanifest`
- `js/app.js` дэлгэцүүд, `js/model.js` өгөгдлийн загвар, `js/export.js` Excel/KMZ/GPX/ZIP, `js/sync.js` Sheet, `js/gps.js` GPS ба туршилтын дуураймал GPS, `js/geo.js` геометр
- `data/transects-2026.json` 2026 оны гэрээний 14 трансект, `data/species.json` хөхтөн, шувууны жагсаалт
- Шинэчлэл гаргахдаа `sw.js` доторх `VERSION` болон `index.html` доторх `APP_VERSION`-ийг өөрчилнө.

Сангууд: Leaflet, SheetJS, JSZip (`js/vendor/`, лицензийн хамт).
