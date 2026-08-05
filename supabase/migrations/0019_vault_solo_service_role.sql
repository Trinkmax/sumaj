-- Las funciones de la 0018 quedaron ejecutables por `anon` y `authenticated`.
--
-- `revoke ... from public` no alcanza en Supabase: el proyecto tiene ALTER
-- DEFAULT PRIVILEGES que le concede EXECUTE a anon, authenticated y service_role
-- sobre TODA función nueva del esquema public. Revocarle a PUBLIC saca el permiso
-- implícito, pero los grants explícitos de esos tres roles quedan intactos.
--
-- El agujero era grande: `wa_cloud_config()` devuelve el access token de Meta
-- descifrado, y PostgREST expone todo lo ejecutable del esquema public. Con la
-- clave publicable (que por definición está en el browser) y el uuid del canal,
-- cualquiera podía pedir /rest/v1/rpc/wa_cloud_config y llevarse el token
-- permanente, el App Secret y el verify token de la agencia.
--
-- Lo detectó el linter de Supabase (0028/0029) apenas se aplicó la 0018.

revoke all on function public.wa_cloud_secret_set(uuid, text, text) from anon, authenticated;
revoke all on function public.wa_cloud_secret_clear(uuid) from anon, authenticated;
revoke all on function public.wa_cloud_config(uuid) from anon, authenticated;
revoke all on function public.wa_cloud_config_by_phone_number_id(text) from anon, authenticated;
revoke all on function public.wa_cloud_config_by_slug(text) from anon, authenticated;
revoke all on function public.wa_cloud_verify_token_matches(text) from anon, authenticated;

-- La función del trigger no la llama nadie por RPC: corre sola al insertar el
-- canal. No tiene por qué estar en la API pública.
revoke all on function public.wa_cloud_credentials_bootstrap() from public, anon, authenticated;
