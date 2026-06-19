import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conversational MCQ",
  description: "Conversation-based MCQ formative assessment prototype"
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
