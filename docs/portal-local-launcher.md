# Trusted local portal startup

Public and managed server deployments leave `ODM_LOCAL_PORTAL` unset. Browser
cookies never enable this mode or choose its destination. A dedicated trusted
local process must pin both the origin and bearer before starting the server.

The repository now provides that launcher:

```sh
npm ci
npm run build
npm run start:portal -- --origin https://game.example.org --token-file /private/portal.token --port 3007
```

For a development checkout add `--dev` instead of running a production build.
Use an existing private bearer-token file; do not paste the token into command
arguments. On POSIX it must belong to the launching user with no group/other
permissions (for example mode 600). On Windows keep it in a directory protected
by the user's ACL. The launcher reads at most 1025 bytes, refuses invalid tokens,
never prints their contents, and uses an argv array rather than a shell command.

The child always receives `--hostname 127.0.0.1`, an explicit local port,
`ODM_LOCAL_PORTAL=1`, the canonical `ODM_PORTAL_ORIGIN`, and `ODM_PORTAL_TOKEN`.
Inherited values for those pins cannot override the selected target. Self-forwarding
to the local listening port is refused. This is not a public proxy and must not be
placed behind an externally accessible reverse proxy.

## Native-client contract

The existing native shell still provisions `odm_portal_origin` and
`odm_portal_token` cookies on its local origin. They must match the pinned target
and bearer. The launcher does not make an arbitrary browser logged in, print a
login link containing credentials, or install an unauthenticated HTTP endpoint
that hands out its bearer. A native shell can invoke this CLI or import
`portalLaunchSpec`/`launchPortal` and provide the same privately stored credential.
Switching hosts means restarting with the new pins and updating the client cookies.
Logout clears the client cookies and disables forwarding until those credentials
are provisioned again. Visiting a public server with forged portal cookies does
not change that server's configuration.

## Verification

`node --test scripts/test-review-portal-launch.mjs` checks option parsing, private
files, credential/origin matching, default-off behavior, loopback binding, and an
actual child process receiving the pins. Nine checks passed in the review workspace.
The child fixture is not Next: this does not claim native-app packaging or a full
Next network rewrite/browser acceptance run.
