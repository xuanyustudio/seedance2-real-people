@echo off
REM Download YuNet ONNX model into models\
setlocal
cd /d "%~dp0.."
if not exist models mkdir models
if exist models\yunet_2023mar.onnx (
  echo Already exists: models\yunet_2023mar.onnx
  exit /b 0
)
echo Downloading YuNet via ghproxy...
curl.exe -L --ssl-no-revoke --retry 3 --max-time 180 -o models\yunet_2023mar.onnx "https://ghproxy.net/https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
if errorlevel 1 (
  echo Download failed.
  exit /b 1
)
for %%A in (models\yunet_2023mar.onnx) do echo OK %%~zA bytes
