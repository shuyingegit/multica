package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/multica-ai/multica/server/internal/util"
)

// SCS fork: continuous confirm ("连续确认") keeps an issue's agent working
// across turns until the work is marked finished, the agent is truly stuck,
// or the round cap is hit and we ask the human.

const (
	ContinuousConfirmMetaKey        = "continuous_confirm"
	ContinuousConfirmRoundsMetaKey  = "continuous_confirm_rounds"
	ContinuousConfirmAgentMetaKey   = "continuous_confirm_agent"
	ContinuousConfirmWaitingMetaKey = "continuous_confirm_waiting"

	// Cap auto-continues so a runaway loop cannot burn the runtime forever.
	// Long-running tickets (e.g. 持续推广) need far more than a handful of turns;
	// only done/cancelled/user-stop end the loop for good.
	ContinuousConfirmMaxRounds = 50

	continuousConfirmAskMarker = "【连续确认】"
)

// ContinuousConfirmHandoffNote is merged into the daemon handoff_note so every
// claim under the flag gets the same "keep going" brief without a daemon bump.
func ContinuousConfirmHandoffNote(round, max int) string {
	if round <= 0 {
		return strings.TrimSpace(`
[连续确认 / continuous confirm]
用户开启了「连续确认」。请尽量自行决策、查资料、推进任务，不要因可自行解决的选择停下来等用户。
结束信号（只有这些才会停自动续跑）：
(a) 任务已彻底完成 → 把票设为 done，并在终评里说明结果；
(b) 已卡住、没有用户介入就无法继续 → 把票设为 blocked，并在终评里写清缺什么。
中间进度请保持 in_progress（或临时 in_review）；系统会在票未 done 时继续安排你推进。
不要只抛出开放式问题后空等。
`)
	}
	return strings.TrimSpace(fmt.Sprintf(`
[连续确认 / continuous confirm — 自动续跑第 %d/%d 轮]
上一轮尚未彻底完结。请继续处理同一任务，自行推进，直到彻底完成或确认真正卡住。
彻底完成 → done + 终评；卡住 → blocked + 说明缺什么。不要停在「请指示下一步」。
`, round, max))
}

func ContinuousConfirmProgressContent(round, max int) string {
	return fmt.Sprintf(
		"%s自动续跑第 %d/%d 轮：上一轮智能体已结束，但票尚未彻底完成。正在继续推进，请暂不必回复。",
		continuousConfirmAskMarker, round, max,
	)
}

func ContinuousConfirmAskUserContent(reason string) string {
	if strings.TrimSpace(reason) == "" {
		reason = "智能体本轮已结束，任务似乎尚未完结"
	}
	return fmt.Sprintf(
		"%s%s。\n\n请回复「继续」让系统接着安排智能体处理，或回复「结束」停止自动续跑。",
		continuousConfirmAskMarker, reason,
	)
}

func ParseContinuousConfirmMeta(raw []byte) (enabled bool, waiting bool, rounds int, agentID string) {
	m := util.JSONObjectOrEmpty(raw)
	enabled, _ = m[ContinuousConfirmMetaKey].(bool)
	waiting, _ = m[ContinuousConfirmWaitingMetaKey].(bool)
	agentID, _ = m[ContinuousConfirmAgentMetaKey].(string)
	switch v := m[ContinuousConfirmRoundsMetaKey].(type) {
	case float64:
		rounds = int(v)
	case json.Number:
		if n, err := v.Int64(); err == nil {
			rounds = int(n)
		}
	}
	return
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
	// Exact short replies
	switch s {
	case "继续", "续跑", "continue", "yes", "y", "ok", "好", "好的", "接着", "接着做", "再来":
		return "continue"
	case "结束", "停止", "stop", "不用了", "取消", "别续了", "停止续跑":
		return "stop"
	}
	// Longer replies that clearly ask to keep going / stop (SCS-298: "任务尚未结束，请继续")
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
	// Bare "结束"/"停止" as the whole short message already handled; avoid treating
	// long task write-ups that mention "完成" as stop.
	return ""
}

// ContinuousConfirmHardStopStatus is statuses where auto-continue ends with no
// ask-user prompt. Only thoroughly finished / cancelled tickets stop the loop.
func ContinuousConfirmHardStopStatus(status string) bool {
	switch status {
	case "done", "cancelled":
		return true
	default:
		return false
	}
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
