/** @type {import('next').NextConfig} */
export default {
  // The UI ships as self-contained HTML files in public/. They are served
  // straight from the CDN and talk to the API routes, so a page load never
  // waits on a server render.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/marketing.html' },
        { source: '/app', destination: '/app.html' },
        { source: '/yardim', destination: '/help.html' },
        // Yasal metinler tek sayfada, bölüm çıpalarıyla. Ayrı ayrı URL isteyen
        // ödeme sağlayıcıları için her biri kendi adresinden de açılır.
        { source: '/yasal', destination: '/yasal.html' },
        { source: '/kvkk', destination: '/yasal.html' },
        { source: '/gizlilik', destination: '/yasal.html' },
        { source: '/kullanim-sartlari', destination: '/yasal.html' },
        { source: '/mesafeli-satis', destination: '/yasal.html' },
        { source: '/iade', destination: '/yasal.html' },
        { source: '/dpa', destination: '/yasal.html' },
        { source: '/giris', destination: '/auth.html' },
        { source: '/kayit', destination: '/auth.html' },
      ],
    };
  },
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ],
    }];
  },
};
