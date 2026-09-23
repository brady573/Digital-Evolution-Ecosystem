// Package inspect derives repository facts from files and structured manifests.
// It does not execute repository commands or inspect the host environment.
package inspect

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type RepositoryFacts struct {
	Languages       []string `json:"languages"`
	PackageManagers []string `json:"packageManagers"`
	Frameworks      []string `json:"frameworks"`
	TestRunners     []string `json:"testRunners"`
	Linters         []string `json:"linters"`
	Formatters      []string `json:"formatters"`
	CISystems       []string `json:"ciSystems"`
	Monorepo        bool     `json:"monorepo"`
	WorkspacePaths  []string `json:"workspacePaths"`
}

type packageManifest struct {
	Dependencies    map[string]json.RawMessage `json:"dependencies"`
	DevDependencies map[string]json.RawMessage `json:"devDependencies"`
	Workspaces      json.RawMessage            `json:"workspaces"`
}

func exists(path string) (bool, error) {
	_, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) { return false, nil }
	return err == nil, err
}

func add(set map[string]bool, values ...string) { for _, value := range values { set[value] = true } }
func sorted(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for value := range set { out = append(out, value) }
	sort.Strings(out)
	return out
}

// Inspect returns sorted facts based only on deterministic repository evidence.
func Inspect(root string) (RepositoryFacts, error) {
	var facts RepositoryFacts
	sets := make(map[string]map[string]bool)
	for _, name := range []string{"languages", "managers", "frameworks", "tests", "linters", "formatters", "ci", "paths"} {
		sets[name] = make(map[string]bool)
	}
	check := func(dir, name string) (bool, error) { return exists(filepath.Join(dir, name)) }
	workspacePatterns := make([]string, 0)

	// Scan the root first, then only paths declared in workspace manifests.
	scan := func(dir string) error {
		for _, pair := range []struct{file, language string}{{"go.mod", "go"}, {"pyproject.toml", "python"}, {"requirements.txt", "python"}} {
			found, err := check(dir, pair.file); if err != nil { return err }
			if found { add(sets["languages"], pair.language) }
		}
		for _, pair := range []struct{file, manager string}{{"package-lock.json", "npm"}, {"pnpm-lock.yaml", "pnpm"}, {"yarn.lock", "yarn"}, {"poetry.lock", "poetry"}, {"uv.lock", "uv"}} {
			found, err := check(dir, pair.file); if err != nil { return err }
			if found { add(sets["managers"], pair.manager) }
		}
		if found, err := check(dir, "go.mod"); err != nil { return err } else if found { add(sets["managers"], "go-modules") }
		if found, err := check(dir, "requirements.txt"); err != nil { return err } else if found { add(sets["managers"], "pip-requirements") }
		if found, err := check(dir, "requirements.txt"); err != nil { return err } else if found {
			b, err := os.ReadFile(filepath.Join(dir,"requirements.txt")); if err != nil { return err }
			for _, line := range strings.Split(string(b),"\n") {
				line = strings.TrimSpace(strings.SplitN(line,"#",2)[0])
				if line=="" { continue }
				name:=strings.ToLower(line)
				for _, separator:=range []string{">=","<=","==","~=","!=",">","<","[",";"} { name=strings.SplitN(name,separator,2)[0] }
				name=strings.TrimSpace(name)
				switch name {case "pytest":add(sets["tests"],"pytest");case "ruff":add(sets["linters"],"ruff");case "black":add(sets["formatters"],"black")}
			}
		}
		if found, err := check(dir, "go.mod"); err != nil { return err } else if found {
			tests, err := filepath.Glob(filepath.Join(dir, "*_test.go")); if err != nil { return err }
			if len(tests) > 0 { add(sets["tests"], "go-test") }
		}
		if found, err := check(dir, ".golangci.yml"); err != nil { return err } else if found { add(sets["linters"], "golangci-lint") }
		if found, err := check(dir, ".golangci.yaml"); err != nil { return err } else if found { add(sets["linters"], "golangci-lint") }
		if found, err := check(dir, ".golangci.toml"); err != nil { return err } else if found { add(sets["linters"], "golangci-lint") }
		for _, file := range []string{"eslint.config.js","eslint.config.mjs","eslint.config.cjs",".eslintrc",".eslintrc.js",".eslintrc.cjs",".eslintrc.json",".eslintrc.yaml",".eslintrc.yml"} {
			if found, err := check(dir,file); err != nil { return err } else if found { add(sets["linters"],"eslint") }
		}
		for _, file := range []string{".prettierrc",".prettierrc.json",".prettierrc.yaml","prettier.config.js","prettier.config.cjs"} {
			if found, err := check(dir,file); err != nil { return err } else if found { add(sets["formatters"],"prettier") }
		}
		for _, pair := range []struct{file,runner string}{{"jest.config.js","jest"},{"jest.config.ts","jest"},{"vitest.config.js","vitest"},{"vitest.config.ts","vitest"},{"pytest.ini","pytest"},{"tox.ini","pytest"}} {
			if found, err := check(dir,pair.file); err != nil { return err } else if found { add(sets["tests"],pair.runner) }
		}
		if found, err := check(dir, "package.json"); err != nil { return err } else if found {
			b, err := os.ReadFile(filepath.Join(dir, "package.json")); if err != nil { return err }
			var manifest packageManifest
			if err := json.Unmarshal(b, &manifest); err != nil { return fmt.Errorf("package.json: %w", err) }
			deps := make(map[string]bool)
			for name := range manifest.Dependencies { deps[name] = true }
			for name := range manifest.DevDependencies { deps[name] = true }
			isTypeScript := deps["typescript"]
			if has, err := check(dir, "tsconfig.json"); err != nil { return err } else if has { isTypeScript = true }
			for _, pattern := range []string{"*.ts", "*.tsx"} { matches, err := filepath.Glob(filepath.Join(dir, pattern)); if err != nil { return err }; if len(matches)>0 { isTypeScript = true } }
			if isTypeScript { add(sets["languages"], "typescript") } else { add(sets["languages"], "javascript") }
			for name, framework := range map[string]string{"react": "react", "next": "nextjs", "vue": "vue", "@angular/core": "angular", "svelte": "svelte"} {
				if deps[name] { add(sets["frameworks"], framework) }
			}
			for name, runner := range map[string]string{"jest": "jest", "vitest": "vitest", "mocha": "mocha"} {
				if deps[name] { add(sets["tests"], runner) }
			}
			if deps["eslint"] { add(sets["linters"], "eslint") }
			if deps["prettier"] { add(sets["formatters"], "prettier") }
			if dir == root && len(manifest.Workspaces) > 0 {
				var paths []string
				trimmed:=strings.TrimSpace(string(manifest.Workspaces))
				if strings.HasPrefix(trimmed,"[") {
					if err := json.Unmarshal(manifest.Workspaces,&paths);err!=nil{return fmt.Errorf("invalid package.json workspaces: %w",err)}
				} else if strings.HasPrefix(trimmed,"{") {
					var object struct { Packages []string `json:"packages"` }
					if err := json.Unmarshal(manifest.Workspaces, &object); err != nil { return fmt.Errorf("invalid package.json workspaces: %w", err) }
					if object.Packages==nil{return fmt.Errorf("invalid package.json workspaces: packages must be an array")}
					paths = object.Packages
				} else {
					return fmt.Errorf("invalid package.json workspaces: expected array or object")
				}
				if len(paths)>0 {workspacePatterns = append(workspacePatterns, paths...);facts.Monorepo = true}
			}
		}
		if found, err := check(dir, "pyproject.toml"); err != nil { return err } else if found {
			b, err := os.ReadFile(filepath.Join(dir, "pyproject.toml")); if err != nil { return err }
			content := string(b)
			// Require a package token or a named tool section rather than guessing from prose.
			for _, pair := range []struct{token, category, value string}{
				{"[tool.pytest", "tests", "pytest"}, {"[tool.ruff", "linters", "ruff"}, {"[tool.black", "formatters", "black"},
				{"\"pytest\"", "tests", "pytest"}, {"\"ruff\"", "linters", "ruff"}, {"\"black\"", "formatters", "black"},
			} { if strings.Contains(content, pair.token) { add(sets[pair.category], pair.value) } }
		}
		return nil
	}
	if err := scan(root); err != nil { return facts, err }
	if found, err := check(root, ".github/workflows"); err != nil { return facts, err } else if found { add(sets["ci"], "github-actions") }
	if found, err := check(root, "go.work"); err != nil { return facts, err } else if found {
		facts.Monorepo = true
		b, err := os.ReadFile(filepath.Join(root, "go.work")); if err != nil { return facts, err }
		inside := false
		for _, line := range strings.Split(string(b), "\n") {
			line = strings.TrimSpace(strings.SplitN(line, "//", 2)[0])
			if line == "use (" { inside = true; continue }
			if inside && line == ")" { inside = false; continue }
			if inside { workspacePatterns = append(workspacePatterns, line) } else if strings.HasPrefix(line, "use ") { workspacePatterns = append(workspacePatterns, strings.TrimSpace(strings.TrimPrefix(line, "use "))) }
		}
	}
	if found, err := check(root, "pnpm-workspace.yaml"); err != nil { return facts, err } else if found {
		add(sets["managers"],"pnpm")
		facts.Monorepo = true
		b, err := os.ReadFile(filepath.Join(root, "pnpm-workspace.yaml")); if err != nil { return facts, err }
		inPackages := false
		for _, line := range strings.Split(string(b), "\n") {
			line = strings.TrimSpace(line)
			if line == "packages:" { inPackages = true; continue }
			if line == "" || strings.HasPrefix(line, "#") { continue }
			if !strings.HasPrefix(line, "- ") { inPackages = false; continue }
			if inPackages { workspacePatterns = append(workspacePatterns, strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "- ")), "'\"")) }
		}
	}
	for _, pattern := range workspacePatterns {
		pattern = strings.TrimPrefix(pattern, "./")
		if pattern == "." || pattern == "" { continue }
		if filepath.IsAbs(pattern) || pattern == ".." || strings.HasPrefix(pattern, "../") || strings.Contains(pattern, "/../") || strings.HasPrefix(pattern, "!") { continue }
		matches, err := filepath.Glob(filepath.Join(root, filepath.FromSlash(pattern))); if err != nil { return facts, fmt.Errorf("workspace pattern %q: %w", pattern, err) }
		for _, path := range matches {
			info, err := os.Lstat(path); if err != nil { return facts, err }
			if !info.IsDir() { continue }
			rel, err := filepath.Rel(root, path); if err != nil { return facts, err }
			if rel == "." { continue }
			for _, manifest := range []string{"go.mod", "package.json", "pyproject.toml", "requirements.txt"} {
				found, err := check(path, manifest); if err != nil { return facts, err }
				if found { add(sets["paths"], filepath.ToSlash(rel)); break }
			}
		}
	}
	for _, rel := range sorted(sets["paths"]) { if err := scan(filepath.Join(root, filepath.FromSlash(rel))); err != nil { return facts, fmt.Errorf("workspace %s: %w", rel, err) } }
	for _, ci := range []struct{path,name string}{{".gitlab-ci.yml","gitlab-ci"},{".circleci/config.yml","circleci"},{"azure-pipelines.yml","azure-pipelines"}} {
		if found, err := check(root,ci.path); err != nil { return facts,err } else if found { add(sets["ci"],ci.name) }
	}
	facts.Languages = sorted(sets["languages"])
	facts.PackageManagers = sorted(sets["managers"])
	facts.Frameworks = sorted(sets["frameworks"])
	facts.TestRunners = sorted(sets["tests"])
	facts.Linters = sorted(sets["linters"])
	facts.Formatters = sorted(sets["formatters"])
	facts.CISystems = sorted(sets["ci"])
	facts.WorkspacePaths = sorted(sets["paths"])
	return facts, nil
}
