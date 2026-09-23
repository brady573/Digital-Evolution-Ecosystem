package inspect

import (
	"reflect"
	"testing"
)

func TestRepositoryEvidenceFixtures(t *testing.T) {
	tests:=[]struct{name string;want RepositoryFacts}{
		{"go",RepositoryFacts{Languages:[]string{"go"},PackageManagers:[]string{"go-modules"},Linters:[]string{"golangci-lint"},TestRunners:[]string{"go-test"},WorkspacePaths:[]string{}}},
		{"npm-js",RepositoryFacts{Languages:[]string{"javascript"},PackageManagers:[]string{"npm"},Frameworks:[]string{"nextjs"},TestRunners:[]string{"mocha"},WorkspacePaths:[]string{}}},
		{"npm-ts",RepositoryFacts{Languages:[]string{"typescript"},PackageManagers:[]string{"npm"},Frameworks:[]string{"react"},TestRunners:[]string{"jest"},Linters:[]string{"eslint"},Formatters:[]string{"prettier"},WorkspacePaths:[]string{}}},
		{"pnpm-workspace",RepositoryFacts{Languages:[]string{"typescript"},PackageManagers:[]string{"pnpm"},Frameworks:[]string{"vue"},TestRunners:[]string{"vitest"},Monorepo:true,WorkspacePaths:[]string{"apps/site"}}},
		{"python",RepositoryFacts{Languages:[]string{"python"},PackageManagers:[]string{"uv"},TestRunners:[]string{"pytest"},Linters:[]string{"ruff"},Formatters:[]string{"black"},WorkspacePaths:[]string{}}},
		{"mixed",RepositoryFacts{Languages:[]string{"go","javascript","python"},PackageManagers:[]string{"go-modules","pip-requirements","pnpm"},TestRunners:[]string{"vitest"},WorkspacePaths:[]string{}}},
		{"workspace",RepositoryFacts{Languages:[]string{"go","javascript"},PackageManagers:[]string{"go-modules"},Monorepo:true,WorkspacePaths:[]string{"packages/a","packages/b"}}},
	}
	for _,tc:=range tests { t.Run(tc.name,func(t *testing.T){
		root:="testdata/"+tc.name
		got,err:=Inspect(root);if err!=nil{t.Fatal(err)}
		for _, values := range []*[]string{&tc.want.Languages,&tc.want.PackageManagers,&tc.want.Frameworks,&tc.want.TestRunners,&tc.want.Linters,&tc.want.Formatters,&tc.want.CISystems,&tc.want.WorkspacePaths} {
			if *values == nil { *values = []string{} }
		}
		if !reflect.DeepEqual(got,tc.want){t.Fatalf("facts = %#v, want %#v",got,tc.want)}
		again,err:=Inspect(root);if err!=nil{t.Fatal(err)}
		if !reflect.DeepEqual(got,again){t.Fatalf("inspection is nondeterministic: %#v != %#v",got,again)}
	}) }
}
