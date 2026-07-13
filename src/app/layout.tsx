import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, Cormorant_Garamond } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeScript } from "@/components/shell/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: {
    default: "viajerOS",
    template: "%s · viajerOS",
  },
  description: "viajerOS — el sistema operativo de tu agencia de viajes: vender y organizar.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#131110" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-AR"
      className={`${inter.variable} ${fraunces.variable} ${cormorant.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh">
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: "var(--t-ink)",
              color: "var(--t-cream)",
              border: "none",
              borderRadius: "12px",
            },
          }}
        />
      </body>
    </html>
  );
}
