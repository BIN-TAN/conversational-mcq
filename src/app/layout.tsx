import type { Metadata } from "next";
// KaTeX styles for formulas in item content and tutor messages (release CMCQ-20261024-11).
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "EDPY 507: Measurement Theory",
  description: "EDPY 507 Measurement Theory student and instructor access portal"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
