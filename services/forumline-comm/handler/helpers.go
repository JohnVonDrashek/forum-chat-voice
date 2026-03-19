package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/forumline/forumline/backend/httpkit"
	"github.com/forumline/forumline/services/forumline-comm/service"
)

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	httpkit.WriteJSON(w, status, v)
}

func trimString(s string) string {
	return strings.TrimSpace(s)
}

func writeServiceError(w http.ResponseWriter, err error) {
	var validationErr *service.ValidationError
	var notFoundErr *service.NotFoundError
	var conflictErr *service.ConflictError
	var forbiddenErr *service.ForbiddenError
	switch {
	case errors.As(err, &validationErr):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": validationErr.Msg})
	case errors.As(err, &notFoundErr):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": notFoundErr.Msg})
	case errors.As(err, &conflictErr):
		writeJSON(w, http.StatusConflict, map[string]string{"error": conflictErr.Msg})
	case errors.As(err, &forbiddenErr):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": forbiddenErr.Msg})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
	}
}
