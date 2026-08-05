using System.Text;

namespace Madi.HwpBridge;

public static class Program
{
    public static async Task<int> Main()
    {
        Console.InputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        var service = new HwpBridgeService(
            new WindowsHancomInstallationProbe(),
            new HancomComAutomationFactory());
        var host = new BridgeHost(service);
        return await host.RunAsync(Console.In, Console.Out).ConfigureAwait(false);
    }
}
