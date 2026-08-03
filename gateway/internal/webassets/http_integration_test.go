//go:build integration

package webassets

import (
	"errors"
	"io/fs"
	"net/url"
	"path"
	"regexp"
	"strings"
	"testing"
)

var localAssetReference = regexp.MustCompile(`(?i)(src|href)[[:space:]]*=[[:space:]]*["'](/assets/[^"']+)["']`)

func TestEmbeddedFrontendAssets(t *testing.T) {
	index, err := Files.ReadFile("dist/index.html")
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			t.Skip("staged frontend assets are absent; run ./scripts/stage-frontend.sh after frontend build")
		}
		t.Fatalf("read embedded index shell: %v", err)
	}

	indexShell := string(index)
	if !strings.Contains(indexShell, `<div id="root">`) {
		t.Fatal("embedded index.html does not contain the application root shell")
	}

	references := localAssetReference.FindAllStringSubmatch(indexShell, -1)
	if len(references) == 0 {
		t.Fatal("embedded index.html does not reference any local /assets/ files")
	}

	seen := make(map[string]struct{}, len(references))
	for _, reference := range references {
		assetURL, err := url.Parse(reference[2])
		if err != nil {
			t.Fatalf("parse local asset reference %q: %v", reference[2], err)
		}
		assetPath := strings.TrimPrefix(assetURL.Path, "/")
		if !strings.HasPrefix(assetPath, "assets/") {
			t.Fatalf("local asset reference %q is outside /assets/", reference[2])
		}
		assetPath = path.Clean(assetPath)
		if !fs.ValidPath(assetPath) || assetPath == "assets" {
			t.Fatalf("invalid local asset reference %q", reference[2])
		}
		if _, ok := seen[assetPath]; ok {
			continue
		}
		seen[assetPath] = struct{}{}

		contents, err := Files.ReadFile("dist/" + assetPath)
		if err != nil {
			t.Fatalf("index.html references %q, but it is not embedded: %v", reference[2], err)
		}
		if len(contents) == 0 {
			t.Fatalf("index.html references %q, but the embedded file is empty", reference[2])
		}
	}
}
