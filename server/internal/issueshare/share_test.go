package issueshare_test

import (
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/issueshare"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	secret := "test-secret"
	hash := issueshare.HashPassword(secret, "pass1234")
	if !issueshare.CheckPassword(secret, "pass1234", hash) {
		t.Fatal("expected match")
	}
	if issueshare.CheckPassword(secret, "wrong", hash) {
		t.Fatal("expected mismatch")
	}
}

func TestAccessToken(t *testing.T) {
	secret := "tok-secret"
	code := "abc123"
	tok := issueshare.MintAccessToken(secret, code, time.Hour)
	if !issueshare.VerifyAccessToken(secret, code, tok) {
		t.Fatal("expected valid token")
	}
	if issueshare.VerifyAccessToken(secret, "other", tok) {
		t.Fatal("code mismatch should fail")
	}
}

func TestNewCode(t *testing.T) {
	a, err := issueshare.NewCode()
	if err != nil || len(a) < 16 {
		t.Fatalf("code %q err %v", a, err)
	}
}
