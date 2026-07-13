import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function RegistroPage() {
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
            Creá tu cuenta
          </h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            En dos minutos tu agencia está vendiendo con viajerOS.
          </p>
        </div>

        <div className="card p-6">
          <RegisterForm />
        </div>

        <p className="mt-6 text-center text-sm text-ink-faint">
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="font-medium text-brand-text hover:underline">
            Ingresar
          </Link>
        </p>
      </div>
    </div>
  );
}
