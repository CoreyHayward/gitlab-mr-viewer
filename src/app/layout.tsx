import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import ErrorBoundary from "@/components/ErrorBoundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GitLab MR Viewer",
  description: "A lightweight, client-side web app for advanced filtering and viewing of GitLab merge requests. Your API token never leaves your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Cloudflare Web Analytics */}
        <Script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "16dcad88fd6b4295a51b28c70ca3c237"}' strategy="afterInteractive"></Script>
        {/* End Cloudflare Web Analytics */}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
