using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Runtime.ExceptionServices;
using System.Diagnostics;
using Microsoft.Win32.SafeHandles;

namespace Madi.HwpBridge;

public sealed class HwpBridgeService
{
    private const long MaximumConvertedFileBytes = 512L * 1024 * 1024;
    private readonly IHancomInstallationProbe installationProbe;
    private readonly IHancomAutomationFactory automationFactory;
    private OperationControl? activeOperation;
    // One drain bound includes the owned native 5000ms exit wait and STA completion.
    private const int WorkerCleanupBudgetMs = 6_000;

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
        var control = new OperationControl(request.RequestId, request.TimeoutMs);
        if (Interlocked.CompareExchange(ref activeOperation, control, null) is not null)
        {
            control.Dispose();
            return Error(request, "BUSY", "The bridge is already processing another operation.");
        }
        using var externalCancellation = cancellationToken.Register(
            () => control.TryStop("CANCELLED"));
        using var deadlineCancellation = new CancellationTokenSource();
        var worker = StaWorker.Start(() => ExecuteOnSta(request, control));
        Task drained = worker;
        try
        {
            var timeout = Task.Delay(request.TimeoutMs, deadlineCancellation.Token);
            var winner = await Task.WhenAny(worker, timeout, control.Stopped).ConfigureAwait(false);
            if (winner != worker)
            {
                if (winner == timeout)
                {
                    control.TryStop("TIMEOUT");
                }
            }
            // Even a completed worker may race an already-started Abort callback.
            // Both must drain before a terminal response or CTS disposal.
            var cancellationCompletion = control.CancellationCompletion;
            drained = Task.WhenAll(worker, cancellationCompletion);
            if (await Task.WhenAny(drained, Task.Delay(WorkerCleanupBudgetMs))
                    .ConfigureAwait(false) != drained)
            {
                control.SealFailure();
                return Error(
                    request,
                    control.PrimaryCode ?? control.StopCode ?? "COMMIT_OUTCOME_UNKNOWN",
                    "The bridge operation could not finish safely.",
                    "WORKER_CLEANUP_TIMEOUT");
            }
            if (cancellationCompletion.IsFaulted)
            {
                _ = cancellationCompletion.Exception;
                return Error(
                    request,
                    control.PrimaryCode ?? control.StopCode ?? "INTERNAL_ERROR",
                    "The bridge operation could not finish safely.",
                    "OWNED_ABORT_FAILED");
            }
            return await worker.ConfigureAwait(false);
        }
        finally
        {
            deadlineCancellation.Cancel();
            Interlocked.CompareExchange(ref activeOperation, null, control);
            if (drained.IsCompleted)
            {
                _ = drained.Exception;
                control.Dispose();
            }
            else
            {
                _ = drained.ContinueWith(
                    completed => { _ = completed.Exception; control.Dispose(); },
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
            }
        }
    }

    public bool TryCancel(string targetRequestId) =>
        Volatile.Read(ref activeOperation) is { } operation &&
        string.Equals(operation.RequestId, targetRequestId, StringComparison.Ordinal) &&
        operation.TryStop("CANCELLED");

    private BridgeResponse ExecuteOnSta(BridgeRequest request, OperationControl control)
    {
        BridgeResponse response;
        try
        {
            response = request switch
            {
                ProbeRequest probe => Probe(probe, control.Token),
                ConvertRequest convert => Convert(convert, control),
                ReopenVerifyRequest reopen => Reopen(reopen, control),
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
            control.RecordPrimary(failure);
            response = Error(request, failure.Code, failure.SafeMessage);
        }
        catch (OperationCanceledException)
        {
            response = Error(
                request, control.PrimaryCode ?? control.StopCode ?? "CANCELLED",
                "The bridge operation was stopped.");
        }
        catch (Exception failure)
        {
            control.RecordPrimary(failure);
            response = Error(request, "INTERNAL_ERROR", "The bridge operation failed safely.");
        }
        if (control.CleanupErrorCode is { } cleanupCode)
        {
            response = response.Status == "SUCCESS"
                ? Error(request, "CLEANUP_FAILED", "The bridge could not finish cleanup safely.", cleanupCode)
                : response with { CleanupErrorCode = cleanupCode };
        }
        control.Finish();
        return response;
    }

    private BridgeResponse Probe(ProbeRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var installation = installationProbe.Inspect();
        if (!installation.ComRegistrationPresent)
        {
            return BridgeResponse.Probe(
                request,
                available: false,
                availabilityCode: "NOT_INSTALLED",
                null);
        }

        if (!installation.SecurityModuleRegistrationPresent)
        {
            return BridgeResponse.Probe(
                request,
                available: false,
                availabilityCode: "SECURITY_MODULE_REQUIRED",
                null);
        }

        // Availability probing must not activate Automation. Hancom may attach a
        // COM object to an existing user window, and ownership cannot be proven
        // without an explicit conversion session. Keep HWP disabled until the
        // installed product is validated by the separate manual gate.
        return BridgeResponse.Probe(
            request,
            available: false,
            availabilityCode: "REGISTERED_UNVERIFIED",
            null);
    }

    private BridgeResponse Convert(ConvertRequest request, OperationControl control)
    {
        var cancellationToken = control.Token;
        var input = BridgePathPolicy.ExistingInput(request.InputHwpx, ".hwpx");
        var output = BridgePathPolicy.Output(request.OutputHwp, ".hwp");
        ValidateOutputState(output);
        cancellationToken.ThrowIfCancellationRequested();

        var installation = RequireAvailableInstallation();
        var temporaryOutput = CreateTemporaryOutputPath(output);
        var committed = false;
        try
        {
            var version = RunSession(installation, control, session =>
            {
                session.Open(input, "HWPX", cancellationToken);
                session.SaveAs(temporaryOutput, "HWP", cancellationToken);
            });
            ValidateConvertedFile(temporaryOutput);
            var (byteLength, sha256) = HashFile(temporaryOutput, cancellationToken);
            if (!control.TryBeginCommit())
            {
                throw new OperationCanceledException(cancellationToken);
            }
            Commit(temporaryOutput, output);
            committed = true;
            return BridgeResponse.Conversion(request, output, byteLength, sha256, version);
        }
        finally
        {
            if (!committed)
            {
                if (DeleteTemporaryFile(temporaryOutput) is { } cleanupCode)
                {
                    control.RecordCleanup(cleanupCode);
                }
            }
        }
    }

    private BridgeResponse Reopen(
        ReopenVerifyRequest request,
        OperationControl control)
    {
        var cancellationToken = control.Token;
        var input = BridgePathPolicy.ExistingInput(request.InputHwp, ".hwp");
        cancellationToken.ThrowIfCancellationRequested();
        var installation = RequireAvailableInstallation();
        var version = RunSession(installation, control, session =>
        {
            try
            {
                session.Open(input, "HWP", cancellationToken);
            }
            catch (BridgeFailureException failure) when (failure.Code == "OPEN_FAILED")
            {
                throw new BridgeFailureException(
                    "REOPEN_FAILED",
                    "Hancom Office could not reopen the converted document.",
                    failure.CleanupErrorCode);
            }
        });
        if (!control.TryBeginCommit())
        {
            throw new OperationCanceledException(cancellationToken);
        }
        return BridgeResponse.Reopen(request, version);
    }

    private string? RunSession(
        HancomInstallation installation,
        OperationControl control,
        Action<IHancomAutomationSession> operation)
    {
        IHancomAutomationSession? session = null;
        Exception? primaryFailure = null;
        string? version = null;
        try
        {
            session = automationFactory.Create(installation, control.Token);
            operation(session);
            version = session.Version;
        }
        catch (Exception failure)
        {
            primaryFailure = failure;
            control.RecordPrimary(failure);
        }
        finally
        {
            if (session is not null)
            {
                try { session.CloseOpenedDocument(); }
                catch (Exception failure) { control.RecordCleanup(SafeCleanupCode(failure)); }
                try { session.Dispose(); }
                catch (Exception failure) { control.RecordCleanup(SafeCleanupCode(failure)); }
            }
        }
        if (primaryFailure is not null)
        {
            ExceptionDispatchInfo.Capture(primaryFailure).Throw();
        }
        if (control.CleanupErrorCode is not null)
        {
            throw new BridgeFailureException("CLEANUP_FAILED", "The bridge cleanup failed safely.");
        }
        control.Token.ThrowIfCancellationRequested();
        return version;
    }

    private static string SafeCleanupCode(Exception failure) =>
        failure is BridgeFailureException typed ? typed.Code : "CLEANUP_FAILED";

    private HancomInstallation RequireAvailableInstallation()
    {
        var installation = installationProbe.Inspect();
        if (!installation.ComRegistrationPresent)
        {
            throw new BridgeFailureException(
                "NOT_INSTALLED",
                "Windows Hancom Office automation is not installed.");
        }

        if (!installation.SecurityModuleRegistrationPresent)
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

    private static string? DeleteTemporaryFile(string path)
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
            return "TEMPORARY_OUTPUT_CLEANUP_FAILED";
        }
        return null;
    }

    private sealed class OperationControl : IDisposable
    {
        private readonly object gate = new();
        private readonly CancellationTokenSource cancellation = new();
        private readonly Stopwatch elapsed = Stopwatch.StartNew();
        private readonly int timeoutMs;
        private readonly TaskCompletionSource<bool> stopped = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private Task cancellationCompletion = Task.CompletedTask;
        private string? stopCode;
        private string? primaryCode;
        private string? cleanupErrorCode;
        private bool commitReserved;
        private bool finished;

        public OperationControl(string requestId, int timeoutMs)
        {
            RequestId = requestId;
            this.timeoutMs = timeoutMs;
        }
        public string RequestId { get; }
        public CancellationToken Token => cancellation.Token;
        public Task Stopped => stopped.Task;
        public Task CancellationCompletion { get { lock (gate) return cancellationCompletion; } }
        public string? StopCode { get { lock (gate) return stopCode; } }
        public string? PrimaryCode { get { lock (gate) return primaryCode; } }
        public string? CleanupErrorCode { get { lock (gate) return cleanupErrorCode; } }

        public bool TryStop(string code)
        {
            lock (gate)
            {
                if (commitReserved || finished) return false;
                if (stopCode is not null) return true;
                stopCode = code;
                cancellationCompletion = cancellation.CancelAsync();
                stopped.TrySetResult(true);
                return true;
            }
        }
        public bool TryBeginCommit()
        {
            lock (gate)
            {
                if (stopCode is not null || finished || commitReserved) return false;
                if (elapsed.ElapsedMilliseconds >= timeoutMs)
                {
                    TryStop("TIMEOUT");
                    return false;
                }
                commitReserved = true;
                return true;
            }
        }
        public void RecordPrimary(Exception failure)
        {
            lock (gate)
            {
                primaryCode ??= failure switch
                {
                    BridgeFailureException typed => typed.Code,
                    OperationCanceledException => stopCode ?? "CANCELLED",
                    _ => "INTERNAL_ERROR",
                };
                if (failure is BridgeFailureException { CleanupErrorCode: { } code })
                    cleanupErrorCode ??= code;
            }
        }
        public void RecordCleanup(string code) { lock (gate) cleanupErrorCode ??= code; }
        public void SealFailure() { lock (gate) finished = true; }
        public void Finish() { lock (gate) finished = true; }
        public void Dispose() => cancellation.Dispose();
    }

    private static BridgeResponse Error(
        BridgeRequest request,
        string code,
        string message,
        string? cleanupErrorCode = null) =>
        BridgeResponse.Error(request.RequestId, request.Command, code, message, cleanupErrorCode);
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
