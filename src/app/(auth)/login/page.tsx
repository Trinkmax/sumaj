import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-cream px-4 py-10">
      {/* halo editorial de marca, sutil en ambos temas */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[38rem] -translate-x-1/2 rounded-full bg-brand-tint opacity-70 blur-3xl"
      />

      <div className="relative w-full max-w-sm animate-slide-up-slow">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/viajerOS-2.png"
            alt="viajerOS"
            className="mx-auto h-8 w-auto dark:invert"
          />
          <h1 className="mt-6 font-display text-[26px] font-semibold leading-tight tracking-tight text-ink">
            Hola de nuevo
          </h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            El sistema de tu agencia: vender y organizar.
          </p>
        </div>

        <div className="card p-6">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-sm text-ink-faint">
          ¿Tu agencia todavía no usa viajerOS?{" "}
          <Link href="/registro" className="font-medium text-brand-text hover:underline">
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}
