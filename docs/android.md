# Android アプリ（試作）

気圧センサーなど、ブラウザでは読めないセンサーを使うための Android アプリ。中身は公開中の Web アプリ（Vercel）をそのまま読み込み、アプリ側では気圧センサーだけを足している（Capacitor）。申請は要らず、APK をスマホに入れて使う。

## 作り方（Windows）
1. JDK 21（Eclipse Temurin）と Android SDK（コマンドラインツール、platforms/android-36、build-tools）を入れる
2. `android/local.properties` に `sdk.dir=C:/Users/<名前>/android-dev/sdk`（公開しない）
3. ビルド
   ```powershell
   $env:JAVA_HOME = "C:\Users\<名前>\android-dev\jdk"
   npx cap sync android
   cd android; .\gradlew.bat assembleDebug
   ```
4. `android/app/build/outputs/apk/debug/app-debug.apk` をスマホに送り、開いて入れる（「提供元不明のアプリ」を許可）

開発中のサーバーを読ませるときは、`CAP_SERVER_URL=http://<PC の IP>:3000 npx cap sync android` のあとでビルドする。

## 中身
- `android/app/src/main/java/app/toiletsupport/trial/BarometerPlugin.java`：気圧センサー（約5回/秒、hPa）
- `src/lib/barometer.ts`：Web 側の窓口。アプリの外では何もしない
- `/tools/floor-log`：アプリの中で開くと、階の記録と一緒に気圧も記録する
