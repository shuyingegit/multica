package issueshare

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

var secretRe = regexp.MustCompile(`(?i)((?:api[_-]?key|token|secret|password|bearer)\s*[:=]\s*)\S+|(?:sk|ghp|gho|github_pat)_[A-Za-z0-9_\-]{8,}`)

// PublicProgressText turns one in-flight task step into a short line a guest
// can read. Tool inputs and outputs are not included.
func PublicProgressText(typ, tool, content string) string {
	content = redact(collapse(content))
	switch typ {
	case "thinking":
		return "思考中"
	case "tool_use":
		name := strings.TrimSpace(tool)
		if name == "" {
			name = "工具"
		}
		return "正在使用 " + name
	case "error":
		if content == "" {
			return "处理中遇到问题"
		}
		return clip("出错："+content, 80)
	default:
		if content == "" {
			return ""
		}
		return clip(content, 160)
	}
}

func collapse(s string) string {
	return strings.Join(strings.Fields(s), " ")
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
