import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "FounderOS · Stay accountable",
  description:
    "A shared operating system for founder commitments and progress.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
