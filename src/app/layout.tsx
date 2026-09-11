import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { ErrorBoundary } from "@/components/error-boundary";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Broker OS — Garment Brokerage Operations",
  description:
    "Modern, glassmorphic operations system for garment industry brokers: visits, bookings, POs, dispatch, payments, brokerage, and full audit trails.",
  keywords: [
    "garment broker",
    "brokerage OS",
    "PO management",
    "dispatch tracking",
    "commission",
    "operations",
  ],
  authors: [{ name: "Broker OS" }],
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${manrope.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <ErrorBoundary label="Broker OS">
              {children}
            </ErrorBoundary>
            <SonnerToaster position="top-right" richColors closeButton />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
