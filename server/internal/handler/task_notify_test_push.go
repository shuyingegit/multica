package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/notify"
)

type testTaskNotifyRequest struct {
	Channel string `json:"channel"`
	URL     string `json:"url,omitempty"`
	Token   string `json:"token,omitempty"`
}

// TestTaskNotify — POST /api/workspaces/{id}/task-notify/test
// Sends one short message through wechat_url or clawbot using the form
// values when present, otherwise the saved workspace settings. The enabled
// switch is ignored so operators can prove the endpoint before relying on
// a real task ending.
func (h *Handler) TestTaskNotify(w http.ResponseWriter, r *http.Request) {
	var req testTaskNotifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	ws, err := h.Queries.GetWorkspace(r.Context(), parseUUID(chi.URLParam(r, "id")))
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	cfg := notify.ParseConfig(ws.Settings, "")
	channel := strings.TrimSpace(req.Channel)
	rawURL := strings.TrimSpace(req.URL)
	token := strings.TrimSpace(req.Token)
	if channel == "wechat_url" && rawURL == "" {
		rawURL = cfg.WechatURL.URL
	}
	if channel == "clawbot" && token == "" {
		token = cfg.Clawbot.Token
	}
	detail, err := notify.ProbeChannel(r.Context(), channel, rawURL, token)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"detail": detail,
	})
}
