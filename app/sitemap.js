const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://trevano.app';

export default function sitemap() {
  const now = new Date();
  const publicRoutes = [
    { path: '/', priority: 1, changeFrequency: 'weekly' },
    { path: '/termeni-si-conditii', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/politica-de-confidentialitate', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/politica-cookies', priority: 0.3, changeFrequency: 'yearly' },
  ];

  return publicRoutes.map(({ path, priority, changeFrequency }) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
