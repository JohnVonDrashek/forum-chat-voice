-- +goose Up
-- Baseline: tenant schema was created by schema_template.sql during provisioning.
-- This migration exists solely to establish the goose_db_version table in each
-- tenant schema and mark the initial schema state as version 1.
-- No DDL changes — all tables, triggers, and seed data already exist.

-- +goose Down
