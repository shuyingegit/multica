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
	// Status alone must never hard-stop the outer loop.
	if ContinuousConfirmHardStopStatus("in_review") || ContinuousConfirmHardStopStatus("done") || ContinuousConfirmHardStopStatus("cancelled") {
		t.Fatal("issue status must not hard-stop continuous confirm")
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
	got := ContinuousConfirmRenderPrompt("第{n}/{max} 结束写{done} 目标:{brief}", 3, 10, "【连续确认:DONE】", "修好登录")
	want := "第3/10 结束写【连续确认:DONE】 目标:修好登录"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestMergeContinuousConfirmMax(t *testing.T) {
	if got := MergeContinuousConfirmMax(50, 20, true); got != 50 {
		t.Fatalf("max must not drop: got %d", got)
	}
	if got := MergeContinuousConfirmMax(20, 50, true); got != 50 {
		t.Fatalf("max should rise: got %d", got)
	}
	if got := MergeContinuousConfirmMax(50, 0, false); got != 50 {
		t.Fatalf("unset incoming keeps prev: got %d", got)
	}
}

func TestMergeContinuousConfirmBrief(t *testing.T) {
	got := MergeContinuousConfirmBrief("目标A", "目标B补充")
	if got != "目标A\n\n---\n补充：目标B补充" {
		t.Fatalf("unexpected merge: %q", got)
	}
	// Exact duplicate should not grow.
	if again := MergeContinuousConfirmBrief(got, "目标B补充"); again != got {
		t.Fatalf("duplicate should be skipped: %q", again)
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

func TestContinuousConfirmShouldReopenDone(t *testing.T) {
	marker := ContinuousConfirmDefaultDoneMarker
	if !ContinuousConfirmShouldReopenPrematureClose("done", "还在推广", marker) {
		t.Fatal("done without marker should reopen")
	}
	if !ContinuousConfirmShouldReopenPrematureClose("cancelled", "先取消再说", marker) {
		t.Fatal("cancelled without marker should reopen")
	}
	if ContinuousConfirmShouldReopenPrematureClose("done", "好了"+marker, marker) {
		t.Fatal("done with marker must not reopen")
	}
	if ContinuousConfirmShouldReopenPrematureClose("cancelled", "好了"+marker, marker) {
		t.Fatal("cancelled with marker must not reopen")
	}
	if ContinuousConfirmShouldReopenPrematureClose("in_progress", "x", marker) {
		t.Fatal("in_progress must not reopen")
	}
}
