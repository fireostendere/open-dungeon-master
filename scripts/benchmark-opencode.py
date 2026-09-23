#!/usr/bin/env python3
"""Measure a real DnD Edition turn against serve-opencode-benchmark.mjs (paid model calls)."""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def summarize(wall_ms, session, context):
    messages = [m for m in context['data'] if m.get('type') == 'assistant']
    calls = []
    for message in messages:
        for part in message.get('content', []):
            if part.get('type') != 'tool':
                continue
            state = part.get('state', {})
            args = state.get('input', {})
            calls.append({'tool': part.get('name'), 'operation': args.get('operation'),
                          'action': args.get('name') or args.get('action'), 'status': state.get('status')})
    tokens = session.get('tokens', {})
    return {'wallMs': wall_ms, 'outcome': session.get('outcome'), 'model': session.get('model'),
            'assistantSteps': len(messages), 'toolCalls': len(calls),
            'toolErrors': sum(c['status'] == 'error' for c in calls), 'tokens': tokens,
            'inputIncludingCache': tokens.get('input', 0) + tokens.get('cache', {}).get('read', 0),
            'calls': calls}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--custom-opencode', type=Path, required=True)
    parser.add_argument('--campaign', choices=['baseline', 'optimized'], default='optimized')
    parser.add_argument('--model', default='gpt-6-dnd-edition')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    state = json.loads(args.state.read_text())
    campaign = next(c for c in state['campaigns'] if c['label'] == args.campaign)
    template = json.loads((args.custom_opencode / 'config/opencode.json.template').read_text().replace('__RAG_DISABLED__', 'true'))
    service_config = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'opencode/service.json'
    service = json.loads(service_config.read_text())
    base = subprocess.check_output(['opencode2', 'service', 'status'], text=True).strip()
    headers = {'Authorization': 'Basic ' + base64.b64encode(('opencode:' + service['password']).encode()).decode(),
               'Content-Type': 'application/json'}

    def api(method, path, body=None):
        with urlopen(Request(base + path, method=method, headers=headers,
                             data=None if body is None else json.dumps(body).encode()), timeout=90) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    with tempfile.TemporaryDirectory(prefix='odm-opencode-benchmark-') as temporary:
        project = Path(temporary)
        servers = {name: {'type': 'local', 'command': ['false'], 'disabled': True}
                   for name in ['kb', 'diptrace', 'fabric', 'dnd', 'odm', 'odm-ui-test']}
        servers['odm_narrator'] = {
            'type': 'local', 'command': ['node', '--import', str(root / 'mcp/external-tools-preload.mjs'), str(root / 'mcp/server.mjs'), '--stdio'],
            'cwd': str(root), 'environment': {'ODM_MCP_TOKEN': state['token'], 'ODM_MCP_CONTROL_URL': state['url']},
            'codemode': False, 'timeout': {'startup': 30000, 'catalog': 10000, 'execution': 30000},
        }
        path = project / 'opencode.json'
        path.write_text(json.dumps({'mcp': {'servers': servers}, 'skills': [str(root / '.opencode/skills')],
                                    'agents': {k: v for k, v in template['agents'].items() if k.startswith('dnd-')}}))
        path.chmod(0o600)
        session = api('POST', '/api/session', {'title': 'Disposable local DnD benchmark',
                      'location': {'directory': str(project)}, 'agent': 'dnd-narrator',
                      'model': {'providerID': 'openai', 'id': args.model}})['data']
        sid = session['id']
        prompt = f'''Это операторский запуск одноразовой ЛОКАЛЬНОЙ тестовой кампании {campaign['id']}, герой Торин {campaign['characterId']}. Проведи ровно один игровой ход через ODM MCP и заверши работу. Заявка игрока: «Я осматриваю запертый сундук у двери трактира, ищу следы ловушки». Прочитай актуальное состояние, назначь проверку perception DC 12 через request_roll, дождись подтверждённого серверного результата и опубликуй короткое повествование в кампанию (до 60 слов), затем верни управление игроку, если это необходимо. Все кости и состояние только через сервер. Не начинай фоновое ожидание следующей реплики. В финале кратко назови выполненные действия.'''
        started = time.perf_counter()
        try:
            api('POST', f'/api/session/{sid}/prompt', {'text': prompt, 'files': []})
            while time.perf_counter() - started < 180:
                time.sleep(.5)
                session = api('GET', f'/api/session/{sid}')['data']
                if session.get('time', {}).get('idle'):
                    break
            else:
                raise TimeoutError('DnD turn did not finish within 180 seconds')
            wall_ms = round((time.perf_counter() - started) * 1000)
            report = summarize(wall_ms, session, api('GET', f'/api/session/{sid}/context'))
            args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
            print(json.dumps(report, ensure_ascii=False))
            assert session.get('outcome') == 'succeeded', 'Model did not complete the turn'
        finally:
            api('POST', f'/api/session/{sid}/interrupt?continue=false', {})
            query = urlencode({'location[directory]': str(project)})
            api('POST', '/api/mcp/odm_narrator/disconnect?' + query, {})


if __name__ == '__main__':
    main()
