[Setup]
AppId={{8A7B4E80-A650-4D47-9D05-8D4D7F13E67E}
AppName=CodexBuddy
AppVersion={#ProductVersion}
AppPublisher=CodexBuddy
DefaultDirName={localappdata}\Programs\CodexBuddy
DefaultGroupName=CodexBuddy
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=CodexBuddy
UninstallDisplayIcon={app}\bin\codexhost-start.exe

#if Architecture == "x64"
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#else
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#endif

[Files]
; Extract the new helper before touching an existing installation, including older versions.
Source: "{#PayloadRoot}\libexec\codexhost-updater.exe"; DestName: "codexhost-install-helper.exe"; Flags: dontcopy
Source: "{#PayloadRoot}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userdesktop}\CodexBuddy"; Filename: "{app}\bin\codexhost-start.exe"; WorkingDir: "{app}"
Name: "{userprograms}\CodexBuddy"; Filename: "{app}\bin\codexhost-start.exe"; WorkingDir: "{app}"
Name: "{userprograms}\CodexBuddy Console"; Filename: "{app}\bin\codexhost-start.exe"; Parameters: "--console"; WorkingDir: "{app}"

[Dirs]
Name: "{app}"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  try
    ExtractTemporaryFile('codexhost-install-helper.exe');
    { PrepareToInstall runs after Install is clicked, before the file-in-use check.
      Append a dot so even a drive-root destination has no trailing argument backslash. }
    if not ExecAndLogOutput(
      ExpandConstant('{tmp}\codexhost-install-helper.exe'),
      'prepare-install --install-root ' + AddQuotes(AddBackslash(ExpandConstant('{app}')) + '.'),
      ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ResultCode, nil) then
      Result := 'Could not start codexhost installation preparation: ' + SysErrorMessage(ResultCode)
    else if ResultCode <> 0 then begin
      Log(Format('codexhost installation preparation failed with exit code %d', [ResultCode]));
      Result := 'Could not close the running codexhost installation. Close codexhost and try again.';
    end;
  except
    Result := 'Could not prepare codexhost installation: ' + GetExceptionMessage;
  end;
end;
