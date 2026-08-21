package runtime

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// InstallPhase 是 Runtime 引导安装的阶段状态，前端据此渲染步骤指示器。
type InstallPhase string

const (
	InstallPhaseDetect   InstallPhase = "detect"
	InstallPhaseDownload InstallPhase = "download"
	InstallPhaseVerify   InstallPhase = "verify"
	InstallPhaseInstall  InstallPhase = "install"
	InstallPhaseStart    InstallPhase = "start"
	InstallPhaseDone     InstallPhase = "done"
	InstallPhaseError    InstallPhase = "error"
)

// InstallStatus 是安装状态快照，供 GET /api/v1/runtime/install/status 轮询。
type InstallStatus struct {
	Phase           InstallPhase `json:"phase"`
	DownloadedBytes int64        `json:"downloaded_bytes,omitempty"`
	TotalBytes      int64        `json:"total_bytes,omitempty"`
	Mirror          string       `json:"mirror,omitempty"`
	Error           string       `json:"error,omitempty"`
}

// mirrorSource 是下载源：URL 模板 + 对应的 checksums 模板。
// {version} 会被替换为具体版本号；镜像前缀指向同一 release 资产的代理。
type mirrorSource struct {
	releaseURL string
	checksums  string
}

// defaultRuntimeMirrors 是硬编码的默认镜像列表（官方优先，国内镜像兜底）。
// 顺序即尝试顺序：官方 GitHub → 常见加速前缀。用户可在设置页覆盖（存 localStorage，不进文件）。
var defaultRuntimeMirrors = []mirrorSource{
	{
		releaseURL: "https://github.com/alanchenchen/suna/releases/download/{version}/suna-{goos}-{goarch}.tar.gz",
		checksums:  "https://github.com/alanchenchen/suna/releases/download/{version}/checksums.txt",
	},
	{
		releaseURL: "https://ghproxy.com/https://github.com/alanchenchen/suna/releases/download/{version}/suna-{goos}-{goarch}.tar.gz",
		checksums:  "https://ghproxy.com/https://github.com/alanchenchen/suna/releases/download/{version}/checksums.txt",
	},
	{
		releaseURL: "https://ghfast.top/https://github.com/alanchenchen/suna/releases/download/{version}/suna-{goos}-{goarch}.tar.gz",
		checksums:  "https://ghfast.top/https://github.com/alanchenchen/suna/releases/download/{version}/checksums.txt",
	},
}

// installAssetName 生成当前平台对应的 release 资产名（与 Runtime 发版命名一致）。
func installAssetName() string {
	goos, goarch := runtime.GOOS, runtime.GOARCH
	if goos == "windows" {
		return fmt.Sprintf("suna-%s-%s.zip", goos, goarch)
	}
	return fmt.Sprintf("suna-%s-%s.tar.gz", goos, goarch)
}

// Installer 管理 Runtime 的引导安装。同一时刻只允许一个安装任务。
type Installer struct {
	version string // 目标 Runtime 版本（Git tag，如 v0.21.0）

	// OnDone 在安装结束（done 或 error）时调用；gateway 用它重新评估空闲自退
	// （安装期间挂起的退出在结束后应重新触发）。
	OnDone func()

	mu     sync.Mutex
	status InstallStatus
	active bool
	cancel context.CancelFunc
}

// NewInstaller 创建安装器。version 是目标 Runtime 版本；空值用 latest。
func NewInstaller(version string) *Installer {
	if version == "" {
		version = "latest"
	}
	return &Installer{version: version, status: InstallStatus{Phase: InstallPhaseDetect}}
}

// Status 返回当前安装状态快照。
func (in *Installer) Status() InstallStatus {
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.status
}

// Active 报告是否有安装任务在跑（gateway 空闲自退需挂起）。
func (in *Installer) Active() bool {
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.active
}

// Cancel 取消进行中的安装。
func (in *Installer) Cancel() {
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.cancel != nil {
		in.cancel()
	}
}

// Start 启动安装（异步）。已在跑时返回 false。
func (in *Installer) Start() bool {
	in.mu.Lock()
	if in.active {
		in.mu.Unlock()
		return false
	}
	in.active = true
	in.status = InstallStatus{Phase: InstallPhaseDetect}
	ctx, cancel := context.WithCancel(context.Background())
	in.cancel = cancel
	in.mu.Unlock()

	go in.run(ctx)
	return true
}

func (in *Installer) run(ctx context.Context) {
	defer func() {
		in.mu.Lock()
		in.active = false
		in.cancel = nil
		in.mu.Unlock()
		// 安装结束：通知外部重新评估（如空闲自退）。
		if in.OnDone != nil {
			in.OnDone()
		}
	}()

	in.setPhase(InstallPhaseDownload, "")
	dir := filepath.Dir(runtimeBinaryPath())
	if dir == "." {
		in.fail("cannot resolve home directory")
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		in.fail("cannot create install directory: " + err.Error())
		return
	}

	// 多镜像按序尝试：下载资产 + checksums，校验 SHA256 后解压安装。
	var lastErr error
	for _, mirror := range in.mirrors() {
		if ctx.Err() != nil {
			in.fail("install cancelled")
			return
		}
		releaseURL := expandTemplate(mirror.releaseURL, in.version)
		checksumsURL := expandTemplate(mirror.checksums, in.version)
		status, err := in.downloadAndInstall(ctx, dir, releaseURL, checksumsURL, mirror.releaseURL)
		if err == nil {
			in.setPhase(InstallPhaseDone, "")
			return
		}
		lastErr = err
		if ctx.Err() != nil {
			in.fail("install cancelled")
			return
		}
		_ = status // 下载进度已通过 setStatus 更新
	}
	in.fail(lastErr.Error())
}

// mirrors 返回按序尝试的镜像列表；后续可扩展为读取设置页覆盖（localStorage 由前端传入）。
func (in *Installer) mirrors() []mirrorSource {
	return defaultRuntimeMirrors
}

func (in *Installer) downloadAndInstall(ctx context.Context, dir, releaseURL, checksumsURL, mirrorLabel string) (InstallStatus, error) {
	in.setPhase(InstallPhaseDownload, mirrorLabel)

	// 1. 下载 checksums.txt，解析目标资产的 SHA256。
	in.setPhase(InstallPhaseVerify, mirrorLabel)
	checksumsBody, err := in.fetch(ctx, checksumsURL)
	if err != nil {
		return in.Status(), fmt.Errorf("fetch checksums failed: %w", err)
	}
	wantHash, err := parseChecksum(checksumsBody, installAssetName())
	if err != nil {
		return in.Status(), fmt.Errorf("parse checksums failed: %w", err)
	}

	// 2. 下载资产到临时文件（带进度），供校验与解压两次读取。
	in.setPhase(InstallPhaseDownload, mirrorLabel)
	tmpFile, total, err := in.downloadToTemp(ctx, releaseURL)
	if err != nil {
		return in.Status(), fmt.Errorf("download failed: %w", err)
	}
	defer os.Remove(tmpFile)

	// 3. SHA256 校验（镜像不可信，硬性校验；失败拒绝安装）。
	in.setPhase(InstallPhaseVerify, mirrorLabel)
	gotHash, err := hashFile(tmpFile)
	if err != nil {
		return in.Status(), fmt.Errorf("read download failed: %w", err)
	}
	if !strings.EqualFold(gotHash, wantHash) {
		return in.Status(), fmt.Errorf("checksum mismatch: file may be tampered")
	}
	_ = total

	// 4. 安装：解压临时文件 → 原子替换。
	in.setPhase(InstallPhaseInstall, mirrorLabel)
	if err := in.installAsset(ctx, dir, tmpFile, installAssetName()); err != nil {
		return in.Status(), fmt.Errorf("install failed: %w", err)
	}
	return in.Status(), nil
}

// fetch 下载完整内容（用于 checksums，较小）。
func (in *Installer) fetch(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

// downloadToTemp 下载资产到临时文件并流式更新进度；返回文件路径与总字节数。
func (in *Installer) downloadToTemp(ctx context.Context, url string) (string, int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", 0, err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("status %d", resp.StatusCode)
	}
	tmp, err := os.CreateTemp("", "suna-download-*")
	if err != nil {
		return "", 0, err
	}
	defer tmp.Close()
	progress := &progressReader{src: resp.Body, total: resp.ContentLength, onProgress: func(done int64) {
		in.setDownloadProgress(done, resp.ContentLength)
	}}
	if _, err := io.Copy(tmp, progress); err != nil {
		os.Remove(tmp.Name())
		return "", 0, err
	}
	return tmp.Name(), resp.ContentLength, nil
}

// hashFile 计算文件的 SHA256（十六进制）。
func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// installAsset 将下载的归档文件解压到目标目录（原子替换 suna 二进制）。
func (in *Installer) installAsset(ctx context.Context, dir, archivePath, assetName string) error {
	tmp := filepath.Join(dir, ".suna-install-"+fmt.Sprint(time.Now().UnixNano()))
	defer os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		return err
	}
	// 解压归档到临时目录。
	if strings.HasSuffix(assetName, ".zip") {
		if err := extractZip(ctx, archivePath, tmp); err != nil {
			return err
		}
	} else {
		if err := extractTarGz(ctx, archivePath, tmp); err != nil {
			return err
		}
	}
	// 找到解压出的 suna 可执行文件。
	bin, err := findExecutable(tmp)
	if err != nil {
		return err
	}
	target := filepath.Join(dir, "suna")
	if err := os.Rename(bin, target); err != nil {
		// 跨设备时 copy 兜底。
		if err := copyFile(bin, target); err != nil {
			return err
		}
	}
	return os.Chmod(target, 0o755)
}

func (in *Installer) setPhase(phase InstallPhase, mirror string) {
	in.mu.Lock()
	defer in.mu.Unlock()
	in.status.Phase = phase
	in.status.Mirror = mirror
	in.status.Error = ""
}

func (in *Installer) setDownloadProgress(done, total int64) {
	in.mu.Lock()
	defer in.mu.Unlock()
	in.status.DownloadedBytes = done
	in.status.TotalBytes = total
}

func (in *Installer) fail(message string) {
	in.mu.Lock()
	defer in.mu.Unlock()
	in.status.Phase = InstallPhaseError
	in.status.Error = message
}

// progressReader 包装响应体，流式上报下载进度。
type progressReader struct {
	src       io.ReadCloser
	total     int64
	read      int64
	onProgress func(int64)
}

func (p *progressReader) Read(buf []byte) (int, error) {
	n, err := p.src.Read(buf)
	p.read += int64(n)
	if p.onProgress != nil {
		p.onProgress(p.read)
	}
	return n, err
}

func (p *progressReader) Close() error { return p.src.Close() }

// parseChecksum 从 checksums.txt 解析指定资产的行（格式：<sha256>  <filename>）。
func parseChecksum(body []byte, assetName string) (string, error) {
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[1] == assetName {
			return fields[0], nil
		}
	}
	return "", fmt.Errorf("checksum for %s not found", assetName)
}

// expandTemplate 替换 URL 模板中的 {version}/{goos}/{goarch}。
func expandTemplate(tmpl, version string) string {
	replacer := strings.NewReplacer(
		"{version}", version,
		"{goos}", runtime.GOOS,
		"{goarch}", runtime.GOARCH,
	)
	return replacer.Replace(tmpl)
}

// findExecutable 在解压目录里查找 suna 可执行文件。
func findExecutable(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if e.IsDir() {
			if sub, err := findExecutable(filepath.Join(dir, e.Name())); err == nil {
				return sub, nil
			}
			continue
		}
		name := e.Name()
		if name == "suna" || name == "suna.exe" {
			return filepath.Join(dir, name), nil
		}
	}
	return "", fmt.Errorf("suna executable not found in archive")
}

// copyFile 复制文件（跨设备 mv 兜底）。
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// ensure JSON 包用于状态序列化（httpapi 直接序列化 InstallStatus）。
// extractTarGz 解压 .tar.gz 归档文件到目标目录（防路径穿越）。
func extractTarGz(ctx context.Context, archivePath, dst string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if err := safeWriteEntry(dst, hdr.Name, hdr.FileInfo().IsDir(), tr); err != nil {
			return err
		}
	}
}

// extractZip 解压 .zip 归档文件到目标目录（防路径穿越）。
func extractZip(ctx context.Context, archivePath, dst string) error {
	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, file := range zr.File {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := safeWriteZipEntry(dst, file); err != nil {
			return err
		}
	}
	return nil
}

// safeWriteEntry 安全解压单个 tar 条目（拒绝路径穿越）。
func safeWriteEntry(dst, name string, isDir bool, r io.Reader) error {
	clean := filepath.Clean(name)
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return fmt.Errorf("unsafe archive path: %s", name)
	}
	target := filepath.Join(dst, clean)
	if isDir {
		return os.MkdirAll(target, 0o755)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	out, err := os.Create(target)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, r)
	return err
}

// safeWriteZipEntry 安全解压单个 zip 条目（拒绝路径穿越）。
func safeWriteZipEntry(dst string, file *zip.File) error {
	clean := filepath.Clean(file.Name)
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return fmt.Errorf("unsafe archive path: %s", file.Name)
	}
	target := filepath.Join(dst, clean)
	if file.FileInfo().IsDir() {
		return os.MkdirAll(target, 0o755)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	in, err := file.Open()
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(target)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}