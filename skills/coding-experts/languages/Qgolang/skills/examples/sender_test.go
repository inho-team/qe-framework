package examples

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestSenderImplementations runs the same assertions against every Sender
// implementation. Both are real - FileSender writes actual files, MemorySender
// stores actual data. This validates behavioral parity without fabrication.
func TestSenderImplementations(t *testing.T) {
	implementations := []struct {
		name   string
		create func(t *testing.T) Sender
	}{
		{
			name: "FileSender",
			create: func(t *testing.T) Sender {
				t.Helper()
				dir := t.TempDir()
				return NewFileSender(dir)
			},
		},
		{
			name: "MemorySender",
			create: func(t *testing.T) Sender {
				t.Helper()
				return NewMemorySender()
			},
		},
	}

	for _, impl := range implementations {
		t.Run(impl.name, func(t *testing.T) {
			sender := impl.create(t)
			ctx := context.Background()

			msg, err := NewMessage("alice@example.com", "Hello Alice")
			if err != nil {
				t.Fatalf("NewMessage: %v", err)
			}

			if err := sender.Send(ctx, msg); err != nil {
				t.Fatalf("Send: %v", err)
			}
		})
	}
}

func TestFileSenderWritesFile(t *testing.T) {
	dir := t.TempDir()
	sender := NewFileSender(dir)
	ctx := context.Background()

	msg, err := NewMessage("bob@example.com", "Test body")
	if err != nil {
		t.Fatalf("NewMessage: %v", err)
	}

	if err := sender.Send(ctx, msg); err != nil {
		t.Fatalf("Send: %v", err)
	}

	path := filepath.Join(dir, "msg_001.txt")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading output file: %v", err)
	}

	want := "To: bob@example.com\n\nTest body\n"
	if string(data) != want {
		t.Errorf("file content = %q, want %q", string(data), want)
	}
}

func TestMemorySenderStoresMessages(t *testing.T) {
	sender := NewMemorySender()
	ctx := context.Background()

	msg1, _ := NewMessage("alice@example.com", "First")
	msg2, _ := NewMessage("bob@example.com", "Second")

	if err := sender.Send(ctx, msg1); err != nil {
		t.Fatalf("Send msg1: %v", err)
	}
	if err := sender.Send(ctx, msg2); err != nil {
		t.Fatalf("Send msg2: %v", err)
	}

	msgs := sender.Messages()
	if len(msgs) != 2 {
		t.Fatalf("Messages() returned %d, want 2", len(msgs))
	}
	if msgs[0].To() != "alice@example.com" {
		t.Errorf("msgs[0].To() = %q, want %q", msgs[0].To(), "alice@example.com")
	}
	if msgs[1].Body() != "Second" {
		t.Errorf("msgs[1].Body() = %q, want %q", msgs[1].Body(), "Second")
	}
}

func TestNewMessageValidation(t *testing.T) {
	tests := []struct {
		name    string
		to      string
		body    string
		wantErr bool
	}{
		{name: "ValidMessage", to: "alice@example.com", body: "Hello", wantErr: false},
		{name: "EmptyToReturnsError", to: "", body: "Hello", wantErr: true},
		{name: "EmptyBodyReturnsError", to: "alice@example.com", body: "", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewMessage(tt.to, tt.body)
			if tt.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
