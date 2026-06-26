package examples

import "testing"

// newTestService creates a Service suitable for testing with a no-op logger.
func newTestService(t *testing.T) *Service {
	t.Helper()
	return NewService(discardLogger())
}

func TestProcessOperationValidInputIncrementsCount(t *testing.T) {
	svc := newTestService(t)

	result1, err := svc.ProcessOperation("First")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result1 != "Processed: First (Op #1)" {
		t.Errorf("got %q, want %q", result1, "Processed: First (Op #1)")
	}

	result2, err := svc.ProcessOperation("Second")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result2 != "Processed: Second (Op #2)" {
		t.Errorf("got %q, want %q", result2, "Processed: Second (Op #2)")
	}

	if svc.OperationCount() != 2 {
		t.Errorf("OperationCount() = %d, want 2", svc.OperationCount())
	}
}

func TestProcessOperationEmptyInputReturnsError(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.ProcessOperation("")
	if err == nil {
		t.Fatal("expected error for empty input, got nil")
	}
}

func TestOperationCountStartsAtZero(t *testing.T) {
	svc := newTestService(t)

	if svc.OperationCount() != 0 {
		t.Errorf("OperationCount() = %d, want 0", svc.OperationCount())
	}
}
