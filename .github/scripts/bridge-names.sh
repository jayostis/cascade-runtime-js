#!/usr/bin/env bash
# The Bridge's function names, for the CPU profiles of the perf job: bridge-names.sh <checkout> [<whose>]
#
# The profiles name the Bridge's Rust functions only if its wasm keeps its names, which the package does not (it would weigh
# more for every reader): the release the build was read from holds a second module, the same code with its names, and it is
# laid over the package's in <checkout>'s cache. The step runs before the headline timings, so they load the named module too
# (10.0 MB beside the package's, about 0.7 ms more to read and a compile of 18.4 ms against 18.5, noise against a 3.26 s
# total). The asset is checked against the digest GitHub computed when it was uploaded, which a transport error or a mix-up
# of assets fails; the script never fails the job, as a profile's names are an extra. A release made before the Bridge
# published one has none, and its profiles show wasm-function[N].
#
# <checkout> is a runtime checkout whose `npm run bridge` has run; <whose> is how the summary names whose Bridge it is (a
# pull request's own is not named). Main's measurement is given its module too, so that both sides of a comparison load the
# same kind of module.
set -euo pipefail
checkout=${1:?the runtime checkout}
whose=${2:-}
bridge=jayostis/cascade-bridge-rs
cache=$checkout/build/cache/cascade-bridge-rs
read -r from commit < <(node -p "const r = JSON.parse(require('fs').readFileSync('$cache/expected.json', 'utf8')); r.source + ' ' + r.commit")
tag="build-$commit"
if [ "$from" != release ]; then
  echo "::warning::the Bridge read${whose:+ by $whose} is a $from build, which has no function names: the profiles show wasm-function[N]"
  exit 0
fi
none() {
  echo "::warning::$1, so the profiles show wasm-function[N]"
  exit 0
}
if ! want=$(gh release view "$tag" -R "$bridge" --json assets -q '.assets[] | select(.name == "cascade_bridge_bg.names.wasm") | .digest'); then
  none "the assets of $tag could not be listed"
fi
[ -n "$want" ] || none "$tag holds no cascade_bridge_bg.names.wasm with a digest"
names="$RUNNER_TEMP/names-$commit"
if ! gh release download "$tag" -R "$bridge" --pattern cascade_bridge_bg.names.wasm --dir "$names"; then
  none "cascade_bridge_bg.names.wasm of $tag could not be downloaded"
fi
got=sha256:$(sha256sum "$names/cascade_bridge_bg.names.wasm" | cut -d' ' -f1)
[ "$got" = "$want" ] || none "cascade_bridge_bg.names.wasm of $tag is $got, where GitHub's digest of the asset is $want"
cp "$names/cascade_bridge_bg.names.wasm" "$cache/$tag/cascade_bridge_bg.wasm"
echo "The Bridge's wasm${whose:+ of $whose} is $tag's with its function names ($(du -h "$cache/$tag/cascade_bridge_bg.wasm" | cut -f1))." >> "$GITHUB_STEP_SUMMARY"
