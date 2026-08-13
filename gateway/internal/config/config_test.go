package config

import (
	"testing"
	"time"
)

func TestDefaultConfig(t *testing.T) {
	cfg := Default()

	if cfg.ListenAddress != DefaultListenAddress {
		t.Fatalf("ListenAddress = %q, want %q", cfg.ListenAddress, DefaultListenAddress)
	}
	if cfg.SunaBinary != DefaultSunaBinary {
		t.Fatalf("SunaBinary = %q, want %q", cfg.SunaBinary, DefaultSunaBinary)
	}
	if cfg.CommandTimeout != 5*time.Second {
		t.Fatalf("CommandTimeout = %v, want 5s", cfg.CommandTimeout)
	}
	if cfg.DialTimeout != 3*time.Second {
		t.Fatalf("DialTimeout = %v, want 3s", cfg.DialTimeout)
	}
	if cfg.HelloTimeout != 3*time.Second {
		t.Fatalf("HelloTimeout = %v, want 3s", cfg.HelloTimeout)
	}
}
