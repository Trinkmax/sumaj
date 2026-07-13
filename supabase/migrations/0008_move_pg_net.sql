-- pg_net fuera del schema public (advisor 0014)
drop extension if exists pg_net;
create extension pg_net schema extensions;
