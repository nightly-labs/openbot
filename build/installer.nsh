; electron-builder includes this file in the NSIS installer. Its `protocols` setting registers the
; openbot:// scheme only on macOS and Linux, so the installer writes the Windows key itself.
; The application writes the same key at each start (`src/main/index.ts`).

; A chosen folder such as D:\OpenBot inherits Modify rights for "Authenticated Users" from the drive
; root, so another account could replace OpenBot.exe. Give access only to this user, SYSTEM and
; Administrators, as %LOCALAPPDATA% does, and reset the files to inherit it. This runs before the
; files are copied at each install and update, because an update deletes the folder. The installer
; makes the folder, so this user owns it and icacls can change it. On a drive with no ACLs, such as
; exFAT, icacls fails and the install continues.
!macro openBotRestrictInstallDirectory
  Push $0
  Push $1
  ReadEnvStr $0 USERDOMAIN
  ReadEnvStr $1 USERNAME
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "$0\$1:(OI)(CI)F" /Q'
  Pop $0
  ${if} $0 == 0
    nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\*" /reset /T /C /Q'
    Pop $0
  ${endIf}
  Pop $1
  Pop $0
!macroend

; This replaces the check after the earlier version is removed, so it keeps that check first.
!macro customUnInstallCheck
  ${if} ${Errors}
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  ${elseIf} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endIf}
  CreateDirectory "$INSTDIR"
  !insertmacro openBotRestrictInstallDirectory
!macroend

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\openbot" "" "URL:OpenBot invitations"
  WriteRegStr SHCTX "Software\Classes\openbot" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\openbot\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHCTX "Software\Classes\openbot\shell\open\command" "" '"$appExe" "%1"'
  !insertmacro openBotRemoveAppFromDataFolder
!macroend

; OpenBot keeps the agent workspaces in %USERPROFILE%\OpenBot (`src/backend/agent-store.ts`) and its
; user data in %APPDATA%\OpenBot (`app.setName` in `src/main/index.ts`). The uninstaller deletes the
; installation folder, and an update moves each file in it to a temporary folder that it then
; deletes. An installation folder must not be one of these folders or a folder that holds one.
; Sets OUT to "1" when the folder in the variable PATH is such a folder, otherwise to "0". A
; trailing backslash is removed from PATH. OUT must not be PATH, $R8 or $R9.
!macro openBotHoldsUserData PATH OUT
  Push $R8
  Push $R9
  StrCpy ${OUT} "0"
  StrCpy $R9 ${PATH} 1 -1
  ${if} $R9 == "\"
    StrCpy ${PATH} ${PATH} -1
  ${endIf}
  ${if} ${PATH} != ""
    !insertmacro openBotHolds ${PATH} "$PROFILE\OpenBot" ${OUT}
    !insertmacro openBotHolds ${PATH} "$APPDATA\OpenBot" ${OUT}
  ${endIf}
  Pop $R9
  Pop $R8
!macroend

!macro openBotHolds PATH FOLDER OUT
  StrLen $R9 ${PATH}
  StrCpy $R8 "${FOLDER}" $R9
  ${if} $R8 == ${PATH}
    StrCpy $R8 "${FOLDER}" 1 $R9
    ${if} $R8 == ""
    ${orIf} $R8 == "\"
      StrCpy ${OUT} "1"
    ${endIf}
  ${endIf}
!macroend

!ifndef BUILD_UNINSTALLER
  ; "1" when the registry names an earlier installation in a folder with user data.
  Var openBotRegisteredInDataFolder
  ; The folder with user data that holds an earlier OpenBot.exe. The update removes that copy.
  Var openBotDataFolderInstall

  ; The assisted installer accepted a folder that did not exist yet, so a first installation could go
  ; to %USERPROFILE%\OpenBot, and the app then made the agent folders in it. The earlier uninstaller
  ; would move them with the app files and delete them, or it stops the update with "Failed to
  ; uninstall old application files". Do not run that uninstaller: `customCheckAppRunning` removes its
  ; registry entry, and `customInstall` removes only the app files. A copy whose registry entry is
  ; already gone, for example after an install that stopped, is removed too. A silent update installs
  ; in the default folder; the page that chooses a folder refuses the folder with user data.
  !macro customInit
    ReadRegStr $1 SHCTX "${INSTALL_REGISTRY_KEY}" InstallLocation
    !insertmacro openBotHoldsUserData $1 $0
    ${if} $0 == "1"
      StrCpy $openBotRegisteredInDataFolder "1"
      ${if} ${FileExists} "$1\${APP_EXECUTABLE_FILENAME}"
        StrCpy $openBotDataFolderInstall $1
      ${endIf}
    ${elseIf} ${FileExists} "$PROFILE\OpenBot\${APP_EXECUTABLE_FILENAME}"
      StrCpy $openBotDataFolderInstall "$PROFILE\OpenBot"
    ${elseIf} ${FileExists} "$APPDATA\OpenBot\${APP_EXECUTABLE_FILENAME}"
      StrCpy $openBotDataFolderInstall "$APPDATA\OpenBot"
    ${endIf}
    !insertmacro openBotHoldsUserData $INSTDIR $0
    ${if} $0 == "1"
      StrCpy $INSTDIR "$LocalAppData\Programs\${APP_FILENAME}"
    ${endIf}
  !macroend

  ; The installer runs this check before it removes the earlier version. It is the default check.
  ; When the registry names a folder with user data, the update closes the app there, so the check
  ; looks for the earlier OpenBot.exe only: a match on the folder would also stop the programs that
  ; agents run from their workspaces. Then the registry no longer names that installation, so
  ; `uninstallOldVersion` does not run its uninstaller. The uninstaller keeps the default check.
  !macro customCheckAppRunning
    !insertmacro IS_POWERSHELL_AVAILABLE
    ${if} $openBotRegisteredInDataFolder == "1"
    ${andIf} $openBotDataFolderInstall != ""
      Push $INSTDIR
      StrCpy $INSTDIR "$openBotDataFolderInstall\${APP_EXECUTABLE_FILENAME}"
    ${endIf}
    !insertmacro _CHECK_APP_RUNNING
    ${if} $openBotRegisteredInDataFolder == "1"
      ${if} $openBotDataFolderInstall != ""
        Pop $INSTDIR
      ${endIf}
      DeleteRegKey SHCTX "${UNINSTALL_REGISTRY_KEY}"
      !ifdef UNINSTALL_REGISTRY_KEY_2
        DeleteRegKey SHCTX "${UNINSTALL_REGISTRY_KEY_2}"
      !endif
      DeleteRegValue SHCTX "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${endIf}
  !macroend

  ; electron-builder includes these for the default check only, and that check needs them.
  !include "getProcessInfo.nsh"
  Var pid
!endif

; After the new copy is installed, delete the earlier app from the folder with user data. Only the
; files and folders that an OpenBot installation has are deleted, so the agent folders stay. A file
; that Windows still holds stays too; it does not stop the update. The login item names the
; executable (`src/main/login-item.ts`), and Electron calls it by the AppUserModelId: point it at
; the new copy, or OpenBot no longer opens at sign-in.
!macro openBotRemoveAppFromDataFolder
  ${if} $openBotDataFolderInstall != ""
    Push $0
    Push $1
    Push $2
    StrCpy $0 $openBotDataFolderInstall
    ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    ${StrContains} $2 "$0\${APP_EXECUTABLE_FILENAME}" $1
    ${if} $2 != ""
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}" '"$appExe"'
    ${endIf}
    Delete "$0\${APP_EXECUTABLE_FILENAME}"
    Delete "$0\${UNINSTALL_FILENAME}"
    Delete "$0\uninstallerIcon.ico"
    Delete "$0\chrome_100_percent.pak"
    Delete "$0\chrome_200_percent.pak"
    Delete "$0\resources.pak"
    Delete "$0\d3dcompiler_47.dll"
    Delete "$0\dxcompiler.dll"
    Delete "$0\dxil.dll"
    Delete "$0\ffmpeg.dll"
    Delete "$0\libEGL.dll"
    Delete "$0\libGLESv2.dll"
    Delete "$0\vk_swiftshader.dll"
    Delete "$0\vk_swiftshader_icd.json"
    Delete "$0\vulkan-1.dll"
    Delete "$0\icudtl.dat"
    Delete "$0\snapshot_blob.bin"
    Delete "$0\v8_context_snapshot.bin"
    Delete "$0\LICENSE.electron.txt"
    Delete "$0\LICENSES.chromium.html"
    RMDir /r "$0\locales"
    RMDir /r "$0\resources"
    Pop $2
    Pop $1
    Pop $0
  ${endIf}
!macroend

; An update runs the old uninstaller first. Keep the key then, so that links work during the update.
; Delete the key only when it still opens this copy. Another copy can own it now.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    ReadRegStr $0 SHCTX "Software\Classes\openbot\shell\open\command" ""
    ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
      DeleteRegKey SHCTX "Software\Classes\openbot"
    ${endIf}
    Pop $0
  ${endIf}
!macroend

; OpenBot installs for the current user only. The application writes the openbot:// key in HKCU at
; each start, and an update finds only one installation. This skips the "All users" page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The uninstaller and each update delete the whole installation folder. electron-builder adds an
; OpenBot subfolder only when the chosen path does not contain "OpenBot", so a choice such as
; %USERPROFILE%\OpenBot (the agent workspaces) or %APPDATA%\OpenBot (the user data) would be
; deleted. Another account can also make a folder first and keep its rights on it. Use only a folder
; that does not exist or that holds this user's earlier installation. Until then, add an OpenBot
; subfolder. The app makes %USERPROFILE%\OpenBot only at its first start, so that folder can also not
; exist yet: use the default folder for it and for a folder that holds it. The page shows nothing;
; Abort skips it.
!macro customPageAfterChangeDir
  !include FileFunc.nsh

  Page custom openBotSafeInstallDirectory

  Function openBotSafeInstallDirectory
    Push $0
    Push $1
    ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCpy $0 $INSTDIR 1 -1
    ${if} $0 == "\"
      StrCpy $INSTDIR $INSTDIR -1
    ${endIf}
    ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
    ${if} $0 == ""
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${endIf}
    !insertmacro openBotHoldsUserData $INSTDIR $0
    ${if} $0 == "1"
      StrCpy $INSTDIR "$LocalAppData\Programs\${APP_FILENAME}"
    ${endIf}
    ${do}
      ${if} $INSTDIR == $1
        ${exitDo}
      ${endIf}
      ${DirState} "$INSTDIR" $0
      ${if} $0 == -1
        ${exitDo}
      ${endIf}
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${loop}
    Pop $1
    Pop $0
    Abort
  FunctionEnd
!macroend
