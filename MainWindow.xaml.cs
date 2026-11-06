using System.Diagnostics;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using OrbMusic.Windows.Services;

namespace OrbMusic.Windows;

public sealed partial class MainWindow : Window
{
    private const string LocalHost = "orbmusic.online";
    private const string Api = "https://twhmhdqmbvogezofvfqg.supabase.co/functions/v1/orb-web";
    private readonly HttpClient _client = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly OrbBleTransport _ble = new();
    private string? _userId;
    private string? _session;
    private long _authGeneration;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Orb Music";
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "orb.ico"));
        AppWindow.Resize(new global::Windows.Graphics.SizeInt32(1260, 830));
        _ble.NearPeerDetected += OnPeerNearby;
        Closed += (_, _) =>
        {
            _ble.Dispose();
            _client.Dispose();
        };
        _ = InitializeBrowserAsync();
    }

    private async Task InitializeBrowserAsync()
    {
        try
        {
            await OrbPlayer.EnsureCoreWebView2Async();
            var root = Path.Combine(AppContext.BaseDirectory, "Web");
            if (!File.Exists(Path.Combine(root, "index.html")))
                throw new FileNotFoundException("O arquivo Web/index.html está ausente.");

            var core = OrbPlayer.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping(LocalHost, root,
                CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.WebMessageReceived += OnWebMessage;
            core.NavigationStarting += (_, args) =>
            {
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var target) &&
                    target.Host.Equals(LocalHost, StringComparison.OrdinalIgnoreCase)) return;
                args.Cancel = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var outside) &&
                    outside.Scheme == Uri.UriSchemeHttps)
                {
                    Process.Start(new ProcessStartInfo(outside.AbsoluteUri) { UseShellExecute = true });
                }
            };
            OrbPlayer.NavigationCompleted += (_, args) =>
            {
                LoadingSurface.Visibility = Visibility.Collapsed;
                if (!args.IsSuccess) Title = "Orb Music · Verifique sua conexão";
            };
            OrbPlayer.Source = new Uri($"https://{LocalHost}/index.html");
        }
        catch (Exception error)
        {
            LoadingSurface.Visibility = Visibility.Visible;
            Title = "Orb Music · Erro ao iniciar";
            System.Diagnostics.Debug.WriteLine(error);
        }
    }

    private async void OnWebMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!Uri.TryCreate(args.Source, UriKind.Absolute, out var origin) ||
            !origin.Host.Equals(LocalHost, StringComparison.OrdinalIgnoreCase)) return;
        try
        {
            using var doc = JsonDocument.Parse(args.WebMessageAsJson);
            var message = doc.RootElement;
            if (message.ValueKind != JsonValueKind.Object ||
                !message.TryGetProperty("type", out var type)) return;
            switch (type.GetString())
            {
                case "orb-desktop:auth":
                    var token = message.TryGetProperty("token", out var t) ? t.GetString() : null;
                    await ValidateSessionAsync(token);
                    break;
                case "orb-desktop:playback":
                    var playing = message.TryGetProperty("playing", out var p) && p.ValueKind == JsonValueKind.True;
                    var open = message.TryGetProperty("nowPlayingOpen", out var n) && n.ValueKind == JsonValueKind.True;
                    _ble.SetPlaybackState(playing, open);
                    break;
                case "orb-desktop:capabilities":
                    await SendCapabilityAsync();
                    break;
            }
        }
        catch (Exception error)
        {
            Debug.WriteLine(error);
        }
    }

    private async Task ValidateSessionAsync(string? token)
    {
        var generation = Interlocked.Increment(ref _authGeneration);
        if (string.IsNullOrWhiteSpace(token) || token.Length != 64)
        {
            _session = null;
            _userId = null;
            _ble.Stop();
            return;
        }
        if (token == _session && _userId is not null) return;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, Api + "/library");
            request.Headers.Add("X-Orb-Session", token);
            using var response = await _client.SendAsync(request);
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Sessão do Orb Web inválida.");
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var uid = json.RootElement.GetProperty("profile").GetProperty("id").GetString();
            if (generation != Interlocked.Read(ref _authGeneration)) return;
            if (!Guid.TryParse(uid, out _)) throw new InvalidOperationException("Identidade inválida.");
            _session = token;
            _userId = uid;
            // BLE advertising remains off in this alpha until the authenticated
            // handoff endpoints and the receiving audio preparation are ready.
            await SendCapabilityAsync();
        }
        catch
        {
            if (generation != Interlocked.Read(ref _authGeneration)) return;
            _session = null;
            _userId = null;
            _ble.Stop();
        }
    }

    private async Task SendCapabilityAsync()
    {
        var capability = await OrbBleTransport.CheckCapabilityAsync();
        await SendToWebAsync(new
        {
            type = "orb-desktop:capabilities",
            deviceKey = _ble.DeviceKey,
            canScan = capability.CanScan,
            canAdvertise = capability.CanAdvertise,
            switchActive = _ble.IsRunning,
            message = capability.Message,
        });
    }

    private void OnPeerNearby(object? sender, NearbyPeerEventArgs peer)
    {
        // A receiving Windows device may react only when the source
        // has its Now Playing open (the Android sender-ready bit).
        if (!peer.SenderReady) return;
        DispatcherQueue.TryEnqueue(() =>
        {
            _ = SendToWebAsync(new
            {
                type = "orb-desktop:nearby",
                deviceKey = peer.DeviceKey,
                playing = peer.Playing,
                senderReady = peer.SenderReady,
                rssi = peer.Rssi,
            });
        });
    }

    private async Task SendToWebAsync(object payload)
    {
        try
        {
            var core = OrbPlayer.CoreWebView2;
            if (core is null) return;
            core.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
            await Task.CompletedTask;
        }
        catch (Exception error)
        {
            Debug.WriteLine(error);
        }
    }
}
