// Package config parses the strict, local repo-ai configuration documents.
package config

import (
	"bufio"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type Config struct {
	Schema string
	Policy string
}

type Override struct {
	ID          string `json:"id"`
	Level       string `json:"level,omitempty"`
	Requirement string `json:"requirement,omitempty"`
	Reason      string `json:"reason,omitempty"`
}

func scalar(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" { return "", fmt.Errorf("empty scalar") }
	value = stripComment(value)
	value = strings.TrimSpace(value)
	if value[0] == '"' {
		parsed, err := strconv.Unquote(value)
		if err != nil { return "", err }
		return parsed, nil
	}
	if value[0] == '\'' {
		if len(value) < 2 || value[len(value)-1] != '\'' { return "", fmt.Errorf("unterminated quoted scalar") }
		return strings.ReplaceAll(value[1:len(value)-1], "''", "'"), nil
	}
	if strings.ContainsAny(value, "{}[]&*!|>%@`") || strings.Contains(value, ": ") { return "", fmt.Errorf("unsupported scalar syntax") }
	if i := strings.Index(value, " #"); i >= 0 { value = strings.TrimSpace(value[:i]) }
	if value == "" { return "", fmt.Errorf("empty scalar") }
	return value, nil
}

func stripComment(value string) string {
	quote := rune(0)
	escaped := false
	runes := []rune(value)
	for i, r := range runes {
		if quote == '"' && escaped { escaped=false; continue }
		if quote == '"' && r == '\\' { escaped=true; continue }
		if quote != 0 {
			if r == quote {
				if quote == '\'' && i+1<len(runes) && runes[i+1]=='\'' { continue }
				quote=0
			}
			continue
		}
		if r=='"' || r=='\'' { quote=r; continue }
		if r=='#' && i>0 && (runes[i-1]==' ' || runes[i-1]=='\t') { return string(runes[:i]) }
	}
	return value
}

func mapping(data []byte) (map[string]string, error) {
	values := make(map[string]string)
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for line := 1; scanner.Scan(); line++ {
		s := strings.TrimSpace(scanner.Text())
		if s == "" || strings.HasPrefix(s, "#") { continue }
		key, raw, ok := strings.Cut(s, ":")
		if !ok { return nil, fmt.Errorf("line %d: expected key and scalar value", line) }
		key = strings.TrimSpace(key)
		if key == "" || strings.ContainsAny(key, " \t") { return nil, fmt.Errorf("line %d: invalid key", line) }
		if _, exists := values[key]; exists { return nil, fmt.Errorf("line %d: duplicate key %q", line, key) }
		value, err := scalar(raw)
		if err != nil { return nil, fmt.Errorf("line %d: %w", line, err) }
		values[key] = value
	}
	if err := scanner.Err(); err != nil { return nil, err }
	return values, nil
}

func Parse(data []byte) (Config, error) {
	values, err := mapping(data)
	if err != nil { return Config{}, err }
	keys:=make([]string,0,len(values));for key:=range values{keys=append(keys,key)};sort.Strings(keys)
	for _,key := range keys { if key != "schema" && key != "policy" { return Config{}, fmt.Errorf("unsupported config field %q", key) } }
	if values["schema"] != "repo-ai/config/v1" { return Config{}, fmt.Errorf("unsupported config schema %q", values["schema"]) }
	if values["policy"] != "core" { return Config{}, fmt.Errorf("invalid policy reference %q", values["policy"]) }
	return Config{Schema: values["schema"], Policy: values["policy"]}, nil
}

func ParseOverrides(data []byte) ([]Override, error) {
	var result []Override
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	seenSchema, seenOverrides, emptyOverrides := false, false, false
	var current *Override
	fields := map[string]bool{}
	for i, raw := range lines {
		line := strings.TrimSpace(stripComment(raw))
		if line == "" || strings.HasPrefix(line, "#") { continue }
		if len(raw)>0 && raw[0]!=' ' && raw[0]!='\t' {
			key,valueRaw,ok:=strings.Cut(line,":")
			if !ok{return nil,fmt.Errorf("line %d: expected root mapping",i+1)}
			key=strings.TrimSpace(key)
			switch key {
			case "schema":
				if seenSchema{return nil,fmt.Errorf("line %d: duplicate schema",i+1)}
				value, err := scalar(valueRaw)
			if err != nil || value != "repo-ai/overrides/v1" { return nil, fmt.Errorf("line %d: unsupported override schema", i+1) }
			seenSchema = true
			case "overrides":
				if seenOverrides{return nil,fmt.Errorf("line %d: duplicate overrides",i+1)}
				value:=strings.TrimSpace(valueRaw)
				if value!=""&&value!="{}"&&value!="[]"{return nil,fmt.Errorf("line %d: overrides must be a list or empty map",i+1)}
				seenOverrides=true;emptyOverrides=value=="{}"||value=="[]"
			default:return nil,fmt.Errorf("line %d: unsupported override field %q",i+1,key)
			}
			continue
		}
		if !seenOverrides { return nil, fmt.Errorf("line %d: expected overrides", i+1) }
		if emptyOverrides{return nil,fmt.Errorf("line %d: entries cannot follow empty overrides map",i+1)}
		if strings.HasPrefix(raw, "  - ") {
			result = append(result, Override{})
			current = &result[len(result)-1]
			fields = map[string]bool{}
			line = strings.TrimSpace(strings.TrimPrefix(raw, "  - "))
		} else if current == nil || !strings.HasPrefix(raw, "    ") {
			return nil, fmt.Errorf("line %d: invalid override indentation", i+1)
		}
		key, valueRaw, ok := strings.Cut(line, ":")
		if !ok { return nil, fmt.Errorf("line %d: expected override key and value", i+1) }
		key = strings.TrimSpace(key)
		if fields[key] { return nil, fmt.Errorf("line %d: duplicate override field %q", i+1, key) }
		value, err := scalar(valueRaw)
		if err != nil { return nil, fmt.Errorf("line %d: %w", i+1, err) }
		fields[key] = true
		switch key {
		case "id": current.ID = value
		case "level": current.Level = value
		case "requirement": current.Requirement = value
		case "reason": current.Reason = value
		default: return nil, fmt.Errorf("line %d: unsupported override field %q", i+1, key)
		}
	}
	if !seenSchema || !seenOverrides { return nil, fmt.Errorf("missing override schema or overrides") }
	if len(result) == 0 { return []Override{}, nil }
	for i, override := range result {
		if strings.TrimSpace(override.ID) == "" {
			return nil, fmt.Errorf("override %d is missing required id", i+1)
		}
		if override.Level != "" && override.Level != "guidance" && override.Level != "check" && override.Level != "enforce" {
			return nil, fmt.Errorf("override %s has invalid level %q", override.ID, override.Level)
		}
	}
	return result, nil
}
