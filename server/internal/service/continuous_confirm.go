package service

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/multica-ai/multica/server/internal/util"
)

// SCS fork: continuous confirm ("连续确认") is an explicit outer-loop plan:
// user-set max rounds, editable prompt template, DONE marker exit, and
// visible progress — not a black-box checkbox that silently re-wakes.

const (
	ContinuousConfirmMetaKey           = "continuous_confirm"
	ContinuousConfirmRoundsMetaKey     = "continuous_confirm_rounds"
	ContinuousConfirmAgentMetaKey      = "continuous_confirm_agent"
	ContinuousConfirmWaitingMetaKey    = "continuous_confirm_waiting"
	ContinuousConfirmMaxMetaKey        = "continuous_confirm_max"
	ContinuousConfirmPromptMetaKey     = "continuous_confirm_prompt"
	ContinuousConfirmDoneMarkerMetaKey = "continuous_confirm_done_marker"

	// Absolute hard ceiling (safety). User-facing max is clamped to this.
	ContinuousConfirmAbsoluteMax = 100
	// Default when the user enables the plan without choosing a count.
	ContinuousConfirmDefaultMax = 20
	// Legacy tickets that only have the bool flag (no max key) keep the old budget.
	ContinuousConfirmLegacyMax = 50

	// Deprecated alias — prefer ContinuousConfirmAbsoluteMax / plan.EffectiveMax().
	ContinuousConfirmMaxRounds = ContinuousConfirmAbsoluteMax

	ContinuousConfirmDefaultDoneMarker = "【连续确认:DONE】"

	continuousConfirmAskMarker = "【连续确认】"
)

// ContinuousConfirmDefaultPrompt is rendered with {n}/{max}/{done} before each
// auto-continue round (and injected into the claim handoff).
const ContinuousConfirmDefaultPrompt = `【连续确认 第 {n}/{max} 轮】请继续推进同一任务，自行决策。若本轮后任务已彻底完成，请在终评明确写出：{done}。若必须等人才能继续，设为 blocked 并写清缺什么。不要只提问后空等。`

// ContinuousConfirmPlan is the persisted outer-loop state on issue.metadata.
type ContinuousConfirmPlan struct {
	Enabled    bool
	Waiting    bool
	Rounds     int
	AgentID    string
	Max        int    // 0 = key unset (legacy)
	MaxSet     bool   // true when continuous_confirm_max is present
	Prompt     string // empty → default template
	DoneMarker string // empty → default marker
}

func (p ContinuousConfirmPlan) EffectiveMax() int {
	max := p.Max
	if !p.MaxSet || max <= 0 {
		if p.MaxSet {
			max = ContinuousConfirmDefaultMax
		} else {
			max = ContinuousConfirmLegacyMax
		}
	}
	if max > ContinuousConfirmAbsoluteMax {
		return ContinuousConfirmAbsoluteMax
	}
	if max < 1 {
		return 1
	}
	return max
}

func (p ContinuousConfirmPlan) EffectivePrompt() string {
	if strings.TrimSpace(p.Prompt) == "" {
		return ContinuousConfirmDefaultPrompt
	}
	return p.Prompt
}

func (p ContinuousConfirmPlan) EffectiveDoneMarker() string {
	if strings.TrimSpace(p.DoneMarker) == "" {
		return ContinuousConfirmDefaultDoneMarker
	}
	return p.DoneMarker
}

// ContinuousConfirmRenderPrompt substitutes {n}/{max}/{done} in the template.
func ContinuousConfirmRenderPrompt(template string, round, max int, doneMarker string) string {
	if strings.TrimSpace(template) == "" {
		template = ContinuousConfirmDefaultPrompt
	}
	if strings.TrimSpace(doneMarker) == "" {
		doneMarker = ContinuousConfirmDefaultDoneMarker
	}
	if round < 1 {
		round = 1
	}
	r := strings.NewReplacer(
		"{n}", strconv.Itoa(round),
		"{max}", strconv.Itoa(max),
		"{done}", doneMarker,
	)
	return strings.TrimSpace(r.Replace(template))
}

// ContinuousConfirmHandoffNote is merged into the daemon handoff_note.
func ContinuousConfirmHandoffNote(plan ContinuousConfirmPlan) string {
	max := plan.EffectiveMax()
	round := plan.Rounds
	if round < 1 {
		round = 1
	}
	body := ContinuousConfirmRenderPrompt(plan.EffectivePrompt(), round, max, plan.EffectiveDoneMarker())
	return strings.TrimSpace(fmt.Sprintf(`[连续确认 / continuous confirm — 外循环第 %d/%d 轮]
%s
`, round, max, body))
}

func ContinuousConfirmProgressContent(round, max int) string {
	return fmt.Sprintf(
		"%s续跑计划进度：第 %d/%d 轮（上一轮已结束，正在继续；可在评论栏下方停止或改计划）。",
		continuousConfirmAskMarker, round, max,
	)
}

func ContinuousConfirmAskUserContent(reason string) string {
	if strings.TrimSpace(reason) == "" {
		reason = "智能体本轮已结束，任务似乎尚未完结"
	}
	return fmt.Sprintf(
		"%s%s。\n\n请回复「继续」让系统接着安排智能体处理，或回复「结束」停止自动续跑。也可在评论栏改次数/话术后重新勾选发送。",
		continuousConfirmAskMarker, reason,
	)
}

func ContinuousConfirmStoppedDoneContent(marker string) string {
	return fmt.Sprintf("%s检测到结束标记 `%s`，已停止自动续跑。", continuousConfirmAskMarker, marker)
}

func ContinuousConfirmStoppedMaxContent(max int) string {
	return fmt.Sprintf("%s已跑满设定的 %d 轮，自动续跑结束。需要的话可改次数后重新开启。", continuousConfirmAskMarker, max)
}

func ParseContinuousConfirmMeta(raw []byte) ContinuousConfirmPlan {
	m := util.JSONObjectOrEmpty(raw)
	p := ContinuousConfirmPlan{}
	p.Enabled, _ = m[ContinuousConfirmMetaKey].(bool)
	p.Waiting, _ = m[ContinuousConfirmWaitingMetaKey].(bool)
	p.AgentID, _ = m[ContinuousConfirmAgentMetaKey].(string)
	p.Prompt, _ = m[ContinuousConfirmPromptMetaKey].(string)
	p.DoneMarker, _ = m[ContinuousConfirmDoneMarkerMetaKey].(string)
	p.Rounds = jsonInt(m[ContinuousConfirmRoundsMetaKey])
	if _, ok := m[ContinuousConfirmMaxMetaKey]; ok {
		p.MaxSet = true
		p.Max = jsonInt(m[ContinuousConfirmMaxMetaKey])
	}
	return p
}

func jsonInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case json.Number:
		i, err := n.Int64()
		if err == nil {
			return int(i)
		}
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

// ContinuousConfirmHasDoneMarker reports whether text contains the exit marker.
func ContinuousConfirmHasDoneMarker(text, marker string) bool {
	if strings.TrimSpace(marker) == "" {
		marker = ContinuousConfirmDefaultDoneMarker
	}
	return marker != "" && strings.Contains(text, marker)
}

// ContinuousConfirmNeedsIntervention detects hard "must wait for human" phrasing.
func ContinuousConfirmNeedsIntervention(text string) bool {
	s := strings.ToLower(text)
	hints := []string{
		"无法继续",
		"必须要等待用户介入",
		"需要用户介入",
		"等待用户介入",
		"need user intervention",
		"requires user intervention",
		"cannot continue without",
		"must wait for the user",
	}
	for _, h := range hints {
		if strings.Contains(s, strings.ToLower(h)) {
			return true
		}
	}
	return false
}

// ContinuousConfirmUserIntent classifies a member reply while we are waiting.
// empty = not a control reply (treat as ordinary comment / resume if checkbox on).
func ContinuousConfirmUserIntent(content string) string {
	s := strings.TrimSpace(strings.ToLower(content))
	s = strings.ReplaceAll(s, "`", "")
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	switch s {
	case "继续", "续跑", "continue", "yes", "y", "ok", "好", "好的", "接着", "接着做", "再来":
		return "continue"
	case "结束", "停止", "stop", "不用了", "取消", "别续了", "停止续跑":
		return "stop"
	}
	continueHints := []string{"继续", "续跑", "接着做", "接着干", "请继续", "继续处理", "继续推进", "keep going", "continue"}
	stopHints := []string{"结束连续确认", "停止连续确认", "不要续跑", "别续跑", "停止续跑", "取消连续确认"}
	for _, h := range stopHints {
		if strings.Contains(s, h) {
			return "stop"
		}
	}
	for _, h := range continueHints {
		if strings.Contains(s, h) {
			return "continue"
		}
	}
	return ""
}

// ContinuousConfirmHardStopStatus is statuses that end the loop unless the
// plan decides to reopen (see ContinuousConfirmShouldReopenDone).
func ContinuousConfirmHardStopStatus(status string) bool {
	switch status {
	case "done", "cancelled":
		return true
	default:
		return false
	}
}

// ContinuousConfirmShouldReopenDone is true when the issue is marked done but
// the agent did NOT emit the plan's DONE marker. Long-running tickets (e.g.
// SCS-298) often get prematurely set to done; with an active plan we reopen
// and keep looping instead of silently dying while the UI still says "进行中".
func ContinuousConfirmShouldReopenDone(status, agentText, doneMarker string) bool {
	return status == "done" && !ContinuousConfirmHasDoneMarker(agentText, doneMarker)
}

// ContinuousConfirmTerminalStatus is kept for callers/tests that want the
// broader "agent considers this finished" set (includes in_review).
func ContinuousConfirmTerminalStatus(status string) bool {
	switch status {
	case "done", "in_review", "cancelled":
		return true
	default:
		return false
	}
}

// ClampContinuousConfirmMax normalizes a user-supplied max.
func ClampContinuousConfirmMax(max int) int {
	if max <= 0 {
		return ContinuousConfirmDefaultMax
	}
	if max > ContinuousConfirmAbsoluteMax {
		return ContinuousConfirmAbsoluteMax
	}
	return max
}
