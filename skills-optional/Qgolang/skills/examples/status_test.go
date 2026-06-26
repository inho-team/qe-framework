package examples

import "testing"

func TestStatusIsTerminal(t *testing.T) {
	tests := []struct {
		name   string
		status Status
		want   bool
	}{
		{name: "PendingIsNotTerminal", status: StatusPending, want: false},
		{name: "CompletedIsTerminal", status: StatusCompleted, want: true},
		{name: "FailedIsTerminal", status: StatusFailed, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.status.IsTerminal()
			if got != tt.want {
				t.Errorf("%s.IsTerminal() = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

func TestStatusIsEven(t *testing.T) {
	tests := []struct {
		name   string
		status Status
		want   bool
	}{
		{name: "PendingCode1IsOdd", status: StatusPending, want: false},
		{name: "CompletedCode2IsEven", status: StatusCompleted, want: true},
		{name: "FailedCode3IsOdd", status: StatusFailed, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.status.IsEven()
			if got != tt.want {
				t.Errorf("%s.IsEven() = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

func TestStatusString(t *testing.T) {
	tests := []struct {
		name   string
		status Status
		want   string
	}{
		{name: "PendingString", status: StatusPending, want: "Pending"},
		{name: "CompletedString", status: StatusCompleted, want: "Completed"},
		{name: "FailedString", status: StatusFailed, want: "Failed"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.status.String()
			if got != tt.want {
				t.Errorf("String() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAllStatusesReturnsAllValues(t *testing.T) {
	all := AllStatuses()
	if len(all) != 3 {
		t.Fatalf("AllStatuses() returned %d values, want 3", len(all))
	}
	if all[0] != StatusPending {
		t.Errorf("AllStatuses()[0] = %v, want Pending", all[0])
	}
	if all[1] != StatusCompleted {
		t.Errorf("AllStatuses()[1] = %v, want Completed", all[1])
	}
	if all[2] != StatusFailed {
		t.Errorf("AllStatuses()[2] = %v, want Failed", all[2])
	}
}
