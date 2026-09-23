#!/usr/bin/env python3
"""Project HTTPS MCP precedence and idempotent setup; no network."""
import importlib.util
import json
from pathlib import Path
import tempfile

def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

setup = module('configure-opencode')
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / 'opencode.json'
    path.write_text(json.dumps({'skills': ['./open-dungeon-master/.opencode/skills'], 'mcp': {'servers': {
        'odm': {'type': 'remote', 'url': 'https://old.invalid/mcp'},
        'dnd': {'type': 'local', 'command': ['existing-rag'], 'environment': {'KB_COLLECTION': 'dnd_srd'}},
    }}}))
    token_file = Path(directory) / 'mcp.token'
    setup.configure(directory, 'https://odm.example/mcp', token_file)
    first = path.read_bytes()
    setup.configure(directory, 'https://odm.example/mcp', token_file)
    assert path.read_bytes() == first
    config = json.loads(first); servers = config['mcp']['servers']
    assert 'odm' not in servers and len(config['skills']) == 1
    assert servers['odm_narrator']['type'] == 'remote'
    assert servers['odm_narrator']['url'] == 'https://odm.example/mcp'
    assert servers['odm_narrator']['oauth'] is False
    assert servers['odm_narrator']['headers']['Authorization'] == f'Bearer {{file:{token_file}}}'
    assert 'command' not in servers['odm_narrator']
    assert servers['dnd']['environment']['KB_COLLECTION'] == 'dnd_srd'
    assert all(servers[name]['disabled'] for name in ('kb', 'diptrace', 'fabric'))
    assert (Path(directory) / 'opencode.json.before-astra').exists()
    for url in ('http://odm.example/mcp', 'https://user:pass@odm.example/mcp', 'not-a-url'):
        try:
            setup.configure(directory, url, token_file)
        except ValueError:
            pass
        else:
            raise AssertionError('insecure or invalid MCP URL accepted')
benchmark = module('benchmark-opencode')
report = benchmark.summarize(10, {'outcome': 'succeeded', 'tokens': {'input': 20, 'cache': {'read': 30}}}, {
    'data': [{'type': 'assistant', 'providerState': 'private', 'content': [
        {'type': 'reasoning', 'text': 'private'},
        {'type': 'tool', 'name': 'odm_narrator_odm_narrator', 'state': {'status': 'completed',
         'input': {'operation': 'invoke', 'name': 'request_roll', 'token': 'private'}}},
    ]}],
})
assert report['inputIncludingCache'] == 50 and report['assistantSteps'] == report['toolCalls'] == 1
assert report['toolErrors'] == 0 and 'private' not in json.dumps(report)
print('PASS: project HTTPS MCP, preserved RAG, idempotence and sanitized metrics')
