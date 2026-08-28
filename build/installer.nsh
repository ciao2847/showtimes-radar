; electron-builder's default process check uses Get-CimInstance. On Windows
; installations where CIM access is denied, PowerShell can return success even
; though the query failed, causing NSIS to report that the app cannot be closed
; forever. Use taskkill's exact image-name matching instead.
!macro customCheckAppRunning
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 500
!macroend
