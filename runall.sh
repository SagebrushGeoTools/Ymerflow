#!/bin/bash
set -e

cd "$(dirname "$0")"

if [ -f "config.env" ]; then
    source "config.env"
fi

DEPLOYMENT="${DEPLOYMENT:-development}"

if [ "$DEPLOYMENT" = "production-minikube" ]; then
    exec ./prod/runall-minikube.sh "$@"
else
    exec ./dev/runall.sh "$@"
fi
