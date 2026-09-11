// Package bridge owns browser-scoped Runtime connections. It deliberately keeps
// Runtime request and notification payloads as JSON so the public typed protocol
// can evolve without the Gateway reproducing its business schemas.
package bridge

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
)

const (
	// BridgeIDLength is the length of a base64.RawURLEncoding encoded 32-byte ID.
	BridgeIDLength = 43
	defaultMaxBody = 1 << 20
)

var (
	ErrNotFound         = errors.New("bridge connection not found")
	ErrClosed           = errors.New("bridge connection is closed")
	ErrMethodNotAllowed = errors.New("bridge method is not allowed")
	ErrInvalidParams    = errors.New("bridge params are invalid")
)

// Connection is the small public Runtime connection surface required by a browser
// bridge. Keeping it here permits HTTP tests without a TCP Runtime.
type Connection interface {
	Request(context.Context, string, any) (json.RawMessage, error)
	Notifications() <-chan runtime.Notification
	Hello() json.RawMessage
	Done() <-chan struct{}
	Close() error
}

// Connector creates a fully negotiated Runtime connection.
type Connector interface {
	Connect(context.Context) (Connection, error)
}

// DiscoveryRefresher clears cached Runtime discovery after a transport failure.
// Connector implementations may provide it without making every test connector
// depend on runtime.ConnectionManager.
type DiscoveryRefresher interface {
	RefreshDiscovery()
}

// RuntimeConnector adapts the public runtime.ConnectionManager to Connector.
type RuntimeConnector struct {
	Manager *runtime.ConnectionManager
}

func (c RuntimeConnector) Connect(ctx context.Context) (Connection, error) {
	if c.Manager == nil {
		return nil, fmt.Errorf("runtime connection manager is required")
	}
	connection, err := c.Manager.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return connection, nil
}

// RefreshDiscovery delegates endpoint cache invalidation to the Runtime manager.
func (c RuntimeConnector) RefreshDiscovery() {
	if c.Manager != nil {
		c.Manager.RefreshDiscovery()
	}
}

// Config controls only browser bridge transport limits. It does not define
// Runtime business schemas.
type Config struct {
	MaxRequestBody    int64
	MaxClients        int
	ClientIdleTimeout time.Duration
	Random            io.Reader // intended for tests; nil uses crypto/rand.Reader.
	// Hello is used only by test connectors that cannot expose the negotiated
	// handshake. Runtime connections always supply their actual hello response.
	Hello json.RawMessage
	// AllowedMethod returns true only for exact public Runtime methods exposed to browsers.
	// Nil uses the v0.3 browser bridge method allowlist.
	AllowedMethod func(string) bool
	// OnIdleExit 在所有浏览器连接都消失时调用。
	// gateway 用它实现"用户关闭浏览器后自动退出"。断开 Runtime 连接不取消
	// run（daemon detach 语义 A1），run 终态前 daemon 由 Lifecycle 常驻。
	// 空闲超时路径同步触发；主动 Disconnect 与 Runtime 被动断开不同步触发，
	// 但会延迟评估（见 scheduleIdleExitEvaluation），否则 pagehide DELETE
	// 后 gateway 永不退出。
	OnIdleExit func()
}

// Service tracks opaque, per-browser Runtime connections.
type Service struct {
	connector   Connector
	discovery   DiscoveryRefresher
	maxBody     int64
	random      io.Reader
	hello       json.RawMessage
	allowed     func(string) bool
	maxClients  int
	idleTimeout time.Duration
	onIdleExit  func()

	mu      sync.RWMutex
	clients map[string]*client
}

type client struct {
	connection Connection

	mu          sync.Mutex
	closed      bool
	subscribers map[chan runtime.Notification]struct{}
	idleTimer   *time.Timer
}

// New creates a bridge service. A connector is required because a Bridge must
// own long-lived Runtime connections rather than issuing one connection per RPC.
func New(connector Connector, config Config) (*Service, error) {
	if connector == nil {
		return nil, fmt.Errorf("bridge connector is required")
	}
	if config.MaxRequestBody < 0 {
		return nil, fmt.Errorf("bridge request body limit cannot be negative")
	}
	if config.MaxRequestBody == 0 {
		config.MaxRequestBody = defaultMaxBody
	}
	if config.Random == nil {
		config.Random = rand.Reader
	}
	if len(config.Hello) == 0 {
		// 兜底 hello 仅供测试连接器使用；真实 Runtime 连接总是携带协商后的 catalog。
		config.Hello = json.RawMessage(`{"runtime_version":"dev","transport":"tcp","catalog":{"methods":[],"notifications":[],"features":[]},"content_sources":{}}`)
	}
	if !json.Valid(config.Hello) {
		return nil, fmt.Errorf("bridge hello must be JSON")
	}
	if config.AllowedMethod == nil {
		config.AllowedMethod = defaultAllowedMethod
	}
	if config.MaxClients < 0 {
		return nil, fmt.Errorf("bridge client limit cannot be negative")
	}
	if config.MaxClients == 0 {
		config.MaxClients = 8
	}
	if config.ClientIdleTimeout < 0 {
		return nil, fmt.Errorf("bridge client idle timeout cannot be negative")
	}
	if config.ClientIdleTimeout == 0 {
		// 空闲自退宽限：覆盖刷新最坏 5s + 移动端切网 10s；10s 内重连会取消计时。
		config.ClientIdleTimeout = 10 * time.Second
	}
	refresher, _ := connector.(DiscoveryRefresher)
	return &Service{
		connector:   connector,
		discovery:   refresher,
		maxBody:     config.MaxRequestBody,
		maxClients:  config.MaxClients,
		idleTimeout: config.ClientIdleTimeout,
		onIdleExit:  config.OnIdleExit,
		random:      config.Random,
		hello:       append(json.RawMessage(nil), config.Hello...),
		allowed:     config.AllowedMethod,
		clients:     make(map[string]*client),
	}, nil
}

// MaxRequestBody is the upper limit for one browser RPC JSON document.
func (s *Service) MaxRequestBody() int64 { return s.maxBody }

// Connect creates an opaque browser ID after Runtime negotiation has completed.
func (s *Service) Connect(ctx context.Context) (string, json.RawMessage, error) {
	s.mu.RLock()
	atCapacity := len(s.clients) >= s.maxClients
	s.mu.RUnlock()
	if atCapacity {
		return "", nil, fmt.Errorf("browser bridge connection limit reached")
	}
	connection, err := s.connector.Connect(ctx)
	if err != nil {
		return "", nil, err
	}
	id, err := s.newID()
	if err != nil {
		_ = connection.Close()
		return "", nil, err
	}
	c := &client{connection: connection, subscribers: make(map[chan runtime.Notification]struct{})}

	s.mu.Lock()
	if len(s.clients) >= s.maxClients {
		s.mu.Unlock()
		_ = connection.Close()
		return "", nil, fmt.Errorf("browser bridge connection limit reached")
	}
	s.clients[id] = c
	s.mu.Unlock()
	s.scheduleIdleDisconnect(id, c)
	// 此 goroutine 是唯一的 Runtime 通知消费者；它退出时关闭所有 SSE 订阅者，避免重连客户端相互抢事件。
	go s.pump(id, c)
	hello := connection.Hello()
	if len(hello) == 0 {
		hello = s.hello
	}
	return id, append(json.RawMessage(nil), hello...), nil
}

// Close disconnects every browser-scoped Runtime connection during Gateway
// shutdown. It is idempotent and never leaves a Runtime pump running.
func (s *Service) Close() {
	s.mu.Lock()
	clients := s.clients
	s.clients = make(map[string]*client)
	s.mu.Unlock()
	for _, c := range clients {
		c.closeSubscribers()
		_ = c.connection.Close()
	}
}

// ActiveClients 报告当前活跃的浏览器连接数。gateway 自退前的二次确认用它
// 防止"计时到点瞬间用户重开浏览器"的竞态。
func (s *Service) ActiveClients() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.clients)
}

// SetOnIdleExit 注册空闲自退回调。与 Config.OnIdleExit 等价，但允许在
// New 之后设置（回调需要引用 Service 自身做二次确认时用）。
func (s *Service) SetOnIdleExit(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onIdleExit = fn
}

func (s *Service) newID() (string, error) {
	bytes := make([]byte, 32)
	if _, err := io.ReadFull(s.random, bytes); err != nil {
		return "", fmt.Errorf("generate bridge ID: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// ValidID rejects arbitrary path values before they can address bridge state.
func ValidID(id string) bool {
	if len(id) != BridgeIDLength {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '-' && r != '_' {
			return false
		}
	}
	return true
}

// Request forwards one allowlisted JSON-RPC request while preserving its raw
// public JSON result. params must contain exactly one valid JSON value.
func (s *Service) Request(ctx context.Context, id, method string, params json.RawMessage) (json.RawMessage, error) {
	if !ValidID(id) {
		return nil, ErrNotFound
	}
	if !s.allowed(method) {
		return nil, ErrMethodNotAllowed
	}
	if len(params) == 0 {
		params = json.RawMessage("null")
	}
	if !json.Valid(params) {
		return nil, ErrInvalidParams
	}
	c, err := s.lookup(id)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.cancelIdleLocked()
	c.mu.Unlock()
	defer s.scheduleIdleDisconnect(id, c)
	return c.connection.Request(ctx, method, params)
}

// Subscribe registers an SSE consumer. The caller must invoke the returned
// function when the HTTP request finishes.
func (s *Service) Subscribe(id string) (<-chan runtime.Notification, func(), error) {
	if !ValidID(id) {
		return nil, nil, ErrNotFound
	}
	c, err := s.lookup(id)
	if err != nil {
		return nil, nil, err
	}
	ch := make(chan runtime.Notification, 32)
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, nil, ErrClosed
	}
	c.cancelIdleLocked()
	c.subscribers[ch] = struct{}{}
	c.mu.Unlock()
	return ch, func() {
		s.releaseSubscriber(id, c, ch)
	}, nil
}

// Disconnect immediately removes a browser capability and terminates its Runtime
// socket. It is safe to call for an already terminated Runtime connection.
func (s *Service) Disconnect(id string) error {
	if !ValidID(id) {
		return ErrNotFound
	}
	s.mu.Lock()
	c, ok := s.clients[id]
	if ok {
		delete(s.clients, id)
	}
	// 移除的是最后一个连接时需要延迟评估空闲自退：pagehide keepalive DELETE
	// 是"用户关掉所有浏览器"的最后一环，若不评估，Runtime socket 关闭后
	// daemon 退出而 gateway 空转驻留。
	noClients := ok && len(s.clients) == 0
	s.mu.Unlock()
	if !ok {
		return ErrNotFound
	}
	c.closeSubscribers()
	err := c.connection.Close()
	if noClients {
		s.scheduleIdleExitEvaluation()
	}
	return err
}

// scheduleIdleExitEvaluation 在最后一个浏览器连接被移除后延迟评估空闲自退。
// 立即评估会与"刷新后瞬间重连"竞态（pagehide DELETE 与新页面 Connect 间隔
// 只有几毫秒），因此沿用 ClientIdleTimeout 作为宽限：触发时二次确认仍无
// 客户端才调用 OnIdleExit，最终决定权（installer 状态等）留在回调实现里。
func (s *Service) scheduleIdleExitEvaluation() {
	if s.onIdleExit == nil {
		return
	}
	time.AfterFunc(s.idleTimeout, func() {
		s.mu.RLock()
		empty := len(s.clients) == 0
		fn := s.onIdleExit
		s.mu.RUnlock()
		if empty && fn != nil {
			fn()
		}
	})
}

func (s *Service) releaseSubscriber(id string, c *client, subscriber chan runtime.Notification) {
	c.mu.Lock()
	delete(c.subscribers, subscriber)
	noSubscribers := len(c.subscribers) == 0
	c.mu.Unlock()
	if noSubscribers {
		s.scheduleIdleDisconnect(id, c)
	}
}

func (s *Service) scheduleIdleDisconnect(id string, c *client) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || len(c.subscribers) != 0 || c.idleTimer != nil {
		return
	}
	c.idleTimer = time.AfterFunc(s.idleTimeout, func() {
		s.disconnectIfCurrent(id, c)
	})
}

func (s *Service) disconnectIfCurrent(id string, expected *client) {
	s.mu.Lock()
	c, ok := s.clients[id]
	if !ok || c != expected {
		s.mu.Unlock()
		return
	}
	delete(s.clients, id)
	noClients := len(s.clients) == 0
	s.mu.Unlock()
	c.closeSubscribers()
	_ = c.connection.Close()
	// 所有浏览器连接都已因空闲超时断开时，通知 gateway 自退。
	// 断开 Runtime 连接不取消 run：daemon 的 detach 语义（A1）保证 run
	// 继续执行且结果落库，run 终态前 daemon 由 Lifecycle 常驻
	// （hasActiveRun），gateway 无需镜像维护 run 状态。
	if noClients && s.onIdleExit != nil {
		s.onIdleExit()
	}
}

func (c *client) cancelIdleLocked() {
	if c.idleTimer != nil {
		c.idleTimer.Stop()
		c.idleTimer = nil
	}
}

func (s *Service) lookup(id string) (*client, error) {
	s.mu.RLock()
	c, ok := s.clients[id]
	s.mu.RUnlock()
	if !ok {
		return nil, ErrNotFound
	}
	return c, nil
}

func (s *Service) pump(id string, c *client) {
	for {
		select {
		case <-c.connection.Done():
			s.retire(id, c)
			return
		case notification, ok := <-c.connection.Notifications():
			if !ok {
				s.retire(id, c)
				return
			}
			c.mu.Lock()
			if !c.closed {
				for subscriber := range c.subscribers {
					// SSE 客户端的积压意味着无法保证状态完整性。关闭此订阅，
					// 让浏览器通过 reconnect + attach 获取 Runtime 权威快照。
					select {
					case subscriber <- notification:
					default:
						close(subscriber)
						delete(c.subscribers, subscriber)
					}
				}
			}
			noSubscribers := !c.closed && len(c.subscribers) == 0
			c.mu.Unlock()
			if noSubscribers {
				// 无订阅者时重新调度空闲断开：浏览器关闭后 timer 到点把最后
				// 一个连接移除，进而触发空闲自退评估。
				c.mu.Lock()
				c.cancelIdleLocked()
				c.mu.Unlock()
				s.scheduleIdleDisconnect(id, c)
			}
		}
	}
}

func (s *Service) retire(id string, c *client) {
	// 仅仍归 Service 所有的连接是 Runtime 的被动终止；DELETE 和 Gateway
	// shutdown 会先从 clients 移除它，不能因此丢弃可复用的发现结果。
	s.mu.Lock()
	active := s.clients[id] == c
	if active {
		delete(s.clients, id)
	}
	// Runtime 被动断开（daemon 退出/网络中断）移除最后一个连接时，同样需要
	// 延迟评估空闲自退；否则 daemon 先退出后 gateway 永远失去退出时机。
	noClients := active && len(s.clients) == 0
	s.mu.Unlock()
	c.closeSubscribers()
	if active && s.discovery != nil {
		s.discovery.RefreshDiscovery()
	}
	if noClients {
		s.scheduleIdleExitEvaluation()
	}
}

func (c *client) closeSubscribers() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.closed = true
	c.cancelIdleLocked()
	for subscriber := range c.subscribers {
		close(subscriber)
		delete(c.subscribers, subscriber)
	}
}

func defaultAllowedMethod(method string) bool {
	switch method {
	case
		"session.list", "session.create", "session.attach", "session.detach",
		"session.update", "session.delete", "session.compact", "session.usage",
		"agent.sendMessage", "agent.steer", "agent.steerRemove",
		"agent.resumeRun", "agent.cancel", "agent.askReply", "agent.guardReply",
		"config.get", "config.set", "config.discoverModels",
		"memory.list", "memory.delete", "memory.clear",
		"skill.list", "skill.set",
		"mcp.list", "mcp.toggle", "mcp.reload",
		"daemon.status":
		return true
	default:
		return false
	}
}
