package runtime

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	runstd "runtime"
	"strings"
	"testing"
)

func TestParseChecksum(t *testing.T) {
	body := []byte("abc123  suna-darwin-arm64.tar.gz\ndef456  suna-linux-amd64.tar.gz\n")
	got, err := parseChecksum(body, "suna-linux-amd64.tar.gz")
	if err != nil {
		t.Fatal(err)
	}
	if got != "def456" {
		t.Fatalf("hash = %q, want def456", got)
	}
	if _, err := parseChecksum(body, "missing.tar.gz"); err == nil {
		t.Fatal("expected error for missing asset")
	}
}

func TestExpandTemplate(t *testing.T) {
	got := expandTemplate("https://example.com/{version}/suna-{goos}-{goarch}.tar.gz", "v0.21.0")
	want := "https://example.com/v0.21.0/suna-" + runstd.GOOS + "-" + runstd.GOARCH + ".tar.gz"
	if got != want {
		t.Fatalf("expandTemplate = %q, want %q", got, want)
	}
}

func TestSafeWriteEntryRejectsTraversal(t *testing.T) {
	dst := t.TempDir()
	// 路径穿越（../）必须被拒绝。
	err := safeWriteEntry(dst, "../evil.txt", false, strings.NewReader("x"))
	if err == nil {
		t.Fatal("path traversal was not rejected")
	}
	// 绝对路径必须被拒绝。
	if err := safeWriteEntry(dst, "/etc/evil.txt", false, strings.NewReader("x")); err == nil {
		t.Fatal("absolute path was not rejected")
	}
}

func TestExtractTarGzRoundTrip(t *testing.T) {
	dst := t.TempDir()
	archive := filepath.Join(t.TempDir(), "suna.tar.gz")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	content := []byte("#!/bin/sh\necho hi\n")
	if err := tw.WriteHeader(&tar.Header{Name: "suna/bin/suna", Mode: 0o755, Size: int64(len(content))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(content); err != nil {
		t.Fatal(err)
	}
	tw.Close()
	gz.Close()
	f.Close()

	if err := extractTarGz(context.Background(), archive, dst); err != nil {
		t.Fatal(err)
	}
	bin, err := findExecutable(dst)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(bin) != "suna" {
		t.Fatalf("found %q, want suna", bin)
	}
}

func TestInstallAssetReplacesBinary(t *testing.T) {
	dir := t.TempDir()
	// 构造一个 tar.gz，内含 suna 可执行文件。
	archive := filepath.Join(t.TempDir(), "suna.tar.gz")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	content := []byte("#!/bin/sh\necho v0.21.0\n")
	if err := tw.WriteHeader(&tar.Header{Name: "suna", Mode: 0o755, Size: int64(len(content))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(content); err != nil {
		t.Fatal(err)
	}
	tw.Close()
	gz.Close()
	f.Close()

	installer := NewInstaller("v0.21.0")
	if err := installer.installAsset(context.Background(), dir, archive, "suna-darwin-arm64.tar.gz"); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "suna")
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&0o111 == 0 {
		t.Fatal("installed binary is not executable")
	}
}