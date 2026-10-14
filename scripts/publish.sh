#!/usr/bin/env bash
# 사이트 다시 만들고 GitHub Pages에 올리기. docs/(기획안·내부 분석)는 공개 저장소에 올리지 않는다 (.gitignore).
# 사용: bash scripts/publish.sh "커밋 메시지"
set -euo pipefail
cd "$(dirname "$0")/.."
MSG="${1:-사이트 갱신}"
.venv/Scripts/python.exe scripts/export_site.py
git add -A
git commit -q -m "$MSG" || true
git fetch -q origin
git checkout -q -b pub origin/main
git read-tree -u --reset main
git commit -q -m "$MSG" || true
git push -q origin pub:main
git subtree split -q --prefix site -b ghp
git push -q origin ghp:gh-pages
git checkout -q main
git branch -D pub ghp >/dev/null
echo "배포 완료: https://eunsik3451.github.io/sleeping-deposit/ (반영까지 1~2분)"
