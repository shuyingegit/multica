package service

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/multica-ai/multica/server/internal/util"
)

// SCS fork: continuous confirm ("连续确认") is an explicit outer-loop plan:
// user-set max rounds, editable prompt template, accumulated task brief,
// DONE marker exit, and visible progress.

const (
	ContinuousConfirmMetaKey           = "continuous_confirm"
	ContinuousConfirmRoundsMetaKey     = "continuous_confirm_rounds"
	ContinuousConfirmAgentMetaKey      = "continuous_confirm_agent"
	ContinuousConfirmWaitingMetaKey    = "continuous_confirm_waiting"
	ContinuousConfirmMaxMetaKey        = "continuous_confirm_max"
	ContinuousConfirmPromptMetaKey     = "continuous_confirm_prompt"
	ContinuousConfirmDoneMarkerMetaKey = "continuous_confirm_done_marker"
	ContinuousConfirmBriefMetaKey      = "continuous_confirm_brief"

	// Absolute hard ceiling (safety). User-facing max is clamped to this.
	ContinuousConfirmAbsoluteMax = 1000
	// Default when the user enables the plan without choosing a count.
	ContinuousConfirmDefaultMax = 20
	// Legacy tickets that only have the bool flag (no max key) keep the old budget.
	ContinuousConfirmLegacyMax = 50

	// Deprecated alias — prefer ContinuousConfirmAbsoluteMax / plan.EffectiveMax().
	ContinuousConfirmMaxRounds = ContinuousConfirmAbsoluteMax

	ContinuousConfirmDefaultDoneMarker = "【连续确认:DONE】"

	continuousConfirmAskMarker = "【连续确认】"
	continuousConfirmBriefMax  = 6000
)

// ContinuousConfirmDefaultPrompt is rendered with {n}/{max}/{done}/{brief}.
const ContinuousConfirmDefaultPrompt = `【连续确认 第 {n}/{max} 轮】
请围绕下列任务目标继续推进，自行决策，不要只回复「收到/继续」敷衍。

## 任务目标（随用户补充更新）
{brief}

## 退出约定
若本轮后任务已彻底完成，请在终评明确写出：{done}
若必须等人才能继续，设为 blocked 并写清缺什么。不要只提问后空等。`

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
	Brief      string // accumulated user goals / supplements
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

func (p ContinuousConfirmPlan) EffectiveBrief() string {
	if strings.TrimSpace(p.Brief) == "" {
		return "（暂无单独目标摘要；请结合票标题、描述与最近评论继续推进。）"
	}
	return strings.TrimSpace(p.Brief)
}

// ContinuousConfirmRenderPrompt substitutes {n}/{max}/{done}/{brief}.
func ContinuousConfirmRenderPrompt(template string, round, max int, doneMarker, brief string) string {
	if strings.TrimSpace(template) == "" {
		template = ContinuousConfirmDefaultPrompt
	}
	if strings.TrimSpace(doneMarker) == "" {
		doneMarker = ContinuousConfirmDefaultDoneMarker
	}
	if strings.TrimSpace(brief) == "" {
		brief = "（暂无单独目标摘要；请结合票标题、描述与最近评论继续推进。）"
	}
	if round < 1 {
		round = 1
	}
	r := strings.NewReplacer(
		"{n}", strconv.Itoa(round),
		"{max}", strconv.Itoa(max),
		"{done}", doneMarker,
		"{brief}", brief,
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
	body := ContinuousConfirmRenderPrompt(
		plan.EffectivePrompt(), round, max, plan.EffectiveDoneMarker(), plan.EffectiveBrief(),
	)
	return strings.TrimSpace(fmt.Sprintf(`[连续确认 / continuous confirm — 外循环第 %d/%d 轮]
%s

【续跑计划维护】
- 若用户本轮补充了新目标，请用 issue metadata 更新 continuous_confirm_brief（合并进任务目标，勿清空旧目标）。
- continuous_confirm_max 只可调高、不可调低；已完成轮次 continuous_confirm_rounds 不要回退。
- 结束标记必须保持为：%s
- 不要只说「继续」——每次推进都要贴着任务目标做事。
`, round, max, body, plan.EffectiveDoneMarker()))
}

func ContinuousConfirmProgressContent(round, max int) string {
	return fmt.Sprintf(
		"%s续跑计划进度：第 %d/%d 轮（上一轮已结束，正在继续；可点下方进度条查看/改次数与话术）。",
		continuousConfirmAskMarker, round, max,
	)
}

func ContinuousConfirmAskUserContent(reason string) string {
	if strings.TrimSpace(reason) == "" {
		reason = "智能体本轮已结束，任务似乎尚未完结"
	}
	return fmt.Sprintf(
		"%s%s。\n\n请回复「继续」让系统接着安排智能体处理，或回复「结束」停止自动续跑。也可点评论栏下方续跑计划改次数/话术。",
		continuousConfirmAskMarker, reason,
	)
}

func ContinuousConfirmStoppedAtDoneContent(marker string) string {
	return fmt.Sprintf("%s检测到结束标记 `%s`，已停止自动续跑。", continuousConfirmAskMarker, marker)
}

// ContinuousConfirmStoppedDoneContent keeps the old name for call sites.
func ContinuousConfirmStoppedDoneContent(marker string) string {
	return ContinuousConfirmStoppedAtDoneContent(marker)
}

func ContinuousConfirmStoppedMaxContent(max int) string {
	return fmt.Sprintf("%s已跑满设定的 %d 轮，自动续跑结束。需要的话可点进度条提高次数后继续。", continuousConfirmAskMarker, max)
}

func ParseContinuousConfirmMeta(raw []byte) ContinuousConfirmPlan {
	m := util.JSONObjectOrEmpty(raw)
	p := ContinuousConfirmPlan{}
	p.Enabled, _ = m[ContinuousConfirmMetaKey].(bool)
	p.Waiting, _ = m[ContinuousConfirmWaitingMetaKey].(bool)
	p.AgentID, _ = m[ContinuousConfirmAgentMetaKey].(string)
	p.Prompt, _ = m[ContinuousConfirmPromptMetaKey].(string)
	p.DoneMarker, _ = m[ContinuousConfirmDoneMarkerMetaKey].(string)
	p.Brief, _ = m[ContinuousConfirmBriefMetaKey].(string)
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

// MergeContinuousConfirmMax never decreases an active plan's budget.
func MergeContinuousConfirmMax(prevEffective int, incoming int, incomingSet bool) int {
	base := prevEffective
	if base <= 0 {
		base = ContinuousConfirmDefaultMax
	}
	if !incomingSet {
		return ClampContinuousConfirmMax(base)
	}
	next := ClampContinuousConfirmMax(incoming)
	if next < base {
		return base
	}
	return next
}

// MergeContinuousConfirmBrief appends a new user supplement into the plan brief.
func MergeContinuousConfirmBrief(prev, addition string) string {
	addition = strings.TrimSpace(addition)
	if addition == "" {
		return strings.TrimSpace(prev)
	}
	// Strip noisy visitor prefixes that Multica external guests sometimes add.
	addition = stripVisitorNoise(addition)
	if addition == "" {
		return strings.TrimSpace(prev)
	}
	prev = strings.TrimSpace(prev)
	if prev == "" {
		return truncateRunes(addition, continuousConfirmBriefMax)
	}
	// Avoid duplicating the exact same block.
	if strings.Contains(prev, addition) {
		return prev
	}
	merged := prev + "\n\n---\n补充：" + addition
	return truncateRunes(merged, continuousConfirmBriefMax)
}

func stripVisitorNoise(s string) string {
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "【外部访客】") {
			continue
		}
		if strings.HasPrefix(trim, "📍") {
			continue
		}
		out = append(out, line)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

func truncateRunes(s string, max int) string {
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max]) + "…"
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

func ContinuousConfirmHardStopStatus(status string) bool {
	switch status {
	case "done", "cancelled":
		return true
	default:
		return false
	}
}

func ContinuousConfirmShouldReopenDone(status, agentText, doneMarker string) bool {
	return status == "done" && !ContinuousConfirmHasDoneMarker(agentText, doneMarker)
}

func ContinuousConfirmTerminalStatus(status string) bool {
	switch status {
	case "done", "in_review", "cancelled":
		return true
	default:
		return false
	}
}

func ClampContinuousConfirmMax(max int) int {
	if max <= 0 {
		return ContinuousConfirmDefaultMax
	}
	if max > ContinuousConfirmAbsoluteMax {
		return ContinuousConfirmAbsoluteMax
	}
	return max
}
