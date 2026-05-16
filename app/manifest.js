export default function manifest() {
  return {
    name: 'Trevano - Aplicație pentru antrenori de fitness',
    short_name: 'Trevano',
    description: 'Clienți, planuri alimentare, antrenamente și progres într-un singur loc.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    lang: 'ro',
    categories: ['fitness', 'productivity', 'business'],
    icons: [
      {
        src: '/favicon-patrat-verde.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  };
}
