"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Email o contraseña incorrectos."
          : "No pudimos iniciar sesión. Probá de nuevo.",
      );
      setLoading(false);
      return;
    }

    const next = searchParams.get("next");
    // solo paths internos: "//evil.com" o "/\evil.com" serían open redirect
    const safe = next && /^\/(?![/\\])/.test(next) ? next : "/inicio";
    router.push(safe);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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
          autoFocus
          className="h-11"
        />
      </div>
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
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
        Ingresar
      </Button>
    </form>
  );
}
