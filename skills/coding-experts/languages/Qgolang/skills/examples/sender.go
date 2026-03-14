package examples

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Message holds notification content. Unexported fields ensure construction
// only through NewMessage, which validates inputs.
type Message struct {
	to   string
	body string
}

// NewMessage creates a validated Message. Returns an error if either field
// is empty, since a notification without a recipient or body is meaningless.
func NewMessage(to, body string) (Message, error) {
	if to == "" {
		return Message{}, fmt.Errorf("to cannot be empty")
	}
	if body == "" {
		return Message{}, fmt.Errorf("body cannot be empty")
	}
	return Message{to: to, body: body}, nil
}

// To returns the recipient address.
func (m Message) To() string { return m.to }

// Body returns the notification content.
func (m Message) Body() string { return m.body }

// Sender delivers notifications through a real channel. We define the
// interface at the consumer so that each call site declares only the
// capability it needs.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// FileSender writes messages to files on disk. Each message produces one file
// in the output directory, providing a durable audit trail.
type FileSender struct {
	dir   string
	mu    sync.Mutex
	count int
}

// NewFileSender creates a FileSender that writes to the given directory.
func NewFileSender(dir string) *FileSender {
	return &FileSender{dir: dir}
}

// Send writes the message to a numbered file in the output directory.
func (f *FileSender) Send(_ context.Context, msg Message) error {
	f.mu.Lock()
	f.count++
	n := f.count
	f.mu.Unlock()

	path := filepath.Join(f.dir, fmt.Sprintf("msg_%03d.txt", n))
	content := fmt.Sprintf("To: %s\n\n%s\n", msg.To(), msg.Body())
	return os.WriteFile(path, []byte(content), 0644)
}

// MemorySender collects messages in memory. Useful for environments where
// file I/O or network delivery is not wanted (test environments, dry-run
// modes). This is NOT a mock - it is a real implementation that stores real
// data and can be inspected after the fact.
type MemorySender struct {
	mu       sync.Mutex
	messages []Message
}

// NewMemorySender creates an empty MemorySender.
func NewMemorySender() *MemorySender {
	return &MemorySender{}
}

// Send stores the message in the internal slice.
func (m *MemorySender) Send(_ context.Context, msg Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages = append(m.messages, msg)
	return nil
}

// Messages returns a copy of all sent messages. Returns a copy so the
// caller cannot mutate internal state.
func (m *MemorySender) Messages() []Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]Message, len(m.messages))
	copy(cp, m.messages)
	return cp
}
