package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/bridge"
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

func TestBridgeRPCErrorMapsStableKind(t *testing.T) {
	t.Parallel()

	// Runtime 结构化 JSON-RPC 错误（如 session_busy）必须映射为可读的稳定
	// kind，而不是被压成 unavailable；原始 message 不能透传。
	connection := newHTTPFakeConnection()
	connection.requestErr = &runtime.RPCError{
		Code:    -32602,
		Message: "interaction reply is owned by another client",
		Data:    json.RawMessage(`{"kind":"session_busy"}`),
	}
	service, err := bridge.New(httpFakeConnector{connection}, bridge.Config{})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithBridge(fakeProber{}, time.Second, service)

	connect := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/connect", nil)
	connect.Host = "127.0.0.1:8080"
	connect.Header.Set("Origin", "http://127.0.0.1:8080")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, connect)
	if response.Code != http.StatusCreated {
		t.Fatalf("connect = %d: %s", response.Code, response.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	rpc := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/"+created.ID+"/rpc", bytes.NewBufferString(`{"method":"agent.guardReply","params":{"id":"x","decision":"approve"}}`))
	rpc.Host = "127.0.0.1:8080"
	rpc.Header.Set("Origin", "http://127.0.0.1:8080")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, rpc)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("rpc = %d, want %d; body %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "session_busy" {
		t.Fatalf("error code = %q, want session_busy", body.Error.Code)
	}
	if strings.Contains(body.Error.Message, "owned by another client") {
		t.Fatal("response leaked Runtime free-text error message")
	}
	if body.Error.Message == "" {
		t.Fatal("error message must be readable")
	}
}
