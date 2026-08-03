package webassets

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHandlerFromFSServesShellAssetsAndSPAPaths(t *testing.T) {
	t.Parallel()

	handler := HandlerFromFS(testAssets())
	cases := []struct {
		name        string
		method      string
		path        string
		status      int
		contentType string
		contains    string
	}{
		{name: "root shell", method: http.MethodGet, path: "/", status: http.StatusOK, contentType: "text/html", contains: `<div id="root">`},
		{name: "nested SPA path", method: http.MethodGet, path: "/sessions/example", status: http.StatusOK, contentType: "text/html", contains: `<div id="root">`},
		{name: "javascript asset", method: http.MethodGet, path: "/assets/app.js", status: http.StatusOK, contentType: "text/javascript", contains: "console.log"},
		{name: "stylesheet asset", method: http.MethodGet, path: "/assets/app.css", status: http.StatusOK, contentType: "text/css", contains: "body"},
		{name: "unknown asset is not SPA fallback", method: http.MethodGet, path: "/assets/missing.js", status: http.StatusNotFound},
		{name: "API path is never UI fallback", method: http.MethodGet, path: "/api/v1/missing", status: http.StatusNotFound},
		{name: "API root is never UI fallback", method: http.MethodGet, path: "/api", status: http.StatusNotFound},
		{name: "health path is never UI fallback", method: http.MethodGet, path: "/healthz", status: http.StatusNotFound},
		{name: "unsafe method is rejected", method: http.MethodPost, path: "/settings", status: http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			response := serve(handler, tc.method, tc.path)

			if response.Code != tc.status {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, tc.status, response.Body.String())
			}
			if tc.contentType != "" && !strings.HasPrefix(response.Header().Get("Content-Type"), tc.contentType) {
				t.Fatalf("Content-Type = %q, want prefix %q", response.Header().Get("Content-Type"), tc.contentType)
			}
			if tc.contains != "" && !strings.Contains(response.Body.String(), tc.contains) {
				t.Fatalf("body does not contain %q", tc.contains)
			}
		})
	}
}

func TestHandlerFromFSMissingIndexReturnsBuildGuidance(t *testing.T) {
	t.Parallel()

	handler := HandlerFromFS(fstest.MapFS{
		"dist/.gitkeep": &fstest.MapFile{Data: []byte("placeholder")},
	})
	response := serve(handler, http.MethodGet, "/sessions/example")

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusServiceUnavailable, response.Body.String())
	}
	for _, message := range []string{"UI assets are unavailable", "pnpm build", "stage-frontend.sh"} {
		if !strings.Contains(response.Body.String(), message) {
			t.Fatalf("body = %q, want guidance containing %q", response.Body.String(), message)
		}
	}
}

func TestHandlerFromFSMissingIndexPreservesAPIAndMethodBoundaries(t *testing.T) {
	t.Parallel()

	handler := HandlerFromFS(fstest.MapFS{})
	for _, tc := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/v1/missing"},
		{method: http.MethodGet, path: "/healthz"},
		{method: http.MethodPost, path: "/"},
	} {
		response := serve(handler, tc.method, tc.path)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s %s: status = %d, want %d", tc.method, tc.path, response.Code, http.StatusNotFound)
		}
	}
}

func TestHandlerFromFSHeadRequestsDoNotReturnABody(t *testing.T) {
	t.Parallel()

	response := serve(HandlerFromFS(testAssets()), http.MethodHead, "/sessions/example")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("HEAD response body = %q, want empty", response.Body.String())
	}
}

func TestHandlerFromFSMissingIndexHeadReturnsNoBody(t *testing.T) {
	t.Parallel()

	response := serve(HandlerFromFS(fstest.MapFS{}), http.MethodHead, "/")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("HEAD response body = %q, want empty", response.Body.String())
	}
}

func testAssets() fs.FS {
	return fstest.MapFS{
		"dist/index.html":     &fstest.MapFile{Data: []byte(`<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></body></html>`)},
		"dist/assets/app.js":  &fstest.MapFile{Data: []byte("console.log('app')")},
		"dist/assets/app.css": &fstest.MapFile{Data: []byte("body { color: black; }")},
	}
}

func serve(handler http.Handler, method, target string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(method, target, nil))
	return response
}
