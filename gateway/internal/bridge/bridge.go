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
	// OnIdleExit 在所有浏览器连接都因空闲超时断开、且无 run 在跑时调用。
	// gateway 用它实现"用户关闭浏览器后自动退出"；主动 Close/Disconnect 不触发。
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
	// running 是该连接上正在执行的 run 数（由 agent.run 通知驱动）。
	// 空闲自退决策依赖它：有 run 时不能断开 Runtime 连接（否则 daemon 会取消 run）。
	running int
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
	s.mu.Unlock()
	if !ok {
		return ErrNotFound
	}
	c.closeSubscribers()
	return c.connection.Close()
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
	c.mu.Lock()
	running := c.hasRunning()
	c.mu.Unlock()
	if running {
		// 有 run 在跑：不能断开（否则 daemon 会取消 run）。保持连接不动，
		// 等 run 终态通知到达后由 trackRun 重新调度空闲断开。
		s.mu.Unlock()
		return
	}
	delete(s.clients, id)
	noClients := len(s.clients) == 0
	s.mu.Unlock()
	c.closeSubscribers()
	_ = c.connection.Close()
	// 所有浏览器连接都已因空闲超时断开、且无任何 run 在跑时，通知 gateway 自退。
	// 仅在空闲断开路径触发（显式 Disconnect/Close 不调用本函数）。
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
				// 跟踪 agent.run 生命周期：决定空闲自退时能否安全断开 Runtime 连接。
				c.trackRun(notification)
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
				// 无订阅者时重新调度空闲断开：run 期间 timer 已触发过（非 nil），
				// 必须先清掉再调度，否则 run 结束后不会再次进入空闲断开流程。
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
	s.mu.Unlock()
	c.closeSubscribers()
	if active && s.discovery != nil {
		s.discovery.RefreshDiscovery()
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

// trackRun 根据 agent.run 通知维护该连接上的 run 计数。
// running/retrying 进入 +1；终态（done/failed/cancelled）或取消中 -1（下限 0）。
// 调用方必须持有 c.mu。
func (c *client) trackRun(n runtime.Notification) {
	if n.Method != "agent.run" {
		return
	}
	var params struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(n.Params, &params); err != nil {
		return
	}
	switch params.State {
	case "running", "retrying":
		c.running++
	case "done", "failed", "cancelled", "cancelling":
		if c.running > 0 {
			c.running--
		}
	}
}

// hasRunning 报告该连接上是否有正在执行的 run。调用方必须持有 c.mu。
func (c *client) hasRunning() bool {
	return c.running > 0
}

func defaultAllowedMethod(method string) bool {
	switch method {
	case
		"session.list", "session.create", "session.attach", "session.detach",
		"session.update", "session.delete", "session.compact", "session.usage",
		"agent.sendMessage", "agent.steer", "agent.steerRemove",
		"agent.resumeRun", "agent.cancel", "agent.askReply", "agent.guardReply",
		"config.get", "config.set",
		"memory.list", "memory.delete", "memory.clear",
		"skill.list", "skill.set",
		"mcp.list", "mcp.toggle", "mcp.reload",
		"daemon.status":
		return true
	default:
		return false
	}
}
