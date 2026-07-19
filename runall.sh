#!/bin/bash
set -e

cd "$(dirname "$0")"

if [ -f "config.env" ]; then
    set -a
    source "config.env"
    set +a
fi

DEPLOYMENT="${DEPLOYMENT:-development}"

if [ "$DEPLOYMENT" = "production" ]; then
    exec ./prod/runall-production.sh "$@"
else
    exec ./dev/runall.sh "$@"
fi
