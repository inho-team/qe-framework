package text

import (
	"errors"
	"strings"
	"unicode"
)

// Truncate shortens a string to maxLen characters, adding an ellipsis if
// truncation occurs. We require maxLen >= 4 so there is always room for at
// least one character plus the "..." suffix.
func Truncate(s string, maxLen int) (string, error) {
	if maxLen < 4 {
		return "", errors.New("maxLen must be at least 4 to accommodate ellipsis")
	}
	if len(s) <= maxLen {
		return s, nil
	}
	return s[:maxLen-3] + "...", nil
}

// IsBlank reports whether s is empty or contains only whitespace. This
// centralizes a check that appears throughout codebases so every caller
// uses the same definition of "blank."
func IsBlank(s string) bool {
	return strings.TrimSpace(s) == ""
}

// ToTitleCase converts s to title case, capitalizing the first letter of
// each word and lowercasing the rest. We handle this ourselves rather than
// using strings.Title (deprecated) to avoid surprising behavior with
// apostrophes and Unicode edge cases.
func ToTitleCase(s string) string {
	if IsBlank(s) {
		return s
	}
	words := strings.Fields(s)
	for i, w := range words {
		runes := []rune(strings.ToLower(w))
		if len(runes) > 0 {
			runes[0] = unicode.ToUpper(runes[0])
		}
		words[i] = string(runes)
	}
	return strings.Join(words, " ")
}
