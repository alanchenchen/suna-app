package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
)

type fakeConnector struct{ connection *fakeConnection }

func (f fakeConnector) Connect(context.Context) (Connection, error) { return f.connection, nil }

// rotatingConnector 每次 Connect 返回队列里的下一个连接，用于模拟
// "pagehide DELETE 后新页面重连建立全新 Runtime 连接"的场景。
type rotatingConnector struct {
	connections []*fakeConnection
	index       int
}

func (c *rotatingConnector) Connect(context.Context) (Connection, error) {
	if c.index >= len(c.connections) {
		return nil, errors.New("no more fake connections")
	}
	connection := c.connections[c.index]
	c.index++
	return connection, nil
}

type endpointConnector struct {
	mu               sync.Mutex
	endpoint         string
	connections      map[string]*fakeConnection
	connectEndpoints []string
	refreshes        int
	refreshed        chan struct{}
}

func (c *endpointConnector) Connect(context.Context) (Connection, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.connectEndpoints = append(c.connectEndpoints, c.endpoint)
	return c.connections[c.endpoint], nil
}

func (c *endpointConnector) RefreshDiscovery() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.refreshes++
	c.endpoint = "127.0.0.1:20002"
	select {
	case c.refreshed <- struct{}{}:
	default:
	}
}

type fakeConnection struct {
	notifications chan runtime.Notification
	done          chan struct{}
	mu            sync.Mutex
	method        string
	params        json.RawMessage
	closed        bool
}

func newFakeConnection() *fakeConnection {
	return &fakeConnection{notifications: make(chan runtime.Notification, 2), done: make(chan struct{})}
}
func (c *fakeConnection) Request(_ context.Context, method string, params any) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.method = method
	c.params = append(json.RawMessage(nil), params.(json.RawMessage)...)
	return json.RawMessage(`{"ok":true}`), nil
}
func (c *fakeConnection) Notifications() <-chan runtime.Notification { return c.notifications }
func (c *fakeConnection) Hello() json.RawMessage {
	return json.RawMessage(`{"protocol_version":"0.4","runtime_version":"test","transport":"tcp","capabilities":{},"content_sources":{}}`)
}
func (c *fakeConnection) Done() <-chan struct{} { return c.done }
func (c *fakeConnection) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.done)
		close(c.notifications)
	}
	return nil
}

func TestDefaultAllowedMethodIsExactV03ProtocolAllowlist(t *testing.T) {
	t.Parallel()

	allowed := []string{
		"session.list", "session.create", "session.attach", "session.detach",
		"session.update", "session.delete", "session.compact", "session.usage",
		"agent.sendMessage", "agent.steer", "agent.steerRemove", "agent.resumeRun", "agent.cancel", "agent.askReply", "agent.guardReply",
		"config.get", "config.set", "config.discoverModels",
		"memory.list", "memory.delete", "memory.clear",
		"skill.list", "skill.set",
		"mcp.list", "mcp.toggle", "mcp.reload",
		"daemon.status",
	}
	for _, method := range allowed {
		if !defaultAllowedMethod(method) {
			t.Errorf("allowlist rejected %q", method)
		}
	}
	for _, method := range []string{
		"", "runtime.hello", "runtime.shutdown", "session", "session.export",
		"agent.sendmessage", "agent.sendMessage ", "agent.sendMessage.extra",
		"config.delete", "memory.set", "skill.delete", "mcp.add", "guard.reply",
	} {
		if defaultAllowedMethod(method) {
			t.Errorf("allowlist admitted %q", method)
		}
	}
}

func TestServiceRefreshesDiscoveryAfterRuntimeTermination(t *testing.T) {
	oldConnection := newFakeConnection()
	newConnection := newFakeConnection()
	connector := &endpointConnector{
		endpoint: "127.0.0.1:20001",
		connections: map[string]*fakeConnection{
			"127.0.0.1:20001": oldConnection,
			"127.0.0.1:20002": newConnection,
		},
		refreshed: make(chan struct{}, 1),
	}
	service, err := New(connector, Config{Random: zeroReader{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}

	// 模拟 Runtime 主动关闭长连接；这不是浏览器 DELETE 或 Gateway shutdown。
	close(oldConnection.done)
	select {
	case <-connector.refreshed:
	case <-time.After(time.Second):
		t.Fatal("Runtime termination did not refresh discovery")
	}

	if _, _, err := service.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}
	connector.mu.Lock()
	defer connector.mu.Unlock()
	if connector.refreshes != 1 {
		t.Fatalf("RefreshDiscovery calls = %d, want 1", connector.refreshes)
	}
	if got, want := connector.connectEndpoints, []string{"127.0.0.1:20001", "127.0.0.1:20002"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("connect endpoints = %v, want %v", got, want)
	}
}

func TestServiceRetiresConnectionWhenDoneClosesBeforeNotifications(t *testing.T) {
	connection := newFakeConnection()
	service, err := New(fakeConnector{connection}, Config{Random: zeroReader{}})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	events, unsubscribe, err := service.Subscribe(id)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()

	// Done is the lifecycle signal. A Connector is permitted to leave its
	// notification channel open while it tears down its transport.
	close(connection.done)
	select {
	case _, ok := <-events:
		if ok {
			t.Fatal("SSE subscriber remained open after Runtime termination")
		}
	case <-time.After(time.Second):
		t.Fatal("SSE subscriber was not closed after Runtime termination")
	}
	if _, err := service.Request(context.Background(), id, "session.list", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("request after termination error = %v, want ErrNotFound", err)
	}
	if _, _, err := service.Subscribe(id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("subscribe after termination error = %v, want ErrNotFound", err)
	}
}

func TestServiceRequestRearmsIdleDisconnectWithoutSubscribers(t *testing.T) {
	connection := newFakeConnection()
	service, err := New(fakeConnector{connection}, Config{
		Random:            zeroReader{},
		ClientIdleTimeout: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Request(context.Background(), id, "session.list", nil); err != nil {
		t.Fatal(err)
	}

	select {
	case <-connection.Done():
	case <-time.After(time.Second):
		t.Fatal("idle bridge remained open after its last RPC")
	}
	if _, err := service.Request(context.Background(), id, "session.list", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("request after idle disconnect error = %v, want ErrNotFound", err)
	}
}

func TestServiceRequestAndNotification(t *testing.T) {
	connection := newFakeConnection()
	service, err := New(fakeConnector{connection}, Config{Random: zeroReader{}})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !ValidID(id) {
		t.Fatalf("invalid generated ID %q", id)
	}

	events, unsubscribe, err := service.Subscribe(id)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()
	connection.notifications <- runtime.Notification{Method: "agent.progress", Params: json.RawMessage(`{"step":1}`)}
	if got := <-events; got.Method != "agent.progress" {
		t.Fatalf("event method = %q", got.Method)
	}
	if _, err := service.Request(context.Background(), id, "agent.sendMessage", json.RawMessage(`{"parts":[{"type":"text","text":"x"}]}`)); err != nil {
		t.Fatal(err)
	}
	connection.mu.Lock()
	method := connection.method
	connection.mu.Unlock()
	if method != "agent.sendMessage" {
		t.Fatalf("method = %q", method)
	}
	if _, err := service.Request(context.Background(), id, "runtime.hello", nil); !errors.Is(err, ErrMethodNotAllowed) {
		t.Fatalf("error = %v", err)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

// TestOnIdleExitFiresAfterLastClientDisconnects 验证：无订阅者 + 空闲超时后
// 断开最后一个连接时触发 OnIdleExit（且无 run 在跑）。
func TestOnIdleExitFiresAfterLastClientDisconnects(t *testing.T) {
	connection := newFakeConnection()
	onIdleExit := make(chan struct{}, 1)
	service, err := New(fakeConnector{connection}, Config{
		Random:            zeroReader{},
		ClientIdleTimeout: 20 * time.Millisecond,
		OnIdleExit: func() {
			select {
			case onIdleExit <- struct{}{}:
			default:
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Request(context.Background(), id, "session.list", nil); err != nil {
		t.Fatal(err)
	}

	select {
	case <-onIdleExit:
	case <-time.After(time.Second):
		t.Fatal("OnIdleExit was not fired after idle disconnect")
	}
}

// TestOnIdleExitFiresAfterRunTerminalState 验证：run 终态通知（done）到达后
// run 计数归零，空闲断开恢复，OnIdleExit 正常触发。这是“run 结束后浏览器
// 已全部关闭，gateway 应退出”的关键路径。
func TestOnIdleExitFiresAfterRunTerminalState(t *testing.T) {
	connection := newFakeConnection()
	onIdleExit := make(chan struct{}, 1)
	service, err := New(fakeConnector{connection}, Config{
		Random:            zeroReader{},
		ClientIdleTimeout: 20 * time.Millisecond,
		OnIdleExit: func() {
			select {
			case onIdleExit <- struct{}{}:
			default:
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// run 进入 running：空闲断开被 run 保护阻塞。
	connection.notifications <- runtime.Notification{Method: "agent.run", Params: json.RawMessage(`{"state":"running"}`)}
	time.Sleep(50 * time.Millisecond)
	if _, err := service.Request(context.Background(), id, "session.list", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-onIdleExit:
		t.Fatal("OnIdleExit fired while a run is active")
	case <-time.After(100 * time.Millisecond):
	}

	// run 终态到达后，空闲断开重新调度并触发自退。
	connection.notifications <- runtime.Notification{Method: "agent.run", Params: json.RawMessage(`{"state":"done"}`)}
	select {
	case <-onIdleExit:
	case <-time.After(time.Second):
		t.Fatal("OnIdleExit was not fired after run reached a terminal state")
	}
}

// TestOnIdleExitFiresAfterDisconnect 验证：pagehide keepalive DELETE 移除
// 最后一个连接后，OnIdleExit 延迟触发。这是“用户关掉所有浏览器后 gateway
// 应退出”的关键路径：DELETE 关闭 Runtime socket（daemon 随后自退），
// 若不评估自退则 gateway 空转驻留。
func TestOnIdleExitFiresAfterDisconnect(t *testing.T) {
	connection := newFakeConnection()
	onIdleExit := make(chan struct{}, 1)
	service, err := New(fakeConnector{connection}, Config{
		Random:            zeroReader{},
		ClientIdleTimeout: 20 * time.Millisecond,
		OnIdleExit: func() {
			select {
			case onIdleExit <- struct{}{}:
			default:
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Disconnect(id); err != nil {
		t.Fatal(err)
	}

	select {
	case <-onIdleExit:
	case <-time.After(time.Second):
		t.Fatal("OnIdleExit was not fired after explicit DELETE of the last client")
	}
}

// TestOnIdleExitFiresAfterRuntimeTermination 验证：Runtime 被动断开（daemon
// 退出/网络中断）移除最后一个连接后，OnIdleExit 同样延迟触发，否则 daemon
// 先退出后 gateway 永远失去退出时机。
func TestOnIdleExitFiresAfterRuntimeTermination(t *testing.T) {
	connection := newFakeConnection()
	onIdleExit := make(chan struct{}, 1)
	service, err := New(fakeConnector{connection}, Config{
		Random:            zeroReader{},
		ClientIdleTimeout: 20 * time.Millisecond,
		OnIdleExit: func() {
			select {
			case onIdleExit <- struct{}{}:
			default:
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}
	// 被动断开：pump 的 Done 分支走 retire 路径。
	connection.Close()

	select {
	case <-onIdleExit:
	case <-time.After(time.Second):
		t.Fatal("OnIdleExit was not fired after Runtime terminated the last connection")
	}
}

// TestOnIdleExitEvaluationCancelledByReconnect 验证：pagehide DELETE 后
// 瞬间重开浏览器（延迟评估窗口内 Connect 新连接）时，不触发自退。
func TestOnIdleExitEvaluationCancelledByReconnect(t *testing.T) {
	// 重连必须拿到全新的 Runtime 连接（与真实浏览器刷新一致）：复用已关闭的
	// 连接会让新 client 的 pump 立即 retire，无法表达"重连成功"。
	onIdleExit := make(chan struct{}, 1)
	service, err := New(&rotatingConnector{connections: []*fakeConnection{newFakeConnection(), newFakeConnection()}}, Config{
		Random:            zeroReader{},
		ClientIdleTimeout: 30 * time.Millisecond,
		OnIdleExit: func() {
			select {
			case onIdleExit <- struct{}{}:
			default:
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// 模拟刷新：pagehide DELETE 后新页面立即 Connect 并订阅 SSE（真实浏览器
	// 重连后马上建立事件流，Subscribe 会取消空闲计时）。
	if err := service.Disconnect(id); err != nil {
		t.Fatal(err)
	}
	reconnectedID, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, unsubscribe, err := service.Subscribe(reconnectedID)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()

	select {
	case <-onIdleExit:
		t.Fatal("OnIdleExit fired although a new client reconnected within the grace window")
	case <-time.After(100 * time.Millisecond):
	}
}

// TestOnIdleExitNotFiredWhileRunActive 验证：连接上有正在执行的 run 时，
// 空闲断开不触发 OnIdleExit（防止 daemon 取消 run）。
func TestOnIdleExitNotFiredWhileRunActive(t *testing.T) {
	connection := newFakeConnection()
	onIdleExit := make(chan struct{}, 1)
	service, err := New(fakeConnector{connection}, Config{
		Random:            zeroReader{},
		ClientIdleTimeout: 200 * time.Millisecond,
		OnIdleExit: func() {
			select {
			case onIdleExit <- struct{}{}:
			default:
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// 先让 pump 消费 agent.run 通知：running 状态使连接保持活跃。
	connection.notifications <- runtime.Notification{Method: "agent.run", Params: json.RawMessage(`{"state":"running"}`)}
	// 等待 pump 消费通知并更新 running 计数，再触发空闲计时。
	time.Sleep(50 * time.Millisecond)
	if _, err := service.Request(context.Background(), id, "session.list", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-onIdleExit:
		t.Fatal("OnIdleExit fired while a run is active")
	case <-time.After(300 * time.Millisecond):
		// 预期：不触发（run 保护使 idle 断开不执行）
	}
	// run 保护生效后连接应仍然可用。
	if _, err := service.Request(context.Background(), id, "session.list", nil); err != nil {
		t.Fatalf("connection was disconnected despite active run: %v", err)
	}
}

// TestDefaultClientIdleTimeoutIsTenSeconds 验证默认空闲宽限为 10s（覆盖刷新/切网）。
func TestDefaultClientIdleTimeoutIsTenSeconds(t *testing.T) {
	service, err := New(fakeConnector{newFakeConnection()}, Config{Random: zeroReader{}})
	if err != nil {
		t.Fatal(err)
	}
	if service.idleTimeout != 10*time.Second {
		t.Fatalf("idleTimeout = %v, want 10s", service.idleTimeout)
	}
}
