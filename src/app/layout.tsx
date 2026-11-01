import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Transport Fever 3 · Vehicle Planner",
  description: "Build and compare train, tram, road and boat options using Transport Fever 3 vehicle data.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
