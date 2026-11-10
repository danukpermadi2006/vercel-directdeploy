# Vercel DirectDeploy

Deploy repository GitHub ke Vercel dari browser (HTML/CSS/JS vanilla + Tailwind CDN).

## Struktur
- `index.html` - markup saja
- `css/style.css` - styling utama; `css/responsive.css` - media query (>= 768px)
- `js/script.js` - semua logika (dimuat dengan `defer`)
- `assets/images/` - taruh `danuk.jpg` (avatar) di sini; `assets/icons/`, `assets/fonts/`

## Jalankan
Buka `index.html`, atau lewat server lokal: `python3 -m http.server 8000`.

## Catatan keamanan
Token Vercel disimpan di `localStorage` (riwayat token). Gunakan token dengan scope dan masa berlaku seminimal mungkin, dan jangan pakai di komputer bersama.
