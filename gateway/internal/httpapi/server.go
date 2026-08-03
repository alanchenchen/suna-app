package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/bridge"
	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
)

type RuntimeProber interface {
	Probe(context.Context) (runtime.HelloResult, error)
}

type Server struct {
	prober       RuntimeProber
	probeTimeout time.Duration
	bridge       *bridge.Service

	probeMu       sync.Mutex
	lastProbe     probeResult
	probeInFlight *probeFlight
}

type probeResult struct {
	hello runtime.HelloResult
	err   error
	at    time.Time
}

type probeFlight struct {
	done   chan struct{}
	result probeResult
}

const probeCacheTTL = 2 * time.Second

// NewServer serves status routes. Supplying a bridge service additionally enables
// browser Runtime bridge routes while preserving the original construction API.
func NewServer(prober RuntimeProber, probeTimeout time.Duration, services ...*bridge.Service) http.Handler {
	var service *bridge.Service
	if len(services) != 0 {
		service = services[0]
	}
	return newServer(prober, probeTimeout, service)
}

// NewServerWithBridge makes the browser bridge dependency explicit for callers
// that create a public runtime.ConnectionManager.
func NewServerWithBridge(prober RuntimeProber, probeTimeout time.Duration, service *bridge.Service) http.Handler {
	return newServer(prober, probeTimeout, service)
}

func newServer(prober RuntimeProber, probeTimeout time.Duration, service *bridge.Service) http.Handler {
	s := &Server{prober: prober, probeTimeout: probeTimeout, bridge: service}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /api/v1/runtime/status", s.runtimeStatus)
	if service != nil {
		mux.HandleFunc("POST /api/v1/bridge/connect", s.bridgeConnect)
		mux.HandleFunc("POST /api/v1/bridge/{id}/rpc", s.bridgeRPC)
		mux.HandleFunc("GET /api/v1/bridge/{id}/events", s.bridgeEvents)
		mux.HandleFunc("DELETE /api/v1/bridge/{id}", s.bridgeDisconnect)
	}
	return securityHeaders(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) runtimeStatus(w http.ResponseWriter, r *http.Request) {
	hello, err := s.probe(r.Context())
	if err == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ready",
			"runtime": map[string]string{"protocol_version": hello.ProtocolVersion},
		})
		return
	}

	kind := runtime.ErrorUnavailable
	if typed, ok := err.(*runtime.Error); ok {
		kind = typed.Kind
	}
	status := http.StatusServiceUnavailable
	if kind == runtime.ErrorProtocol {
		status = http.StatusBadGateway
	}
	if kind == runtime.ErrorCapability {
		status = http.StatusNotImplemented
	}
	writeJSON(w, status, map[string]any{
		"status": string(kind),
		"error": map[string]string{
			"code":    string(kind),
			"message": safeMessage(kind),
		},
	})
}

func (s *Server) probe(ctx context.Context) (runtime.HelloResult, error) {
	s.probeMu.Lock()
	if !s.lastProbe.at.IsZero() && time.Since(s.lastProbe.at) < probeCacheTTL {
		result := s.lastProbe
		s.probeMu.Unlock()
		return result.hello, result.err
	}
	if flight := s.probeInFlight; flight != nil {
		s.probeMu.Unlock()
		select {
		case <-ctx.Done():
			return runtime.HelloResult{}, ctx.Err()
		case <-flight.done:
			return flight.result.hello, flight.result.err
		}
	}
	flight := &probeFlight{done: make(chan struct{})}
	s.probeInFlight = flight
	s.probeMu.Unlock()

	probeCtx, cancel := context.WithTimeout(context.Background(), s.probeTimeout)
	hello, err := s.prober.Probe(probeCtx)
	cancel()
	result := probeResult{hello: hello, err: err, at: time.Now()}

	s.probeMu.Lock()
	// Client cancellation must not make a healthy Runtime look unavailable to
	// other browser requests. The leader probe is detached from request context,
	// and only the bounded probe result is shared briefly.
	s.lastProbe = result
	s.probeInFlight = nil
	flight.result = result
	close(flight.done)
	s.probeMu.Unlock()
	return hello, err
}

func (s *Server) bridgeConnect(w http.ResponseWriter, r *http.Request) {
	if !sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	id, hello, err := s.bridge.Connect(r.Context())
	if err != nil {
		bridgeRuntimeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":    id,
		"hello": json.RawMessage(hello),
	})
}

func (s *Server) bridgeRPC(w http.ResponseWriter, r *http.Request) {
	if !sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	id := r.PathValue("id")
	if !bridge.ValidID(id) {
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
		return
	}
	var request struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if err := decodeLimitedJSON(w, r, s.bridge.MaxRequestBody(), &request); err != nil {
		bridgeError(w, http.StatusBadRequest, "invalid_request", "Request must be a valid JSON object.")
		return
	}
	result, err := s.bridge.Request(r.Context(), id, request.Method, request.Params)
	if err == nil {
		writeJSON(w, http.StatusOK, map[string]json.RawMessage{"result": result})
		return
	}
	switch {
	case errors.Is(err, bridge.ErrNotFound), errors.Is(err, bridge.ErrClosed):
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
	case errors.Is(err, bridge.ErrMethodNotAllowed):
		bridgeError(w, http.StatusForbidden, "method_not_allowed", "Runtime method is not allowed.")
	case errors.Is(err, bridge.ErrInvalidParams):
		bridgeError(w, http.StatusBadRequest, "invalid_params", "Request params must be valid JSON.")
	default:
		bridgeRuntimeError(w, err)
	}
}

func (s *Server) bridgeEvents(w http.ResponseWriter, r *http.Request) {
	if !sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	id := r.PathValue("id")
	if !bridge.ValidID(id) {
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
		return
	}
	notifications, unsubscribe, err := s.bridge.Subscribe(id)
	if err != nil {
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
		return
	}
	defer unsubscribe()

	flusher, ok := w.(http.Flusher)
	if !ok {
		bridgeError(w, http.StatusInternalServerError, "stream_unavailable", "Event stream is unavailable.")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, ": connected\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case notification, ok := <-notifications:
			if !ok {
				return
			}
			payload, err := json.Marshal(struct {
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}{Method: notification.Method, Params: notification.Params})
			if err != nil { // Notification fields originate from a typed Runtime frame.
				return
			}
			_, _ = io.WriteString(w, "event: notification\ndata: ")
			_, _ = w.Write(payload)
			_, _ = io.WriteString(w, "\n\n")
			flusher.Flush()
		}
	}
}

func (s *Server) bridgeDisconnect(w http.ResponseWriter, r *http.Request) {
	if !sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	if err := s.bridge.Disconnect(r.PathValue("id")); err != nil {
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sameOriginUnsafe permits browser requests with no Origin (native clients and
// same-origin navigation) but rejects any supplied non-loopback or cross-origin
// Origin. The process is loopback-only, so this is the CSRF boundary.
func sameOriginUnsafe(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	if parsed.Scheme != requestScheme(r) {
		return false
	}
	originHost, originPort, err := net.SplitHostPort(parsed.Host)
	if err != nil {
		return false
	}
	requestHost, requestPort, err := net.SplitHostPort(r.Host)
	if err != nil || originPort != requestPort || !sameLoopbackHost(originHost, requestHost) {
		return false
	}
	return true
}

func requestScheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

func sameLoopbackHost(a, b string) bool {
	// hostname localhost is a loopback alias, while all other host names are
	// refused so DNS configuration cannot widen this browser-only boundary.
	if strings.EqualFold(a, "localhost") && strings.EqualFold(b, "localhost") {
		return true
	}
	left, right := net.ParseIP(a), net.ParseIP(b)
	return left != nil && right != nil && left.IsLoopback() && right.IsLoopback() && left.Equal(right)
}

func decodeLimitedJSON(w http.ResponseWriter, r *http.Request, max int64, destination any) error {
	if r.Body == nil || (r.ContentLength > max && r.ContentLength >= 0) {
		return errors.New("body exceeds limit")
	}
	r.Body = http.MaxBytesReader(w, r.Body, max)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values")
	}
	return nil
}

func bridgeRuntimeError(w http.ResponseWriter, err error) {
	kind := runtime.ErrorUnavailable
	var runtimeError *runtime.Error
	if errors.As(err, &runtimeError) {
		kind = runtimeError.Kind
	}
	status := http.StatusBadGateway
	if kind == runtime.ErrorCapability {
		status = http.StatusNotImplemented
	}
	bridgeError(w, status, string(kind), safeMessage(kind))
}

func bridgeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func safeMessage(kind runtime.ErrorKind) string {
	switch kind {
	case runtime.ErrorProtocol:
		return "Runtime returned an unsupported response."
	case runtime.ErrorCapability:
		return "Installed Runtime does not support the required protocol."
	default:
		return "Runtime is unavailable."
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
