-- Citus extension setup — requires superuser privileges.
-- Runs via Docker entrypoint (/docker-entrypoint-initdb.d/) on first
-- container initialization only. Table schema is managed by goose
-- migrations embedded in the Go binary.

CREATE EXTENSION IF NOT EXISTS citus;

-- Enable schema-based sharding persistently (writes to postgresql.auto.conf).
-- New schemas are automatically distributed across Citus worker nodes.
ALTER SYSTEM SET citus.enable_schema_based_sharding = on;
SELECT pg_reload_conf();

SELECT 'Citus extension initialized.' AS status;
