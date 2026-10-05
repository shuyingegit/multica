package service

import "testing"

func TestContinuousConfirmUserIntent(t *testing.T) {
	cases := map[string]string{
		"继续":         "continue",
		"  Continue ": "continue",
		"结束":         "stop",
		"STOP":       "stop",
		"随便说说":       "",
		"任务尚未结束，请继续": "continue",
		"请继续处理同一任务":  "continue",
		"结束连续确认":     "stop",
		"停止连续确认吧":    "stop",
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
	if ContinuousConfirmHardStopStatus("in_review") {
		t.Fatal("in_review must not hard-stop continuous confirm")
	}
	if !ContinuousConfirmHardStopStatus("done") || !ContinuousConfirmHardStopStatus("cancelled") {
		t.Fatal("done/cancelled must hard-stop")
	}
}

func TestParseContinuousConfirmMeta(t *testing.T) {
	raw := []byte(`{"continuous_confirm":true,"continuous_confirm_rounds":2,"continuous_confirm_agent":"abc","continuous_confirm_waiting":false,"continuous_confirm_max":30,"continuous_confirm_prompt":"keep going {n}/{max}","continuous_confirm_done_marker":"DONE"}`)
	p := ParseContinuousConfirmMeta(raw)
	if !p.Enabled || p.Waiting || p.Rounds != 2 || p.AgentID != "abc" {
		t.Fatalf("got enabled=%v waiting=%v rounds=%d agent=%q", p.Enabled, p.Waiting, p.Rounds, p.AgentID)
	}
	if !p.MaxSet || p.EffectiveMax() != 30 {
		t.Fatalf("max: set=%v effective=%d", p.MaxSet, p.EffectiveMax())
	}
	if p.Prompt != "keep going {n}/{max}" || p.DoneMarker != "DONE" {
		t.Fatalf("prompt/marker wrong: %q / %q", p.Prompt, p.DoneMarker)
	}
}

func TestParseContinuousConfirmMetaLegacyMax(t *testing.T) {
	raw := []byte(`{"continuous_confirm":true,"continuous_confirm_rounds":2}`)
	p := ParseContinuousConfirmMeta(raw)
	if p.MaxSet || p.EffectiveMax() != ContinuousConfirmLegacyMax {
		t.Fatalf("legacy max want %d, got set=%v max=%d", ContinuousConfirmLegacyMax, p.MaxSet, p.EffectiveMax())
	}
}

func TestContinuousConfirmRenderPrompt(t *testing.T) {
	got := ContinuousConfirmRenderPrompt("第{n}/{max} 结束写{done}", 3, 10, "【连续确认:DONE】")
	want := "第3/10 结束写【连续确认:DONE】"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestContinuousConfirmHasDoneMarker(t *testing.T) {
	if !ContinuousConfirmHasDoneMarker("任务好了【连续确认:DONE】", ContinuousConfirmDefaultDoneMarker) {
		t.Fatal("expected done marker hit")
	}
	if ContinuousConfirmHasDoneMarker("还在做", ContinuousConfirmDefaultDoneMarker) {
		t.Fatal("false positive")
	}
}

func TestContinuousConfirmNeedsIntervention(t *testing.T) {
	if !ContinuousConfirmNeedsIntervention("当前无法继续，必须要等待用户介入") {
		t.Fatal("expected intervention")
	}
	if ContinuousConfirmNeedsIntervention("我继续推进即可") {
		t.Fatal("false positive")
	}
}

func TestClampContinuousConfirmMax(t *testing.T) {
	if ClampContinuousConfirmMax(0) != ContinuousConfirmDefaultMax {
		t.Fatal("default")
	}
	if ClampContinuousConfirmMax(999) != ContinuousConfirmAbsoluteMax {
		t.Fatal("absolute")
	}
	if ClampContinuousConfirmMax(7) != 7 {
		t.Fatal("passthrough")
	}
}
