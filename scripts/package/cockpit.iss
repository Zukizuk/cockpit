; Cockpit's Setup.exe (Inno Setup 6). Built by scripts/package.mjs from the same folder as the zip:
;   iscc /DVersion=0.2.17 /DStage=<release\stage\Cockpit> /DOutDir=<release> cockpit.iss
;
; It installs for the current user with no admin rights, into the same folder as the zip's installer
; (%LOCALAPPDATA%\Programs\Cockpit), and it does that by running the zip's own install.ps1. So an install from
; Setup.exe, from the zip, from get.ps1 or from the in-app updater ends up the same, and each can update the others.
; What Setup adds: a wizard, an entry in Settings > Apps, and an exe that winget can install.
;
; Command line, besides Inno's own (/SILENT, /VERYSILENT, /DIR=, /TASKS=):
;   /Extra="-NoStartMenu ..."   more switches for install.ps1 (the tests use it to leave this PC's shortcuts alone)

#ifndef Version
  #error Pass /DVersion=x.y.z
#endif
#ifndef Stage
  #error Pass /DStage=<the staged Cockpit folder>
#endif
#ifndef OutDir
  #define OutDir "."
#endif

[Setup]
; never change the AppId: Windows and winget know Cockpit by it
AppId={{F123EE23-6B69-452D-8502-CC346A602483}
AppName=Cockpit
AppVersion={#Version}
AppVerName=Cockpit {#Version}
AppPublisher=Zukizuk
AppPublisherURL=https://github.com/Zukizuk/cockpit
AppSupportURL=https://github.com/Zukizuk/cockpit/issues
AppUpdatesURL=https://github.com/Zukizuk/cockpit/releases
VersionInfoVersion={#Version}
DefaultDirName={localappdata}\Programs\Cockpit
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutDir}
OutputBaseFilename=Cockpit-Setup-{#Version}
SetupIconFile={#Stage}\app\cockpit.ico
UninstallDisplayIcon={app}\app\cockpit.ico
UninstallDisplayName=Cockpit
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; install.ps1 stops a running Cockpit itself
CloseApplications=no
RestartApplications=no

[Tasks]
Name: startup; Description: "Start Cockpit when I sign in to Windows"
Name: hotkey; Description: "Ctrl+Alt+K brings Cockpit up from anywhere"
Name: sendto; Description: "Add Cockpit to Send to (right-click a file in Explorer)"
Name: claude; Description: "Connect Cockpit to Claude Code, if it's installed (what Claude makes shows up on your board)"

[Files]
; unpacked to a temp folder: install.ps1 copies it into place
Source: "{#Stage}\*"; DestDir: "{tmp}\Cockpit"; Flags: recursesubdirs createallsubdirs ignoreversion

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\app\scripts\open.vbs"""; Description: "Open Cockpit"; Flags: postinstall nowait skipifsilent

[UninstallRun]
; the shortcuts, the helper, the login start and the Claude Code connection; the files go below
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"" -FromSetup"; Flags: runhidden waituntilterminated; RunOnceId: "CockpitUninstall"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"
Type: files; Name: "{app}\uninstall.ps1"
Type: files; Name: "{app}\Uninstall.cmd"

[Messages]
FinishedLabel=Cockpit is installed. Open it from the Start menu, or press Ctrl+Alt+K if you kept that.

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  Args: String;
  Code: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\Cockpit\install.ps1') + '"' +
    ' -InstallDir "' + ExpandConstant('{app}') + '" -NoOpen';
  if not WizardIsTaskSelected('startup') then Args := Args + ' -NoStartup';
  if not WizardIsTaskSelected('hotkey') then Args := Args + ' -NoHotkey';
  if not WizardIsTaskSelected('sendto') then Args := Args + ' -NoSendTo';
  { always answered here: install.ps1 must never wait for a question in a hidden window }
  if WizardIsTaskSelected('claude') then Args := Args + ' -Claude yes' else Args := Args + ' -Claude no';
  Args := Args + ' ' + ExpandConstant('{param:Extra|}');
  WizardForm.StatusLabel.Caption := 'Setting up Cockpit...';
  if not Exec('powershell.exe', Args, '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    SuppressibleMsgBox('Cockpit was copied, but setting it up stopped (code ' + IntToStr(Code) + '). ' +
      'Run Setup again, or install from the zip to see what went wrong.', mbError, MB_OK, IDOK);
end;
