package service

import "testing"

func TestContinuousConfirmUserIntent(t *testing.T) {
	cases := map[string]string{
		"继续":       "continue",
		"  Continue ": "continue",
		"结束":       "stop",
		"STOP":     "stop",
		"随便说说":     "",
	}
	for in, want := range cases {
		if got := ContinuousConfirmUserIntent(in); got != want {
			t.Fatalf("%q → %q, want %q", in, got, want)
		}
	}
}

func TestContinuousConfirmTerminalStatus(t *testing.T) {
	if !ContinuousConfirmTerminalStatus("in_review") || ContinuousConfirmTerminalStatus("in_progress") {
		t.Fatal("terminal status mapping wrong")
	}
}

func TestParseContinuousConfirmMeta(t *testing.T) {
	raw := []byte(`{"continuous_confirm":true,"continuous_confirm_rounds":2,"continuous_confirm_agent":"abc","continuous_confirm_waiting":false}`)
	enabled, waiting, rounds, agent := ParseContinuousConfirmMeta(raw)
	if !enabled || waiting || rounds != 2 || agent != "abc" {
		t.Fatalf("got enabled=%v waiting=%v rounds=%d agent=%q", enabled, waiting, rounds, agent)
	}
}
