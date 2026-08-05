using System.Text.Json;

namespace Madi.HwpBridge;

public abstract record BridgeRequest(
    string RequestId,
    string Command,
    int TimeoutMs);

public sealed record ProbeRequest(string RequestId, int TimeoutMs)
    : BridgeRequest(RequestId, "probe", TimeoutMs);

public sealed record ConvertRequest(
    string RequestId,
    string InputHwpx,
    string OutputHwp,
    bool Overwrite,
    int TimeoutMs)
    : BridgeRequest(RequestId, "convert", TimeoutMs);

public sealed record ReopenVerifyRequest(
    string RequestId,
    string InputHwp,
    int TimeoutMs)
    : BridgeRequest(RequestId, "reopen-verify", TimeoutMs);

public sealed record CancelRequest(string RequestId, string TargetRequestId)
    : BridgeRequest(RequestId, "cancel", 1_000);

public sealed class BridgeProtocolException : Exception
{
    public BridgeProtocolException()
        : base("The bridge request is invalid.")
    {
    }
}

public static class BridgeProtocol
{
    public const int MaximumLineCharacters = 65_536;
    private const int MaximumPathCharacters = 32_000;
    private const int MinimumTimeoutMs = 100;
    private const int MaximumTimeoutMs = 300_000;

    public static BridgeRequest ParseRequest(string line)
    {
        if (string.IsNullOrWhiteSpace(line) || line.Length > MaximumLineCharacters)
        {
            throw new BridgeProtocolException();
        }

        try
        {
            using var document = JsonDocument.Parse(line, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 8,
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                throw new BridgeProtocolException();
            }

            var command = RequiredString(root, "command", 32);
            return command switch
            {
                "probe" => ParseProbe(root),
                "convert" => ParseConvert(root),
                "reopen-verify" => ParseReopenVerify(root),
                "cancel" => ParseCancel(root),
                _ => throw new BridgeProtocolException(),
            };
        }
        catch (BridgeProtocolException)
        {
            throw;
        }
        catch (JsonException)
        {
            throw new BridgeProtocolException();
        }
    }

    private static ProbeRequest ParseProbe(JsonElement root)
    {
        RequireExactProperties(root, "requestId", "command", "timeoutMs");
        return new ProbeRequest(RequiredRequestId(root, "requestId"), RequiredTimeout(root));
    }

    private static ConvertRequest ParseConvert(JsonElement root)
    {
        RequireExactProperties(
            root,
            "requestId",
            "command",
            "inputHwpx",
            "outputHwp",
            "overwrite",
            "timeoutMs");
        var overwrite = RequiredBoolean(root, "overwrite");
        if (overwrite)
        {
            throw new BridgeProtocolException();
        }

        return new ConvertRequest(
            RequiredRequestId(root, "requestId"),
            RequiredString(root, "inputHwpx", MaximumPathCharacters),
            RequiredString(root, "outputHwp", MaximumPathCharacters),
            false,
            RequiredTimeout(root));
    }

    private static ReopenVerifyRequest ParseReopenVerify(JsonElement root)
    {
        RequireExactProperties(
            root,
            "requestId",
            "command",
            "inputHwp",
            "timeoutMs");
        return new ReopenVerifyRequest(
            RequiredRequestId(root, "requestId"),
            RequiredString(root, "inputHwp", MaximumPathCharacters),
            RequiredTimeout(root));
    }

    private static CancelRequest ParseCancel(JsonElement root)
    {
        RequireExactProperties(root, "requestId", "command", "targetRequestId");
        return new CancelRequest(
            RequiredRequestId(root, "requestId"),
            RequiredRequestId(root, "targetRequestId"));
    }

    private static string RequiredRequestId(JsonElement root, string name)
    {
        var value = RequiredString(root, name, 64);
        if (value.Any(character =>
                !char.IsAsciiLetterOrDigit(character) &&
                character != '-' &&
                character != '_'))
        {
            throw new BridgeProtocolException();
        }

        return value;
    }

    private static int RequiredTimeout(JsonElement root)
    {
        if (!root.TryGetProperty("timeoutMs", out var property) ||
            !property.TryGetInt32(out var value) ||
            value < MinimumTimeoutMs ||
            value > MaximumTimeoutMs)
        {
            throw new BridgeProtocolException();
        }

        return value;
    }

    private static string RequiredString(JsonElement root, string name, int maximumLength)
    {
        if (!root.TryGetProperty(name, out var property) ||
            property.ValueKind != JsonValueKind.String)
        {
            throw new BridgeProtocolException();
        }

        var value = property.GetString();
        if (string.IsNullOrEmpty(value) ||
            value.Length > maximumLength ||
            value.Any(character => char.IsControl(character)))
        {
            throw new BridgeProtocolException();
        }

        return value;
    }

    private static bool RequiredBoolean(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var property) ||
            (property.ValueKind != JsonValueKind.True &&
             property.ValueKind != JsonValueKind.False))
        {
            throw new BridgeProtocolException();
        }

        return property.GetBoolean();
    }

    private static void RequireExactProperties(JsonElement root, params string[] expected)
    {
        var expectedNames = expected.ToHashSet(StringComparer.Ordinal);
        var observedNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
        {
            if (!expectedNames.Contains(property.Name) ||
                !observedNames.Add(property.Name))
            {
                throw new BridgeProtocolException();
            }
        }

        if (observedNames.Count != expectedNames.Count)
        {
            throw new BridgeProtocolException();
        }
    }
}
