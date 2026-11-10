@echo off
setlocal
if "%~4"=="" (
  echo Usage: Validate-Extrinsics-Windows.bat "VMMS_FOLDER" "FRAME_CSV" "EXTRINSICS_CSV" "OUTPUT_FOLDER"
  exit /b 2
)
python "%~dp0scripts\validate_extrinsics.py" --vmms "%~1" --frames "%~2" --extrinsics "%~3" --output "%~4"
exit /b %ERRORLEVEL%
