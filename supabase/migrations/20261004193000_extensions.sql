-- Extensões que o export do schema public não inclui.
-- Precisam existir antes do export (views em cron.job, chamadas net.http_post).
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
