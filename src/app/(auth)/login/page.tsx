import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm animate-slide-up-slow">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/viajerOS-2.png"
            alt="viajerOS"
            className="mx-auto h-9 w-auto"
          />
          <p className="mt-2 text-sm text-ink-soft">
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
          <Link href="/registro" className="font-medium text-brand-700 hover:underline">
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}
