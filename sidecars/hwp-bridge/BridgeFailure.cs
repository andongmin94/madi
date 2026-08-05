namespace Madi.HwpBridge;

public sealed class BridgeFailureException : Exception
{
    public BridgeFailureException(string code, string safeMessage)
        : base(safeMessage)
    {
        Code = code;
        SafeMessage = safeMessage;
    }

    public string Code { get; }
    public string SafeMessage { get; }
}
