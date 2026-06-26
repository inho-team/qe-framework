package examples

// Status represents the processing state of an order. We use an unexported
// struct with exported variables instead of iota constants because this
// pattern allows attaching behavior and multiple fields to each value,
// which iota constants cannot do.
type Status struct {
	value string
	code  int
}

// String returns the human-readable display name. Implements fmt.Stringer
// so Status values print meaningfully in logs and error messages.
func (s Status) String() string { return s.value }

// Code returns the numeric identifier used for database persistence and
// external system integration.
func (s Status) Code() int { return s.code }

// IsTerminal reports whether the status represents a final state that
// cannot transition further.
func (s Status) IsTerminal() bool {
	return s == StatusCompleted || s == StatusFailed
}

// IsEven reports whether the status code is even. Demonstrates how behavior
// can be encapsulated directly on the type.
func (s Status) IsEven() bool {
	return s.code%2 == 0
}

var (
	// StatusPending indicates an order is awaiting processing.
	StatusPending = Status{value: "Pending", code: 1}

	// StatusCompleted indicates an order has been fully processed.
	StatusCompleted = Status{value: "Completed", code: 2}

	// StatusFailed indicates an order could not be processed.
	StatusFailed = Status{value: "Failed", code: 3}
)

// AllStatuses returns every defined status value. Useful for iteration,
// validation, and populating UI selection lists.
func AllStatuses() []Status {
	return []Status{StatusPending, StatusCompleted, StatusFailed}
}
