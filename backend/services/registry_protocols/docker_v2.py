"""docker-v2 protocol handler — wraps the self-hosted Docker Registry v2 that
`dev/setup-registry.sh` deploys inside Minikube (namespace `registry`, NodePort 30500,
self-signed TLS, htpasswd basic auth). This is core's only registry protocol; any other protocol
(e.g. Google Artifact Registry) is a plugin's job — see docs/plans/registry-backend-hooks.md.

`RegistryBackend.config` shape for this protocol:
    {
        "user": "...",       # htpasswd basic-auth username
        "password": "...",   # htpasswd basic-auth password
        "host": "...",       # bare host/IP, no scheme or port (config.env REGISTRY_PUBLIC_HOST)
        "port": 30500,       # NodePort dev/setup-registry.sh publishes the registry on
    }

Every method here is genuinely per-backend-parametrized: it reads `config` (this specific
backend's connection info) rather than global `settings` — same pattern
`storage_protocols/minio.py` follows. `image_url`/`pull_credentials`/`configure_push_auth`/
`test_connection` all take `config` explicitly (no held instance state), consistent with every
other ABC method here and with how `StorageProtocolHandler`/`ClusterProvider` handlers are
called — `get_registry_protocol_handler()` hands back a fresh, stateless instance each time.

Self-signed TLS (Level A: encrypt, skip server-identity verification — see
docs/plans/done/self-signed-tls-minio-registry.md) is a `docker-v2`-specific concern: the CA-
fetch logic lives here (`fetch_ca_pem`), adapted from `backend/routers/admin.py`'s
`_fetch_registry_ca_pem`. Nothing in the ABC has any concept of CA pinning — a protocol that
doesn't need it (a real managed registry with a CA-issued cert) simply never implements anything
resembling this. NOTE: `admin.py`'s own `_fetch_registry_ca_pem` and its callers are left as-is
in Phase 1 (not rewired to call into this handler yet) — that migration is a later phase's
concern; this module's `fetch_ca_pem` is a Phase-1-scoped adaptation for this handler's own use
(and future callers, once Phase 2+ wires push/pull through this handler)."""
import ssl
import subprocess
import urllib.request
import urllib.error
import asyncio

from backend.services.registry_protocols import RegistryProtocolHandler

DEFAULT_PORT = 30500


def _host_port(config: dict) -> tuple:
    host = config.get("host")
    if not host:
        raise ValueError("docker-v2 registry config is missing 'host'")
    port = config.get("port", DEFAULT_PORT)
    return host, port


class DockerV2ProtocolHandler(RegistryProtocolHandler):
    def image_url(self, config: dict, repository: str, tag: str) -> str:
        host, port = _host_port(config)
        return f"{host}:{port}/{repository}:{tag}"

    async def pull_credentials(self, config: dict) -> dict:
        # Static htpasswd credential — never expires (expires_at=None means "reuse the
        # pod-launch-time value", see Design decision 4 in
        # docs/plans/registry-backend-hooks.md), no minting/refresh needed.
        return {
            "username": config.get("user"),
            "password": config.get("password"),
            "expires_at": None,
        }

    def configure_push_auth(self, config: dict) -> None:
        """`docker login host:port -u user --password-stdin` — preserves today's
        docker/build.sh behavior (see that file's `docker login "${REGISTRY_URL}" -u
        "${REGISTRY_USER}" --password-stdin` line). Phase 1 only builds this handler method;
        docker/build.sh itself is not rewired to call it until Phase 2."""
        host, port = _host_port(config)
        password = config.get("password", "")
        subprocess.run(
            ["docker", "login", f"{host}:{port}", "-u", config.get("user", ""), "--password-stdin"],
            input=password.encode(),
            check=True,
        )

    async def test_connection(self, config: dict) -> None:
        """Validate connectivity/credentials by hitting the registry's v2 API root with basic
        auth. The registry's cert is self-signed (Level A TLS — encrypt, skip server-identity
        verification), so certificate verification is intentionally disabled here, same as
        fetch_ca_pem's raw TLS handshake below."""
        host, port = _host_port(config)
        url = f"https://{host}:{port}/v2/"
        request = urllib.request.Request(url)
        user = config.get("user", "")
        password = config.get("password", "")
        if user or password:
            import base64
            auth = base64.b64encode(f"{user}:{password}".encode()).decode()
            request.add_header("Authorization", f"Basic {auth}")

        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        def _do_request():
            try:
                with urllib.request.urlopen(request, timeout=10, context=ctx) as resp:
                    resp.read()
            except urllib.error.HTTPError as e:
                # A registry that reaches the v2 API and rejects credentials is reachable but
                # misconfigured/misauthenticated — surface that distinctly from a network failure.
                raise RuntimeError(f"docker-v2 registry at {host}:{port} rejected the request: HTTP {e.code}") from e
            except urllib.error.URLError as e:
                raise RuntimeError(f"Could not reach docker-v2 registry at {host}:{port}: {e.reason}") from e

        await asyncio.to_thread(_do_request)

    def bootstrap(self, config: dict) -> dict:
        """Passthrough — there is nothing to provision, the registry server itself is stood up
        by dev/setup-registry.sh, not by this hook (see Design decision 3 in
        docs/plans/registry-backend-hooks.md)."""
        return config

    def fetch_ca_pem(self, config: dict) -> str:
        """The registry's self-signed cert IS its own CA (Level A TLS — see
        docs/plans/done/self-signed-tls-minio-registry.md), so we can just fetch whatever cert
        it presents live over TLS rather than needing filesystem/Secret access to wherever
        dev/setup-registry.sh happened to persist it. Adapted from
        backend/routers/admin.py's `_fetch_registry_ca_pem`, which is left in place untouched for
        now — full migration of its callers onto this handler is a later phase's concern."""
        host, port = _host_port(config)
        return ssl.get_server_certificate((host, port))
