package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/example/repo-ai/internal/inspect"
	"github.com/example/repo-ai/internal/policy"
)

func TestInspectCLIJSONContract(t *testing.T) {
	binary:=filepath.Join(t.TempDir(),"repo-ai")
	if output,err:=exec.Command("go","build","-o",binary,".").CombinedOutput();err!=nil{t.Fatalf("build CLI: %v: %s",err,output)}
	root:=filepath.Join("../../internal/inspect/testdata","npm-ts")
	command:=exec.Command(binary,"inspect","--format=json");command.Dir=root
	one,err:=command.Output();if err!=nil{t.Fatalf("inspect: %v",err)}
	command=exec.Command(binary,"inspect","--format=json");command.Dir=root
	two,err:=command.Output();if err!=nil{t.Fatalf("inspect repeat: %v",err)}
	if string(one)!=string(two){t.Fatalf("inspect output changed:\n%s\n%s",one,two)}
	var facts inspect.RepositoryFacts
	if err:=json.Unmarshal(one,&facts);err!=nil{t.Fatalf("decode inspect facts: %v",err)}
	if len(facts.Languages)!=1||facts.Languages[0]!="typescript"||len(facts.PackageManagers)!=1||facts.PackageManagers[0]!="npm"{t.Fatalf("unexpected facts: %#v",facts)}
}

func TestCheckCLIExitCodes(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "repo-ai")
	build := exec.Command("go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil { t.Fatalf("build CLI: %v: %s", err, output) }
	pack, err := policy.Parse([]byte(policy.CoreYAML))
	if err != nil { t.Fatal(err) }
	digest, err := policy.Digest(pack)
	if err != nil { t.Fatal(err) }
	lock := "schema: repo-ai/lock/v1\npacks:\n  - name: core\n    source: builtin:core\n    version: 0.2.0\n    digest: " + digest + "\n"
	write := func(t *testing.T, root, path, contents string) {
		t.Helper()
		full := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil { t.Fatal(err) }
		if err := os.WriteFile(full, []byte(contents), 0644); err != nil { t.Fatal(err) }
	}
		tests := []struct {
		name, fixture, change, wantRule, wantStatus string
		wantExit int
	}{
		{name: "compliant", fixture: "compliant", wantStatus: "compliant", wantExit: 0},
		{name: "guidance", fixture: "compliant", change: "remove agents", wantRule: "coding.validate-before-completion", wantStatus: "compliant", wantExit: 0},
		{name: "check", fixture: "compliant", change: "remove workflow", wantRule: "governance.workflow.present", wantStatus: "compliant", wantExit: 0},
		{name: "enforce", fixture: "noncompliant", wantRule: "security.github.permissions", wantStatus: "failed", wantExit: 1},
		{name: "invalid policy", fixture: "compliant", change: "invalid policy", wantStatus: "error", wantExit: 2},
		{name: "lock mismatch", fixture: "compliant", change: "invalid lock", wantStatus: "error", wantExit: 2},
		{name: "malformed config", fixture: "compliant", change: "invalid config", wantStatus: "error", wantExit: 2},
		{name: "equivalent config formatting", fixture: "compliant", change: "format config", wantStatus: "compliant", wantExit: 0},
		{name: "evaluation error", fixture: "compliant", change: "unreadable workflow", wantStatus: "error", wantExit: 2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			write(t, root, ".repo-ai/config.yaml", "schema: repo-ai/config/v1\npolicy: core\n")
			write(t, root, ".repo-ai/packs/core/policy.yaml", policy.CoreYAML)
			write(t, root, ".repo-ai/policy.lock", lock)
			for _, path := range []string{".github/workflows/repo-ai.yml", "AGENTS.md"} {
				data, err := os.ReadFile(filepath.Join("../../internal/policy/testdata", tc.fixture, filepath.FromSlash(path)))
				if errors.Is(err, os.ErrNotExist) { continue }
				if err != nil { t.Fatal(err) }
				write(t, root, path, string(data))
			}
			switch tc.change {
			case "remove agents": if err := os.Remove(filepath.Join(root, "AGENTS.md")); err != nil { t.Fatal(err) }
			case "remove workflow": if err := os.Remove(filepath.Join(root, ".github/workflows/repo-ai.yml")); err != nil { t.Fatal(err) }
			case "invalid policy": write(t, root, ".repo-ai/packs/core/policy.yaml", "schema: wrong\n")
			case "invalid lock": write(t, root, ".repo-ai/policy.lock", strings.Replace(lock, digest, "sha256:"+strings.Repeat("0", 64), 1))
			case "invalid config": write(t, root, ".repo-ai/config.yaml", "schema: repo-ai/config/v1\npolicy: unsupported\n")
			case "format config": write(t, root, ".repo-ai/config.yaml", "# format-only variation\npolicy : 'core'\nschema: \"repo-ai/config/v1\"\n")
			case "unreadable workflow":
				path := filepath.Join(root, ".github/workflows/repo-ai.yml")
				if err := os.Remove(path); err != nil { t.Fatal(err) }
				if err := os.Mkdir(path, 0755); err != nil { t.Fatal(err) }
			}
			command := exec.Command(binary, "check", "--format=json")
			command.Dir = root
			output, err := command.CombinedOutput()
			exit := 0
			if err != nil {
				var failure *exec.ExitError
				if !errors.As(err, &failure) { t.Fatalf("run CLI: %v", err) }
				exit = failure.ExitCode()
			}
			if exit != tc.wantExit { t.Fatalf("exit %d, want %d: %s", exit, tc.wantExit, output) }
			var result Result
			if err := json.Unmarshal(output, &result); err != nil { t.Fatalf("parse output: %v: %s", err, output) }
			if result.Status != tc.wantStatus { t.Fatalf("status %q, want %q: %s", result.Status, tc.wantStatus, output) }
			if tc.wantRule != "" {
				found := false
				for _, finding := range result.Findings { if finding.ID == tc.wantRule { found = true } }
				if !found { t.Fatalf("missing finding %q: %s", tc.wantRule, output) }
			}
		})
	}
}
