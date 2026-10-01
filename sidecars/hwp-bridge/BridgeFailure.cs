namespace Madi.HwpBridge;

public sealed class BridgeFailureException : Exception
{
    public BridgeFailureException(string code, string safeMessage, string? cleanupErrorCode = null)
        : base(safeMessage)
    {
        Code = code;
        SafeMessage = safeMessage;
        CleanupErrorCode = cleanupErrorCode;
    }

    public string Code { get; }
    public string SafeMessage { get; }
    public string? CleanupErrorCode { get; }
}
