#!/usr/bin/env bash
# Build a debug APK from a scaffolded project (run from the project root).
# Needs: JDK 21, Android SDK (ANDROID_HOME or ANDROID_SDK_ROOT), network to Google's Maven.
# No SDK? Push the project to GitHub instead: .github/workflows/android-apk.yml builds the APK in the cloud.
set -euo pipefail
cd "$(dirname "$0")/.." 2>/dev/null || true
[ -f capacitor.config.json ] || { echo "Run from the scaffolded project root (capacitor.config.json not found)"; exit 2; }
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  echo "NO_ANDROID_SDK: set ANDROID_HOME, or use the GitHub Actions workflow (see README.md)."; exit 3
fi
command -v java >/dev/null || { echo "NO_JAVA: install JDK 21"; exit 3; }
npm install --no-audit --no-fund
npx cap sync android
echo "sdk.dir=$SDK" > android/local.properties
( cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon )
APK=android/app/build/outputs/apk/debug/app-debug.apk
mkdir -p dist && cp "$APK" dist/cpf-simulator-debug.apk
echo "APK ready: dist/cpf-simulator-debug.apk"
