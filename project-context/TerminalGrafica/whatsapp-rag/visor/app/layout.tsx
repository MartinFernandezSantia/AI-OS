import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visor de chunks — Terminal Gráfica",
  description: "Inspección de los bloques de texto que va a leer el bot. No escribe a ninguna base.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
