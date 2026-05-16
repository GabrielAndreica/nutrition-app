const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://trevano.app';

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/termeni-si-conditii',
          '/politica-de-confidentialitate',
          '/politica-cookies',
        ],
        disallow: [
          '/api/',
          '/dashboard',
          '/clients',
          '/client/',
          '/generator-plan',
          '/generator-antrenament',
          '/meal-plan/',
          '/workout-plan/',
          '/upgrade',
          '/external-redirect',
          '/confirm/',
          '/activate/',
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
