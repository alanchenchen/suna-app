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
	"os/signal"
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
	flag.StringVar(&cfg.ListenAddress, "listen", cfg.ListenAddress, "loopback HTTP listen address")
	flag.StringVar(&cfg.SunaBinary, "suna-binary", cfg.SunaBinary, "path to the installed suna executable")
	// 记录用户是否显式指定了 --listen：显式指定时不做端口回退，
	// 尊重用户意图（与 Suna Runtime 的 --listen 语义一致）。
	listenExplicit := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "listen" {
			listenExplicit = true
		}
	})
	flag.Parse()

	if !isLoopbackAddress(cfg.ListenAddress) {
		fmt.Fprintln(os.Stderr, "suna-app only supports a loopback listen address")
		os.Exit(2)
	}

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
	handler := httpapi.NewServerWithBridge(connections, cfg.CommandTimeout+cfg.DialTimeout+cfg.HelloTimeout, browserBridge)
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
	}
}

func isLoopbackAddress(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// listenWithFallback 在默认地址上监听；若端口被占用且 allowFallback 为真，
// 先探测占用者是否已是 Suna App（复用已有实例），否则回退到随机 loopback
// 端口继续启动（对齐 Suna Runtime 的端口冲突策略）。显式 --listen 时不回退。
func listenWithFallback(address string, allowFallback bool) (net.Listener, error) {
	listener, err := net.Listen("tcp", address)
	if err == nil || !allowFallback || !errors.Is(err, syscall.EADDRINUSE) {
		return listener, err
	}
	// 占用者很可能就是另一个 Suna App 实例：探测 /healthz 确认后直接复用，
	// 不启动第二个实例（避免双实例各自 attach 同一 Runtime 会话）。
	if isSunaAppRunning("http://" + address) {
		fmt.Fprintf(os.Stderr, "suna-app: 检测到已有 Suna App 正在运行，请直接打开 http://%s\n", address)
		os.Exit(0)
	}
	// 其他程序占用了默认端口：回退随机端口，实际地址由启动日志告知用户。
	fmt.Fprintf(os.Stderr, "suna-app: 默认端口 %s 被其他程序占用，已改用随机 loopback 端口。\n", address)
	return net.Listen("tcp", "127.0.0.1:0")
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
