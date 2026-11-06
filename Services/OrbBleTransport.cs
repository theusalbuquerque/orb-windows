using System.Collections.Concurrent;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Storage.Streams;

namespace OrbMusic.Windows.Services;

public sealed class OrbBleTransport : IDisposable
{
    private sealed class Peer
    {
        public double SmoothedRssi;
        public double MinimumRssi;
        public long ApproachedAt;
        public long InitialAt;
        public bool InitiallyApproached;
        public DateTimeOffset LastSeen;
    }

    private readonly ConcurrentDictionary<string, Peer> _peers = new();
    private readonly string _stableId = ReadOrCreateStableId();
    private BluetoothLEAdvertisementPublisher? _publisher;
    private BluetoothLEAdvertisementWatcher? _watcher;
    private System.Threading.Timer? _refresh;
    private string? _userId;
    private bool _playing;
    private bool _nowPlayingOpen;
    private bool _disposed;

    public string DeviceKey => Convert.ToHexString(OrbBleProtocol.DeviceTag(_stableId)).ToLowerInvariant();
    public bool IsRunning => _watcher?.Status == BluetoothLEAdvertisementWatcherStatus.Started;
    public event EventHandler<NearbyPeerEventArgs>? NearPeerDetected;

    public static async Task<BleCapability> CheckCapabilityAsync()
    {
        try
        {
            var adapter = await BluetoothAdapter.GetDefaultAsync();
            if (adapter is null) return new BleCapability(false, false, "Nenhum adaptador Bluetooth encontrado.");
            if (!adapter.IsLowEnergySupported)
                return new BleCapability(false, false, "O adaptador não oferece Bluetooth Low Energy.");
            if (!adapter.IsPeripheralRoleSupported)
                return new BleCapability(true, false, "Bluetooth LE disponível, mas o adaptador não anuncia como periférico.");
            return new BleCapability(true, true, "Bluetooth LE pronto para testes de proximidade.");
        }
        catch (Exception error)
        {
            return new BleCapability(false, false, "Não foi possível consultar o Bluetooth: " + error.Message);
        }
    }

    /// <summary>
    /// This transport is not activated by the alpha player. It must only be started
    /// after authenticated Premium authorization and server handoff support are in place.
    /// Advertising without a receiver causes Android to offer a handoff that will expire.
    /// </summary>
    public async Task<bool> StartAsync(string userId)
    {
        if (_disposed || string.IsNullOrWhiteSpace(userId)) return false;
        var capability = await CheckCapabilityAsync();
        if (!capability.CanAdvertise) return false;
        Stop();

        _userId = userId;
        _peers.Clear();
        _watcher = new BluetoothLEAdvertisementWatcher
        {
            ScanningMode = BluetoothLEScanningMode.Active,
        };
        _watcher.Received += OnReceived;
        _watcher.Start();
        RestartAdvertisement();
        _refresh = new System.Threading.Timer(_ => RestartAdvertisement(), null,
            TimeSpan.FromSeconds(60), TimeSpan.FromSeconds(60));
        return true;
    }

    public void SetPlaybackState(bool playing, bool nowPlayingOpen)
    {
        if (_playing == playing && _nowPlayingOpen == nowPlayingOpen) return;
        // Sending is permitted only from the visible Now Playing.
        // Receiver validates the Android sender-ready flag as well.
        _playing = playing && nowPlayingOpen;
        _nowPlayingOpen = nowPlayingOpen;
        if (_userId is not null) RestartAdvertisement();
    }

    private void RestartAdvertisement()
    {
        var uid = _userId;
        if (uid is null || _disposed) return;
        try
        {
            _publisher?.Stop();
            var publisher = new BluetoothLEAdvertisementPublisher();
            using var writer = new DataWriter();
            writer.WriteBytes(OrbBleProtocol.MakeAdvertisement(uid, _stableId, _playing, _nowPlayingOpen));
            var buffer = writer.DetachBuffer();
            publisher.Advertisement.ManufacturerData.Add(
                new BluetoothLEManufacturerData(OrbBleProtocol.ManufacturerId, buffer));
            publisher.Start();
            _publisher = publisher;
        }
        catch
        {
            // A hardware/driver failure must never terminate the player's audio.
        }
    }

    private void OnReceived(BluetoothLEAdvertisementWatcher sender, BluetoothLEAdvertisementReceivedEventArgs args)
    {
        var uid = _userId;
        if (uid is null) return;
        try
        {
            foreach (var manufacturer in args.Advertisement.ManufacturerData)
            {
                if (manufacturer.CompanyId != OrbBleProtocol.ManufacturerId) continue;
                using var reader = DataReader.FromBuffer(manufacturer.Data);
                var bytes = new byte[checked((int)reader.UnconsumedBufferLength)];
                reader.ReadBytes(bytes);
                if (!OrbBleProtocol.TryParsePeer(bytes, uid, DeviceKey,
                        out var peerKey, out var isPlaying, out var senderReady)) continue;

                var now = DateTimeOffset.UtcNow;
                var peer = _peers.GetOrAdd(peerKey, _ => new Peer
                {
                    SmoothedRssi = args.RawSignalStrengthInDBm,
                    MinimumRssi = args.RawSignalStrengthInDBm,
                    LastSeen = now,
                });
                lock (peer)
                {
                    var rssi = args.RawSignalStrengthInDBm;
                    peer.SmoothedRssi = 0.68 * peer.SmoothedRssi + 0.32 * rssi;
                    peer.MinimumRssi = Math.Min(peer.MinimumRssi, peer.SmoothedRssi);
                    peer.LastSeen = now;
                    bool near = peer.SmoothedRssi >= -40;
                    if (!peer.InitiallyApproached)
                    {
                        // Android requires a fresh increase in signal after discovery.
                        if (near && peer.SmoothedRssi - peer.MinimumRssi >= 1)
                        {
                            if (peer.InitialAt == 0) peer.InitialAt = Environment.TickCount64;
                            if (Environment.TickCount64 - peer.InitialAt >= 800) peer.InitiallyApproached = true;
                        }
                        else peer.InitialAt = 0;
                        continue;
                    }
                    if (!near)
                    {
                        peer.ApproachedAt = 0;
                        continue;
                    }
                    if (peer.ApproachedAt == 0) peer.ApproachedAt = Environment.TickCount64;
                    if (Environment.TickCount64 - peer.ApproachedAt >= 400)
                    {
                        peer.ApproachedAt = 0;
                        NearPeerDetected?.Invoke(this, new NearbyPeerEventArgs(peerKey,
                            isPlaying, senderReady, (int)Math.Round(peer.SmoothedRssi)));
                    }
                }
            }
        }
        catch
        {
            // Malformed and foreign BLE advertisements are untrusted.
        }
    }

    public void Stop()
    {
        _userId = null;
        _refresh?.Dispose();
        _refresh = null;
        if (_watcher is not null)
        {
            _watcher.Received -= OnReceived;
            try { _watcher.Stop(); } catch { }
            _watcher = null;
        }
        try { _publisher?.Stop(); } catch { }
        _publisher = null;
        _peers.Clear();
    }

    private static string ReadOrCreateStableId()
    {
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OrbMusic");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "switch-device.id");
        if (File.Exists(path) && Guid.TryParse(File.ReadAllText(path), out var existing))
            return existing.ToString();
        var generated = Guid.NewGuid().ToString();
        File.WriteAllText(path, generated);
        return generated;
    }

    public void Dispose()
    {
        Stop();
        _disposed = true;
    }
}

public sealed record BleCapability(bool CanScan, bool CanAdvertise, string Message);
public sealed class NearbyPeerEventArgs : EventArgs
{
    public NearbyPeerEventArgs(string deviceKey, bool playing, bool senderReady, int rssi)
    {
        DeviceKey = deviceKey;
        Playing = playing;
        SenderReady = senderReady;
        Rssi = rssi;
    }

    public string DeviceKey { get; }
    public bool Playing { get; }
    public bool SenderReady { get; }
    public int Rssi { get; }
}
