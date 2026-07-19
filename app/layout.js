import { Inter, Space_Grotesk } from "next/font/google";
import { AuthProvider } from "./contexts/AuthContext";
import ExternalNavigationReloadGuard from "./components/ExternalNavigationReloadGuard";
import CookieConsentBanner from "./components/CookieConsentBanner";
import MarketingPixels from "./components/MarketingPixels";
import ResourceHints from "./components/ResourceHints";
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
    default: "Trevano - Plan personalizat de alimentație și antrenament",
    template: "%s | Trevano"
  },
  description: "Trevano îți spune ce să mănânci, cum să te antrenezi și îți adaptează planul pe măsură ce progresezi, până îți atingi obiectivul.",
  keywords: [
    'Trevano',
    'trevano app',
    'plan alimentar personalizat',
    'plan antrenament personalizat',
    'aplicatie fitness Romania',
    'aplicatie slabit',
    'aplicatie masa musculara',
    'monitorizare progres fitness',
    'antrenamente acasa',
    'antrenamente sala',
    'Trevano Coach',
  ],
  applicationName: 'Trevano',
  authors: [{ name: 'Trevano' }],
  creator: 'Trevano',
  publisher: 'Trevano',
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/',
  },
  category: 'health and fitness',
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
    title: 'Trevano - Plan personalizat de alimentație și antrenament',
    description: 'Planuri zilnice de mese și antrenamente, progres urmărit săptămânal și ajustări automate cu Trevano Coach.',
    images: [
      {
        url: '/screenshots/mockup-meal-plan.png',
        width: 1200,
        height: 630,
        alt: 'Trevano - plan alimentar și antrenament personalizat',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Trevano - Plan personalizat de alimentație și antrenament',
    description: 'Trevano îți spune ce să mănânci, cum să te antrenezi și cum să continui progresul.',
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
        <ResourceHints />
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
