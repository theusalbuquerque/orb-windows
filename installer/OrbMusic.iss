#ifndef OrbVersion
  #define OrbVersion "0.1.0"
#endif
#define OrbAppName "Orb Music"
#define OrbAppExe "OrbMusic.Windows.exe"

[Setup]
AppId={{DFD46B18-84D9-43AB-944C-1DFA13D190A5}
AppName={#OrbAppName}
AppVersion={#OrbVersion}
AppVerName={#OrbAppName} {#OrbVersion}
AppPublisher=Orb Music
AppPublisherURL=https://orbmusic.online
DefaultDirName={localappdata}\Programs\Orb Music
DefaultGroupName=Orb Music
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=Orb-Music-Windows-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\Assets\orb.ico
UninstallDisplayIcon={app}\{#OrbAppExe}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na area de trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked

[Files]
Source: "..\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Orb Music"; Filename: "{app}\{#OrbAppExe}"; WorkingDir: "{app}"
Name: "{autodesktop}\Orb Music"; Filename: "{app}\{#OrbAppExe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#OrbAppExe}"; Description: "Abrir Orb Music"; Flags: nowait postinstall skipifsilent
