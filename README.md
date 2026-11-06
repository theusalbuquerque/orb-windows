# Orb Music para Windows

Aplicativo desktop oficial do Orb Music, criado com **WinUI 3, C# (.NET 8) e WebView2**.

## Download
[Baixar versão mais recente](https://github.com/theusalbuquerque/orb-windows/releases/latest)

**Compatibilidade:** Windows 10 (build 19041+) e Windows 11, x64. Requer WebView2 Runtime e conexão à internet.

## Recursos
- MiniPlayer, Now Playing, fila e biblioteca.
- Histórico e curtidas sincronizados com a conta Orb no Android.
- Letras sincronizadas, quando disponíveis, com navegação por linha.
- ThinSlider animado.
- Pareamento via QR.

**Atenção:** o Orb Switch por aproximação BLE ainda não está habilitado e segue em desenvolvimento.

## Compilar
Instale o .NET SDK 8. Execute `COMPILAR.cmd` ou `build-windows.ps1 -Publish`. O resultado estará na pasta `publish/`.

O GitHub Actions monta o instalador Windows quando uma tag de versão é publicada. O instalador ainda não é assinado digitalmente, podendo mostrar avisos do Windows SmartScreen.

Site: https://orbmusic.online
