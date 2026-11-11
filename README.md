# North Field CPF Trainer

Offline process simulator and operator trainer for a Central Processing Facility (CPF), packaged for Android.
App id: `com.northfield.cpftrainer`

## Get the APK (pick one)

1. **GitHub Actions (no Android tools needed).** Create a private GitHub repo, upload this whole folder, open the
   *Actions* tab, run **Build Android APK**, download the `cpf-simulator-apk` artifact, unzip, copy `app-debug.apk`
   to the phone and open it (allow "install unknown apps" for your file manager/browser once).
2. **Locally.** Install JDK 21 and the Android SDK (Android Studio does both), set `ANDROID_HOME`, then
   `bash scripts/build_apk.sh` → `dist/cpf-simulator-debug.apk`.
3. **Android Studio.** `npx cap open android`, then *Build > Build APK(s)*.
4. **Instantly, without an APK:** host the `www/` folder on any HTTPS site (GitHub Pages works), open it in Chrome on
   the phone and choose *Add to Home screen*. It then runs full-screen and offline.

## Check the model
`npm install && npm test` runs the headless regression (steady state + every scenario).

## Customise
Edit `www/js/config.js` (rates, vessel sizes, set-points), then re-run the build.

## iPhone (iOS)
The `ios/` project is generated. Building for a real iPhone needs a Mac with Xcode and an Apple Developer account
(free account = 7-day installs on your own phone; paid $99/yr = TestFlight/App Store):
1. `npm ci && npx cap sync ios && npx cap open ios`
2. In Xcode: App target > Signing & Capabilities > pick your Team; bundle id `com.northfield.cpftrainer`.
3. Plug in the iPhone > Run. The workflow `ios-simulator.yml` only builds an unsigned simulator app (compile check).
