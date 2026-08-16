package config

import "time"

const (
	// DefaultListenAddress 默认监听所有网卡：本机 loopback、局域网与 Tailscale
	// 虚拟网均可访问（手机远程控制场景）；显式 --listen 127.0.0.1 可退回本机模式。
	DefaultListenAddress = "0.0.0.0:7633"
	DefaultSunaBinary    = "suna"
)

type Config struct {
	ListenAddress  string
	SunaBinary     string
	CommandTimeout time.Duration
	DialTimeout    time.Duration
	HelloTimeout   time.Duration
}

func Default() Config {
	return Config{
		ListenAddress:  DefaultListenAddress,
		SunaBinary:     DefaultSunaBinary,
		CommandTimeout: 5 * time.Second,
		DialTimeout:    3 * time.Second,
		HelloTimeout:   3 * time.Second,
	}
}
