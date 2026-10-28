#!/usr/bin/env bash
set -euo pipefail

artifact_directory="$1"
publication_directory="$2"
source_commit="$3"
publication_branch="$4"

test -f "$artifact_directory/index.html"
test -f "$artifact_directory/agent/latest.json"
test -e "$publication_directory/.git"

rsync -a --delete --exclude='.git' "$artifact_directory/" "$publication_directory/"
touch "$publication_directory/.nojekyll"
git -C "$publication_directory" add --all
if git -C "$publication_directory" diff --cached --quiet; then
  printf 'Documentation files are unchanged.\n'
else
  git -C "$publication_directory" commit -m "docs: publish source $source_commit"
fi
git -C "$publication_directory" push origin "HEAD:$publication_branch"
