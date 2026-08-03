package config

import "time"

const (
	DefaultListenAddress = "127.0.0.1:7633"
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
