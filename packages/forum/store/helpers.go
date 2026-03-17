package store

import (
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/forumline/forumline/forum/model"
	"github.com/forumline/forumline/forum/sqlcdb"
)

// pgUUID converts a UUID string to pgtype.UUID.
// Panics if s is not a valid UUID — this is a programming error, not a runtime condition.
func pgUUID(s string) pgtype.UUID {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		panic(fmt.Sprintf("pgUUID: invalid UUID %q: %v", s, err))
	}
	return u
}

// uuidStr converts pgtype.UUID to string.
func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// pgtextPtr converts pgtype.Text to *string.
func pgtextPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

// textToPgtext converts string to pgtype.Text.
func textToPgtext(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: true}
}

// optTextToPgtext converts *string to pgtype.Text.
func optTextToPgtext(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

// pgTimestamp converts time.Time to pgtype.Timestamptz.
func pgTimestamp(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// tsStr converts pgtype.Timestamptz to RFC3339 string.
func tsStr(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.Format(time.RFC3339)
}

// tsStrPtr converts pgtype.Timestamptz to *string (nil if zero).
func tsStrPtr(t pgtype.Timestamptz) *string {
	if !t.Valid || t.Time.IsZero() {
		return nil
	}
	s := t.Time.Format(time.RFC3339)
	return &s
}

// profileFromSqlc converts a sqlcdb.Profile to a model.Profile.
func profileFromSqlc(p sqlcdb.Profile) model.Profile {
	return model.Profile{
		ID:          uuidStr(p.ID),
		Username:    p.Username,
		DisplayName: pgtextPtr(p.DisplayName),
		AvatarURL:   pgtextPtr(p.AvatarUrl),
		Bio:         pgtextPtr(p.Bio),
		Website:     pgtextPtr(p.Website),
		IsAdmin:     p.IsAdmin,
		ForumlineID: pgtextPtr(p.ForumlineID),
		CreatedAt:   tsStr(p.CreatedAt),
		UpdatedAt:   tsStr(p.UpdatedAt),
	}
}

// authorProfileFromThread extracts a model.Profile from thread row author fields.
func authorProfileFromThreadRow(
	id pgtype.UUID, username string, displayName, avatarURL, bio, website pgtype.Text,
	isAdmin bool, forumlineID pgtype.Text, createdAt, updatedAt pgtype.Timestamptz,
) model.Profile {
	return model.Profile{
		ID:          uuidStr(id),
		Username:    username,
		DisplayName: pgtextPtr(displayName),
		AvatarURL:   pgtextPtr(avatarURL),
		Bio:         pgtextPtr(bio),
		Website:     pgtextPtr(website),
		IsAdmin:     isAdmin,
		ForumlineID: pgtextPtr(forumlineID),
		CreatedAt:   tsStr(createdAt),
		UpdatedAt:   tsStr(updatedAt),
	}
}

// categoryFromThreadRow extracts a model.Category from thread row category fields.
func categoryFromThreadRow(
	id pgtype.UUID, name, slug string, description pgtype.Text, sortOrder int32, createdAt pgtype.Timestamptz,
) model.Category {
	return model.Category{
		ID:          uuidStr(id),
		Name:        name,
		Slug:        slug,
		Description: pgtextPtr(description),
		SortOrder:   int(sortOrder),
		CreatedAt:   tsStr(createdAt),
	}
}

// threadRowToModel converts a GetThreadRow to model.Thread.
func threadRowToModel(r sqlcdb.GetThreadRow) model.Thread {
	return model.Thread{
		ID:         uuidStr(r.ID),
		CategoryID: uuidStr(r.CategoryID),
		AuthorID:   uuidStr(r.AuthorID),
		Title:      r.Title,
		Slug:       r.Slug,
		Content:    pgtextPtr(r.Content),
		ImageURL:   pgtextPtr(r.ImageUrl),
		IsPinned:   r.IsPinned,
		IsLocked:   r.IsLocked,
		ViewCount:  int(r.ViewCount),
		PostCount:  int(r.PostCount),
		LastPostAt: tsStrPtr(r.LastPostAt),
		CreatedAt:  tsStr(r.CreatedAt),
		UpdatedAt:  tsStr(r.UpdatedAt),
		Author: authorProfileFromThreadRow(
			r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
			r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
			r.AuthorCreatedAt, r.AuthorUpdatedAt,
		),
		Category: categoryFromThreadRow(
			r.CatID, r.CatName, r.CatSlug, r.CatDescription, r.CatSortOrder, r.CatCreatedAt,
		),
	}
}

// listThreadsRowToModel converts a ListThreadsRow to model.Thread.
func listThreadsRowToModel(r sqlcdb.ListThreadsRow) model.Thread {
	return model.Thread{
		ID:         uuidStr(r.ID),
		CategoryID: uuidStr(r.CategoryID),
		AuthorID:   uuidStr(r.AuthorID),
		Title:      r.Title,
		Slug:       r.Slug,
		Content:    pgtextPtr(r.Content),
		ImageURL:   pgtextPtr(r.ImageUrl),
		IsPinned:   r.IsPinned,
		IsLocked:   r.IsLocked,
		ViewCount:  int(r.ViewCount),
		PostCount:  int(r.PostCount),
		LastPostAt: tsStrPtr(r.LastPostAt),
		CreatedAt:  tsStr(r.CreatedAt),
		UpdatedAt:  tsStr(r.UpdatedAt),
		Author: authorProfileFromThreadRow(
			r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
			r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
			r.AuthorCreatedAt, r.AuthorUpdatedAt,
		),
		Category: categoryFromThreadRow(
			r.CatID, r.CatName, r.CatSlug, r.CatDescription, r.CatSortOrder, r.CatCreatedAt,
		),
	}
}

// listThreadsByCategoryRowToModel converts a ListThreadsByCategoryRow to model.Thread.
func listThreadsByCategoryRowToModel(r sqlcdb.ListThreadsByCategoryRow) model.Thread {
	return model.Thread{
		ID:         uuidStr(r.ID),
		CategoryID: uuidStr(r.CategoryID),
		AuthorID:   uuidStr(r.AuthorID),
		Title:      r.Title,
		Slug:       r.Slug,
		Content:    pgtextPtr(r.Content),
		ImageURL:   pgtextPtr(r.ImageUrl),
		IsPinned:   r.IsPinned,
		IsLocked:   r.IsLocked,
		ViewCount:  int(r.ViewCount),
		PostCount:  int(r.PostCount),
		LastPostAt: tsStrPtr(r.LastPostAt),
		CreatedAt:  tsStr(r.CreatedAt),
		UpdatedAt:  tsStr(r.UpdatedAt),
		Author: authorProfileFromThreadRow(
			r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
			r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
			r.AuthorCreatedAt, r.AuthorUpdatedAt,
		),
		Category: categoryFromThreadRow(
			r.CatID, r.CatName, r.CatSlug, r.CatDescription, r.CatSortOrder, r.CatCreatedAt,
		),
	}
}

// listUserThreadsRowToModel converts a ListUserThreadsRow to model.Thread.
func listUserThreadsRowToModel(r sqlcdb.ListUserThreadsRow) model.Thread {
	return model.Thread{
		ID:         uuidStr(r.ID),
		CategoryID: uuidStr(r.CategoryID),
		AuthorID:   uuidStr(r.AuthorID),
		Title:      r.Title,
		Slug:       r.Slug,
		Content:    pgtextPtr(r.Content),
		ImageURL:   pgtextPtr(r.ImageUrl),
		IsPinned:   r.IsPinned,
		IsLocked:   r.IsLocked,
		ViewCount:  int(r.ViewCount),
		PostCount:  int(r.PostCount),
		LastPostAt: tsStrPtr(r.LastPostAt),
		CreatedAt:  tsStr(r.CreatedAt),
		UpdatedAt:  tsStr(r.UpdatedAt),
		Author: authorProfileFromThreadRow(
			r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
			r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
			r.AuthorCreatedAt, r.AuthorUpdatedAt,
		),
		Category: categoryFromThreadRow(
			r.CatID, r.CatName, r.CatSlug, r.CatDescription, r.CatSortOrder, r.CatCreatedAt,
		),
	}
}

// searchThreadsRowToModel converts a SearchThreadsRow to model.Thread.
func searchThreadsRowToModel(r sqlcdb.SearchThreadsRow) model.Thread {
	return model.Thread{
		ID:         uuidStr(r.ID),
		CategoryID: uuidStr(r.CategoryID),
		AuthorID:   uuidStr(r.AuthorID),
		Title:      r.Title,
		Slug:       r.Slug,
		Content:    pgtextPtr(r.Content),
		ImageURL:   pgtextPtr(r.ImageUrl),
		IsPinned:   r.IsPinned,
		IsLocked:   r.IsLocked,
		ViewCount:  int(r.ViewCount),
		PostCount:  int(r.PostCount),
		LastPostAt: tsStrPtr(r.LastPostAt),
		CreatedAt:  tsStr(r.CreatedAt),
		UpdatedAt:  tsStr(r.UpdatedAt),
		Author: authorProfileFromThreadRow(
			r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
			r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
			r.AuthorCreatedAt, r.AuthorUpdatedAt,
		),
		Category: categoryFromThreadRow(
			r.CatID, r.CatName, r.CatSlug, r.CatDescription, r.CatSortOrder, r.CatCreatedAt,
		),
	}
}

// postRowToModel converts a ListPostsByThreadRow to model.Post.
func postRowToModel(r sqlcdb.ListPostsByThreadRow) model.Post {
	return model.Post{
		ID:        uuidStr(r.ID),
		ThreadID:  uuidStr(r.ThreadID),
		AuthorID:  uuidStr(r.AuthorID),
		Content:   r.Content,
		ReplyToID: pgtextPtr(pgtype.Text{String: uuidStr(r.ReplyToID), Valid: r.ReplyToID.Valid}),
		CreatedAt: tsStr(r.CreatedAt),
		UpdatedAt: tsStr(r.UpdatedAt),
		Author: authorProfileFromThreadRow(
			r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
			r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
			r.AuthorCreatedAt, r.AuthorUpdatedAt,
		),
	}
}

// listUserPostsRowToModel converts a ListUserPostsRow to model.Post.
func listUserPostsRowToModel(r sqlcdb.ListUserPostsRow) model.Post {
	return model.Post{
		ID:        uuidStr(r.ID),
		ThreadID:  uuidStr(r.ThreadID),
		AuthorID:  uuidStr(r.AuthorID),
		Content:   r.Content,
		ReplyToID: pgtextPtr(pgtype.Text{String: uuidStr(r.ReplyToID), Valid: r.ReplyToID.Valid}),
		CreatedAt: tsStr(r.CreatedAt),
		UpdatedAt: tsStr(r.UpdatedAt),
		Author: authorProfileFromThreadRow(
			r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
			r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
			r.AuthorCreatedAt, r.AuthorUpdatedAt,
		),
	}
}

// searchPostsRowToModel converts a SearchPostsRow to model.Post.
func searchPostsRowToModel(r sqlcdb.SearchPostsRow) model.Post {
	return model.Post{
		ID:        uuidStr(r.ID),
		ThreadID:  uuidStr(r.ThreadID),
		AuthorID:  uuidStr(r.AuthorID),
		Content:   r.Content,
		ReplyToID: pgtextPtr(pgtype.Text{String: uuidStr(r.ReplyToID), Valid: r.ReplyToID.Valid}),
		CreatedAt: tsStr(r.CreatedAt),
		UpdatedAt: tsStr(r.UpdatedAt),
		Author: authorProfileFromThreadRow(
			r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
			r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
			r.AuthorCreatedAt, r.AuthorUpdatedAt,
		),
	}
}

// bookmarkRowToModel converts a ListBookmarksRow to model.Bookmark.
func bookmarkRowToModel(r sqlcdb.ListBookmarksRow) model.Bookmark {
	return model.Bookmark{
		ID:        uuidStr(r.ID),
		CreatedAt: tsStr(r.BookmarkCreatedAt),
		Thread: model.Thread{
			ID:         uuidStr(r.ThreadID),
			CategoryID: uuidStr(r.CategoryID),
			AuthorID:   uuidStr(r.AuthorID),
			Title:      r.Title,
			Slug:       r.Slug,
			Content:    pgtextPtr(r.Content),
			ImageURL:   pgtextPtr(r.ImageUrl),
			IsPinned:   r.IsPinned,
			IsLocked:   r.IsLocked,
			ViewCount:  int(r.ViewCount),
			PostCount:  int(r.PostCount),
			LastPostAt: tsStrPtr(r.LastPostAt),
			CreatedAt:  tsStr(r.ThreadCreatedAt),
			UpdatedAt:  tsStr(r.ThreadUpdatedAt),
			Author: authorProfileFromThreadRow(
				r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
				r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
				r.AuthorCreatedAt, r.AuthorUpdatedAt,
			),
			Category: categoryFromThreadRow(
				r.CatID, r.CatName, r.CatSlug, r.CatDescription, r.CatSortOrder, r.CatCreatedAt,
			),
		},
	}
}

// chatMessageRowToModel converts a ListChatMessagesRow to model.ChatMessage.
func chatMessageRowToModel(r sqlcdb.ListChatMessagesRow) model.ChatMessage {
	return model.ChatMessage{
		ID:        uuidStr(r.ID),
		ChannelID: uuidStr(r.ChannelID),
		AuthorID:  uuidStr(r.AuthorID),
		Content:   r.Content,
		CreatedAt: tsStr(r.CreatedAt),
		Author: authorProfileFromThreadRow(
			r.AuthorID2, r.AuthorUsername, r.AuthorDisplayName, r.AuthorAvatarUrl,
			r.AuthorBio, r.AuthorWebsite, r.AuthorIsAdmin, r.AuthorForumlineID,
			r.AuthorCreatedAt, r.AuthorUpdatedAt,
		),
	}
}

// voicePresenceRowToModel converts a ListVoicePresenceRow to model.VoicePresence.
func voicePresenceRowToModel(r sqlcdb.ListVoicePresenceRow) model.VoicePresence {
	return model.VoicePresence{
		ID:       uuidStr(r.ID),
		UserID:   uuidStr(r.UserID),
		RoomSlug: r.RoomSlug,
		JoinedAt: tsStr(r.JoinedAt),
		Profile: authorProfileFromThreadRow(
			r.ProfileID, r.ProfileUsername, r.ProfileDisplayName, r.ProfileAvatarUrl,
			r.ProfileBio, r.ProfileWebsite, r.ProfileIsAdmin, r.ProfileForumlineID,
			r.ProfileCreatedAt, r.ProfileUpdatedAt,
		),
	}
}
