import type { Metadata } from "next";
import type { ReactNode } from "react";
import ServiceWorkerRegistration from "./service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "SyncPad",
  description:
    "Proyecto experimental para explorar notas colaborativas, sincronización en tiempo real y trabajo offline.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}<ServiceWorkerRegistration /></body>
    </html>
  );
}
