package store

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
)

// pgtextPtr converts pgtype.Text to *string (nil when not valid).
func pgtextPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

// textToPgtext converts a string to pgtype.Text (always valid).
func textToPgtext(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: true}
}

// optTextToPgtext converts *string to pgtype.Text (nil → invalid).
func optTextToPgtext(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

// pgUUID converts a UUID string to pgtype.UUID for sqlc queries.
// Panics if s is not a valid UUID — this is a programming error, not a runtime condition.
func pgUUID(s string) pgtype.UUID {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		panic(fmt.Sprintf("pgUUID: invalid UUID %q: %v", s, err))
	}
	return u
}

// uuidStr converts pgtype.UUID back to string.
func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return formatUUID(b)
}

func formatUUID(b [16]byte) string {
	const hex = "0123456789abcdef"
	buf := make([]byte, 36)
	j := 0
	for i, v := range b {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			buf[j] = '-'
			j++
		}
		buf[j] = hex[v>>4]
		buf[j+1] = hex[v&0x0f]
		j += 2
	}
	return string(buf)
}
