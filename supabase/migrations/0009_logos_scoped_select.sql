-- SELECT scopeado por agencia en logos (necesario para upsert del logo desde Configuración)
create policy "logos_select_own" on storage.objects for select to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select app.my_agency_ids())
  );
