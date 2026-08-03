package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
)

type fakeProber struct {
	result runtime.HelloResult
	err    error
}

func (p fakeProber) Probe(context.Context) (runtime.HelloResult, error) {
	return p.result, p.err
}

func TestRuntimeStatusReady(t *testing.T) {
	t.Parallel()

	handler := NewServer(fakeProber{result: runtime.HelloResult{ProtocolVersion: "0.3"}}, time.Second)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/runtime/status", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", cacheControl)
	}
}

func TestRuntimeStatusRedactsInternalErrors(t *testing.T) {
	t.Parallel()

	handler := NewServer(fakeProber{err: &runtime.Error{Kind: runtime.ErrorUnavailable, Err: errors.New("secret path /private/data")}}, time.Second)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/runtime/status", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if response.Body.String() == "" || strings.Contains(response.Body.String(), "secret path") {
		t.Fatal("response leaked internal error details")
	}
}
