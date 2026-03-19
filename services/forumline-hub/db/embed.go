package db

import (
	"embed"
	"io/fs"
	"log"
)

//go:embed migrations/*.sql
var embedFS embed.FS

// Migrations is an fs.FS rooted at the migrations/ directory,
// so goose sees files like "00001_baseline.sql" at the top level.
var Migrations fs.FS

func init() {
	var err error
	Migrations, err = fs.Sub(embedFS, "migrations")
	if err != nil {
		log.Fatalf("failed to create migrations sub-FS: %v", err)
	}
}
