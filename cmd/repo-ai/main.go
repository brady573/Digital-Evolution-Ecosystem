package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/example/repo-ai/internal/policy"
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
	Findings []policy.Result `json:"findings,omitempty"`
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
		pack,err:=policy.Parse([]byte(policy.CoreYAML))
		if err!=nil { fmt.Fprintln(os.Stderr,err); os.Exit(1) }
		digest,err:=policy.Digest(pack)
		if err!=nil { fmt.Fprintln(os.Stderr,err); os.Exit(1) }
		targets:=map[string]string{
			".repo-ai/config.yaml":"schema: repo-ai/config/v1\npolicy: core\n",
			".repo-ai/overrides.yaml":"schema: repo-ai/overrides/v1\noverrides: {}\n",
			".repo-ai/packs/core/policy.yaml":policy.CoreYAML,
			".repo-ai/policy.lock":"schema: repo-ai/lock/v1\npacks:\n  - name: core\n    source: builtin:core\n    version: 0.2.0\n    digest: "+digest+"\n",
			".github/workflows/repo-ai.yml":"name: repo-ai\non:\n  pull_request:\n  push:\n    branches: [main]\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  policy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7.0.0\n        with:\n          go-version-file: go.mod\n          cache: false\n      - run: go run ./cmd/repo-ai check --format=json\n",
		}
		r:=Result{Status:"ready",Facts:f}
		keys:=make([]string,0,len(targets)); for p:=range targets {keys=append(keys,p)}; sort.Strings(keys)
		for _,p:=range keys { c:=targets[p]
			if exists(p) { r.Warnings=append(r.Warnings,"preserved existing "+p); continue }
			r.Created=append(r.Created,p)
			if !*dry { if err:=os.MkdirAll(filepath.Dir(p),0755);err!=nil{fmt.Fprintln(os.Stderr,err);os.Exit(1)};if err:=os.WriteFile(p,[]byte(c),0644);err!=nil{fmt.Fprintln(os.Stderr,err);os.Exit(1)} }
		}
		if !exists("AGENTS.md") { r.Created=append(r.Created,"AGENTS.md")} else {r.Warnings=append(r.Warnings,"preserved existing AGENTS.md")}
		if !*dry {
			// Never overwrite an existing unowned AGENTS.md.
			if !exists("AGENTS.md") {
				if err:=os.WriteFile("AGENTS.md",[]byte("# Repository AI Instructions\n\nFollow `.repo-ai/` policy. Before completion run `repo-ai check`. Never bypass enforce-level failures.\n"),0644);err!=nil{fmt.Fprintln(os.Stderr,err);os.Exit(1)}
			}
		}
		emit(r,j)
	case "generate":
		emit(Result{Status:"ok",Warnings:[]string{"bootstrap compiler: no regeneration required"}},j)
	case "check":
		if !exists(".repo-ai/config.yaml") { emit(Result{Status:"failed",Warnings:[]string{"missing .repo-ai/config.yaml"}},j); os.Exit(1) }
		findings,err:=policy.EvaluateCore(".")
		if err!=nil {emit(Result{Status:"failed",Warnings:[]string{err.Error()}},j);os.Exit(1)}
		r:=Result{Status:"compliant",Findings:findings}
		for _,finding:=range findings {if finding.Level==policy.Enforce || finding.Level==policy.Check {r.Status="failed"}}
		emit(r,j)
		if r.Status=="failed" {os.Exit(1)}
	case "update":
		emit(Result{Status:"ok",Warnings:[]string{"bootstrap package uses builtin core policy; OCI resolver is extension point"}},j)
	default:
		fmt.Println("unknown command:",cmd); os.Exit(2)
	}
}
