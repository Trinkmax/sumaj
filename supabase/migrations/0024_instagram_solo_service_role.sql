-- La misma trampa que la 0019, dos años de código después: las funciones de la
-- 0023 quedaron ejecutables por `anon` y `authenticated`.
--
-- `revoke ... from public` NO alcanza en Supabase. El proyecto tiene ALTER
-- DEFAULT PRIVILEGES que le concede EXECUTE a anon, authenticated y service_role
-- sobre toda función nueva del esquema public: revocarle a PUBLIC saca el
-- permiso implícito y deja los tres grants explícitos intactos. La 0023 hace el
-- revoke a `public` y por eso el linter (0028/0029) volvió a marcar todo apenas
-- se aplicó.
--
-- Lo que estaba abierto: `ig_config()` devuelve el access token de Instagram
-- descifrado, y PostgREST expone todo lo ejecutable del esquema public. Con la
-- clave publicable —que por definición vive en el browser— y el uuid del canal,
-- cualquiera podía pedir /rest/v1/rpc/ig_config y llevarse el token de la cuenta,
-- el App Secret y el verify token de la agencia.
--
-- REGLA: toda función nueva que toque el Vault se revoca SIEMPRE nombrando a
-- anon y authenticated, no a `public`.

revoke all on function public.ig_secret_set(uuid, text, text) from anon, authenticated;
revoke all on function public.ig_secret_clear(uuid) from anon, authenticated;
revoke all on function public.ig_config(uuid) from anon, authenticated;
revoke all on function public.ig_config_by_slug(text) from anon, authenticated;
revoke all on function public.ig_config_by_ig_user_id(text) from anon, authenticated;
revoke all on function public.ig_verify_token_matches(text) from anon, authenticated;

-- La función del trigger no la llama nadie por RPC: corre sola al insertar el
-- canal. No tiene por qué estar en la API pública.
revoke all on function public.ig_accounts_bootstrap() from public, anon, authenticated;
