#!/usr/bin/env bash
# Publie une Release GitHub avec les binaires téléchargeables (dist/).
# Nécessite un token GitHub (scope "repo") :
#
#   GITHUB_TOKEN=ghp_xxx bash scripts/publish-release.sh
#
set -euo pipefail
exec node "$(dirname "$0")/publish-release.js"
