package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/bridge"
	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
)

type httpFakeConnector struct{ connection *httpFakeConnection }

func (c httpFakeConnector) Connect(context.Context) (bridge.Connection, error) {
	return c.connection, nil
}

type httpFakeConnection struct {
	notifications chan runtime.Notification
	done          chan struct{}
	mu            sync.Mutex
	method        string
	requestErr    error
	closeOnce     sync.Once
}

func newHTTPFakeConnection() *httpFakeConnection {
	return &httpFakeConnection{notifications: make(chan runtime.Notification, 1), done: make(chan struct{})}
}
func (c *httpFakeConnection) Request(_ context.Context, method string, _ any) (json.RawMessage, error) {
	c.mu.Lock()
	c.method = method
	c.mu.Unlock()
	if c.requestErr != nil {
		return nil, c.requestErr
	}
	return json.RawMessage(`{"value":"ok"}`), nil
}
func (c *httpFakeConnection) Notifications() <-chan runtime.Notification { return c.notifications }
func (c *httpFakeConnection) Hello() json.RawMessage {
	return json.RawMessage(`{"protocol_version":"0.3","runtime_version":"test","transport":"tcp","capabilities":{},"content_sources":{}}`)
}
func (c *httpFakeConnection) Done() <-chan struct{} { return c.done }
func (c *httpFakeConnection) Close() error {
	c.closeOnce.Do(func() {
		close(c.done)
		close(c.notifications)
	})
	return nil
}

func TestBridgeSSEOriginAndRuntimeLifecycle(t *testing.T) {
	connection := newHTTPFakeConnection()
	service, err := bridge.New(httpFakeConnector{connection}, bridge.Config{})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServerWithBridge(fakeProber{}, time.Second, service))
	defer server.Close()

	connect, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/bridge/connect", nil)
	if err != nil {
		t.Fatal(err)
	}
	connect.Header.Set("Origin", server.URL)
	createdResponse, err := server.Client().Do(connect)
	if err != nil {
		t.Fatal(err)
	}
	defer createdResponse.Body.Close()
	if createdResponse.StatusCode != http.StatusCreated {
		t.Fatalf("connect = %d", createdResponse.StatusCode)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(createdResponse.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}

	denied, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/bridge/"+created.ID+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	denied.Header.Set("Origin", "http://example.com")
	deniedResponse, err := server.Client().Do(denied)
	if err != nil {
		t.Fatal(err)
	}
	defer deniedResponse.Body.Close()
	if deniedResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin SSE = %d, want %d", deniedResponse.StatusCode, http.StatusForbidden)
	}

	eventsRequest, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/bridge/"+created.ID+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	eventsRequest.Header.Set("Origin", server.URL)
	eventsResponse, err := server.Client().Do(eventsRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer eventsResponse.Body.Close()
	if eventsResponse.StatusCode != http.StatusOK {
		t.Fatalf("SSE = %d", eventsResponse.StatusCode)
	}
	if got := eventsResponse.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/event-stream") {
		t.Fatalf("SSE Content-Type = %q", got)
	}

	scanner := bufio.NewScanner(eventsResponse.Body)
	if !scanner.Scan() || scanner.Text() != ": connected" {
		t.Fatalf("SSE prelude = %q", scanner.Text())
	}
	if !scanner.Scan() || scanner.Text() != "" {
		t.Fatalf("SSE prelude terminator = %q", scanner.Text())
	}
	connection.notifications <- runtime.Notification{Method: "agent.delta", Params: json.RawMessage(`{"content":"hello"}`)}
	if !scanner.Scan() || scanner.Text() != "event: notification" {
		t.Fatalf("SSE event = %q", scanner.Text())
	}
	if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "data: ") {
		t.Fatalf("SSE data = %q", scanner.Text())
	}
	var notification struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &notification); err != nil {
		t.Fatal(err)
	}
	if notification.Method != "agent.delta" || string(notification.Params) != `{"content":"hello"}` {
		t.Fatalf("SSE notification = %#v", notification)
	}
	if !scanner.Scan() || scanner.Text() != "" {
		t.Fatalf("SSE event terminator = %q", scanner.Text())
	}

	if err := connection.Close(); err != nil {
		t.Fatal(err)
	}
	if scanner.Scan() {
		t.Fatalf("SSE remained open after Runtime termination: %q", scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Request(context.Background(), created.ID, "session.list", nil); !errors.Is(err, bridge.ErrNotFound) {
		t.Fatalf("request after Runtime termination error = %v, want ErrNotFound", err)
	}
}
func TestBridgeHTTPRPCOriginAndDisconnect(t *testing.T) {
	connection := newHTTPFakeConnection()
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

	rpc := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/"+created.ID+"/rpc", bytes.NewBufferString(`{"method":"agent.sendMessage","params":{"parts":[{"type":"text","text":"x"}]}}`))
	rpc.Host = "127.0.0.1:8080"
	rpc.Header.Set("Origin", "http://127.0.0.1:8080")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, rpc)
	if response.Code != http.StatusOK {
		t.Fatalf("rpc = %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("missing no-store")
	}

	denied := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/"+created.ID+"/rpc", bytes.NewBufferString(`{"method":"agent.sendMessage"}`))
	denied.Host = "127.0.0.1:8080"
	denied.Header.Set("Origin", "http://example.com")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, denied)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin = %d", response.Code)
	}

	disconnect := httptest.NewRequest(http.MethodDelete, "/api/v1/bridge/"+created.ID, nil)
	disconnect.Host = "127.0.0.1:8080"
	disconnect.Header.Set("Origin", "http://127.0.0.1:8080")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, disconnect)
	if response.Code != http.StatusNoContent {
		t.Fatalf("disconnect = %d", response.Code)
	}
}
