"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Eye, EyeOff, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="flex flex-col items-center gap-3 py-2 text-center animate-scale-in">
        <div className="flex size-14 items-center justify-center rounded-full bg-tone-emerald-soft text-tone-emerald-text ring-4 ring-tone-emerald-soft/40">
          <MailCheck className="size-6" strokeWidth={1.75} />
        </div>
        <div>
          <p className="font-display text-lg font-semibold text-ink">Revisá tu email</p>
          <p className="mt-1 text-sm text-ink-soft">
            Te mandamos un link a <span className="font-medium text-ink">{email}</span> para
            confirmar tu cuenta. Después ingresá desde el login.
          </p>
        </div>
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
          className="h-11"
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
          className="h-11"
        />
      </div>
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Mínimo 6 caracteres"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-11 pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-tone-red-line bg-tone-red-soft px-3 py-2.5 text-[13px] text-tone-red-text animate-scale-in">
          <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.75} />
          {error}
        </p>
      )}

      <Button type="submit" size="lg" loading={loading} className="w-full">
        Crear cuenta
      </Button>
    </form>
  );
}
