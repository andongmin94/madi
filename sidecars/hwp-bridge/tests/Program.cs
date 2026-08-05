using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Madi.HwpBridge;

namespace Madi.HwpBridge.ContractTests;

public static class Program
{
    private static readonly HancomInstallation AvailableInstallation = new(
        ComRegistered: true,
        SecurityModuleRegistered: true,
        SecurityModulePath: @"C:\Hancom\FilePathCheckerModuleExample.dll",
        Version: "12.0-test");

    public static async Task<int> Main()
    {
        var tests = new (string Name, Func<Task> Run)[]
        {
            ("protocol parse is closed and typed", ProtocolParseIsClosed),
            ("probe reports mock automation availability", ProbeReportsAvailability),
            ("probe reports Hancom not installed", ProbeReportsNotInstalled),
            ("convert rejects relative paths", ConvertRejectsRelativePath),
            ("convert rejects wrong extensions", ConvertRejectsWrongExtension),
            ("convert enforces no-clobber", ConvertEnforcesNoClobber),
            ("convert timeout returns without killing a process", ConvertTimesOutSafely),
            ("convert cancellation cleans up", ConvertCancellationCleansUp),
            ("conversion failure preserves HWPX", ConversionFailurePreservesInput),
            ("conversion rejects oversized output before hashing", ConversionRejectsOversizedOutput),
            ("mock conversion commits exact HWP contract", MockConversionSucceeds),
            ("mock reopen verifies exact HWP contract", MockReopenSucceeds),
            ("JSONL host accepts only targeted cancel", HostAcceptsTargetedCancel),
            ("JSONL host cancels an operation when stdin closes", HostCancelsOnInputEof),
        };

        var failures = 0;
        foreach (var test in tests)
        {
            try
            {
                await test.Run().ConfigureAwait(false);
                Console.WriteLine($"PASS {test.Name}");
            }
            catch (Exception exception)
            {
                failures += 1;
                Console.WriteLine($"FAIL {test.Name}: {exception.GetType().Name}");
            }
        }

        Console.WriteLine($"RESULT total={tests.Length} passed={tests.Length - failures} failed={failures}");
        return failures == 0 ? 0 : 1;
    }

    private static Task ProtocolParseIsClosed()
    {
        var parsed = BridgeProtocol.ParseRequest(
            "{\"requestId\":\"convert_1\",\"command\":\"convert\",\"inputHwpx\":\"C:\\\\in.hwpx\",\"outputHwp\":\"C:\\\\out.hwp\",\"overwrite\":false,\"timeoutMs\":5000}");
        var convert = RequireType<ConvertRequest>(parsed);
        Equal("convert_1", convert.RequestId);
        Equal(@"C:\in.hwpx", convert.InputHwpx);
        False(convert.Overwrite);

        Throws<BridgeProtocolException>(() => BridgeProtocol.ParseRequest(
            "{\"requestId\":\"probe_1\",\"command\":\"probe\",\"timeoutMs\":5000,\"extra\":true}"));
        Throws<BridgeProtocolException>(() => BridgeProtocol.ParseRequest(
            "{\"requestId\":\"probe_1\",\"requestId\":\"probe_2\",\"command\":\"probe\",\"timeoutMs\":5000}"));
        Throws<BridgeProtocolException>(() => BridgeProtocol.ParseRequest(
            "{\"requestId\":\"probe 1\",\"command\":\"probe\",\"timeoutMs\":5000}"));
        Throws<BridgeProtocolException>(() => BridgeProtocol.ParseRequest(
            "{\"requestId\":\"convert_2\",\"command\":\"convert\",\"inputHwpx\":\"C:\\\\in.hwpx\",\"outputHwp\":\"C:\\\\out.hwp\",\"overwrite\":true,\"timeoutMs\":5000}"));
        return Task.CompletedTask;
    }

    private static async Task ProbeReportsAvailability()
    {
        var factory = new FakeAutomationFactory(() => new FakeAutomationSession());
        var service = Service(AvailableInstallation, factory);
        var response = await service.ExecuteAsync(
            new ProbeRequest("probe_1", 2_000),
            CancellationToken.None).ConfigureAwait(false);

        Equal("SUCCESS", response.Status);
        Equal(true, response.Available);
        Equal("AVAILABLE", response.AvailabilityCode);
        Equal(1, factory.CreateCount);
        True(factory.Sessions.Single().Disposed);
    }

    private static async Task ProbeReportsNotInstalled()
    {
        var factory = new FakeAutomationFactory(() => new FakeAutomationSession());
        var service = Service(
            new HancomInstallation(false, false, null, null),
            factory);
        var response = await service.ExecuteAsync(
            new ProbeRequest("probe_2", 2_000),
            CancellationToken.None).ConfigureAwait(false);

        Equal("SUCCESS", response.Status);
        Equal(false, response.Available);
        Equal("NOT_INSTALLED", response.AvailabilityCode);
        Equal(0, factory.CreateCount);
    }

    private static async Task ConvertRejectsRelativePath()
    {
        var factory = new FakeAutomationFactory(() => new FakeAutomationSession());
        var response = await Service(AvailableInstallation, factory).ExecuteAsync(
            new ConvertRequest(
                "convert_relative",
                "relative.hwpx",
                "relative.hwp",
                false,
                2_000),
            CancellationToken.None).ConfigureAwait(false);

        Error(response, "INVALID_PATH");
        Equal(0, factory.CreateCount);
    }

    private static async Task ConvertRejectsWrongExtension()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("input.txt");
        File.WriteAllText(input, "fixture", Encoding.UTF8);
        var factory = new FakeAutomationFactory(() => new FakeAutomationSession());
        var response = await Service(AvailableInstallation, factory).ExecuteAsync(
            ConvertRequest(input, directory.File("output.hwp"), "wrong_extension"),
            CancellationToken.None).ConfigureAwait(false);

        Error(response, "WRONG_EXTENSION");
        Equal(0, factory.CreateCount);
    }

    private static async Task ConvertEnforcesNoClobber()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("input.hwpx");
        var output = directory.File("output.hwp");
        File.WriteAllBytes(input, [1, 2, 3]);
        File.WriteAllBytes(output, [9, 8, 7]);
        var factory = new FakeAutomationFactory(() => new FakeAutomationSession());
        var response = await Service(AvailableInstallation, factory).ExecuteAsync(
            ConvertRequest(input, output, "no_clobber"),
            CancellationToken.None).ConfigureAwait(false);

        Error(response, "OUTPUT_EXISTS");
        SequenceEqual([9, 8, 7], File.ReadAllBytes(output));
        Equal(0, factory.CreateCount);
    }

    private static async Task ConvertTimesOutSafely()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("input.hwpx");
        var output = directory.File("output.hwp");
        File.WriteAllBytes(input, [1, 2, 3]);
        using var release = new ManualResetEventSlim(initialState: false);
        var session = new FakeAutomationSession
        {
            OpenBlock = release,
        };
        var service = Service(
            AvailableInstallation,
            new FakeAutomationFactory(() => session));
        var stopwatch = Stopwatch.StartNew();
        var response = await service.ExecuteAsync(
            new ConvertRequest("timeout", input, output, false, 100),
            CancellationToken.None).ConfigureAwait(false);
        stopwatch.Stop();

        Error(response, "TIMEOUT");
        True(stopwatch.ElapsedMilliseconds < 1_000);
        False(File.Exists(output));
        release.Set();
        True(SpinWait.SpinUntil(() => session.Disposed, 2_000));
        False(Directory.EnumerateFiles(directory.Path, ".madi-hwp-*.hwp").Any());
    }

    private static async Task ConvertCancellationCleansUp()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("input.hwpx");
        var output = directory.File("output.hwp");
        File.WriteAllBytes(input, [1, 2, 3]);
        var session = new FakeAutomationSession
        {
            WaitForCancellationInOpen = true,
        };
        var service = Service(
            AvailableInstallation,
            new FakeAutomationFactory(() => session));
        using var cancellation = new CancellationTokenSource();
        var operation = service.ExecuteAsync(
            new ConvertRequest("cancel_direct", input, output, false, 5_000),
            cancellation.Token);
        True(session.OpenStarted.Wait(2_000));
        cancellation.Cancel();
        var response = await operation.ConfigureAwait(false);

        Error(response, "CANCELLED");
        True(SpinWait.SpinUntil(() => session.Disposed, 2_000));
        True(session.CloseCalled);
        False(File.Exists(output));
        False(Directory.EnumerateFiles(directory.Path, ".madi-hwp-*.hwp").Any());
    }

    private static async Task ConversionFailurePreservesInput()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("input.hwpx");
        var output = directory.File("output.hwp");
        var source = Encoding.UTF8.GetBytes("immutable hwpx fixture");
        File.WriteAllBytes(input, source);
        var session = new FakeAutomationSession
        {
            SaveFailure = new BridgeFailureException(
                "SAVE_FAILED",
                "Hancom Office could not save the converted document."),
        };
        var response = await Service(
            AvailableInstallation,
            new FakeAutomationFactory(() => session)).ExecuteAsync(
                ConvertRequest(input, output, "save_failure"),
                CancellationToken.None).ConfigureAwait(false);

        Error(response, "SAVE_FAILED");
        SequenceEqual(source, File.ReadAllBytes(input));
        False(File.Exists(output));
        True(session.CloseCalled);
        True(session.Disposed);
        False(Directory.EnumerateFiles(directory.Path, ".madi-hwp-*.hwp").Any());
    }

    private static async Task MockConversionSucceeds()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("input.hwpx");
        var output = directory.File("output.hwp");
        File.WriteAllBytes(input, [1, 2, 3]);
        var converted = Encoding.UTF8.GetBytes("mock binary hwp");
        var session = new FakeAutomationSession
        {
            ConvertedBytes = converted,
        };
        var response = await Service(
            AvailableInstallation,
            new FakeAutomationFactory(() => session)).ExecuteAsync(
                ConvertRequest(input, output, "success"),
                CancellationToken.None).ConfigureAwait(false);

        Equal("SUCCESS", response.Status);
        Equal(Path.GetFullPath(output), response.OutputPath);
        Equal((long)converted.Length, response.ByteLength);
        Equal(Sha256(converted), response.Sha256);
        SequenceEqual(converted, File.ReadAllBytes(output));
        Equal((Path.GetFullPath(input), "HWPX"), session.OpenCalls.Single());
        Equal("HWP", session.SaveFormats.Single());
        True(session.CloseCalled);
        True(session.Disposed);
        False(Directory.EnumerateFiles(directory.Path, ".madi-hwp-*.hwp").Any());
    }

    private static async Task ConversionRejectsOversizedOutput()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("input.hwpx");
        var output = directory.File("output.hwp");
        File.WriteAllBytes(input, [1, 2, 3]);
        var session = new FakeAutomationSession
        {
            ConvertedLength = 512L * 1024 * 1024 + 1,
        };
        var response = await Service(
            AvailableInstallation,
            new FakeAutomationFactory(() => session)).ExecuteAsync(
                ConvertRequest(input, output, "oversized"),
                CancellationToken.None).ConfigureAwait(false);

        Error(response, "OUTPUT_TOO_LARGE");
        False(File.Exists(output));
        True(session.CloseCalled);
        True(session.Disposed);
        False(Directory.EnumerateFiles(directory.Path, ".madi-hwp-*.hwp").Any());
    }

    private static async Task MockReopenSucceeds()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("output.hwp");
        File.WriteAllBytes(input, [4, 5, 6]);
        var session = new FakeAutomationSession();
        var response = await Service(
            AvailableInstallation,
            new FakeAutomationFactory(() => session)).ExecuteAsync(
                new ReopenVerifyRequest("reopen", input, 2_000),
                CancellationToken.None).ConfigureAwait(false);

        Equal("SUCCESS", response.Status);
        Equal(true, response.Verified);
        Equal((Path.GetFullPath(input), "HWP"), session.OpenCalls.Single());
        Equal(0, session.SaveFormats.Count);
        True(session.CloseCalled);
        True(session.Disposed);
    }

    private static async Task HostAcceptsTargetedCancel()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("input.hwpx");
        var output = directory.File("output.hwp");
        File.WriteAllBytes(input, [1, 2, 3]);
        var session = new FakeAutomationSession
        {
            WaitForCancellationInOpen = true,
        };
        var host = new BridgeHost(Service(
            AvailableInstallation,
            new FakeAutomationFactory(() => session)));
        var first = JsonSerializer.Serialize(new
        {
            requestId = "host_convert",
            command = "convert",
            inputHwpx = input,
            outputHwp = output,
            overwrite = false,
            timeoutMs = 5_000,
        });
        var cancel = JsonSerializer.Serialize(new
        {
            requestId = "host_cancel",
            command = "cancel",
            targetRequestId = "host_convert",
        });
        using var inputReader = new GatedLineReader(
            first,
            cancel,
            session.OpenStarted);
        using var outputWriter = new StringWriter();
        Equal(0, await host.RunAsync(inputReader, outputWriter).ConfigureAwait(false));

        var lines = outputWriter.ToString()
            .Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        Equal(2, lines.Length);
        using var acknowledgement = JsonDocument.Parse(lines[0]);
        using var terminal = JsonDocument.Parse(lines[1]);
        Equal("host_cancel", acknowledgement.RootElement.GetProperty("requestId").GetString());
        Equal(true, acknowledgement.RootElement.GetProperty("cancelled").GetBoolean());
        Equal("host_convert", terminal.RootElement.GetProperty("requestId").GetString());
        Equal("CANCELLED", terminal.RootElement.GetProperty("errorCode").GetString());
        False(File.Exists(output));
        True(SpinWait.SpinUntil(() => session.Disposed, 2_000));
    }

    private static async Task HostCancelsOnInputEof()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.File("input.hwpx");
        var output = directory.File("output.hwp");
        File.WriteAllBytes(input, [1, 2, 3]);
        var session = new FakeAutomationSession
        {
            WaitForCancellationInOpen = true,
        };
        var host = new BridgeHost(Service(
            AvailableInstallation,
            new FakeAutomationFactory(() => session)));
        var first = JsonSerializer.Serialize(new
        {
            requestId = "host_eof",
            command = "convert",
            inputHwpx = input,
            outputHwp = output,
            overwrite = false,
            timeoutMs = 5_000,
        });
        using var inputReader = new GatedLineReader(first, null, session.OpenStarted);
        using var outputWriter = new StringWriter();
        Equal(0, await host.RunAsync(inputReader, outputWriter).ConfigureAwait(false));

        var lines = outputWriter.ToString()
            .Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        Equal(1, lines.Length);
        using var terminal = JsonDocument.Parse(lines[0]);
        Equal("ERROR", terminal.RootElement.GetProperty("status").GetString());
        Equal("CANCELLED", terminal.RootElement.GetProperty("errorCode").GetString());
        True(SpinWait.SpinUntil(() => session.CloseCalled && session.Disposed, 2_000));
    }

    private static HwpBridgeService Service(
        HancomInstallation installation,
        FakeAutomationFactory factory) =>
        new(new FakeInstallationProbe(installation), factory);

    private static ConvertRequest ConvertRequest(
        string input,
        string output,
        string requestId) =>
        new(requestId, input, output, false, 2_000);

    private static string Sha256(byte[] value) =>
        Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

    private static void Error(BridgeResponse response, string code)
    {
        Equal("ERROR", response.Status);
        Equal(code, response.ErrorCode);
        False(response.Message?.Contains("hwpx fixture", StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private static T RequireType<T>(object value)
    {
        if (value is not T typed)
        {
            throw new InvalidOperationException();
        }

        return typed;
    }

    private static void True(bool value)
    {
        if (!value)
        {
            throw new InvalidOperationException();
        }
    }

    private static void False(bool value) => True(!value);

    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException();
        }
    }

    private static void SequenceEqual(byte[] expected, byte[] actual)
    {
        if (!expected.AsSpan().SequenceEqual(actual))
        {
            throw new InvalidOperationException();
        }
    }

    private static void Throws<T>(Action action)
        where T : Exception
    {
        try
        {
            action();
        }
        catch (T)
        {
            return;
        }

        throw new InvalidOperationException();
    }
}

internal sealed class FakeInstallationProbe : IHancomInstallationProbe
{
    private readonly HancomInstallation installation;

    public FakeInstallationProbe(HancomInstallation installation)
    {
        this.installation = installation;
    }

    public HancomInstallation Inspect() => installation;
}

internal sealed class GatedLineReader : TextReader
{
    private readonly string first;
    private readonly string? second;
    private readonly ManualResetEventSlim secondLineGate;
    private int lineIndex;

    public GatedLineReader(
        string first,
        string? second,
        ManualResetEventSlim secondLineGate)
    {
        this.first = first;
        this.second = second;
        this.secondLineGate = secondLineGate;
    }

    public override ValueTask<string?> ReadLineAsync(CancellationToken cancellationToken)
    {
        var index = Interlocked.Increment(ref lineIndex);
        if (index == 1)
        {
            return ValueTask.FromResult<string?>(first);
        }

        if (index == 2)
        {
            secondLineGate.Wait(cancellationToken);
            return ValueTask.FromResult<string?>(second);
        }

        return ValueTask.FromResult<string?>(null);
    }
}

internal sealed class FakeAutomationFactory : IHancomAutomationFactory
{
    private readonly Func<FakeAutomationSession> create;

    public FakeAutomationFactory(Func<FakeAutomationSession> create)
    {
        this.create = create;
    }

    public List<FakeAutomationSession> Sessions { get; } = [];
    public int CreateCount => Sessions.Count;

    public IHancomAutomationSession Create(HancomInstallation installation)
    {
        var session = create();
        Sessions.Add(session);
        return session;
    }
}

internal sealed class FakeAutomationSession : IHancomAutomationSession
{
    public string? Version => "12.0-mock";
    public List<(string Path, string Format)> OpenCalls { get; } = [];
    public List<string> SaveFormats { get; } = [];
    public ManualResetEventSlim OpenStarted { get; } = new(initialState: false);
    public ManualResetEventSlim? OpenBlock { get; init; }
    public bool WaitForCancellationInOpen { get; init; }
    public BridgeFailureException? SaveFailure { get; init; }
    public byte[] ConvertedBytes { get; init; } = [7, 8, 9];
    public long? ConvertedLength { get; init; }
    public bool CloseCalled { get; private set; }
    public bool Disposed { get; private set; }

    public void Open(string path, string format, CancellationToken cancellationToken)
    {
        OpenCalls.Add((path, format));
        OpenStarted.Set();
        if (WaitForCancellationInOpen)
        {
            cancellationToken.WaitHandle.WaitOne();
            cancellationToken.ThrowIfCancellationRequested();
        }

        if (OpenBlock is not null)
        {
            OpenBlock.Wait();
            cancellationToken.ThrowIfCancellationRequested();
        }

        cancellationToken.ThrowIfCancellationRequested();
    }

    public void SaveAs(string path, string format, CancellationToken cancellationToken)
    {
        SaveFormats.Add(format);
        cancellationToken.ThrowIfCancellationRequested();
        if (SaveFailure is not null)
        {
            throw SaveFailure;
        }

        if (ConvertedLength is long convertedLength)
        {
            using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write);
            stream.SetLength(convertedLength);
            return;
        }

        File.WriteAllBytes(path, ConvertedBytes);
    }

    public void CloseOpenedDocument()
    {
        CloseCalled = true;
    }

    public void Dispose()
    {
        CloseCalled = true;
        Disposed = true;
    }
}

internal sealed class TemporaryDirectory : IDisposable
{
    public TemporaryDirectory()
    {
        Path = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            $"madi-hwp-bridge-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }
    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        if (Directory.Exists(Path))
        {
            Directory.Delete(Path, recursive: true);
        }
    }
}
