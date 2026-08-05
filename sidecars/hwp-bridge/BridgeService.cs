using System.Security.Cryptography;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Madi.HwpBridge;

public sealed class HwpBridgeService
{
    private const long MaximumConvertedFileBytes = 512L * 1024 * 1024;
    private readonly IHancomInstallationProbe installationProbe;
    private readonly IHancomAutomationFactory automationFactory;

    public HwpBridgeService(
        IHancomInstallationProbe installationProbe,
        IHancomAutomationFactory automationFactory)
    {
        this.installationProbe = installationProbe;
        this.automationFactory = automationFactory;
    }

    public async Task<BridgeResponse> ExecuteAsync(
        BridgeRequest request,
        CancellationToken cancellationToken)
    {
        var workerCancellation = new CancellationTokenSource();
        var worker = StaWorker.Start(
            () => ExecuteOnSta(request, workerCancellation.Token));
        var timeout = Task.Delay(request.TimeoutMs);
        var cancelled = CancellationSignal(cancellationToken);
        var completed = await Task.WhenAny(worker, timeout, cancelled).ConfigureAwait(false);

        if (completed == worker)
        {
            workerCancellation.Dispose();
            return await worker.ConfigureAwait(false);
        }

        workerCancellation.Cancel();
        workerCancellation.Dispose();
        return completed == cancelled
            ? Error(request, "CANCELLED", "The bridge operation was cancelled.")
            : Error(request, "TIMEOUT", "The bridge operation timed out.");
    }

    private BridgeResponse ExecuteOnSta(BridgeRequest request, CancellationToken cancellationToken)
    {
        try
        {
            return request switch
            {
                ProbeRequest probe => Probe(probe, cancellationToken),
                ConvertRequest convert => Convert(convert, cancellationToken),
                ReopenVerifyRequest reopen => Reopen(reopen, cancellationToken),
                CancelRequest cancel => Error(
                    cancel,
                    "NO_ACTIVE_OPERATION",
                    "There is no matching active bridge operation."),
                _ => Error(
                    request,
                    "INVALID_REQUEST",
                    "The bridge request is invalid."),
            };
        }
        catch (BridgeFailureException failure)
        {
            return Error(request, failure.Code, failure.SafeMessage);
        }
        catch (OperationCanceledException)
        {
            return Error(request, "CANCELLED", "The bridge operation was cancelled.");
        }
        catch (Exception)
        {
            return Error(request, "INTERNAL_ERROR", "The bridge operation failed safely.");
        }
    }

    private BridgeResponse Probe(ProbeRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var installation = installationProbe.Inspect();
        if (!installation.ComRegistered)
        {
            return BridgeResponse.Probe(
                request,
                available: false,
                availabilityCode: "NOT_INSTALLED",
                installation.Version);
        }

        if (!installation.SecurityModuleRegistered)
        {
            return BridgeResponse.Probe(
                request,
                available: false,
                availabilityCode: "SECURITY_MODULE_REQUIRED",
                installation.Version);
        }

        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            using var session = automationFactory.Create(installation);
            return BridgeResponse.Probe(
                request,
                available: true,
                availabilityCode: "AVAILABLE",
                session.Version ?? installation.Version);
        }
        catch (BridgeFailureException failure)
        {
            return BridgeResponse.Probe(
                request,
                available: false,
                availabilityCode: failure.Code,
                installation.Version);
        }
    }

    private BridgeResponse Convert(ConvertRequest request, CancellationToken cancellationToken)
    {
        var input = BridgePathPolicy.ExistingInput(request.InputHwpx, ".hwpx");
        var output = BridgePathPolicy.Output(request.OutputHwp, ".hwp");
        ValidateOutputState(output);
        cancellationToken.ThrowIfCancellationRequested();

        var installation = RequireAvailableInstallation();
        var temporaryOutput = CreateTemporaryOutputPath(output);
        var committed = false;
        try
        {
            using (var session = automationFactory.Create(installation))
            {
                try
                {
                    session.Open(input, "HWPX", cancellationToken);
                    session.SaveAs(temporaryOutput, "HWP", cancellationToken);
                }
                finally
                {
                    session.CloseOpenedDocument();
                }

                ValidateConvertedFile(temporaryOutput);
                cancellationToken.ThrowIfCancellationRequested();
                var (byteLength, sha256) = HashFile(
                    temporaryOutput,
                    cancellationToken);
                Commit(temporaryOutput, output);
                committed = true;
                return BridgeResponse.Conversion(
                    request,
                    output,
                    byteLength,
                    sha256,
                    session.Version ?? installation.Version);
            }
        }
        finally
        {
            if (!committed)
            {
                DeleteTemporaryFile(temporaryOutput);
            }
        }
    }

    private BridgeResponse Reopen(
        ReopenVerifyRequest request,
        CancellationToken cancellationToken)
    {
        var input = BridgePathPolicy.ExistingInput(request.InputHwp, ".hwp");
        cancellationToken.ThrowIfCancellationRequested();
        var installation = RequireAvailableInstallation();
        using var session = automationFactory.Create(installation);
        try
        {
            session.Open(input, "HWP", cancellationToken);
        }
        catch (BridgeFailureException failure) when (failure.Code == "OPEN_FAILED")
        {
            throw new BridgeFailureException(
                "REOPEN_FAILED",
                "Hancom Office could not reopen the converted document.");
        }
        finally
        {
            session.CloseOpenedDocument();
        }

        return BridgeResponse.Reopen(request, session.Version ?? installation.Version);
    }

    private HancomInstallation RequireAvailableInstallation()
    {
        var installation = installationProbe.Inspect();
        if (!installation.ComRegistered)
        {
            throw new BridgeFailureException(
                "NOT_INSTALLED",
                "Windows Hancom Office automation is not installed.");
        }

        if (!installation.SecurityModuleRegistered)
        {
            throw new BridgeFailureException(
                "SECURITY_MODULE_REQUIRED",
                "The Hancom file-path security module is not registered.");
        }

        return installation;
    }

    private static void ValidateOutputState(string output)
    {
        if (!File.Exists(output))
        {
            return;
        }

        var attributes = File.GetAttributes(output);
        if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
        {
            throw new BridgeFailureException(
                "INVALID_PATH",
                "The requested output path is not a regular file.");
        }

        throw new BridgeFailureException(
            "OUTPUT_EXISTS",
            "The requested output file already exists.");
    }

    private static string CreateTemporaryOutputPath(string output)
    {
        var directory = Path.GetDirectoryName(output)!;
        for (var attempt = 0; attempt < 8; attempt += 1)
        {
            var candidate = Path.Combine(
                directory,
                $".madi-hwp-{Guid.NewGuid():N}.hwp");
            if (!File.Exists(candidate) && !Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new BridgeFailureException(
            "TEMPORARY_OUTPUT_UNAVAILABLE",
            "A private temporary output file could not be reserved.");
    }

    private static void ValidateConvertedFile(string path)
    {
        if (!File.Exists(path) || new FileInfo(path).Length == 0)
        {
            throw new BridgeFailureException(
                "OUTPUT_INVALID",
                "Hancom Office did not create a valid converted file.");
        }
    }

    private static (long ByteLength, string Sha256) HashFile(
        string path,
        CancellationToken cancellationToken)
    {
        using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 64 * 1024,
            FileOptions.SequentialScan);
        var byteLength = stream.Length;
        if (byteLength < 1)
        {
            throw new BridgeFailureException(
                "OUTPUT_INVALID",
                "Hancom Office did not create a valid converted file.");
        }

        if (byteLength > MaximumConvertedFileBytes)
        {
            throw new BridgeFailureException(
                "OUTPUT_TOO_LARGE",
                "The converted HWP file exceeds the size limit.");
        }

        var identity = FileIdentity.FromHandle(stream.SafeFileHandle);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[64 * 1024];
        var remaining = byteLength;
        while (remaining > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var read = stream.Read(
                buffer,
                0,
                (int)Math.Min(buffer.Length, remaining));
            if (read == 0)
            {
                throw new BridgeFailureException(
                    "OUTPUT_CHANGED",
                    "The converted HWP file changed while it was verified.");
            }

            hash.AppendData(buffer, 0, read);
            remaining -= read;
        }

        cancellationToken.ThrowIfCancellationRequested();
        if (stream.Length != byteLength || stream.Position != byteLength)
        {
            throw new BridgeFailureException(
                "OUTPUT_CHANGED",
                "The converted HWP file changed while it was verified.");
        }

        using var verification = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 1,
            FileOptions.None);
        if (
            verification.Length != byteLength ||
            FileIdentity.FromHandle(verification.SafeFileHandle) != identity)
        {
            throw new BridgeFailureException(
                "OUTPUT_CHANGED",
                "The converted HWP file changed while it was verified.");
        }

        return (
            byteLength,
            System.Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant());
    }

    private static void Commit(string temporaryOutput, string output)
    {
        try
        {
            File.Move(temporaryOutput, output, overwrite: false);
        }
        catch (IOException)
        {
            if (File.Exists(output))
            {
                throw new BridgeFailureException(
                    "OUTPUT_EXISTS",
                    "The requested output file already exists.");
            }

            throw new BridgeFailureException(
                "COMMIT_FAILED",
                "The converted file could not be committed atomically.");
        }
        catch (UnauthorizedAccessException)
        {
            throw new BridgeFailureException(
                "COMMIT_FAILED",
                "The converted file could not be committed atomically.");
        }
    }

    private static void DeleteTemporaryFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException)
        {
            // Never replace the requested output after a failed cleanup.
        }
    }

    private static Task CancellationSignal(CancellationToken cancellationToken)
    {
        if (!cancellationToken.CanBeCanceled)
        {
            return Task.Delay(Timeout.InfiniteTimeSpan);
        }

        var signal = new TaskCompletionSource<bool>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        cancellationToken.Register(static state =>
        {
            ((TaskCompletionSource<bool>)state!).TrySetResult(true);
        }, signal);
        return signal.Task;
    }

    private static BridgeResponse Error(
        BridgeRequest request,
        string code,
        string message) =>
        BridgeResponse.Error(request.RequestId, request.Command, code, message);
}

internal readonly record struct FileIdentity(
    uint VolumeSerialNumber,
    uint FileIndexHigh,
    uint FileIndexLow)
{
    public static FileIdentity FromHandle(SafeFileHandle handle)
    {
        if (!GetFileInformationByHandle(handle, out var information))
        {
            throw new BridgeFailureException(
                "OUTPUT_CHANGED",
                "The converted HWP file identity could not be verified.");
        }

        return new FileIdentity(
            information.VolumeSerialNumber,
            information.FileIndexHigh,
            information.FileIndexLow);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle file,
        out ByHandleFileInformation information);

    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleFileInformation
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }
}

internal static class StaWorker
{
    public static Task<BridgeResponse> Start(Func<BridgeResponse> operation)
    {
        var completion = new TaskCompletionSource<BridgeResponse>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                completion.TrySetResult(operation());
            }
            catch (Exception exception)
            {
                completion.TrySetException(exception);
            }
        })
        {
            IsBackground = true,
            Name = "madi-hwp-bridge-sta",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task;
    }
}
