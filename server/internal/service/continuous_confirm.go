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
	ContinuousConfirmMaxRounds = 5

	continuousConfirmAskMarker = "【连续确认】"
)

// ContinuousConfirmHandoffNote is merged into the daemon handoff_note so every
// claim under the flag gets the same "keep going" brief without a daemon bump.
func ContinuousConfirmHandoffNote(round, max int) string {
	if round <= 0 {
		return strings.TrimSpace(`
[连续确认 / continuous confirm]
用户开启了「连续确认」。请尽量自行决策、查资料、推进到可交付状态，不要因可自行解决的选择停下来等用户。
结束本轮时请满足其一：
(a) 任务已真正完成 → 把票设为 in_review（或按工作流写 done），并在唯一终评里说明结果；
(b) 已卡住、没有用户介入就无法继续 → 把票设为 blocked，并在终评里写清缺什么。
不要只抛出开放式问题后空等。
`)
	}
	return strings.TrimSpace(fmt.Sprintf(`
[连续确认 / continuous confirm — 自动续跑第 %d/%d 轮]
上一轮尚未给出完整结束信号。请继续处理同一任务，自行推进，直到完成或确认真正卡住。
完成 → in_review + 终评；卡住 → blocked + 说明缺什么。不要停在「请指示下一步」。
`, round, max))
}

func ContinuousConfirmProgressContent(round, max int) string {
	return fmt.Sprintf(
		"%s自动续跑第 %d/%d 轮：上一轮智能体已结束，但票尚未完结。正在继续推进，请暂不必回复。",
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
	// Strip common markdown / mention noise for short replies.
	s = strings.ReplaceAll(s, "`", "")
	s = strings.TrimSpace(s)
	switch {
	case s == "继续" || s == "续跑" || s == "continue" || s == "yes" || s == "y" || s == "ok" || s == "好" || s == "好的":
		return "continue"
	case s == "结束" || s == "停止" || s == "stop" || s == "done" || s == "完成" || s == "不用了" || s == "取消":
		return "stop"
	default:
		return ""
	}
}

func ContinuousConfirmTerminalStatus(status string) bool {
	switch status {
	case "done", "in_review", "cancelled":
		return true
	default:
		return false
	}
}
