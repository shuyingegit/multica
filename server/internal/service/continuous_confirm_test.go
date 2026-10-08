package service

import (
	"strings"
	"testing"
)

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

func TestContinuousConfirmPromptNeedsUpgrade(t *testing.T) {
	if !ContinuousConfirmPromptNeedsUpgrade("") {
		t.Fatal("empty needs upgrade")
	}
	legacy := "【连续确认 第 {n}/{max} 轮】请继续推进同一任务，自行决策。若本轮后任务已彻底完成，请在终评明确写出：{done}。"
	if !ContinuousConfirmPromptNeedsUpgrade(legacy) {
		t.Fatal("legacy without {brief} needs upgrade")
	}
	if ContinuousConfirmPromptNeedsUpgrade(ContinuousConfirmDefaultPrompt) {
		t.Fatal("default must not need upgrade")
	}
}

func TestContinuousConfirmIsTransientFailure(t *testing.T) {
	if !ContinuousConfirmIsTransientFailure("claude input/control protocol failed: write |1: file already closed") {
		t.Fatal("pipe-closed must be transient")
	}
	if ContinuousConfirmIsTransientFailure("model refused the request") {
		t.Fatal("model refusal must not be transient")
	}
	if ContinuousConfirmIsTransientFailure("") {
		t.Fatal("empty must not be transient")
	}
}

func TestRefineContinuousConfirmBriefFromAgent(t *testing.T) {
	brief := "是不是还没有结束啊？"
	agent := "没结束,继续推进 — 我刚刚已经把 R131 的工作做完。\n\n## 详情\n一堆表格"
	got := RefineContinuousConfirmBriefFromAgent(brief, agent)
	if !strings.Contains(got, "是不是还没有结束啊？") {
		t.Fatalf("user part lost: %q", got)
	}
	if !strings.Contains(got, "【Agent整理】") || !strings.Contains(got, "没结束,继续推进") {
		t.Fatalf("agent summary missing: %q", got)
	}
}

func TestContinuousConfirmHasDoneMarker(t *testing.T) {
	marker := ContinuousConfirmDefaultDoneMarker
	if !ContinuousConfirmHasDoneMarker("任务好了\n"+marker, marker) {
		t.Fatal("standalone marker line should count")
	}
	if !ContinuousConfirmHasDoneMarker("任务已彻底完成。"+marker, marker) {
		t.Fatal("suffix marker after sentence should count")
	}
	if ContinuousConfirmHasDoneMarker("还在做", marker) {
		t.Fatal("false positive on plain text")
	}
	// SCS-298: agent explained why it did NOT write the marker — must not stop.
	if ContinuousConfirmHasDoneMarker("**未写"+marker+"原因**:还有 30 项待做", marker) {
		t.Fatal("negated mention must not count as done")
	}
	if ContinuousConfirmHasDoneMarker("结束标记必须保持为："+marker, marker) {
		t.Fatal("instructional quote must not count as done")
	}
	if ContinuousConfirmHasDoneMarker("请在终评单独一行写出：`"+marker+"`", marker) {
		t.Fatal("backtick instruction must not count as done")
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

func TestContinuousConfirmRoundFromHandoff(t *testing.T) {
	note := `[连续确认 / continuous confirm — 外循环第 7/20 轮]
请继续`
	if got := ContinuousConfirmRoundFromHandoff(note); got != 7 {
		t.Fatalf("got %d want 7", got)
	}
	if ContinuousConfirmRoundFromHandoff("no stamp here") != 0 {
		t.Fatal("expected 0 for missing stamp")
	}
}

func TestContinuousConfirmAgentWritableMeta(t *testing.T) {
	if !ContinuousConfirmAgentWritableMeta(ContinuousConfirmBriefMetaKey) {
		t.Fatal("brief must stay writable")
	}
	if ContinuousConfirmAgentWritableMeta(ContinuousConfirmRoundsMetaKey) {
		t.Fatal("rounds must be server-owned")
	}
	if ContinuousConfirmAgentWritableMeta(ContinuousConfirmMaxMetaKey) {
		t.Fatal("max must be server-owned")
	}
	if ContinuousConfirmAgentWritableMeta(ContinuousConfirmMetaKey) {
		t.Fatal("enable flag must be server-owned")
	}
	if !ContinuousConfirmAgentWritableMeta("pipeline_status") {
		t.Fatal("unrelated keys stay writable")
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
