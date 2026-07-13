import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function RegistroPage() {
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
          <p className="mt-2 text-sm text-ink-soft">Creá tu cuenta para empezar.</p>
        </div>

        <div className="card p-6">
          <RegisterForm />
        </div>

        <p className="mt-6 text-center text-sm text-ink-faint">
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Ingresar
          </Link>
        </p>
      </div>
    </div>
  );
}
