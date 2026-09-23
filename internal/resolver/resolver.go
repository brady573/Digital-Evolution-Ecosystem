// Package resolver selects local policy sources and merges them deterministically.
package resolver

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/example/repo-ai/internal/config"
	"github.com/example/repo-ai/internal/inspect"
	"github.com/example/repo-ai/internal/policy"
)

type PolicySource struct {
	Layer  string `json:"layer"`
	Name   string `json:"name"`
	Path   string `json:"path,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type RuleProvenance struct { Source PolicySource `json:"source"` }

type ResolvedRule struct {
	Definition policy.Rule `json:"definition"`
	Provenance []RuleProvenance `json:"provenance"`
}

type ResolvedPolicy struct {
	Schema string `json:"schema"`
	Digest string `json:"digest"`
	Rules []ResolvedRule `json:"rules"`
}

type sourcePack struct { source PolicySource; pack policy.Pack }

var builtins = map[string]string{
	"go": `schema: repo-ai/v1
rules:
  - id: stack.go.manifest
    level: check
    requirement: go_mod_present
`,
	"javascript/typescript": `schema: repo-ai/v1
rules:
  - id: stack.javascript.manifest
    level: check
    requirement: package_json_present
`,
	"python": `schema: repo-ai/v1
rules:
  - id: stack.python.manifest
    level: check
    requirement: python_manifest_present
`,
}

func stackName(language string) string {
	switch language {
	case "javascript", "typescript": return "javascript/typescript"
	default: return language
	}
}

func parseSource(name, path, layer string, data []byte) (sourcePack,error) {
	pack,err:=policy.Parse(data)
	if err!=nil{return sourcePack{},fmt.Errorf("%s: %w",path,err)}
	return sourcePack{source:PolicySource{Layer:layer,Name:name,Path:path},pack:pack},nil
}

func definitionsEqual(a,b policy.Rule) bool { return a==b }

func loadStandards(root string) ([]sourcePack,error) {
	dir:=filepath.Join(root,".repo-ai/standards")
	info,err:=os.Lstat(dir)
	if errors.Is(err,os.ErrNotExist){return nil,nil}
	if err!=nil{return nil,err}
	if info.Mode()&os.ModeSymlink!=0{return nil,fmt.Errorf(".repo-ai/standards cannot be a symlink")}
	if !info.IsDir(){return nil,fmt.Errorf(".repo-ai/standards must be a directory")}
	paths,err:=filepath.Glob(filepath.Join(dir,"*.yaml"));if err!=nil{return nil,err}
	more,err:=filepath.Glob(filepath.Join(dir,"*.yml"));if err!=nil{return nil,err}
	paths=append(paths,more...);sort.Strings(paths)
	var packs []sourcePack
	for _,path:=range paths {
		fileInfo,err:=os.Lstat(path);if err!=nil{return nil,err}
		if !fileInfo.Mode().IsRegular(){return nil,fmt.Errorf("policy source %s must be a regular file",path)}
		data,err:=os.ReadFile(path);if err!=nil{return nil,err}
		rel,err:=filepath.Rel(root,path);if err!=nil{return nil,err}
		pack,err:=parseSource(filepath.Base(path),filepath.ToSlash(rel),"repository-standard",data);if err!=nil{return nil,err}
		packs=append(packs,pack)
	}
	return packs,nil
}

func loadOverrides(root string) ([]config.Override,error) {
	path:=filepath.Join(root,".repo-ai/overrides.yaml")
	data,err:=os.ReadFile(path)
	if errors.Is(err,os.ErrNotExist){return []config.Override{},nil}
	if err!=nil{return nil,err}
	return config.ParseOverrides(data)
}

// Resolve loads and validates policy inputs, then applies sources in the fixed
// order baseline, detected stacks, repository standards, and explicit overrides.
func Resolve(root string, facts inspect.RepositoryFacts) (ResolvedPolicy,error) {
	configData,err:=os.ReadFile(filepath.Join(root,".repo-ai/config.yaml"));if err!=nil{return ResolvedPolicy{},err}
	cfg,err:=config.Parse(configData);if err!=nil{return ResolvedPolicy{},fmt.Errorf(".repo-ai/config.yaml: %w",err)}
	if cfg.Policy!="core" { return ResolvedPolicy{},fmt.Errorf("unsupported policy reference %q",cfg.Policy) }
	base,err:=policy.LoadCore(root);if err!=nil{return ResolvedPolicy{},err}
	baseline:=sourcePack{source:PolicySource{Layer:"baseline",Name:"core",Path:".repo-ai/packs/core/policy.yaml"},pack:base}
	layers:=[][]sourcePack{{baseline}}
	stackNames:=map[string]bool{}
	for _,language:=range facts.Languages { if _,ok:=builtins[stackName(language)];ok { stackNames[stackName(language)]=true } }
	var stacks []sourcePack
	for language:=range stackNames {
		data:=builtins[language]
		pack,err:=parseSource(language,"builtin:stack/"+strings.ReplaceAll(language,"/","-"),"detected-stack",[]byte(data));if err!=nil{return ResolvedPolicy{},err}
		stacks=append(stacks,pack)
	}
	sort.Slice(stacks,func(i,j int)bool{return stacks[i].source.Name<stacks[j].source.Name})
	layers=append(layers,stacks)
	standards,err:=loadStandards(root);if err!=nil{return ResolvedPolicy{},err}
	layers=append(layers,standards)
	resolved:=map[string]ResolvedRule{}
	for _,layer:=range layers {
		candidates:=map[string]policy.Rule{}
		sources:=map[string][]PolicySource{}
		for _,source:=range layer {
			for _,definition:=range source.pack.Rules {
				reason:=definition.Reason
				definition.Reason=""
				if old,ok:=candidates[definition.ID];ok&&!definitionsEqual(old,definition){return ResolvedPolicy{},fmt.Errorf("equal-precedence policy conflict for rule %s",definition.ID)}
				candidates[definition.ID]=definition
				provenance:=source.source
				provenance.Reason=reason
				sources[definition.ID]=append(sources[definition.ID],provenance)
			}
		}
		ids:=make([]string,0,len(candidates));for id:=range candidates{ids=append(ids,id)};sort.Strings(ids)
		for _,id:=range ids {
			prior:=resolved[id]
			if prior.Definition.ID!=""&&len(layer)>0&&layer[0].source.Layer=="repository-standard" {
				definition:=candidates[id]
				weakens:=levelRank(definition.Level)<levelRank(prior.Definition.Level)||definition.Requirement!=prior.Definition.Requirement
				if weakens {
					reasonPresent:=false
					for _,source:=range sources[id]{if strings.TrimSpace(source.Reason)!=""{reasonPresent=true}}
					if !reasonPresent{return ResolvedPolicy{},fmt.Errorf("repository standard weakening %s requires a reason",id)}
				}
			}
			prior.Definition=candidates[id]
			for _,source:=range sources[id]{prior.Provenance=append(prior.Provenance,RuleProvenance{Source:source})}
			resolved[id]=prior
		}
	}
	overrides,err:=loadOverrides(root);if err!=nil{return ResolvedPolicy{},fmt.Errorf(".repo-ai/overrides.yaml: %w",err)}
	seen:=map[string]bool{}
	for _,override:=range overrides {
		if seen[override.ID] {return ResolvedPolicy{},fmt.Errorf("duplicate override for rule %s",override.ID)}
		seen[override.ID]=true
		prior,ok:=resolved[override.ID];if !ok{return ResolvedPolicy{},fmt.Errorf("override targets unknown rule %s",override.ID)}
		updated:=prior.Definition
		if override.Level!="" {updated.Level=policy.Level(override.Level)}
		if override.Requirement!="" {updated.Requirement=override.Requirement}
		if err:=policy.ValidateRule(updated);err!=nil{return ResolvedPolicy{},fmt.Errorf("override %s: %w",override.ID,err)}
		if (levelRank(updated.Level)<levelRank(prior.Definition.Level)||updated.Requirement!=prior.Definition.Requirement)&&strings.TrimSpace(override.Reason)=="" {return ResolvedPolicy{},fmt.Errorf("override weakening or changing %s requires a reason",override.ID)}
		prior.Definition=updated
		prior.Provenance=append(prior.Provenance,RuleProvenance{Source:PolicySource{Layer:"explicit-override",Name:override.ID,Path:".repo-ai/overrides.yaml",Reason:override.Reason}})
		resolved[override.ID]=prior
	}
	ids:=make([]string,0,len(resolved));for id:=range resolved{ids=append(ids,id)};sort.Strings(ids)
	result:=ResolvedPolicy{Schema:"repo-ai/resolved/v1"}
	canonical:=struct{Schema string `json:"schema"`;Rules []policy.Rule `json:"rules"`}{Schema:result.Schema}
	for _,id:=range ids{rule:=resolved[id];result.Rules=append(result.Rules,rule);canonical.Rules=append(canonical.Rules,rule.Definition)}
	bytes,err:=json.Marshal(canonical);if err!=nil{return ResolvedPolicy{},err}
	result.Digest=fmt.Sprintf("sha256:%x",sha256.Sum256(bytes))
	return result,nil
}

func levelRank(level policy.Level) int { switch level {case policy.Guidance:return 1;case policy.Check:return 2;case policy.Enforce:return 3;default:return 0} }

func (p ResolvedPolicy) Definitions() []policy.Rule { rules:=make([]policy.Rule,len(p.Rules));for i,rule:=range p.Rules{rules[i]=rule.Definition};return rules }
