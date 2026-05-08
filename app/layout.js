import { Inter, Space_Grotesk } from "next/font/google";
import { AuthProvider } from "./contexts/AuthContext";
import ExternalNavigationReloadGuard from "./components/ExternalNavigationReloadGuard";
import CookieConsentBanner from "./components/CookieConsentBanner";
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
  title: {
    default: "trevano - Planuri Nutriționale Personalizate",
    template: "%s | trevano"
  },
  description: "Aplicație de nutriție pentru antrenori: generează planuri alimentare personalizate, monitorizează progresul clienților și gestionează portofoliul de clienți.",
  keywords: ['nutriție', 'planuri alimentare', 'antrenori', 'fitness', 'dieta'],
  authors: [{ name: 'trevano' }],
  icons: {
    icon: '/favicon-patrat-verde.svg',
    apple: '/favicon-patrat-verde.svg',
    shortcut: '/favicon-patrat-verde.svg',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    locale: 'ro_RO',
    title: 'trevano - Planuri Nutriționale',
    description: 'Platformă pentru antrenori - Creează planuri alimentare personalizate',
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
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <ExternalNavigationReloadGuard />
          {children}
          <CookieConsentBanner />
        </AuthProvider>
      </body>
    </html>
  );
}
