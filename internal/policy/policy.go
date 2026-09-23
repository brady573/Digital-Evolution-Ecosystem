// Package policy parses and evaluates the local, versioned core policy pack.
package policy

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/example/repo-ai/internal/inspect"
)

type Level string

const (
	Guidance Level = "guidance"
	Check    Level = "check"
	Enforce  Level = "enforce"
)

type Rule struct {
	ID          string `json:"id"`
	Level       Level  `json:"level"`
	Requirement string `json:"requirement"`
	Reason      string `json:"reason,omitempty"`
}

type Pack struct {
	Schema string `json:"schema"`
	Rules  []Rule `json:"rules"`
}

// Finding is the stable interface for an individual policy result.
type Finding interface {
	RuleID() string
	Severity() Level
	Location() string
	Message() string
}

type Result struct {
	ID      string `json:"ruleId"`
	Level   Level  `json:"level"`
	Path    string `json:"path"`
	Detail  string `json:"message"`
}

func (r Result) RuleID() string    { return r.ID }
func (r Result) Severity() Level  { return r.Level }
func (r Result) Location() string { return r.Path }
func (r Result) Message() string  { return r.Detail }

// Checker examines one rule against a repository root.
type Checker interface {
	Check(root string, rule Rule) ([]Finding, error)
}

var ruleID = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$`)
var writeAll = regexp.MustCompile(`(?m)^\s*permissions:\s*write-all\s*(?:#.*)?$`)

// Parse accepts the documented, deliberately narrow policy YAML subset. Unknown
// fields, duplicate keys, malformed indentation, and unsupported syntax fail closed.
func Parse(data []byte) (Pack, error) {
	var pack Pack
	scanner := bufio.NewScanner(bytes.NewReader(data))
	seenSchema, seenRules := false, false
	var fields map[string]bool
	for line := 1; scanner.Scan(); line++ {
		s := strings.TrimRight(scanner.Text(), "\r")
		if s == "" || strings.HasPrefix(strings.TrimSpace(s), "#") { continue }
		switch {
		case strings.HasPrefix(s, "schema: ") && !strings.HasPrefix(s, " "):
			if seenSchema { return pack, fmt.Errorf("line %d: duplicate schema", line) }
			pack.Schema = strings.TrimPrefix(s, "schema: "); seenSchema = true
		case s == "rules:":
			if seenRules { return pack, fmt.Errorf("line %d: duplicate rules", line) }
			seenRules = true
		case strings.HasPrefix(s, "  - id: ") && seenRules:
			pack.Rules = append(pack.Rules, Rule{ID: strings.TrimPrefix(s, "  - id: ")})
			fields = map[string]bool{"id":true}
		case strings.HasPrefix(s, "    ") && len(pack.Rules)>0:
			key, value, ok := strings.Cut(strings.TrimPrefix(s, "    "), ": ")
			if !ok || fields[key] { return pack, fmt.Errorf("line %d: invalid or duplicate field", line) }
			fields[key] = true
			r := &pack.Rules[len(pack.Rules)-1]
			switch key {
			case "level": r.Level = Level(value)
			case "requirement": r.Requirement = value
			case "reason": r.Reason = value
			default: return pack, fmt.Errorf("line %d: unknown field %q", line, key)
			}
		default: return pack, fmt.Errorf("line %d: unsupported policy syntax", line)
		}
	}
	if err := scanner.Err(); err != nil { return pack, err }
	if pack.Schema != "repo-ai/v1" || !seenRules || len(pack.Rules)==0 { return pack, errors.New("invalid policy schema or empty rules") }
	seen := make(map[string]bool)
	for _, r := range pack.Rules {
		if ValidateRule(r)!=nil || seen[r.ID] {
			return pack, fmt.Errorf("invalid or duplicate rule %q", r.ID)
		}
		seen[r.ID] = true
	}
	sort.Slice(pack.Rules,func(i,j int)bool{return pack.Rules[i].ID<pack.Rules[j].ID})
	return pack,nil
}

func ValidateRule(r Rule) error {
	if !ruleID.MatchString(r.ID) { return fmt.Errorf("invalid rule ID %q",r.ID) }
	if r.Level!=Guidance && r.Level!=Check && r.Level!=Enforce { return fmt.Errorf("invalid rule level %q",r.Level) }
	if strings.TrimSpace(r.Requirement)=="" || strings.ContainsAny(r.Requirement,"\r\n") { return fmt.Errorf("invalid requirement") }
	return nil
}

func Canonical(pack Pack) ([]byte,error) { return json.Marshal(pack) }

func Digest(pack Pack) (string,error) {
	b,err:=Canonical(pack); if err!=nil{return "",err}
	return fmt.Sprintf("sha256:%x",sha256.Sum256(b)),nil
}

// VerifyLock binds the local policy bytes to the exact canonical content digest.
func VerifyLock(data []byte, digest string) error {
	want := "    digest: " + digest
	if !bytes.Equal(data, []byte("schema: repo-ai/lock/v1\npacks:\n  - name: core\n    source: builtin:core\n    version: 0.2.0\n"+want+"\n")) {
		return errors.New("invalid policy lock or core digest mismatch")
	}
	return nil
}

type coreChecker struct { facts *inspect.RepositoryFacts }

func (coreChecker) Check(root string, rule Rule) ([]Finding,error) {
	add := func(path,message string) []Finding { return []Finding{Result{ID:rule.ID,Level:rule.Level,Path:path,Detail:message}} }
	switch rule.Requirement {
	case "github_actions_no_write_all":
		paths,err:=filepath.Glob(filepath.Join(root,".github/workflows","*"));if err!=nil{return nil,err}
		var findings []Finding
		for _,path:=range paths {
			if ext:=filepath.Ext(path); ext!=".yml" && ext!=".yaml" {continue}
			b,err:=os.ReadFile(path);if err!=nil{return nil,err}
			if writeAll.Match(b) {findings=append(findings,add(filepath.ToSlash(strings.TrimPrefix(path,root+string(os.PathSeparator))),"write-all GitHub permissions prohibited")...)}
		}
		return findings,nil
	case "repo_ai_workflow_present":
		path:=".github/workflows/repo-ai.yml"
		_,err:=os.Stat(filepath.Join(root,filepath.FromSlash(path)))
		if errors.Is(err,os.ErrNotExist){return add(path,"repo-ai workflow is missing"),nil}
		return nil,err
	case "agents_run_check":
		b,err:=os.ReadFile(filepath.Join(root,"AGENTS.md"))
		if errors.Is(err,os.ErrNotExist){return add("AGENTS.md","agent instructions are missing"),nil}
		if err!=nil{return nil,err}
		if !strings.Contains(string(b),"repo-ai check"){return add("AGENTS.md","agent instructions should require repo-ai check"),nil}
		return nil,nil
	case "go_mod_present", "package_json_present", "python_manifest_present":
		files := map[string][]string{"go_mod_present":{"go.mod"}, "package_json_present":{"package.json"}, "python_manifest_present":{"pyproject.toml","requirements.txt"}}
		candidates:=[]string{"."}
		if c.facts!=nil {candidates=append(candidates,c.facts.WorkspacePaths...)}
		for _, candidate:=range candidates {
			for _, file := range files[rule.Requirement] {
				if _, err := os.Stat(filepath.Join(root,filepath.FromSlash(candidate),file)); err == nil { return nil,nil } else if !errors.Is(err,os.ErrNotExist) { return nil,err }
			}
		}
		return add(".","detected stack manifest is missing"),nil
	default: return nil,fmt.Errorf("no checker for requirement %q",rule.Requirement)
	}
}

func Evaluate(root string, pack Pack, checker Checker) ([]Result,error) {
	var results []Result
	for _,rule:=range pack.Rules {
		findings,err:=checker.Check(root,rule);if err!=nil{return nil,fmt.Errorf("rule %s: %w",rule.ID,err)}
		for _,f:=range findings {results=append(results,Result{ID:f.RuleID(),Level:f.Severity(),Path:f.Location(),Detail:f.Message()})}
	}
	sort.Slice(results,func(i,j int)bool{a,b:=results[i],results[j];if a.ID!=b.ID{return a.ID<b.ID};if a.Path!=b.Path{return a.Path<b.Path};return a.Detail<b.Detail})
	return results,nil
}

func EvaluateCore(root string) ([]Result,error) {
	pack, err := LoadCore(root)
	if err != nil { return nil, err }
	return EvaluateRules(root, pack.Rules)
}

// LoadCore validates the repository's locked core pack against its compiled source.
func LoadCore(root string) (Pack,error) {
	b,err:=os.ReadFile(filepath.Join(root,".repo-ai/packs/core/policy.yaml"));if err!=nil{return Pack{},err}
	pack,err:=Parse(b);if err!=nil{return Pack{},err}
	digest,err:=Digest(pack);if err!=nil{return Pack{},err}
	builtin,err:=Parse([]byte(CoreYAML));if err!=nil{return Pack{},err}
	trustedDigest,err:=Digest(builtin);if err!=nil{return Pack{},err}
	if digest!=trustedDigest {return Pack{},errors.New("local core policy differs from built-in core policy")}
	lock,err:=os.ReadFile(filepath.Join(root,".repo-ai/policy.lock"));if err!=nil{return Pack{},err}
	if err:=VerifyLock(lock,digest);err!=nil{return Pack{},err}
	return pack,nil
}

// EvaluateRules applies the built-in deterministic checkers to resolved rules.
func EvaluateRules(root string, rules []Rule) ([]Result,error) { return Evaluate(root, Pack{Schema:"repo-ai/v1",Rules:rules}, coreChecker{}) }

func EvaluateRulesWithFacts(root string,rules []Rule,facts inspect.RepositoryFacts)([]Result,error){return Evaluate(root,Pack{Schema:"repo-ai/v1",Rules:rules},coreChecker{facts:&facts})}
