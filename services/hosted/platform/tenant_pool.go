package platform

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type tenantConnKey struct{}

// TenantPool wraps a *pgxpool.Pool and routes queries to the correct
// PostgreSQL schema based on the tenant stored in the request context.
//
// In multi-tenant mode, middleware calls SetTenant to acquire a connection,
// set search_path, and store it in context. Subsequent calls to Query/QueryRow/Exec
// use that connection — so all handler code works unchanged.
//
// In single-tenant mode (or if no tenant is in context), queries go directly
// to the underlying pool with the default search_path.
type TenantPool struct {
	Pool *pgxpool.Pool
}

// SetTenant acquires a connection from the pool, sets its search_path to the
// tenant's schema, and returns a new context containing that connection.
// The returned release function MUST be called when the request is done
// (typically deferred in middleware).
func (tp *TenantPool) SetTenant(ctx context.Context, schemaName string) (context.Context, func(), error) {
	conn, err := tp.Pool.Acquire(ctx)
	if err != nil {
		return ctx, nil, fmt.Errorf("acquire connection: %w", err)
	}

	// Use pgx.Identifier.Sanitize to prevent SQL injection in schema name
	sanitized := pgx.Identifier{schemaName}.Sanitize()
	_, err = conn.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", sanitized))
	if err != nil {
		conn.Release()
		return ctx, nil, fmt.Errorf("set search_path to %s: %w", schemaName, err)
	}

	ctx = context.WithValue(ctx, tenantConnKey{}, conn)
	return ctx, func() {
		// Reset search_path before returning connection to pool
		_, _ = conn.Exec(context.Background(), "SET search_path TO public")
		conn.Release()
	}, nil
}

// acquireWithSchema gets a short-lived connection with the correct search_path
// for requests that don't hold a persistent connection (e.g. SSE streams).
func (tp *TenantPool) acquireWithSchema(ctx context.Context) (*pgxpool.Conn, error) {
	schema := SchemaFromContext(ctx)
	if schema == "" {
		return nil, fmt.Errorf("no tenant schema in context")
	}
	conn, err := tp.Pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	sanitized := pgx.Identifier{schema}.Sanitize()
	if _, err := conn.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", sanitized)); err != nil {
		conn.Release()
		return nil, err
	}
	return conn, nil
}

// Query executes a query. If a tenant connection is in context, uses that.
// If only a schema is in context (SSE streams), acquires a connection briefly.
// Otherwise falls through to the pool (for platform-level queries).
func (tp *TenantPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if conn, ok := ctx.Value(tenantConnKey{}).(*pgxpool.Conn); ok {
		return conn.Query(ctx, sql, args...)
	}
	if SchemaFromContext(ctx) != "" {
		conn, err := tp.acquireWithSchema(ctx)
		if err != nil {
			return nil, err
		}
		rows, err := conn.Query(ctx, sql, args...)
		if err != nil {
			conn.Release()
			return nil, err
		}
		// rows.Close() will release the connection — wrap via callback
		return &releaseRows{Rows: rows, release: conn.Release}, nil
	}
	return tp.Pool.Query(ctx, sql, args...)
}

// QueryRow executes a query returning a single row.
func (tp *TenantPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if conn, ok := ctx.Value(tenantConnKey{}).(*pgxpool.Conn); ok {
		return conn.QueryRow(ctx, sql, args...)
	}
	if SchemaFromContext(ctx) != "" {
		conn, err := tp.acquireWithSchema(ctx)
		if err != nil {
			return &errRow{err: err}
		}
		row := conn.QueryRow(ctx, sql, args...)
		return &releaseRow{Row: row, release: conn.Release}
	}
	return tp.Pool.QueryRow(ctx, sql, args...)
}

// Exec executes a statement.
func (tp *TenantPool) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if conn, ok := ctx.Value(tenantConnKey{}).(*pgxpool.Conn); ok {
		return conn.Exec(ctx, sql, args...)
	}
	if SchemaFromContext(ctx) != "" {
		conn, err := tp.acquireWithSchema(ctx)
		if err != nil {
			return pgconn.CommandTag{}, err
		}
		defer conn.Release()
		return conn.Exec(ctx, sql, args...)
	}
	return tp.Pool.Exec(ctx, sql, args...)
}

// releaseRow wraps pgx.Row to release the connection after Scan.
type releaseRow struct {
	pgx.Row
	release func()
}

func (r *releaseRow) Scan(dest ...any) error {
	defer r.release()
	return r.Row.Scan(dest...)
}

// errRow is a pgx.Row that always returns an error.
type errRow struct {
	err error
}

func (r *errRow) Scan(dest ...any) error {
	return r.err
}

// releaseRows wraps pgx.Rows to release the connection when closed.
type releaseRows struct {
	pgx.Rows
	release func()
}

func (r *releaseRows) Close() {
	r.Rows.Close()
	r.release()
}
