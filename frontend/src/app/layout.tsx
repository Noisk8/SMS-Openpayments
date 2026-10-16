import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMS Pagos",
  description: "Crea cuenta, envía dinero y consulta tu saldo por SMS.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="font-semibold">
              SMS Pagos
            </Link>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link href="/accounts" className="hover:underline">Cuenta</Link>
              <Link href="/payments" className="hover:underline">Enviar dinero</Link>
              <Link href="/balance" className="hover:underline">Saldo</Link>
            </div>
          </nav>
        </header>
        <div className="flag-stripe h-1" aria-hidden="true" />
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}