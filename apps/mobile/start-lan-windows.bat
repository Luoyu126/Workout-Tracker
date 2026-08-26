@echo off
pushd "\\wsl$\Ubuntu\home\chenyy\Workout-Tracker\apps\mobile"
set REACT_NATIVE_PACKAGER_HOSTNAME=10.0.0.86
set EXPO_NO_TELEMETRY=1
"C:\Users\kindj\AppData\Local\hermes\node\npx.cmd" expo start --lan --port 8081
