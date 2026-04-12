#!/bin/sh
# Runs before nginx starts (via /docker-entrypoint.d/).
# If the headlamp SA token is mounted, write a proxy_set_header directive so
# nginx forwards it to Headlamp, enabling auto-authentication.
TOKEN_FILE=/etc/nginx/headlamp-token/token
OUTPUT=/tmp/headlamp-token.conf
if [ -f "$TOKEN_FILE" ] && [ -s "$TOKEN_FILE" ]; then
    printf 'proxy_set_header X-Headlamp-Token "%s";\n' "$(cat "$TOKEN_FILE")" > "$OUTPUT"
    echo "30-headlamp-token: token header configured"
else
    printf '# headlamp token not mounted\n' > "$OUTPUT"
    echo "30-headlamp-token: token not mounted, headlamp will require manual login"
fi
