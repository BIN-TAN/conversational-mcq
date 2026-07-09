import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EDPY 507: Measurement Theory",
  description: "Course activity and instructor review tools for EDPY 507 Measurement Theory"
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
