package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Facts struct {
	Languages []string `json:"languages"`
	PackageManagers []string `json:"packageManagers"`
	CI []string `json:"ci"`
}
type Result struct {
	Status string `json:"status"`
	Facts Facts `json:"facts,omitempty"`
	Created []string `json:"created,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
}

func exists(p string) bool { _, e := os.Stat(p); return e == nil }
func inspect() Facts {
	f := Facts{}
	if exists("go.mod") { f.Languages=append(f.Languages,"go") }
	if exists("package.json") { f.Languages=append(f.Languages,"javascript/typescript") }
	if exists("pyproject.toml") || exists("requirements.txt") { f.Languages=append(f.Languages,"python") }
	if exists("pnpm-lock.yaml") { f.PackageManagers=append(f.PackageManagers,"pnpm") }
	if exists("package-lock.json") { f.PackageManagers=append(f.PackageManagers,"npm") }
	if exists("yarn.lock") { f.PackageManagers=append(f.PackageManagers,"yarn") }
	if exists(".github/workflows") { f.CI=append(f.CI,"github-actions") }
	return f
}
func emit(v any, jsonOut bool) {
	if jsonOut { b,_:=json.MarshalIndent(v,"","  "); fmt.Println(string(b)); return }
	fmt.Printf("%+v\n",v)
}
func main() {
	if len(os.Args)<2 { fmt.Println("repo-ai: init | inspect | deploy | generate | check | update"); os.Exit(2) }
	cmd:=os.Args[1]
	fs:=flag.NewFlagSet(cmd, flag.ExitOnError)
	format:=fs.String("format","","json output")
	dry:=fs.Bool("dry-run",false,"preview")
	non:=fs.Bool("non-interactive",false,"conservative defaults")
	_ = non
	fs.Parse(os.Args[2:])
	j:=*format=="json"
	switch cmd {
	case "inspect":
		emit(inspect(),j)
	case "init","deploy":
		f:=inspect()
		targets:=map[string]string{
			".repo-ai/config.yaml":"schema: repo-ai/config/v1\npolicy: core\n",
			".repo-ai/overrides.yaml":"schema: repo-ai/overrides/v1\noverrides: {}\n",
			".repo-ai/policy.lock":"schema: repo-ai/lock/v1\npacks:\n  - name: core\n    source: builtin:core\n    version: 0.1.0\n    digest: sha256:bootstrap\n",
			".github/workflows/repo-ai.yml":"name: repo-ai\non: [pull_request]\npermissions:\n  contents: read\njobs:\n  policy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4 # Replace with full commit SHA before enforce mode\n      - uses: actions/setup-go@v5 # Replace with full commit SHA before enforce mode\n        with:\n          go-version: '1.23'\n      - run: go run ./cmd/repo-ai check --format=json\n",
		}
		r:=Result{Status:"ready",Facts:f}
		for p,c:=range targets {
			if exists(p) { r.Warnings=append(r.Warnings,"preserved existing "+p); continue }
			r.Created=append(r.Created,p)
			if !*dry { os.MkdirAll(filepath.Dir(p),0755); os.WriteFile(p,[]byte(c),0644) }
		}
		if !*dry {
			// Never overwrite an existing unowned AGENTS.md.
			if !exists("AGENTS.md") {
				os.WriteFile("AGENTS.md",[]byte("# Repository AI Instructions\n\nFollow `.repo-ai/` policy. Before completion run `repo-ai check`. Never bypass enforce-level failures.\n"),0644)
				r.Created=append(r.Created,"AGENTS.md")
			} else { r.Warnings=append(r.Warnings,"preserved existing AGENTS.md") }
		}
		emit(r,j)
	case "generate":
		emit(Result{Status:"ok",Warnings:[]string{"bootstrap compiler: no regeneration required"}},j)
	case "check":
		var warnings []string
		if !exists(".repo-ai/config.yaml") { warnings=append(warnings,"missing .repo-ai/config.yaml") }
		if !exists(".repo-ai/policy.lock") { warnings=append(warnings,"missing .repo-ai/policy.lock") }
		if len(warnings)>0 { emit(Result{Status:"failed",Warnings:warnings},j); os.Exit(1) }
		// Basic deterministic safety checks.
		if exists(".github/workflows/repo-ai.yml") {
			b,_:=os.ReadFile(".github/workflows/repo-ai.yml")
			if strings.Contains(string(b),"permissions: write-all") { emit(Result{Status:"failed",Warnings:[]string{"write-all GitHub permissions prohibited"}},j); os.Exit(1) }
		}
		emit(Result{Status:"compliant"},j)
	case "update":
		emit(Result{Status:"ok",Warnings:[]string{"bootstrap package uses builtin core policy; OCI resolver is extension point"}},j)
	default:
		fmt.Println("unknown command:",cmd); os.Exit(2)
	}
}
