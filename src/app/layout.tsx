import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../styles.css";

// Fallback faces after the system stack in styles.css. Self-hosted at build time.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Azalea e-Helpdesk",
  description: "Service requests, work orders and shift handover for hotels.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#f2f2f7",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The app sets theme, text size and motion attributes on <html> after mount.
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
