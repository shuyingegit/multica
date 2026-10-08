package service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/multica-ai/multica/server/internal/util"
	"github.com/multica-ai/multica/server/pkg/taskfailure"
)

var continuousConfirmHandoffRoundRE = regexp.MustCompile(`外循环第\s*(\d+)\s*/`)

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
	ContinuousConfirmFailStreakMetaKey = "continuous_confirm_fail_streak"

	// Absolute hard ceiling (safety). User-facing max is clamped to this.
	ContinuousConfirmAbsoluteMax = 1000
	// Default when the user enables the plan without choosing a count.
	ContinuousConfirmDefaultMax = 20
	// Legacy tickets that only have the bool flag (no max key) keep the old budget.
	ContinuousConfirmLegacyMax = 50
	// How many consecutive Claude-pipe / process crashes we auto-retry before
	// asking the user. Keeps long outer loops from dying on one bad resume.
	ContinuousConfirmTransientRetryMax = 3

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

## 退出约定（必须先确认，再写标记）
对照上面的任务目标逐条自检后，只有下面两种情况才允许结束：
1. 已 100% 确认目标全部做完 → 在终评**单独一行**写出：{done}
2. 已 100% 确认进入 blocked（没有任何可继续事项，必须等人）→ 设为 blocked，写清缺什么；不要写结束标记

重要：
- 仅仅把票标成 done / cancelled / in_review **不算结束**。系统会忽略这类状态变更并继续催你确认。
- 若还有任何可做事项，继续做，**不要**写结束标记，也**不要**误关票。
- 未结束时禁止在正文里复述结束标记字符串（包括「未写 xxx」这种写法也会干扰检测）。
- 不要只提问后空等。`

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
	FailStreak int    // consecutive transient agent crashes (pipe closed, etc.)
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
- 本轮结束前，请用 issue metadata **重写** continuous_confirm_brief：整理成简洁任务目标清单（保留用户原意 + 你补充的可执行项），不要只留用户原话聊天句。
- 禁止修改 continuous_confirm_rounds / continuous_confirm_max / continuous_confirm（这三个由系统维护；乱改会导致误判「跑满」提前停机）。
- 结束标记必须保持为：%s
- 停机条件只有：在终评单独一行写出结束标记、用户手动停止、或跑满次数。票被标成 done/cancelled **不会**自动停机；若你误关了票，系统会拉回并要求你对照任务目标再确认一轮。
- 跑满次数 ≠ 任务完成：若目标仍是长期推广/监测，不要写结束标记，等用户加次数即可。
- 未结束时不要复述结束标记字符串（「未写 xxx」也会被旧逻辑误伤；请直接继续做事）。
- 不要只说「继续」——每次推进都要贴着任务目标做事；结束前必须 100%% 确认已完成或已真正 blocked。
`, round, max, body, plan.EffectiveDoneMarker()))
}

// ContinuousConfirmRoundFromHandoff extracts the server-stamped round from a
// task handoff note. Agents sometimes overwrite continuous_confirm_rounds with
// their own "R307" style counters; the handoff value is authoritative for the
// turn that just finished.
func ContinuousConfirmRoundFromHandoff(note string) int {
	m := continuousConfirmHandoffRoundRE.FindStringSubmatch(note)
	if len(m) < 2 {
		return 0
	}
	n, err := strconv.Atoi(m[1])
	if err != nil || n < 1 {
		return 0
	}
	return n
}

// ContinuousConfirmAgentWritableMeta reports whether an agent (task-token)
// may write this metadata key. Progress / enable flags are server-owned.
func ContinuousConfirmAgentWritableMeta(key string) bool {
	switch key {
	case ContinuousConfirmBriefMetaKey:
		return true
	case ContinuousConfirmMetaKey,
		ContinuousConfirmRoundsMetaKey,
		ContinuousConfirmWaitingMetaKey,
		ContinuousConfirmAgentMetaKey,
		ContinuousConfirmMaxMetaKey,
		ContinuousConfirmPromptMetaKey,
		ContinuousConfirmDoneMarkerMetaKey,
		ContinuousConfirmFailStreakMetaKey:
		return false
	default:
		return true
	}
}

func ContinuousConfirmProgressContent(plan ContinuousConfirmPlan, round, max int) string {
	brief := truncateRunes(plan.EffectiveBrief(), 400)
	rendered := ContinuousConfirmRenderPrompt(
		plan.EffectivePrompt(), round, max, plan.EffectiveDoneMarker(), plan.EffectiveBrief(),
	)
	rendered = truncateRunes(rendered, 900)
	return fmt.Sprintf(
		"%s续跑计划进度：第 %d/%d 轮（正在继续）\n\n### 当前任务目标\n%s\n\n### 本轮发给智能体的提示\n%s\n\n可点下方进度条查看/修改次数、摘要与话术模板。",
		continuousConfirmAskMarker, round, max, brief, rendered,
	)
}

// ContinuousConfirmPromptNeedsUpgrade is true for empty/legacy templates that
// lack {brief} (old one-liners stored before the living-plan redesign).
func ContinuousConfirmPromptNeedsUpgrade(prompt string) bool {
	p := strings.TrimSpace(prompt)
	if p == "" {
		return true
	}
	return !strings.Contains(p, "{brief}")
}

// RefineContinuousConfirmBriefFromAgent updates the 【Agent整理】 section so the
// visible brief is not stuck on raw user chat lines when the agent forgets to
// call metadata APIs.
func RefineContinuousConfirmBriefFromAgent(brief, agentText string) string {
	summary := extractContinuousConfirmAgentSummary(agentText)
	if summary == "" {
		return strings.TrimSpace(brief)
	}
	const section = "【Agent整理】"
	brief = strings.TrimSpace(brief)
	userPart := brief
	if i := strings.Index(brief, section); i >= 0 {
		userPart = strings.TrimSpace(brief[:i])
	}
	refined := summary
	if userPart != "" {
		refined = userPart + "\n\n" + section + "\n" + summary
	} else {
		refined = section + "\n" + summary
	}
	return truncateRunes(refined, continuousConfirmBriefMax)
}

func extractContinuousConfirmAgentSummary(agentText string) string {
	text := strings.TrimSpace(agentText)
	if text == "" {
		return ""
	}
	var lines []string
	for _, line := range strings.Split(text, "\n") {
		trim := strings.TrimSpace(line)
		if trim == "" {
			if len(lines) > 0 {
				break
			}
			continue
		}
		if strings.HasPrefix(trim, "【连续确认】") {
			continue
		}
		if strings.HasPrefix(trim, "|") || strings.HasPrefix(trim, "---") {
			continue
		}
		// Skip pure heading-only lines after we already have content.
		lines = append(lines, trim)
		joined := strings.Join(lines, "\n")
		if utf8.RuneCountInString(joined) >= 280 {
			break
		}
		if len(lines) >= 6 {
			break
		}
	}
	return truncateRunes(strings.TrimSpace(strings.Join(lines, "\n")), 360)
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
	p.FailStreak = jsonInt(m[ContinuousConfirmFailStreakMetaKey])
	if _, ok := m[ContinuousConfirmMaxMetaKey]; ok {
		p.MaxSet = true
		p.Max = jsonInt(m[ContinuousConfirmMaxMetaKey])
	}
	return p
}

// ContinuousConfirmIsTransientFailure is true for infrastructure crashes that
// should not park the outer loop waiting for a human (SCS-298 Claude pipe).
func ContinuousConfirmIsTransientFailure(errText string) bool {
	return taskfailure.ClaudeResumePipeClosed(errText)
}

func ContinuousConfirmTransientRetryContent(streak, max int, errText string) string {
	if max <= 0 {
		max = ContinuousConfirmTransientRetryMax
	}
	short := strings.TrimSpace(errText)
	if utf8.RuneCountInString(short) > 120 {
		short = string([]rune(short)[:120]) + "…"
	}
	return fmt.Sprintf(
		"%s检测到智能体瞬时故障（%s）。正在自动重试 %d/%d，续跑计划不中断；可点进度条查看。",
		continuousConfirmAskMarker, short, streak, max,
	)
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

// ContinuousConfirmHasDoneMarker reports whether the agent intentionally exited
// with the done marker. A bare strings.Contains is too weak: agents often write
// 「未写【连续确认:DONE】原因…」or quote the marker in instructions, which used to
// false-stop the outer loop (SCS-298).
func ContinuousConfirmHasDoneMarker(text, marker string) bool {
	if strings.TrimSpace(marker) == "" {
		marker = ContinuousConfirmDefaultDoneMarker
	}
	if marker == "" || !strings.Contains(text, marker) {
		return false
	}
	for _, line := range strings.Split(text, "\n") {
		if continuousConfirmLineDeclaresDone(line, marker) {
			return true
		}
	}
	return false
}

func continuousConfirmLineDeclaresDone(line, marker string) bool {
	trim := strings.TrimSpace(line)
	if trim == "" || !strings.Contains(trim, marker) {
		return false
	}
	// Strip common markdown wrappers around a whole-line marker.
	naked := strings.TrimSpace(strings.Trim(trim, "*_`~\"'"))
	if naked == marker {
		return true
	}
	if !strings.HasSuffix(trim, marker) && !strings.HasSuffix(naked, marker) {
		return false
	}
	before := strings.TrimSpace(strings.TrimSuffix(trim, marker))
	if before == "" {
		return true
	}
	// Instruction / negation mentions are not an exit.
	lower := strings.ToLower(before)
	deny := []string{
		"未写", "没写", "不写", "不要写", "勿写", "别写", "不能写", "不会写", "没有写", "尚未写",
		"未输出", "不输出", "没有输出", "不发送",
		"结束标记", "保持为", "必须为", "必须保持", "写出：", "写出:", "写上：", "写上:",
		"do not write", "don't write", "without writing", "not writing", "done marker",
	}
	for _, d := range deny {
		if strings.Contains(lower, strings.ToLower(d)) {
			return false
		}
	}
	return true
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

// ContinuousConfirmHardStopStatus is deprecated for exit decisions: issue
// status alone must never stop the outer loop (agents often mark done/cancelled
// prematurely). Kept for callers; always false.
func ContinuousConfirmHardStopStatus(status string) bool {
	return false
}

// ContinuousConfirmShouldReopenPrematureClose is true when the issue was closed
// (done/cancelled) without an explicit DONE marker — treat as agent mistake.
func ContinuousConfirmShouldReopenPrematureClose(status, agentText, doneMarker string) bool {
	switch status {
	case "done", "cancelled":
		return !ContinuousConfirmHasDoneMarker(agentText, doneMarker)
	default:
		return false
	}
}

// ContinuousConfirmShouldReopenDone keeps the old name for call sites.
func ContinuousConfirmShouldReopenDone(status, agentText, doneMarker string) bool {
	return ContinuousConfirmShouldReopenPrematureClose(status, agentText, doneMarker)
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
