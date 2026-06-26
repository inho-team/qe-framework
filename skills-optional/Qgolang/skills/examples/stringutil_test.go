package text

import "testing"

func TestTruncate(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		maxLen  int
		want    string
		wantErr bool
	}{
		{name: "ShortStringUnchanged", input: "Hello", maxLen: 10, want: "Hello"},
		{name: "ExactLengthUnchanged", input: "Hello", maxLen: 5, want: "Hello"},
		{name: "LongStringTruncated", input: "Hello World", maxLen: 8, want: "Hello..."},
		{name: "EmptyStringUnchanged", input: "", maxLen: 10, want: ""},
		{name: "MaxLenTooSmallReturnsError", input: "Hello", maxLen: 3, wantErr: true},
		{name: "MaxLenExactlyFourTruncates", input: "Hello", maxLen: 4, want: "H..."},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Truncate(tt.input, tt.maxLen)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("Truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
			}
		})
	}
}

func TestIsBlank(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{name: "EmptyStringIsBlank", input: "", want: true},
		{name: "WhitespaceOnlyIsBlank", input: "   \t\n", want: true},
		{name: "NonEmptyStringIsNotBlank", input: "Hello", want: false},
		{name: "StringWithSpacesIsNotBlank", input: " a ", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsBlank(tt.input)
			if got != tt.want {
				t.Errorf("IsBlank(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestToTitleCase(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "LowercaseConverted", input: "hello world", want: "Hello World"},
		{name: "UppercaseConverted", input: "HELLO WORLD", want: "Hello World"},
		{name: "MixedCaseConverted", input: "hELLO wORLD", want: "Hello World"},
		{name: "EmptyStringUnchanged", input: "", want: ""},
		{name: "WhitespaceOnlyUnchanged", input: "   ", want: "   "},
		{name: "SingleWordCapitalized", input: "hello", want: "Hello"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ToTitleCase(tt.input)
			if got != tt.want {
				t.Errorf("ToTitleCase(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
