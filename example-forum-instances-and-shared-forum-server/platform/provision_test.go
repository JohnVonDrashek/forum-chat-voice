package platform

import (
	"testing"
)

func TestValidSlug(t *testing.T) {
	tests := []struct {
		slug  string
		valid bool
	}{
		{"myforum", true},
		{"my-forum", true},
		{"a", true},
		{"ab", true},
		{"a1b2c3", true},
		{"forum-name-with-hyphens", true},
		{"a1234567890123456789012345678901234567890", false}, // 41 chars
		{"1234567890123456789012345678901234567890", true},   // 40 chars
		{"-starts-with-hyphen", false},
		{"ends-with-hyphen-", false},
		{"has spaces", false},
		{"HAS_UPPERCASE", false},
		{"has_underscore", false},
		{"has.dot", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.slug, func(t *testing.T) {
			got := validSlug.MatchString(tt.slug)
			if got != tt.valid {
				t.Errorf("validSlug(%q) = %v, want %v", tt.slug, got, tt.valid)
			}
		})
	}
}

func TestReservedSlugs(t *testing.T) {
	reserved := []string{"www", "app", "api", "demo", "admin", "mail", "smtp",
		"ftp", "ssh", "ns1", "ns2", "cdn", "forum-b", "status", "docs", "blog"}

	for _, slug := range reserved {
		if !reservedSlugs[slug] {
			t.Errorf("%q should be reserved", slug)
		}
	}

	nonReserved := []string{"myforum", "gaming", "tech", "news"}
	for _, slug := range nonReserved {
		if reservedSlugs[slug] {
			t.Errorf("%q should not be reserved", slug)
		}
	}
}

func TestSchemaNameGeneration(t *testing.T) {
	tests := []struct {
		slug       string
		wantSchema string
		wantDomain string
	}{
		{"myforum", "forum_myforum", "myforum.forumline.net"},
		{"my-forum", "forum_my_forum", "my-forum.forumline.net"},
		{"test-forum-1", "forum_test_forum_1", "test-forum-1.forumline.net"},
	}

	for _, tt := range tests {
		t.Run(tt.slug, func(t *testing.T) {
			schema := "forum_" + replaceHyphens(tt.slug)
			domain := tt.slug + ".forumline.net"

			if schema != tt.wantSchema {
				t.Errorf("schema = %q, want %q", schema, tt.wantSchema)
			}
			if domain != tt.wantDomain {
				t.Errorf("domain = %q, want %q", domain, tt.wantDomain)
			}
		})
	}
}

func replaceHyphens(s string) string {
	result := make([]byte, len(s))
	for i := range s {
		if s[i] == '-' {
			result[i] = '_'
		} else {
			result[i] = s[i]
		}
	}
	return string(result)
}
