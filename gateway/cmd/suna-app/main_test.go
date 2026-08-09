package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 占用指定地址，返回可释放的 listener（模拟"其他程序占用了端口"）。
func occupyAddress(t *testing.T, address string) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", address)
	if err != nil {
		t.Fatalf("occupy %s: %v", address, err)
	}
	return listener
}

func TestListenWithFallback_AddressFree(t *testing.T) {
	// 先拿一个随机空闲地址，关闭后立刻监听（时间窗内几乎不可能被抢）。
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("probe listen: %v", err)
	}
	address := probe.Addr().String()
	probe.Close()

	listener, err := listenWithFallback(address, true)
	if err != nil {
		t.Fatalf("listenWithFallback(%s) = %v", address, err)
	}
	defer listener.Close()
	if got := listener.Addr().String(); got != address {
		t.Fatalf("listened on %s, want %s", got, address)
	}
}

func TestListenWithFallback_ReusesExistingSunaApp(t *testing.T) {
	// 模拟一个已有的 Suna App：/healthz 返回 200。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	host := strings.TrimPrefix(server.URL, "http://")

	if !isSunaAppRunning("http://" + host) {
		t.Fatal("isSunaAppRunning = false, want true")
	}

	// listenWithFallback 会探测到已有实例并 os.Exit(0)，无法直接调用；
	// 这里验证探测函数本身即可，回退分支由下一测试覆盖。
}

func TestListenWithFallback_OccupiedByOtherApp(t *testing.T) {
	// 占用一个随机端口（非 Suna App，无 /healthz 服务）。
	listener := occupyAddress(t, "127.0.0.1:0")
	address := listener.Addr().String()
	defer listener.Close()

	// allowFallback=true：应回退到随机端口并成功监听，且地址不同于被占用的。
	fallback, err := listenWithFallback(address, true)
	if err != nil {
		t.Fatalf("listenWithFallback(%s) with fallback = %v", address, err)
	}
	defer fallback.Close()
	if got := fallback.Addr().String(); got == address {
		t.Fatalf("fallback address = %s, want a different random port", got)
	}
	if ip, _, err := net.SplitHostPort(fallback.Addr().String()); err != nil || net.ParseIP(ip) == nil || !net.ParseIP(ip).IsLoopback() {
		t.Fatalf("fallback address %s is not loopback", fallback.Addr().String())
	}
}

func TestListenWithFallback_ExplicitListenDoesNotFallback(t *testing.T) {
	listener := occupyAddress(t, "127.0.0.1:0")
	address := listener.Addr().String()
	defer listener.Close()

	// allowFallback=false（用户显式 --listen）：必须报错，不能静默换端口。
	_, err := listenWithFallback(address, false)
	if err == nil {
		t.Fatal("listenWithFallback with explicit listen = nil error, want EADDRINUSE")
	}
	if !strings.Contains(err.Error(), "address already in use") {
		t.Fatalf("error = %v, want address already in use", err)
	}
}

func TestIsSunaAppRunning_NonSunaServer(t *testing.T) {
	// 一个不提供 /healthz 的普通服务（模拟其他程序占用端口）。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.NotFound(w, nil)
	}))
	defer server.Close()
	host := strings.TrimPrefix(server.URL, "http://")

	if isSunaAppRunning("http://" + host) {
		t.Fatal("isSunaAppRunning = true for a non-Suna server, want false")
	}
}

func TestIsSunaAppRunning_Unreachable(t *testing.T) {
	// 无服务可连：应快速返回 false，不阻塞。
	start := time.Now()
	if isSunaAppRunning("http://127.0.0.1:1") {
		t.Fatal("isSunaAppRunning = true for unreachable address, want false")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("unreachable probe took %v, want fast failure", elapsed)
	}
}
