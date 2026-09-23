package config

import "testing"

func TestConfigFormattingDoesNotChangeSemantics(t *testing.T) {
	a,err:=Parse([]byte("schema: repo-ai/config/v1\npolicy: core\n"));if err!=nil{t.Fatal(err)}
	b,err:=Parse([]byte("# comment\npolicy : core # supported policy\nschema: \"repo-ai/config/v1\"\n"));if err!=nil{t.Fatal(err)}
	if a!=b {t.Fatalf("parsed configs differ: %#v %#v",a,b)}
}

func TestConfigRejectsUnknownSchemaFieldsAndReferences(t *testing.T) {
	for _,data:=range []string{
		"schema: repo-ai/config/v2\npolicy: core\n",
		"schema: repo-ai/config/v1\npolicy: [core]\n",
		"schema: repo-ai/config/v1\npolicy: remote\n",
		"schema: repo-ai/config/v1\npolicy: core\nother: value\n",
		"schema: repo-ai/config/v1\nschema: repo-ai/config/v1\npolicy: core\n",
	} {if _,err:=Parse([]byte(data));err==nil{t.Fatalf("accepted invalid config %q",data)}}
}

func TestOverrideParsingIsStrictAndOrderIndependent(t *testing.T) {
	data:=[]byte("schema: repo-ai/overrides/v1\noverrides:\n  - reason: approved test exception\n    level: check\n    id: security.github.permissions\n")
	got,err:=ParseOverrides(data);if err!=nil{t.Fatal(err)}
	if len(got)!=1||got[0].ID!="security.github.permissions"||got[0].Level!="check"||got[0].Reason!="approved test exception"{t.Fatalf("override = %#v",got)}
	if _,err:=ParseOverrides([]byte("schema: repo-ai/overrides/v1\noverrides:\n  - id: security.github.permissions\n    unexpected: value\n"));err==nil{t.Fatal("accepted unsupported override field")}
	if _,err:=ParseOverrides([]byte("schema: repo-ai/overrides/v1\noverrides:\n  - level: check\n"));err==nil{t.Fatal("accepted override without an ID")}
	if _,err:=ParseOverrides([]byte("schema: repo-ai/overrides/v1\noverrides:\n  - id: security.github.permissions\n    level: block\n"));err==nil{t.Fatal("accepted invalid override level")}
	empty,err:=ParseOverrides([]byte("overrides: [] # no changes\nschema: 'repo-ai/overrides/v1'\n"));if err!=nil||len(empty)!=0{t.Fatalf("empty overrides = %#v, %v",empty,err)}
}
