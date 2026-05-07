import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "./contexts/AuthContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
    icon: '/favicon-patrat-negru.svg',
    apple: '/favicon-patrat-negru.svg',
    shortcut: '/favicon-patrat-negru.svg',
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
