import { Inter, Space_Grotesk } from "next/font/google";
import { AuthProvider } from "./contexts/AuthContext";
import ExternalNavigationReloadGuard from "./components/ExternalNavigationReloadGuard";
import CookieConsentBanner from "./components/CookieConsentBanner";
import MarketingPixels from "./components/MarketingPixels";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://trevano.app'),
  title: {
    default: "Trevano - Aplicație pentru antrenori de fitness",
    template: "%s | Trevano"
  },
  description: "Trevano este aplicația pentru antrenori de fitness unde ții clienții, planurile alimentare, antrenamentele și progresul într-un singur loc.",
  keywords: [
    'Trevano',
    'trevano app',
    'aplicatie antrenori fitness',
    'software antrenori personali',
    'aplicatie antrenori',
    'planuri alimentare',
    'planuri antrenament',
    'monitorizare progres clienti',
    'platforma fitness Romania',
    'organizare clienti antrenor',
  ],
  applicationName: 'Trevano',
  authors: [{ name: 'Trevano' }],
  creator: 'Trevano',
  publisher: 'Trevano',
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/',
  },
  category: 'fitness software',
  icons: {
    icon: '/favicon-patrat-verde.svg',
    apple: '/favicon-patrat-verde.svg',
    shortcut: '/favicon-patrat-verde.svg',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'ro_RO',
    url: '/',
    siteName: 'Trevano',
    title: 'Trevano - Aplicație pentru antrenori de fitness',
    description: 'Clienți, planuri alimentare, antrenamente și progres într-un singur loc.',
    images: [
      {
        url: '/screenshots/mockup-meal-plan.png',
        alt: 'Trevano - aplicație pentru antrenori de fitness',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Trevano - Aplicație pentru antrenori de fitness',
    description: 'Clienți, planuri alimentare, antrenamente și progres într-un singur loc.',
    images: ['/screenshots/mockup-meal-plan.png'],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="ro"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <ExternalNavigationReloadGuard />
          <MarketingPixels />
          {children}
          <CookieConsentBanner />
        </AuthProvider>
      </body>
    </html>
  );
}
