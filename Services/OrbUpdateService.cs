using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace OrbMusic.Windows.Services;

internal sealed record OrbRelease(string Tag, string Version, string Url, string Sha256, long Size);

internal sealed class OrbUpdateService
{
    private static readonly Uri ReleasesUri = new("https://api.github.com/repos/theusalbuquerque/orb-windows/releases?per_page=30");
    private static readonly Regex TagPattern = new(@"^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<kind>alpha|beta|rc)(?<number>\d+))?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex DigestPattern = new(@"^sha256:([a-f0-9]{64})$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private readonly HttpClient _client = new() { Timeout = TimeSpan.FromMinutes(15) };

    internal static string CurrentVersion
    {
        get
        {
            var raw = typeof(OrbUpdateService).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                      ?? "0.0.0";
            return raw.Split('+')[0];
        }
    }

    private static (int Major, int Minor, int Patch, int Kind, int Number)? ParseVersion(string tag)
    {
        var match = TagPattern.Match(tag);
        if (!match.Success) return null;
        var kind = match.Groups["kind"].Value.ToLowerInvariant() switch
        {
            "alpha" => 0,
            "beta" => 1,
            "rc" => 2,
            _ => 3
        };
        return (int.Parse(match.Groups["major"].Value),
                int.Parse(match.Groups["minor"].Value),
                int.Parse(match.Groups["patch"].Value),
                kind, match.Groups["number"].Success ? int.Parse(match.Groups["number"].Value) : 0);
    }

    internal static int CompareVersions(string left, string right)
    {
        var a = ParseVersion(left);
        var b = ParseVersion(right);
        if (a is null || b is null) return 0;
        var av = a.Value;
        var bv = b.Value;
        var first = av.Major.CompareTo(bv.Major);
        if (first != 0) return first;
        first = av.Minor.CompareTo(bv.Minor);
        if (first != 0) return first;
        first = av.Patch.CompareTo(bv.Patch);
        if (first != 0) return first;
        first = av.Kind.CompareTo(bv.Kind);
        return first != 0 ? first : av.Number.CompareTo(bv.Number);
    }

    internal async Task<OrbRelease?> FindUpdateAsync(CancellationToken cancellationToken = default)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, ReleasesUri);
        req.Headers.UserAgent.ParseAdd("OrbMusicWindows-Updater/1.0");
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        using var response = await _client.SendAsync(req, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        OrbRelease? selected = null;

        foreach (var release in document.RootElement.EnumerateArray())
        {
            if (release.GetProperty("draft").GetBoolean()) continue;
            var tag = release.GetProperty("tag_name").GetString() ?? "";
            if (ParseVersion(tag) is null || CompareVersions(tag, CurrentVersion) <= 0) continue;
            foreach (var asset in release.GetProperty("assets").EnumerateArray())
            {
                if (!string.Equals(asset.GetProperty("name").GetString(),
                        "Orb-Music-Windows-Setup.exe", StringComparison.OrdinalIgnoreCase)) continue;
                var link = asset.GetProperty("browser_download_url").GetString() ?? "";
                if (!Uri.TryCreate(link, UriKind.Absolute, out var uri) ||
                    uri.Scheme != Uri.UriSchemeHttps ||
                    uri.Host != "github.com" ||
                    !uri.AbsolutePath.StartsWith(
                        "/theusalbuquerque/orb-windows/releases/download/", StringComparison.Ordinal))
                    continue;
                var digest = asset.TryGetProperty("digest", out var dig) ? dig.GetString() ?? "" : "";
                var match = DigestPattern.Match(digest);
                if (!match.Success) continue; // Never install unverified releases.
                var size = asset.GetProperty("size").GetInt64();
                if (size <= 0 || size > 1024L * 1024 * 1024) continue;
                var candidate = new OrbRelease(tag, tag.TrimStart('v', 'V'), link,
                    match.Groups[1].Value.ToLowerInvariant(), size);
                if (selected is null || CompareVersions(candidate.Tag, selected.Tag) > 0)
                    selected = candidate;
                break;
            }
        }
        return selected;
    }

    internal static string TargetPath(OrbRelease release)
    {
        // The path is derived from a strictly parsed tag, never from HTTP headers.
        var version = ParseVersion(release.Tag) is null ? throw new InvalidOperationException("Versão inválida.") : release.Version;
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Orb Music", "Updates", version);
        Directory.CreateDirectory(folder);
        return Path.Combine(folder, "Orb-Music-Windows-Setup.exe");
    }

    internal async Task<string> DownloadAsync(OrbRelease release, Action<int> onProgress,
        CancellationToken cancellationToken = default)
    {
        var destination = TargetPath(release);
        if (File.Exists(destination) && await MatchesSha256Async(destination, release.Sha256, cancellationToken))
        {
            onProgress(100);
            return destination;
        }
        var partial = destination + ".partial";
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, release.Url);
            req.Headers.UserAgent.ParseAdd("OrbMusicWindows-Updater/1.0");
            using var response = await _client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();
            var total = response.Content.Headers.ContentLength.GetValueOrDefault(release.Size);
            if (total <= 0 || total > 1024L * 1024 * 1024)
                throw new IOException("Tamanho do instalador inválido.");
            await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using var output = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, useAsync: true);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[128 * 1024];
            long downloaded = 0;
            int lastPercent = -1;
            int count;
            while ((count = await input.ReadAsync(buffer, cancellationToken)) > 0)
            {
                downloaded += count;
                if (downloaded > 1024L * 1024 * 1024)
                    throw new IOException("O download excedeu o limite permitido.");
                hash.AppendData(buffer, 0, count);
                await output.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
                int percent = Math.Clamp((int)(downloaded * 100 / total), 0, 99);
                if (percent != lastPercent)
                {
                    lastPercent = percent;
                    onProgress(percent);
                }
            }
            await output.FlushAsync(cancellationToken);
            if (downloaded != release.Size)
                throw new IOException("O tamanho do instalador não corresponde ao Release.");
            var digest = Convert.ToHexString(hash.GetHashAndReset());
            if (!string.Equals(digest, release.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new CryptographicException("O hash do instalador não corresponde ao arquivo oficial.");
        }
        catch
        {
            if (File.Exists(partial)) File.Delete(partial);
            throw;
        }
        File.Move(partial, destination, overwrite: true);
        onProgress(100);
        return destination;
    }

    internal static async Task<bool> VerifyDownloadedAsync(OrbRelease release, string path)
    {
        if (!string.Equals(Path.GetFullPath(path), Path.GetFullPath(TargetPath(release)),
                StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
            return false;
        return await MatchesSha256Async(path, release.Sha256, CancellationToken.None);
    }

    private static async Task<bool> MatchesSha256Async(string file, string expected, CancellationToken ct)
    {
        await using var stream = File.OpenRead(file);
        var result = await SHA256.HashDataAsync(stream, ct);
        return Convert.ToHexString(result).Equals(expected, StringComparison.OrdinalIgnoreCase);
    }

    public void Dispose() => _client.Dispose();
}
