package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	runtimelib "runtime"
	"strings"
	"syscall"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/bridge"
	"github.com/alanchenchen/suna-app/gateway/internal/config"
	"github.com/alanchenchen/suna-app/gateway/internal/httpapi"
	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
	"github.com/alanchenchen/suna-app/gateway/internal/webassets"
)

var buildVersion = "dev"

func main() {
	cfg := config.Default()
	flag.StringVar(&cfg.ListenAddress, "listen", cfg.ListenAddress, "HTTP listen address (default 0.0.0.0:7633)")
	flag.StringVar(&cfg.SunaBinary, "suna-binary", cfg.SunaBinary, "path to the installed suna executable")
	// 记录用户是否显式指定了 --listen：显式指定时不做端口回退，
	// 尊重用户意图（与 Suna Runtime 的 --listen 语义一致）。
	// 注意：flag.Visit 必须在 flag.Parse() 之后调用，否则看不到任何已设置 flag。
	flag.Parse()
	listenExplicit := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "listen" {
			listenExplicit = true
		}
	})

	// 监听地址自由指定：默认 0.0.0.0 覆盖本机 loopback、局域网与 Tailscale 虚拟网
	// （手机远程场景）；显式 --listen 127.0.0.1 可退回纯本机模式。
	// 显式 --listen 时不做端口回退，尊重用户意图。

	listener, err := listenWithFallback(cfg.ListenAddress, !listenExplicit)
	if err != nil {
		fmt.Fprintf(os.Stderr, "suna-app could not start the local server: %v\n", err)
		os.Exit(1)
	}
	defer listener.Close()
	// 回退后 cfg.ListenAddress 仍是默认值，后续打印实际监听地址时用 listener。
	actualAddress := listener.Addr().String()

	connections, err := runtime.NewConnectionManager(runtime.ManagerConfig{
		Launcher:      runtime.CommandLauncher{Binary: cfg.SunaBinary},
		LaunchTimeout: cfg.CommandTimeout,
		DialTimeout:   cfg.DialTimeout,
		HelloTimeout:  cfg.HelloTimeout,
		ClientVersion: buildVersion,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "suna-app could not configure the Runtime bridge")
		os.Exit(1)
	}
	browserBridge, err := bridge.New(bridge.RuntimeConnector{Manager: connections}, bridge.Config{})
	if err != nil {
		fmt.Fprintln(os.Stderr, "suna-app could not configure the browser bridge")
		os.Exit(1)
	}
	// 非 loopback 监听时启用远程模式：CSRF 校验从"仅 loopback 同源"放宽为"任意同源"。
	// 默认 0.0.0.0 监听下总是远程模式；显式 --listen 127.0.0.1 则退回严格本机模式。
	allowRemote := !isLoopbackAddress(cfg.ListenAddress)
	// Runtime 引导安装器：main 持有同一实例，供 httpapi 端点与空闲自退挂起判断共用。
	runtimeInstaller := runtime.NewInstaller("latest")
	handler := httpapi.NewServerWithInstaller(connections, cfg.CommandTimeout+cfg.DialTimeout+cfg.HelloTimeout, browserBridge, runtimeInstaller, allowRemote)
	mux := http.NewServeMux()
	mux.Handle("/api/", handler)
	mux.Handle("/healthz", handler)
	mux.Handle("/", webassets.Handler())
	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		// SSE is a long-lived notification stream. Do not apply a server-wide write
		// deadline here; individual non-stream HTTP handlers are bounded by request contexts.
		WriteTimeout: 0,
		IdleTimeout:  30 * time.Second,
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	logger.Info("suna-app gateway started", "version", buildVersion, "address", actualAddress)

	// .app / .desktop 双击启动时自动打开浏览器（SUNA_APP_OPEN_BROWSER=1 由启动脚本设置）。
	// 手动命令行启动不设置该变量，避免每次重启都弹浏览器。
	if os.Getenv("SUNA_APP_OPEN_BROWSER") == "1" {
		go openBrowser(actualAddress)
	}

	// 空闲自退：所有浏览器连接都关闭且无 run 后，gateway 优雅退出。
	// 二次确认 ActiveClients()==0 防"计时到点瞬间用户重开浏览器"竞态；
	// 安装进行中挂起（不中断下载/校验）。
	idleExitCh := make(chan struct{}, 1)
	maybeIdleExit := func() {
		if browserBridge.ActiveClients() != 0 || runtimeInstaller.Active() {
			return
		}
		select {
		case idleExitCh <- struct{}{}:
		default:
		}
	}
	browserBridge.SetOnIdleExit(maybeIdleExit)
	// 安装结束（done/error）后重新评估：安装期间挂起的自退此时应生效。
	runtimeInstaller.OnDone = maybeIdleExit

	errCh := make(chan error, 1)
	go func() { errCh <- server.Serve(listener) }()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("suna-app gateway stopped", "error", err)
			os.Exit(1)
		}
	case <-signals:
		// 先撤销浏览器 bridge 并关闭其 Runtime socket，再停止 HTTP；避免进程退出时
		// 仍遗留 attach 或通知泵影响本地 Runtime。
		browserBridge.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("suna-app gateway shutdown failed", "error", err)
			os.Exit(1)
		}
	case <-idleExitCh:
		// 用户关闭浏览器后空闲自退：先关 bridge（断开 Runtime 连接，daemon 随后
		// 2s 自动退出），再停 HTTP，进程干净退出。
		browserBridge.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("suna-app gateway shutdown failed", "error", err)
			os.Exit(1)
		}
	}
}

func isLoopbackAddress(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	// 主机名 localhost 也是 loopback 别名（net.ParseIP 不识别字符串）。
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// listenWithFallback 在默认地址上监听；若端口被占用且 allowFallback 为真，
// 先探测占用者是否已是 Suna App（复用已有实例），否则回退到随机端口继续启动
// （对齐 Suna Runtime 的端口冲突策略；默认 0.0.0.0 监听下回退仍保持 0.0.0.0，
// 避免丢失局域网/Tailscale 可达性）。显式 --listen 时不回退。
func listenWithFallback(address string, allowFallback bool) (net.Listener, error) {
	listener, err := net.Listen("tcp", address)
	if err == nil || !allowFallback || !errors.Is(err, syscall.EADDRINUSE) {
		return listener, err
	}
	// 占用者很可能就是另一个 Suna App 实例：探测 /healthz 确认后直接复用，
	// 不启动第二个实例（避免双实例各自 attach 同一 Runtime 会话）。
	// 注意：0.0.0.0 / :: 不是可路由目标地址，探测前须映射为 loopback，
	// 否则永远探测失败，导致双实例回归。probeURL 不含 /healthz，
	// isSunaAppRunning 内部会拼接（避免双重拼接落到 SPA fallback 误判）。
	probeURL := "http://" + address
	if host, port, err := net.SplitHostPort(address); err == nil {
		if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
			probeURL = "http://127.0.0.1:" + port
		}
	}
	if isSunaAppRunning(probeURL) {
		fmt.Fprintf(os.Stderr, "suna-app: 检测到已有 Suna App 正在运行，请直接打开 http://%s\n", address)
		os.Exit(0)
	}
	// 其他程序占用了默认端口：回退随机端口，实际地址由启动日志告知用户。
	// 回退保持与请求地址相同的监听范围（loopback 或全网卡）。
	fallback := "0.0.0.0:0"
	if host, _, err := net.SplitHostPort(address); err == nil {
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			fallback = "127.0.0.1:0"
		}
	}
	fmt.Fprintf(os.Stderr, "suna-app: 默认端口 %s 被其他程序占用，已改用随机端口 %s。\n", address, fallback)
	return net.Listen("tcp", fallback)
}

// isSunaAppRunning 探测目标地址是否已有 Suna App Gateway 在服务（/healthz）。
func isSunaAppRunning(baseURL string) bool {
	client := &http.Client{Timeout: 800 * time.Millisecond}
	resp, err := client.Get(baseURL + "/healthz")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// openBrowser 在默认浏览器打开 Suna App 地址（平台分支 + 回退链）。
// 仅 .app / .desktop 双击启动时调用；失败时依次尝试备用命令，
// 全部失败则静默打印地址（无 GUI 环境时用户可手动访问）。
// 注意：监听地址可能是 0.0.0.0 / [::]（通配地址），浏览器访问通配地址会失败，
// 因此必须解析出端口后用 localhost 打开。
func openBrowser(address string) {
	_, port, err := net.SplitHostPort(address)
	if err != nil {
		fmt.Fprintf(os.Stderr, "suna-app: could not parse listen address %q: %v\n", address, err)
		return
	}
	url := "http://localhost:" + port
	// 每个平台按可靠性排序的候选命令；前一个失败（如无 GUI、命令缺失）时尝试下一个。
	var candidates [][]string
	switch runtimelib.GOOS {
	case "darwin":
		candidates = [][]string{
			{"open", url},
		}
	case "windows":
		candidates = [][]string{
			// cmd /c start 打开默认浏览器（start 接受 URL 作为参数）。
			{"cmd", "/c", "start", "", url},
			// rundll32 是旧版 Windows 的备用方式。
			{"rundll32", "url.dll,FileProtocolHandler", url},
		}
	default:
		// xdg-open 是 Linux 桌面标准；无桌面环境时尝试 x-www-browser 直开。
		candidates = [][]string{
			{"xdg-open", url},
			{"x-www-browser", url},
		}
	}
	for _, argv := range candidates {
		cmd := exec.Command(argv[0], argv[1:]...)
		if err := cmd.Start(); err == nil {
			// 启动成功即返回；浏览器进程独立于 gateway 生命周期。
			return
		}
	}
	fmt.Fprintf(os.Stderr, "suna-app: could not open browser automatically, visit %s\n", url)
}
