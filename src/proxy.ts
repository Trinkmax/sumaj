import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Rutas que no requieren sesión.
 *
 * `/api/wa` son los webhooks de WhatsApp: los llama Meta (Cloud API), el worker
 * de Baileys y el cron, ninguno con cookie de usuario. Si el proxy los mandara
 * al login, la verificación del webhook de Meta fallaría y no entraría ninguna
 * consulta. Cada uno valida lo suyo por su cuenta y RECHAZA si le falta el
 * secreto: firma con el App Secret de Meta (verify token en el GET de
 * verificación), firma HMAC del worker y x-cron-secret del cron.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/registro",
  "/p/",
  "/r/",
  "/api/public",
  "/api/wa",
  // política de privacidad: Meta la exige pública para publicar la app de WhatsApp
  "/privacidad",
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname === p.replace(/\/$/, "") || pathname.startsWith(p),
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANTE: no ejecutar lógica entre createServerClient y getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/registro")) {
    const url = request.nextUrl.clone();
    url.pathname = "/inicio";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // todo salvo estáticos e imágenes
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
