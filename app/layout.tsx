import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whoop → Calendar",
  description: "Your WHOOP sleep, recovery and workouts in Google Calendar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
