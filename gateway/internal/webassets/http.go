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
		// 缓存策略：只有 /assets/ 下的 hash 资源（Vite 产物，内容寻址）可长期缓存；
		// 其余入口元数据（HTML/SPA fallback/manifest/图标）每次重新验证——
		// 这些文件路径不带 hash，若 immutable 缓存一年，更新图标/名称/UI 后
		// 用户浏览器会长期拿到旧版本（manifest 引用的 icon-192.png 尤其如此）。
		if strings.HasPrefix(cleanPath, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		// PWA manifest 扩展名不在 Go 内置 mime 表（默认 text/plain），
		// 部分浏览器会拒绝加载；显式声明正确类型。
		if strings.EqualFold(path.Ext(cleanPath), ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json")
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
