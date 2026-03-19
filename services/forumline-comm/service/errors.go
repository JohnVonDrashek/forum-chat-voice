package service

import "strings"

type ValidationError struct {
	Msg string
}

func (e *ValidationError) Error() string { return e.Msg }

type NotFoundError struct {
	Msg string
}

func (e *NotFoundError) Error() string { return e.Msg }

type ConflictError struct {
	Msg string
}

func (e *ConflictError) Error() string { return e.Msg }

type ForbiddenError struct {
	Msg string
}

func (e *ForbiddenError) Error() string { return e.Msg }

func trimString(s string) string {
	return strings.TrimSpace(s)
}
