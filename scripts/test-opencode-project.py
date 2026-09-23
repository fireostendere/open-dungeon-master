#!/usr/bin/env python3
"""Project MCP precedence, idempotent setup and safe SSH argv; no network."""
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
bridge = module('opencode-mcp')
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / 'opencode.json'
    path.write_text(json.dumps({'skills': ['./open-dungeon-master/.opencode/skills'], 'mcp': {'servers': {
        'odm': {'type': 'remote', 'url': 'https://old.invalid/mcp'},
        'dnd': {'type': 'local', 'command': ['existing-rag'], 'environment': {'KB_COLLECTION': 'dnd_srd'}},
    }}}))
    setup.configure(directory, 'user@odm.example')
    first = path.read_bytes()
    setup.configure(directory, 'user@odm.example')
    assert path.read_bytes() == first
    config = json.loads(first); servers = config['mcp']['servers']
    assert 'odm' not in servers and len(config['skills']) == 1
    assert servers['odm_narrator']['command'][-1] == 'user@odm.example'
    assert servers['dnd']['environment']['KB_COLLECTION'] == 'dnd_srd'
    assert all(servers[name]['disabled'] for name in ('kb', 'diptrace', 'fabric'))
    assert (Path(directory) / 'opencode.json.before-astra').exists()
for target in ('-oProxyCommand=bad', 'user@host extra', ''):
    try:
        bridge.command(target)
    except ValueError:
        pass
    else:
        raise AssertionError('invalid SSH target accepted')
assert 'odm-mcpctl' in bridge.command('user@odm.example')[-1]
assert 'odm-' not in ' '.join(bridge.command('user@odm.example')[:-1])
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
print('PASS: project configuration, preserved RAG, idempotence, dynamic sidecar, SSH argv and sanitized metrics')
