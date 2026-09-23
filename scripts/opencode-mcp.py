#!/usr/bin/env python3
"""Connect OpenCode to the active managed ODM sidecar over one SSH stdio session."""
import argparse
import os
import shlex

# Resolve the active container on every connection; deployment names are not stable.
REMOTE = "import json,os,subprocess; s=json.loads(subprocess.check_output(['odm-mcpctl','status'])); assert s['running'], 'ODM MCP is stopped'; c=s['stdioCommand']; os.execvp(c[0],c)"

def command(target):
    if not target or target.startswith('-') or any(c.isspace() for c in target):
        raise ValueError('SSH target must be a single host or user@host')
    return ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
            target, 'exec python3 -c ' + shlex.quote(REMOTE)]

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ssh-target', required=True)
    args = parser.parse_args()
    argv = command(args.ssh_target)
    os.execvp(argv[0], argv)
