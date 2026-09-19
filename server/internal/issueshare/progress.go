package issueshare

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

var secretRe = regexp.MustCompile(`(?i)((?:api[_-]?key|token|secret|password|bearer)\s*[:=]\s*)\S+|(?:sk|ghp|gho|github_pat)_[A-Za-z0-9_\-]{8,}`)

// PublicProgressText turns one agent step into text a guest can read.
// Secrets are stripped. Tool calls stay as the tool name; the agent's own
// words (text and thinking) are kept so the process is readable after it ends.
func PublicProgressText(typ, tool, content string) string {
	content = redact(strings.TrimSpace(content))
	switch typ {
	case "thinking":
		if content == "" {
			return "思考中"
		}
		return clip(content, 800)
	case "tool_use":
		name := strings.TrimSpace(tool)
		if name == "" {
			name = "工具"
		}
		return "使用 " + name
	case "tool_result":
		name := strings.TrimSpace(tool)
		if content == "" {
			if name == "" {
				return "这一步完成了"
			}
			return name + " 完成"
		}
		return clip(content, 400)
	case "error":
		if content == "" {
			return "处理中遇到问题"
		}
		return clip(content, 400)
	default:
		if content == "" {
			return ""
		}
		return clip(content, 1200)
	}
}

func redact(s string) string {
	return secretRe.ReplaceAllString(s, "[已隐藏]")
}

func clip(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return strings.TrimSpace(string(runes[:max])) + "…"
}
