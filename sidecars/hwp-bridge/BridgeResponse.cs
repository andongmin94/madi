using System.Text.Json;
using System.Text.Json.Serialization;

namespace Madi.HwpBridge;

public sealed record BridgeResponse
{
    public required string RequestId { get; init; }
    public required string Command { get; init; }
    public required string Status { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Available { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AvailabilityCode { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? HancomVersion { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? OutputPath { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? ByteLength { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Sha256 { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Verified { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Cancelled { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ErrorCode { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Message { get; init; }

    public static BridgeResponse Probe(
        ProbeRequest request,
        bool available,
        string availabilityCode,
        string? version) => new()
        {
            RequestId = request.RequestId,
            Command = request.Command,
            Status = "SUCCESS",
            Available = available,
            AvailabilityCode = availabilityCode,
            HancomVersion = version,
        };

    public static BridgeResponse Conversion(
        ConvertRequest request,
        string outputPath,
        long byteLength,
        string sha256,
        string? version) => new()
        {
            RequestId = request.RequestId,
            Command = request.Command,
            Status = "SUCCESS",
            OutputPath = outputPath,
            ByteLength = byteLength,
            Sha256 = sha256,
            HancomVersion = version,
        };

    public static BridgeResponse Reopen(
        ReopenVerifyRequest request,
        string? version) => new()
        {
            RequestId = request.RequestId,
            Command = request.Command,
            Status = "SUCCESS",
            Verified = true,
            HancomVersion = version,
        };

    public static BridgeResponse CancelledRequest(CancelRequest request, bool cancelled) => new()
    {
        RequestId = request.RequestId,
        Command = request.Command,
        Status = "SUCCESS",
        Cancelled = cancelled,
    };

    public static BridgeResponse Error(
        string requestId,
        string command,
        string errorCode,
        string message) => new()
        {
            RequestId = requestId,
            Command = command,
            Status = "ERROR",
            ErrorCode = errorCode,
            Message = message,
        };
}

public static class BridgeJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    public static string Serialize(BridgeResponse response) =>
        JsonSerializer.Serialize(response, Options);
}
