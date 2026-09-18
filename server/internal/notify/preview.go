package notify

import (
	"strings"
	"unicode/utf8"
)

// ReplyGist picks one dense line that answers “做了什么 / 结论是什么”
// for ClawBot / WeChat preview (often only ~3 lines before “点击查看详情”).
func ReplyGist(raw string, maxRunes int) string {
	if maxRunes <= 0 {
		maxRunes = 72
	}
	text := StripMarkdownLight(raw)
	if text == "" {
		return ""
	}
	var candidates []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimLeft(line, "#*-•> ")
		line = strings.TrimSpace(line)
		if line == "" || isPushNoiseLine(line) {
			continue
		}
		candidates = append(candidates, line)
	}
	if len(candidates) == 0 {
		// Fall back to flattened first sentence of the whole body.
		flat := strings.Join(strings.Fields(text), " ")
		return truncateRunes(flat, maxRunes)
	}
	return truncateRunes(pickBestGistLine(candidates), maxRunes)
}

func isPushNoiseLine(line string) bool {
	lower := strings.ToLower(line)
	switch {
	case strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		return true
	case strings.HasPrefix(line, "|"):
		return true
	case strings.HasPrefix(line, "```"):
		return true
	case strings.Contains(lower, "redeploy-fork"):
		return true
	case strings.Contains(line, "mention://"):
		return true
	case strings.HasPrefix(line, "请 [@"):
		return true
	case line == "---" || line == "***":
		return true
	}
	return false
}

func pickBestGistLine(candidates []string) string {
	keywords := []string{
		"已推", "已改", "已修", "修好", "已完成", "完成了", "失败", "卡住",
		"交付", "根因", "结论", "修复", "改为", "改成", "不再", "优先",
	}
	for _, c := range candidates {
		if utf8.RuneCountInString(c) < 6 {
			continue
		}
		for _, k := range keywords {
			if strings.Contains(c, k) {
				return c
			}
		}
	}
	// Skip ultra-short acknowledgements (“收到”, “好的”) when a longer line follows.
	for _, c := range candidates {
		if utf8.RuneCountInString(c) >= 10 {
			return c
		}
	}
	return candidates[0]
}

// BuildTaskEndTitle packs ticket + status + who (+ short issue title) into the
// PushPlus / wxsend title field so the first preview line is not half-empty.
// clawbotPrefixReserve: leave room for clients that prepend 【scsoi】.
func BuildTaskEndTitle(identifier, kind, agentName, issueTitle string, clawbotPrefixReserve int) string {
	status := "✓ 完成"
	if kind != "completed" {
		status = "✗ 失败"
	}
	budget := maxTitleRunes - clawbotPrefixReserve
	if budget < 16 {
		budget = maxTitleRunes
	}
	head := strings.TrimSpace(identifier + " " + status)
	agentName = strings.TrimSpace(agentName)
	issueTitle = strings.TrimSpace(strings.ReplaceAll(issueTitle, "\n", " "))

	remaining := budget - utf8.RuneCountInString(head)
	if agentName != "" && remaining > 2 {
		chunk := " " + truncateRunes(agentName, remaining-1)
		head += chunk
		remaining = budget - utf8.RuneCountInString(head)
	}
	if issueTitle != "" && remaining > 4 {
		head += " · " + truncateRunes(issueTitle, remaining-3)
	}
	return truncateRunes(head, budget)
}

// BuildTaskEndContent lays out the body so the first ~2 content lines answer
// “什么事”, with ticket title as secondary context. Full text / link stay below
// for “点击查看详情”.
func BuildTaskEndContent(kind, issueTitle, agentName, body, appBase, slug, identifier, commentID string) string {
	gistMax := 80
	gist := ReplyGist(body, gistMax)
	issueTitle = strings.TrimSpace(strings.ReplaceAll(issueTitle, "\n", " "))

	var b strings.Builder
	if gist != "" {
		b.WriteString(gist)
	} else if issueTitle != "" {
		b.WriteString(issueTitle)
	} else if kind == "completed" {
		b.WriteString("任务已完成")
	} else {
		b.WriteString("任务失败")
	}

	// Second preview line: who + ticket title (skip title if already used as gist).
	var secondParts []string
	if agentName != "" {
		if kind == "completed" {
			secondParts = append(secondParts, agentName+" 已回复")
		} else {
			secondParts = append(secondParts, agentName+" 运行失败")
		}
	}
	if issueTitle != "" && gist != "" && issueTitle != gist {
		secondParts = append(secondParts, truncateRunes(issueTitle, 36))
	}
	if len(secondParts) > 0 {
		b.WriteString("\n")
		b.WriteString(strings.Join(secondParts, " · "))
	}

	// Detail section (usually folded behind “点击查看详情”).
	if body != "" {
		detail := StripMarkdownLight(body)
		if detail != "" && detail != gist {
			b.WriteString("\n\n")
			b.WriteString(truncateRunes(detail, maxContentRunes))
		}
	}
	if link := JoinIssueDeepLink(appBase, slug, identifier, commentID); link != "" {
		b.WriteString("\n\n")
		b.WriteString(link)
	}
	return b.String()
}

// JoinIssueDeepLink is the shared deep-link builder for push bodies.
func JoinIssueDeepLink(appBase, slug, identifier, commentID string) string {
	appBase = strings.TrimRight(strings.TrimSpace(appBase), "/")
	slug = strings.Trim(strings.TrimSpace(slug), "/")
	identifier = strings.TrimSpace(identifier)
	if appBase == "" || slug == "" || identifier == "" {
		return ""
	}
	link := appBase + "/" + slug + "/issues/" + identifier
	commentID = strings.TrimSpace(commentID)
	if commentID != "" {
		link += "#comment-" + commentID
	}
	return link
}
