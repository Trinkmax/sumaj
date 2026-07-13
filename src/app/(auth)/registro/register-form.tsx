"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });

    if (!error && !data.session) {
      // proyecto con confirmación de email activada
      setNeedsConfirm(true);
      setLoading(false);
      return;
    }

    if (error) {
      setError(
        error.message.includes("already registered")
          ? "Ese email ya tiene una cuenta. Probá ingresar."
          : error.message.includes("Password")
            ? "La contraseña debe tener al menos 6 caracteres."
            : "No pudimos crear la cuenta. Probá de nuevo.",
      );
      setLoading(false);
      return;
    }

    router.push("/onboarding");
    router.refresh();
  }

  if (needsConfirm) {
    return (
      <div className="space-y-2 text-center animate-scale-in">
        <p className="text-3xl">📬</p>
        <p className="font-medium text-ink">Revisá tu email</p>
        <p className="text-sm text-ink-soft">
          Te mandamos un link a <span className="font-medium">{email}</span> para
          confirmar tu cuenta. Después ingresá desde el login.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Tu nombre</Label>
        <Input
          id="name"
          autoComplete="name"
          placeholder="Tomás Burgos"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="vos@tuagencia.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          placeholder="Mínimo 6 caracteres"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700 animate-scale-in">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" loading={loading} className="w-full">
        Crear cuenta
      </Button>
    </form>
  );
}
