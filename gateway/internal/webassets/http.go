package webassets

import (
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

const missingAssetsMessage = "Suna App UI assets are unavailable. Build the frontend with `cd frontend && pnpm build`, then stage it with `./scripts/stage-frontend.sh`."

// Handler serves the production UI embedded at build time. API routes must be
// registered by the caller before this fallback handler.
func Handler() http.Handler {
	return HandlerFromFS(Files)
}

// HandlerFromFS serves a UI embedded below dist in assets. It is exported so
// callers and tests can provide a filesystem without depending on build output.
// A filesystem without dist/index.html returns a 503 with build/stage guidance.
func HandlerFromFS(assets fs.FS) http.Handler {
	dist, err := fs.Sub(assets, "dist")
	if err != nil {
		return missingAssetsHandler()
	}
	index, err := fs.Stat(dist, "index.html")
	if err != nil || index.IsDir() {
		return missingAssetsHandler()
	}

	files := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		cleanPath := path.Clean(r.URL.Path)
		if isBackendPath(cleanPath) {
			http.NotFound(w, r)
			return
		}
		if cleanPath != "/" && path.Ext(cleanPath) == "" {
			r2 := r.Clone(r.Context())
			// Serve the directory root rather than /index.html: net/http's
			// FileServer redirects direct index.html requests, which would turn
			// an SPA navigation into an incorrect relative redirect.
			r2.URL.Path = "/"
			r2.URL.RawPath = ""
			files.ServeHTTP(w, r2)
			return
		}
		files.ServeHTTP(w, r)
	})
}

func isBackendPath(cleanPath string) bool {
	return cleanPath == "/api" || strings.HasPrefix(cleanPath, "/api/") || cleanPath == "/healthz"
}

func missingAssetsHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		cleanPath := path.Clean(r.URL.Path)
		if isBackendPath(cleanPath) {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		if r.Method != http.MethodHead {
			_, _ = fmt.Fprintln(w, missingAssetsMessage)
		}
	})
}
