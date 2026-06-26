package examples

import (
	"errors"
	"fmt"
	"io"
	"log"
)

// Logger defines the logging contract for Service. We define it at the
// consumer (here) rather than the provider, following Go's interface-at-the-
// consumer convention.
type Logger interface {
	Printf(format string, args ...any)
}

// Service manages operations and tracks usage. Unexported fields enforce
// construction through NewService, guaranteeing valid state.
type Service struct {
	logger         Logger
	operationCount int
}

// NewService creates a Service from its dependencies. This is the only way
// to obtain a valid Service instance.
func NewService(logger Logger) *Service {
	return &Service{
		logger: logger,
	}
}

// ProcessOperation performs a named operation and tracks the invocation count.
// Returns an error if the input is empty, since an empty operation name
// provides no useful audit trail.
func (s *Service) ProcessOperation(input string) (string, error) {
	if input == "" {
		return "", errors.New("input cannot be empty")
	}
	s.operationCount++
	s.logger.Printf("Processing operation #%d: %s", s.operationCount, input)
	return fmt.Sprintf("Processed: %s (Op #%d)", input, s.operationCount), nil
}

// OperationCount returns how many operations have been processed. Exposed as
// a method rather than a public field so the count cannot be tampered with.
func (s *Service) OperationCount() int {
	return s.operationCount
}

// discardLogger returns a Logger that writes nowhere, suitable for tests
// that do not care about log output.
func discardLogger() Logger {
	return log.New(io.Discard, "", 0)
}
