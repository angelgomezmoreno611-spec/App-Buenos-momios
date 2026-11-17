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

# Avisos push solo si está la configuración de Firebase (ignorada por Git).
push=false
if [[ -f android/app/google-services.json ]]; then push=true; else
  echo "Aviso: sin android/app/google-services.json el APK no tendrá notificaciones." >&2
fi

"$flutter" build apk --release --target-platform android-arm64 \
  --build-name="$name" --build-number="$build" \
  --dart-define-from-file=config.local.json --dart-define=APP_BUILD="$build" --dart-define=ENABLE_PUSH="$push"

apk=build/app/outputs/flutter-apk/app-release.apk
out="build/buenos-momios-v$build.apk"
cp "$apk" "$out"
ls -lh "$out"

if "$publish"; then
  # Primero como borrador (la app ignora borradores); la subida del APK se reintenta
  # con límite de tiempo porque a veces se congela, y al final se publica.
  gh release create "app-v$build" --draft --title "App v$build" --notes "$notes"
  for try in 1 2 3; do
    timeout 300 gh release upload "app-v$build" "$out" --clobber && break
    [[ $try == 3 ]] && { echo "No se pudo subir el APK; el release app-v$build quedó como borrador" >&2; exit 1; }
    echo "Reintentando subida ($try)…"; sleep 5
  done
  gh release edit "app-v$build" --draft=false
  gh release view "app-v$build" --json url --jq .url
fi

# Si el teléfono está conectado por USB, se instala directo.
if [[ -x "$adb" ]] && "$adb" get-state >/dev/null 2>&1; then
  "$adb" install -r "$out"
fi
