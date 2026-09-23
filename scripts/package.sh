#!/usr/bin/env bash
# ViewDigest - Chrome 웹 스토어 업로드용 zip을 만든다.
#
#   scripts/package.sh            → dist/viewdigest-<버전>.zip
#
# 버전은 manifest.json에서 읽는다. 스토어는 게시된 것보다 높은 버전만 받으므로,
# 게시할 때마다 붙이는 git 태그(v1.0.0 …) 중 가장 높은 것보다 버전이 낮거나 같으면
# 여기서 먼저 멈춘다. 대시보드에서 업로드가 거부되고 나서야 알게 되는 일을 막기 위해서다.
# 필요한 도구: bash, zip, (선택) git.

set -euo pipefail

cd "$(dirname "$0")/.."

# 확장프로그램 실행에 필요한 것만 담는다. docs/, *.md, scripts/는 넣지 않는다.
# 최상위에 새 파일·폴더를 추가했다면 여기에도 추가해야 한다. 빠뜨리면 아래의
# 참조 검사가 잡아낸다.
INCLUDE=(manifest.json background.js content.js _locales icons popup options results utils)

fail() { echo "✗ $*" >&2; exit 1; }
warn() { echo "! $*" >&2; }

command -v zip >/dev/null || fail "zip 명령이 없습니다. (macOS/Linux 기본 포함, Windows는 WSL 또는 Git Bash + zip 필요)"

for path in "${INCLUDE[@]}"; do
  [ -e "$path" ] || fail "패키지에 넣을 '$path'가 없습니다."
done

# ── 버전 ────────────────────────────────────────────────────────────────
version=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
[ -n "$version" ] || fail "manifest.json에서 version을 찾지 못했습니다."

# Chrome 규칙: 점으로 구분한 정수 1~4개, 각 0~65535, 0이 아닌 수는 0으로 시작하지 않음.
[[ "$version" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]] || fail "version \"$version\" 형식이 잘못됐습니다. 예: 1.0.1"
IFS=. read -r -a parts <<<"$version"
for part in "${parts[@]}"; do
  [[ "$part" == 0 || "$part" != 0* ]] || fail "version \"$version\": 0으로 시작하는 숫자는 쓸 수 없습니다."
  (( part <= 65535 )) || fail "version \"$version\": 각 숫자는 65535 이하여야 합니다."
done

# a > b 이면 참. 빈 자리는 0으로 본다(1.0 == 1.0.0).
version_gt() {
  local IFS=.
  local -a a=($1) b=($2)
  local i
  for i in 0 1 2 3; do
    local x=${a[i]:-0} y=${b[i]:-0}
    (( 10#$x > 10#$y )) && return 0
    (( 10#$x < 10#$y )) && return 1
  done
  return 1
}

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  latest=""
  while read -r tag; do
    candidate=${tag#v}
    [[ "$candidate" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]] || continue
    if [ -z "$latest" ] || version_gt "$candidate" "$latest"; then latest=$candidate; fi
  done < <(git tag -l 'v*')

  if [ -n "$latest" ] && ! version_gt "$version" "$latest"; then
    fail "manifest.json의 version($version)이 이미 게시한 v$latest보다 높지 않습니다. 스토어가 업로드를 거부합니다. manifest.json의 version을 올리세요."
  fi

  # 커밋되지 않은 변경이 zip에 섞이면, 나중에 게시된 코드가 어느 커밋인지 알 수 없다.
  if [ -n "$(git status --porcelain -- "${INCLUDE[@]}")" ]; then
    warn "커밋하지 않은 변경이 패키지에 포함됩니다:"
    git status --short -- "${INCLUDE[@]}" >&2
  fi
else
  warn "git 저장소가 아니어서 게시된 버전과 비교하지 못했습니다."
fi

# ── 스테이징 ────────────────────────────────────────────────────────────
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

cp -R "${INCLUDE[@]}" "$staging/"
find "$staging" \( -name '.DS_Store' -o -name 'Thumbs.db' -o -name '*.swp' -o -name '*~' \) -delete

# 패키지 안의 파일이 가리키는 상대 경로(manifest의 아이콘·스크립트, HTML의 src/href,
# JS의 import)가 모두 패키지 안에 있는지 확인한다. INCLUDE에서 빠진 파일이 있으면
# 스토어에서는 확장프로그램이 깨진 채로 게시되기 때문이다.
missing=()
check_ref() { # <참조하는 파일> <상대 경로>
  local from=$1 ref=$2
  case "$ref" in http:* | https:* | data:* | chrome:* | //* | \#* | "") return ;; esac
  ref=${ref%%[?#]*}
  local base
  if [ "$from" = "$staging/manifest.json" ]; then base=$staging; else base=$(dirname "$from"); fi
  [ -e "$base/$ref" ] || missing+=("${from#"$staging"/} → $ref")
}

while read -r ref; do
  check_ref "$staging/manifest.json" "$ref"
done < <(grep -oE '"[^"]+\.(js|html|css|png|json)"' "$staging/manifest.json" | tr -d '"')

while IFS= read -r -d '' file; do
  while read -r ref; do
    check_ref "$file" "$ref"
  done < <(grep -oE '(src|href)="[^"]*"' "$file" | sed -E 's/^[a-z]+="(.*)"$/\1/')
done < <(find "$staging" -name '*.html' -print0)

while IFS= read -r -d '' file; do
  while read -r ref; do
    check_ref "$file" "$ref"
  done < <(grep -oE '(from|import)[[:space:]]*\(?[[:space:]]*["'"'"']\.{1,2}/[^"'"'"']+["'"'"']' "$file" \
           | sed -E 's/.*["'"'"'](\.{1,2}\/[^"'"'"']+)["'"'"']$/\1/')
done < <(find "$staging" -name '*.js' -print0)

while IFS= read -r -d '' file; do
  while read -r ref; do
    check_ref "$file" "$ref"
  done < <(grep -oE 'url\([^)]*\)' "$file" | sed -E 's/^url\(["'"'"']?([^"'"'"')]*)["'"'"']?\)$/\1/')
done < <(find "$staging" -name '*.css' -print0)

# manifest의 __MSG_키__ 문구는 default_locale의 messages.json에 있어야 한다.
# 없으면 Chrome이 확장프로그램을 아예 불러오지 않는다.
default_locale=$(sed -n 's/^[[:space:]]*"default_locale"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$staging/manifest.json" | head -n 1)
if [ -n "$default_locale" ]; then
  messages="$staging/_locales/$default_locale/messages.json"
  if [ ! -f "$messages" ]; then
    missing+=("manifest.json → _locales/$default_locale/messages.json")
  else
    while read -r key; do
      grep -q "\"$key\"[[:space:]]*:" "$messages" || missing+=("manifest.json → __MSG_${key}__ (_locales/$default_locale/messages.json)")
    done < <(grep -oE '__MSG_[A-Za-z0-9_]+__' "$staging/manifest.json" | sed -E 's/^__MSG_(.*)__$/\1/' | sort -u)
  fi
fi

if [ ${#missing[@]} -gt 0 ]; then
  echo "✗ 패키지에 없는 파일을 참조합니다. 경로 오타이거나, 위 INCLUDE에서 빠진 파일입니다:" >&2
  printf '    %s\n' "${missing[@]}" | sort -u >&2
  exit 1
fi

# ── zip ────────────────────────────────────────────────────────────────
mkdir -p dist
out="dist/viewdigest-$version.zip"
rm -f "$out" # zip은 기존 파일에 덧붙이므로, 지난번 zip에 있던 파일이 남지 않게 지운다.
(cd "$staging" && zip -qrX "$OLDPWD/$out" .)

count=$(cd "$staging" && find . -type f | wc -l | tr -d ' ')
size=$(wc -c <"$out" | tr -d ' ')
echo "✓ $out  (파일 ${count}개, $((size / 1024)) KB, version $version)"
