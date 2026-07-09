import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "900"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://whatsupbangalore.netlify.app"),
  title: "What's Trending Bangalore",
  description:
    "A living map of what's trending in Bengaluru — places, events, and experiences, upvoted by the people who went.",
  openGraph: {
    title: "What's Trending Bangalore",
    description:
      "A living map of what's trending in Bengaluru — places, events, and experiences, upvoted by the people who went.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
