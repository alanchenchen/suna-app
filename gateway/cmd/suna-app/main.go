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
	flag.Parse()

	if !isLoopbackAddress(cfg.ListenAddress) {
		fmt.Fprintln(os.Stderr, "suna-app only supports a loopback listen address")
		os.Exit(2)
	}

	listener, err := net.Listen("tcp", cfg.ListenAddress)
	if err != nil {
		fmt.Fprintln(os.Stderr, "suna-app could not start the local server")
		os.Exit(1)
	}
	defer listener.Close()

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
	logger.Info("suna-app gateway started", "version", buildVersion, "address", listener.Addr().String())

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
