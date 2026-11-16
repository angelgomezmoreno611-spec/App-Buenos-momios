#!/usr/bin/env bash
# Compila el APK (arm64, release) con el siguiente número de versión y lo publica
# como release `app-vN` en GitHub; el botón "Actualizar" de la app lo descarga.
# Uso: tools/release-apk.sh "Qué cambió"   (--no-publish: solo compila e instala)
# Poca RAM: cierra el navegador antes; no ejecutes otra compilación en paralelo.
set -euo pipefail

cd "$(dirname "$0")/../mobile"
publish=true
if [[ "${1:-}" == "--no-publish" ]]; then publish=false; shift; fi
notes="${1:-Mejoras y correcciones.}"

export PUB_CACHE="${PUB_CACHE:-$HOME/.local/opt/pub-cache}"
flutter="${FLUTTER:-$HOME/.local/opt/flutter-3.35.7/bin/flutter}"
adb="$HOME/Android/Sdk/platform-tools/adb"
[[ -f config.local.json ]] || { echo "Falta mobile/config.local.json" >&2; exit 1; }

# Siguiente versión: la mayor app-vN publicada + 1 (empieza en 2; la v1 se instaló a mano).
last=$(gh release list --limit 100 --json tagName --jq '.[].tagName' | sed -n 's/^app-v\([0-9]\+\)$/\1/p' | sort -n | tail -1)
build=$(( ${last:-1} + 1 ))
name=$(sed -n 's/^version: *\([0-9.]*\).*/\1/p' pubspec.yaml)
echo "Compilando versión $name ($build)…"

"$flutter" build apk --release --target-platform android-arm64 \
  --build-name="$name" --build-number="$build" \
  --dart-define-from-file=config.local.json --dart-define=APP_BUILD="$build"

apk=build/app/outputs/flutter-apk/app-release.apk
out="build/buenos-momios-v$build.apk"
cp "$apk" "$out"
ls -lh "$out"

if "$publish"; then
  gh release create "app-v$build" "$out" --title "App v$build" --notes "$notes"
fi

# Si el teléfono está conectado por USB, se instala directo.
if [[ -x "$adb" ]] && "$adb" get-state >/dev/null 2>&1; then
  "$adb" install -r "$out"
fi
