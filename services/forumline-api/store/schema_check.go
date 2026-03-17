package store

import (
	"context"
	"fmt"
	"log"
	"strings"
)

// ValidateSchema checks for common schema issues that can silently break
// the app (UUID/TEXT mismatches, missing FKs, stale trigger functions).
// Logs warnings on startup — does not block the server from starting.
func (s *Store) ValidateSchema(ctx context.Context) {
	var issues []string

	// Check 1: forumline_profiles.id must be TEXT (not UUID)
	var profileIDType string
	if err := s.Pool.QueryRow(ctx,
		`SELECT data_type FROM information_schema.columns
		 WHERE table_name = 'forumline_profiles' AND column_name = 'id'`,
	).Scan(&profileIDType); err == nil && profileIDType != "text" {
		issues = append(issues, fmt.Sprintf("forumline_profiles.id is %s (expected text)", profileIDType))
	}

	// Check 2: All user ID columns must be TEXT
	rows, err := s.Pool.Query(ctx,
		`SELECT table_name, column_name, data_type
		 FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name LIKE 'forumline_%'
		   AND column_name IN ('user_id','sender_id','caller_id','callee_id','created_by','owner_id')
		   AND data_type != 'text'`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var table, col, dtype string
			if rows.Scan(&table, &col, &dtype) == nil {
				issues = append(issues, fmt.Sprintf("%s.%s is %s (expected text)", table, col, dtype))
			}
		}
	}

	// Check 3: Trigger functions must not use UUID[] for member_ids
	var uuidTriggerCount int
	if err := s.Pool.QueryRow(ctx,
		`SELECT count(*) FROM pg_proc WHERE prosrc LIKE '%UUID[]%'`,
	).Scan(&uuidTriggerCount); err == nil && uuidTriggerCount > 0 {
		issues = append(issues, fmt.Sprintf("%d trigger function(s) still use UUID[] instead of TEXT[]", uuidTriggerCount))
	}

	// Check 4: All user ID columns should have FK to forumline_profiles
	missingFKRows, err := s.Pool.Query(ctx,
		`SELECT c.table_name, c.column_name
		 FROM information_schema.columns c
		 WHERE c.table_schema = 'public' AND c.table_name LIKE 'forumline_%'
		   AND c.column_name IN ('user_id','sender_id','caller_id','callee_id','created_by','owner_id')
		   AND NOT EXISTS (
		     SELECT 1 FROM pg_constraint pc
		     JOIN pg_attribute a ON a.attrelid = pc.conrelid AND a.attnum = ANY(pc.conkey)
		     WHERE pc.contype = 'f' AND pc.confrelid = 'forumline_profiles'::regclass
		       AND pc.conrelid = c.table_name::regclass AND a.attname = c.column_name
		   )`)
	if err == nil {
		defer missingFKRows.Close()
		for missingFKRows.Next() {
			var table, col string
			if missingFKRows.Scan(&table, &col) == nil {
				issues = append(issues, fmt.Sprintf("%s.%s missing FK to forumline_profiles", table, col))
			}
		}
	}

	if len(issues) > 0 {
		log.Printf("⚠️  SCHEMA VALIDATION: %d issue(s) found:\n  - %s", len(issues), strings.Join(issues, "\n  - "))
	} else {
		log.Println("Schema validation: OK")
	}
}
