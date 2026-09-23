package resolver

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/example/repo-ai/internal/inspect"
	"github.com/example/repo-ai/internal/policy"
)

func write(t *testing.T,root,path,body string){t.Helper();full:=filepath.Join(root,filepath.FromSlash(path));if err:=os.MkdirAll(filepath.Dir(full),0755);err!=nil{t.Fatal(err)};if err:=os.WriteFile(full,[]byte(body),0644);err!=nil{t.Fatal(err)}}

func initRepo(t *testing.T,root string){
	t.Helper()
	pack,err:=policy.Parse([]byte(policy.CoreYAML));if err!=nil{t.Fatal(err)}
	digest,err:=policy.Digest(pack);if err!=nil{t.Fatal(err)}
	write(t,root,".repo-ai/config.yaml","schema: repo-ai/config/v1\npolicy: core\n")
	write(t,root,".repo-ai/packs/core/policy.yaml",policy.CoreYAML)
	write(t,root,".repo-ai/policy.lock","schema: repo-ai/lock/v1\npacks:\n  - name: core\n    source: builtin:core\n    version: 0.2.0\n    digest: "+digest+"\n")
	write(t,root,".repo-ai/overrides.yaml","schema: repo-ai/overrides/v1\noverrides: {}\n")
}

func resolve(t *testing.T,root string)ResolvedPolicy{t.Helper();facts,err:=inspect.Inspect(root);if err!=nil{t.Fatal(err)};got,err:=Resolve(root,facts);if err!=nil{t.Fatal(err)};return got}
func findRule(t *testing.T,resolved ResolvedPolicy,id string)ResolvedRule{t.Helper();for _,r:=range resolved.Rules{if r.Definition.ID==id{return r}};t.Fatalf("missing resolved rule %s",id);return ResolvedRule{}}

func TestDetectedStackSelectionAndIdempotence(t *testing.T){
	tests:=[]struct{name,manifest,stackRule string}{
		{"go","go.mod", "stack.go.manifest"},
		{"typescript","package.json","stack.javascript.manifest"},
		{"python","pyproject.toml","stack.python.manifest"},
	}
	for _,tc:=range tests{t.Run(tc.name,func(t *testing.T){root:=t.TempDir();initRepo(t,root)
		switch tc.name{case "go":write(t,root,tc.manifest,"module example.test/go\n\ngo 1.23\n");case "typescript":write(t,root,tc.manifest,"{\"devDependencies\":{\"typescript\":\"5\"}}\n");case "python":write(t,root,tc.manifest,"[project]\nname='fixture'\n")}
		first:=resolve(t,root);second:=resolve(t,root)
		if !reflect.DeepEqual(first,second){t.Fatalf("resolve is nondeterministic: %#v != %#v",first,second)}
		rule:=findRule(t,first,tc.stackRule)
		if rule.Provenance[len(rule.Provenance)-1].Source.Layer!="detected-stack"{t.Fatalf("stack provenance = %#v",rule.Provenance)}
		findRule(t,first,"security.github.permissions")
	})}
}

func TestMixedRepositorySelectsMultipleStacksInStableOrder(t *testing.T){root:=t.TempDir();initRepo(t,root)
	write(t,root,"go.mod","module example.test/mixed\n\ngo 1.23\n")
	write(t,root,"package.json","{\"devDependencies\":{\"typescript\":\"5\"}}\n")
	write(t,root,"requirements.txt","requests\n")
	got:=resolve(t,root)
	var ids []string;for _,r:=range got.Rules{if strings.HasPrefix(r.Definition.ID,"stack."){ids=append(ids,r.Definition.ID)}}
	want:=[]string{"stack.go.manifest","stack.javascript.manifest","stack.python.manifest"}
	if !reflect.DeepEqual(ids,want){t.Fatalf("stack policies = %#v, want %#v",ids,want)}
}

func TestWorkspaceDetectionSelectsStacksFromWorkspaceEvidence(t *testing.T){root:=t.TempDir();initRepo(t,root)
	write(t,root,"package.json","{\"workspaces\":[\"apps/*\"]}\n")
	write(t,root,"apps/web/package.json","{\"devDependencies\":{\"typescript\":\"5\"}}\n")
	write(t,root,"apps/service/go.mod","module example.test/service\n\ngo 1.23\n")
	facts,err:=inspect.Inspect(root);if err!=nil{t.Fatal(err)}
	if !facts.Monorepo||!reflect.DeepEqual(facts.WorkspacePaths,[]string{"apps/service","apps/web"}){t.Fatalf("facts = %#v",facts)}
	got,err:=Resolve(root,facts);if err!=nil{t.Fatal(err)}
	findRule(t,got,"stack.go.manifest");findRule(t,got,"stack.javascript.manifest")
}

func TestRepositoryStandardOverridesStackWithProvenance(t *testing.T){root:=t.TempDir();initRepo(t,root);write(t,root,"go.mod","module example.test/go\n\ngo 1.23\n")
	write(t,root,".repo-ai/standards/team.yaml","schema: repo-ai/v1\nrules:\n  - id: stack.go.manifest\n    level: guidance\n    requirement: go_mod_present\n    reason: repository standard permits gradual adoption\n")
	got:=resolve(t,root);rule:=findRule(t,got,"stack.go.manifest")
	if rule.Definition.Level!=policy.Guidance||len(rule.Provenance)!=2||rule.Provenance[1].Source.Layer!="repository-standard"{t.Fatalf("resolved rule = %#v",rule)}
}

func TestExplicitOverrideWinsAndCarriesReason(t *testing.T){root:=t.TempDir();initRepo(t,root);write(t,root,"go.mod","module example.test/go\n\ngo 1.23\n")
	write(t,root,".repo-ai/standards/team.yaml","schema: repo-ai/v1\nrules:\n  - id: stack.go.manifest\n    level: guidance\n    requirement: go_mod_present\n    reason: repository standard permits gradual adoption\n")
	write(t,root,".repo-ai/overrides.yaml","schema: repo-ai/overrides/v1\noverrides:\n  - id: stack.go.manifest\n    level: enforce\n    reason: release gate requested by maintainers\n")
	got:=resolve(t,root);rule:=findRule(t,got,"stack.go.manifest")
	last:=rule.Provenance[len(rule.Provenance)-1].Source
	if rule.Definition.Level!=policy.Enforce||last.Layer!="explicit-override"||last.Reason!="release gate requested by maintainers"{t.Fatalf("resolved rule = %#v",rule)}
}

func TestInvalidOverridesAndEqualPrecedenceConflictFail(t *testing.T){
	t.Run("unknown target",func(t *testing.T){root:=t.TempDir();initRepo(t,root);write(t,root,".repo-ai/overrides.yaml","schema: repo-ai/overrides/v1\noverrides:\n  - id: unknown.rule\n    level: check\n");facts,_:=inspect.Inspect(root);if _,err:=Resolve(root,facts);err==nil{t.Fatal("unknown override target accepted")}})
	t.Run("weakening requires reason",func(t *testing.T){root:=t.TempDir();initRepo(t,root);write(t,root,".repo-ai/overrides.yaml","schema: repo-ai/overrides/v1\noverrides:\n  - id: security.github.permissions\n    level: check\n");facts,_:=inspect.Inspect(root);if _,err:=Resolve(root,facts);err==nil||!strings.Contains(err.Error(),"requires a reason"){t.Fatalf("error = %v",err)}})
	t.Run("reasoned weakening is explicit",func(t *testing.T){root:=t.TempDir();initRepo(t,root);write(t,root,".repo-ai/overrides.yaml","schema: repo-ai/overrides/v1\noverrides:\n  - id: security.github.permissions\n    level: check\n    reason: approved exception for this repository\n");got:=resolve(t,root);rule:=findRule(t,got,"security.github.permissions");if rule.Definition.Level!=policy.Check||rule.Provenance[len(rule.Provenance)-1].Source.Reason==""{t.Fatalf("resolved rule = %#v",rule)}})
	t.Run("equal layer conflict",func(t *testing.T){root:=t.TempDir();initRepo(t,root);for name,level:=range map[string]string{"a.yaml":"guidance","b.yaml":"enforce"}{write(t,root,".repo-ai/standards/"+name,"schema: repo-ai/v1\nrules:\n  - id: coding.validate-before-completion\n    level: "+level+"\n    requirement: agents_run_check\n")};facts,_:=inspect.Inspect(root);if _,err:=Resolve(root,facts);err==nil||!strings.Contains(err.Error(),"equal-precedence"){t.Fatalf("error = %v",err)}})
}

func TestConfigFormattingAndEffectivePolicyDigest(t *testing.T){root:=t.TempDir();initRepo(t,root);write(t,root,"go.mod","module example.test/go\n\ngo 1.23\n")
	first:=resolve(t,root)
	write(t,root,".repo-ai/config.yaml","# equivalent config\npolicy : 'core'\nschema: \"repo-ai/config/v1\"\n")
	second:=resolve(t,root)
	if first.Digest!=second.Digest{t.Fatalf("formatting changed digest %s != %s",first.Digest,second.Digest)}
	write(t,root,".repo-ai/standards/team.yaml","schema: repo-ai/v1\nrules:\n  - id: stack.go.manifest\n    level: guidance\n    requirement: go_mod_present\n    reason: repository standard permits gradual adoption\n")
	third:=resolve(t,root)
	if second.Digest==third.Digest{t.Fatal("effective policy change did not change digest")}
}

func TestResolvedDigestExcludesProvenanceAndIsStable(t *testing.T) {
	root:=t.TempDir();initRepo(t,root);write(t,root,"go.mod","module example.test/go\n\ngo 1.23\n")
	first:=resolve(t,root)
	second:=resolve(t,root)
	if first.Digest!=second.Digest { t.Fatalf("identical effective rules have different digests: %s != %s",first.Digest,second.Digest) }
	write(t,root,".repo-ai/standards/provenance.yaml","schema: repo-ai/v1\nrules:\n  - id: stack.go.manifest\n    level: check\n    requirement: go_mod_present\n    reason: provenance-only annotation\n")
	withProvenance:=resolve(t,root)
	before,after:=findRule(t,first,"stack.go.manifest"),findRule(t,withProvenance,"stack.go.manifest")
	if !reflect.DeepEqual(before.Definition,after.Definition) { t.Fatalf("effective definitions differ: %#v != %#v",before.Definition,after.Definition) }
	if reflect.DeepEqual(before.Provenance,after.Provenance) { t.Fatal("expected provenance to differ") }
	if first.Digest!=withProvenance.Digest { t.Fatalf("provenance-only change altered resolved digest: %s != %s",first.Digest,withProvenance.Digest) }
}
