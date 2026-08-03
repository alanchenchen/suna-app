package runtime

import "testing"

func TestParseServeResult(t *testing.T) {
	t.Parallel()

	result, err := parseServeResult([]byte(`{"status":"ready","pid":123,"tcp_endpoint":"127.0.0.1:7632"}`))
	if err != nil {
		t.Fatalf("parseServeResult() error = %v", err)
	}
	if result.TCPEndpoint != "127.0.0.1:7632" {
		t.Fatalf("endpoint = %q, want loopback endpoint", result.TCPEndpoint)
	}
}

func TestParseServeResultRejectsInvalidAndNonLoopbackEndpoints(t *testing.T) {
	t.Parallel()

	cases := []string{
		`not json`,
		`{"status":"ready"}`,
		`{"status":"ready","tcp_endpoint":"0.0.0.0:7632"}`,
		`{"status":"starting","tcp_endpoint":"127.0.0.1:7632"}`,
	}
	for _, input := range cases {
		if _, err := parseServeResult([]byte(input)); err == nil {
			t.Errorf("parseServeResult(%q) succeeded, want error", input)
		}
	}
}
