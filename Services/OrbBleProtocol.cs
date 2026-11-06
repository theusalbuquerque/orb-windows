using System.Security.Cryptography;
using System.Text;

namespace OrbMusic.Windows.Services;

/// <summary>
/// Byte-for-byte BLE advertisement format from OrbTouchTransfer.kt (Android 1.8.0-beta66).
/// Neither songs nor credentials are advertised over the air.
/// </summary>
public static class OrbBleProtocol
{
    public const ushort ManufacturerId = 0xFFFF;
    public const byte Version = 2;
    public const int PayloadBytes = 18;
    public const byte PlayingFlag = 1;
    public const byte ReadyFlag = 2;

    public static byte[] AccountTag(string userId, long utcMilliseconds)
    {
        long bucket = utcMilliseconds / 300_000L;
        return SHA256.HashData(Encoding.UTF8.GetBytes($"orb-touch-account:{userId}:{bucket}"))[..8];
    }

    public static byte[] DeviceTag(string stableId) =>
        SHA256.HashData(Encoding.UTF8.GetBytes($"orb-touch-device:{stableId}"))[..8];

    public static byte[] MakeAdvertisement(string userId, string stableId, bool playing, bool nowPlayingOpen)
    {
        var bytes = new byte[PayloadBytes];
        bytes[0] = Version;
        bytes[1] = (byte)((playing ? PlayingFlag : 0) | (playing && nowPlayingOpen ? ReadyFlag : 0));
        AccountTag(userId, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).CopyTo(bytes, 2);
        DeviceTag(stableId).CopyTo(bytes, 10);
        return bytes;
    }

    public static bool TryParsePeer(byte[] bytes, string userId, string ownDeviceKey,
        out string peerKey, out bool playing, out bool senderReady)
    {
        peerKey = "";
        playing = false;
        senderReady = false;
        if (bytes.Length < PayloadBytes || bytes[0] != Version) return false;

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        bool accountMatches = false;
        for (long offset = -1; offset <= 1; offset++)
        {
            var accountBytes = AccountTag(userId, now + offset * 300_000L);
            if (CryptographicOperations.FixedTimeEquals(bytes.AsSpan(2, 8), accountBytes))
            {
                accountMatches = true;
                break;
            }
        }
        if (!accountMatches) return false;

        peerKey = Convert.ToHexString(bytes.AsSpan(10, 8)).ToLowerInvariant();
        if (string.Equals(peerKey, ownDeviceKey, StringComparison.OrdinalIgnoreCase)) return false;
        playing = (bytes[1] & PlayingFlag) != 0;
        senderReady = (bytes[1] & ReadyFlag) != 0;
        return true;
    }
}
