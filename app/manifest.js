export default function manifest() {
  return {
    name: 'Trevano - Plan personalizat de alimentație și antrenament',
    short_name: 'Trevano',
    description: 'Planuri zilnice de mese și antrenamente, progres urmărit săptămânal și ajustări automate cu Trevano Coach.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fbfbf8',
    theme_color: '#b7ff00',
    lang: 'ro',
    categories: ['fitness', 'health', 'lifestyle'],
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
