#!/usr/bin/env python3
"""Install project-scoped HTTPS ODM MCP without copying tokens into config."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

def configure(workspace, url, token_file=None):
    endpoint = urlsplit(url)
    if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
        raise ValueError('ODM MCP URL must be an absolute HTTPS URL without credentials or query')
    token_file = str(Path(token_file).expanduser().resolve()) if token_file else '~/.config/odm/mcp.token'
    workspace = Path(workspace).resolve()
    path = workspace / 'opencode.json'
    config = json.loads(path.read_text()) if path.exists() else {}
    config.setdefault('$schema', 'https://opencode.ai/config.json')
    config['skills'] = list(dict.fromkeys([*[item for item in config.get('skills', []) if item != './open-dungeon-master/.opencode/skills'], str(ROOT / '.opencode/skills')]))
    servers = config.setdefault('mcp', {}).setdefault('servers', {})
    servers.pop('odm', None)  # Retired duplicate /mcp endpoint.
    servers['odm_narrator'] = {
        'type': 'remote', 'url': url, 'oauth': False,
        'headers': {'Authorization': f'Bearer {{file:{token_file}}}'},
        'disabled': False, 'codemode': False,
        'timeout': {'startup': 30000, 'catalog': 15000, 'execution': 150000},
    }
    for name in ('kb', 'diptrace', 'fabric'):
        servers.setdefault(name, {'type': 'local', 'command': ['false']})['disabled'] = True
    if 'dnd' in servers:
        servers['dnd']['codemode'] = False
    if 'odm-ui-test' in servers:
        servers['odm-ui-test']['cwd'] = str(ROOT)
        servers['odm-ui-test']['command'] = ['node', str(ROOT / 'tests/ui-mcp/server.mjs')]
    text = json.dumps(config, ensure_ascii=False, indent=2) + '\n'
    if path.exists() and path.read_text() == text:
        return
    if path.exists():
        backup = path.with_name('opencode.json.before-astra')
        if not backup.exists():
            backup.write_bytes(path.read_bytes())
            backup.chmod(0o600)
    temporary = path.with_name('opencode.json.tmp')
    temporary.write_text(text)
    os.replace(temporary, path)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--mcp-url', default='https://api.iroslyakov.com/mcp')
    parser.add_argument('--token-file', type=Path)
    args = parser.parse_args()
    configure(args.workspace, args.mcp_url, args.token_file)
    print('Project MCP configured:', args.workspace / 'opencode.json')
