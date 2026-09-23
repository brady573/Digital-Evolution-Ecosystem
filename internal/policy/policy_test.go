package policy

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestFixtureRepositories(t *testing.T) {
	pack,err:=Parse([]byte(CoreYAML));if err!=nil{t.Fatal(err)}
	for _,tc:=range []struct{name string;want []Result}{
		{"compliant",nil},
		{"noncompliant",[]Result{
			{ID:"coding.validate-before-completion",Level:Guidance,Path:"AGENTS.md",Detail:"agent instructions are missing"},
			{ID:"security.github.permissions",Level:Enforce,Path:".github/workflows/repo-ai.yml",Detail:"write-all GitHub permissions prohibited"},
		}},
	} {
		t.Run(tc.name,func(t *testing.T){
			got,err:=Evaluate(filepath.Join("testdata",tc.name),pack,coreChecker{});if err!=nil{t.Fatal(err)}
			if !reflect.DeepEqual(got,tc.want){t.Fatalf("findings = %#v, want %#v",got,tc.want)}
		})
	}
}

func TestMissingWorkflowIsCheckLevel(t *testing.T) {
	pack,err:=Parse([]byte(CoreYAML));if err!=nil{t.Fatal(err)}
	root:=t.TempDir()
	if err:=os.WriteFile(filepath.Join(root,"AGENTS.md"),[]byte("run repo-ai check"),0644);err!=nil{t.Fatal(err)}
	got,err:=Evaluate(root,pack,coreChecker{});if err!=nil{t.Fatal(err)}
	if len(got)!=1 || got[0].ID!="governance.workflow.present" || got[0].Level!=Check {t.Fatalf("findings = %#v",got)}
}

func TestCanonicalDigestAndLock(t *testing.T) {
	a,err:=Parse([]byte(CoreYAML));if err!=nil{t.Fatal(err)}
	b,err:=Parse([]byte("schema: repo-ai/v1\nrules:\n  - id: security.github.permissions\n    level: enforce\n    requirement: github_actions_no_write_all\n  - id: governance.workflow.present\n    level: check\n    requirement: repo_ai_workflow_present\n  - id: coding.validate-before-completion\n    level: guidance\n    requirement: agents_run_check\n"));if err!=nil{t.Fatal(err)}
	d1,err:=Digest(a);if err!=nil{t.Fatal(err)}
	d2,err:=Digest(b);if err!=nil{t.Fatal(err)}
	if d1!=d2 {t.Fatalf("order changed digest: %s != %s",d1,d2)}
	lock,err:=os.ReadFile("../../.repo-ai/policy.lock");if err!=nil{t.Fatal(err)}
	if err:=VerifyLock(lock,d1);err!=nil{t.Fatal(err)}
	if err:=VerifyLock(lock,"sha256:"+strings.Repeat("0",64));err==nil{t.Fatal("mismatched digest accepted")}
}

func TestRejectInvalidPolicy(t *testing.T) {
	for _,data:=range []string{
		"schema: repo-ai/v1\nrules:\n  - id: security.github.permissions\n    level: enforce\n    requirement: github_actions_no_write_all\n    unexpected: true\n",
		"schema: repo-ai/v1\nrules:\n  - id: security.github.permissions\n    level: unknown\n    requirement: github_actions_no_write_all\n",
		"schema: repo-ai/v1\nrules:\n  - id: security.github.permissions\n    level: enforce\n    requirement: github_actions_no_write_all\n  - id: security.github.permissions\n    level: enforce\n    requirement: github_actions_no_write_all\n",
	} {
		if _,err:=Parse([]byte(data));err==nil{t.Fatalf("accepted invalid policy %q",data)}
	}
}

func TestEvaluateCoreRejectsTamperedPack(t *testing.T) {
	root:=t.TempDir()
	if err:=os.MkdirAll(filepath.Join(root,".repo-ai/packs/core"),0755);err!=nil{t.Fatal(err)}
	if err:=os.WriteFile(filepath.Join(root,".repo-ai/packs/core/policy.yaml"),[]byte(strings.Replace(CoreYAML,"level: enforce","level: guidance",1)),0644);err!=nil{t.Fatal(err)}
	if _,err:=EvaluateCore(root);err==nil || !strings.Contains(err.Error(),"differs from built-in") {t.Fatalf("tampered policy accepted: %v",err)}
}
