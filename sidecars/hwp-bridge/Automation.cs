using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using Microsoft.Win32;

namespace Madi.HwpBridge;

public sealed record HancomInstallation(
    bool ComRegistrationPresent,
    bool SecurityModuleRegistrationPresent);

public interface IHancomInstallationProbe
{
    HancomInstallation Inspect();
}

public interface IHancomAutomationFactory
{
    IHancomAutomationSession Create(HancomInstallation installation, CancellationToken cancellationToken);
}

public interface IHancomAutomationSession : IDisposable
{
    string? Version { get; }
    void Open(string path, string format, CancellationToken cancellationToken);
    void SaveAs(string path, string format, CancellationToken cancellationToken);
    void CloseOpenedDocument();
}

public sealed class WindowsHancomInstallationProbe : IHancomInstallationProbe
{
    private const string ProgId = "HWPFrame.HwpObject.2";
    private const string SecurityModuleRegistryPath = @"Software\HNC\HwpAutomation\Modules";
    private const string SecurityModuleName = "FilePathCheckerModuleExample";

    public HancomInstallation Inspect()
    {
        if (!OperatingSystem.IsWindows())
        {
            return new HancomInstallation(false, false);
        }

        try
        {
            using var classes = RegistryKey.OpenBaseKey(
                RegistryHive.ClassesRoot,
                RegistryView.Registry32);
            using var progId = classes.OpenSubKey($@"{ProgId}\CLSID", writable: false);
            var classId = progId?.GetValue(null) as string;
            string? localServerCommand = null;
            if (Guid.TryParse(classId, out var parsedClassId))
            {
                using var server = classes.OpenSubKey(
                    $@"CLSID\{parsedClassId:B}\LocalServer32",
                    writable: false);
                localServerCommand = server?.GetValue(null) as string;
            }

            using var currentUser = RegistryKey.OpenBaseKey(
                RegistryHive.CurrentUser,
                RegistryView.Default);
            using var modules = currentUser.OpenSubKey(
                SecurityModuleRegistryPath,
                writable: false);
            var moduleRegistration = modules?.GetValue(SecurityModuleName) as string;
            return ClassifyRegistration(
                classId,
                localServerCommand,
                moduleRegistration);
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or
                ArgumentException or System.Security.SecurityException)
        {
            return new HancomInstallation(false, false);
        }
    }

    public static HancomInstallation ClassifyRegistration(
        string? classId,
        string? localServerCommand,
        string? securityModuleRegistration)
    {
        return new HancomInstallation(
            Guid.TryParse(classId, out _) &&
                !string.IsNullOrWhiteSpace(localServerCommand),
            !string.IsNullOrWhiteSpace(securityModuleRegistration));
    }
}

public sealed class HancomComAutomationFactory : IHancomAutomationFactory
{
    public IHancomAutomationSession Create(HancomInstallation installation, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!OperatingSystem.IsWindows() || !installation.ComRegistrationPresent)
            throw new BridgeFailureException("NOT_INSTALLED", "Windows Hancom Office automation is not installed.");
        if (!installation.SecurityModuleRegistrationPresent)
            throw new BridgeFailureException("SECURITY_MODULE_REQUIRED", "The Hancom file-path security module is not registered.");
        // Normal UI probe remains registry-only and disabled. This preflight
        // proves isolation, not approval: the trial runner must independently
        // pin the approved executable, module registration/file and input.
        return new HancomComAutomationSession(OwnedHancomProcess.Preflight(), cancellationToken);
    }
}

internal sealed class HancomComAutomationSession : IHancomAutomationSession
{
    private const string ExactRotName = "!HwpObject.120.1";
    private readonly string desktop;
    private readonly CancellationToken lifetimeCancellation;
    private CancellationTokenRegistration abortRegistration;
    private OwnedHancomProcess? owner;
    private object? automation, window, documents, document;
    private IntPtr hwnd;
    private string expectedName = "";
    private bool openedProof, finished, closedSuccessfully, inputGuardFailed, closeRejected;
    private BridgeFailureException? finishFailure;

    internal HancomComAutomationSession(string desktop, CancellationToken cancellationToken)
    {
        this.desktop = desktop;
        lifetimeCancellation = cancellationToken;
    }

    // Snapshot, never a COM getter during/after Dispose.
    public string? Version { get; private set; }
    private dynamic Root => automation ?? throw new InvalidOperationException();

    public void Open(string path, string format, CancellationToken cancellationToken)
    {
        CheckCancellation(cancellationToken);
        if (owner is not null || finished || format is not ("HWPX" or "HWP"))
            throw Failure("OPEN_FAILED");
        try
        {
            expectedName = Path.GetFullPath(path);
            owner = new OwnedHancomProcess(desktop);
            // Installed immediately after owner creation, before native start,
            // ROT retrieval, or any COM getter/mutation.
            abortRegistration = lifetimeCancellation.Register(static value => ((OwnedHancomProcess)value!).Abort(), owner);
            owner.Start(expectedName, lifetimeCancellation);
            automation = ReadExactRotObject();
            object? windows = null;
            Exception? windowPrimary = null;
            try
            {
                OwnedCall(() => { windows = (object)Root.XHwpWindows; return true; });
                if (OwnedCall(() => (int)((dynamic)windows!).Count) != 1) throw Failure("OWNERSHIP_FAILED");
                OwnedCall(() => { window = (object)((dynamic)windows!).Item(0); return true; });
            }
            catch (Exception error) { windowPrimary = error; throw; }
            finally { ReleaseTemporary(windows, windowPrimary); }
            int signedHwnd = OwnedCall(() => ((IXHwpWindowInspection)window!).WindowHandle);
            hwnd = new IntPtr(signedHwnd);
            owner.GuardWindow(hwnd);
            OwnedCall(() => { documents = (object)Root.XHwpDocuments; return true; });
            if (OwnedCall(() => (int)((dynamic)documents!).Count) != 1) throw Failure("OWNERSHIP_FAILED");
            OwnedCall(() => { document = (object)((dynamic)documents!).Active_XHwpDocument; return true; });

            var ready = Stopwatch.StartNew();
            bool exact = false;
            for (int sample = 0; sample < 30 && ready.ElapsedMilliseconds < 15_000; sample++)
            {
                CheckCancellation(cancellationToken);
                string? name = OwnedCall(() => ((IXHwpDocumentInspection)document!).FullName);
                exact = OwnedHancomProcess.ExactPath(name, expectedName) && ready.ElapsedMilliseconds < 15_000;
                if (exact) break;
                int remaining = (int)Math.Max(0, 15_000 - ready.ElapsedMilliseconds);
                if (remaining > 0) Thread.Sleep(Math.Min(500, remaining));
            }
            if (!exact) throw Failure("OPEN_FAILED");
            EnsureDocument(expectedName);
            openedProof = true;
            // Unlike the diagnostic's unnamed-blank activation, product trial
            // mutation requires the complete known, nonempty document proof.
            OwnedCall(() => { ((IXHwpDocumentInspection)document!).SetActive_XHwpDocument(); return true; });
            EnsureDocument(expectedName);
            CheckCancellation(cancellationToken);
            object? registered = OwnedCall(() => (object?)Root.RegisterModule("FilePathCheckDLL", "FilePathCheckerModuleExample"));
            if (registered is not true) throw Failure("SECURITY_MODULE_REQUIRED");
            EnsureDocument(expectedName);
            Version = OwnedCall(() => (string?)Root.Version);
            CheckCancellation(cancellationToken);
        }
        catch (OperationCanceledException) { throw; }
        catch (COMException error) when (IsOwnedAbortDisconnection(error,
            lifetimeCancellation.IsCancellationRequested, owner?.AbortStarted == true))
        {
            throw new OperationCanceledException("The owned Hancom operation was cancelled.", error, lifetimeCancellation);
        }
        catch (BridgeFailureException) { throw; }
        catch { throw Failure("OPEN_FAILED"); }
    }

    public void SaveAs(string path, string format, CancellationToken cancellationToken)
    {
        CheckCancellation(cancellationToken);
        if (!openedProof || finished || format != "HWP") throw Failure("SAVE_FAILED");
        try
        {
            string target = Path.GetFullPath(path);
            EnsureDocument(expectedName);
            CheckCancellation(cancellationToken);
            object? saved = OwnedCall(() => (object?)Root.SaveAs(target, format, ""));
            if (saved is not true) throw Failure("SAVE_FAILED");
            // Native true alone does not advance document identity. Captured
            // and current active FullName, Count, IsEmpty/Modified must agree.
            EnsureDocument(target);
            expectedName = target;
            CheckCancellation(cancellationToken);
        }
        catch (OperationCanceledException) { throw; }
        catch (COMException error) when (IsOwnedAbortDisconnection(error,
            lifetimeCancellation.IsCancellationRequested, owner?.AbortStarted == true))
        {
            throw new OperationCanceledException("The owned Hancom operation was cancelled.", error, lifetimeCancellation);
        }
        catch (BridgeFailureException) { throw; }
        catch { throw Failure("SAVE_FAILED"); }
    }

    private void EnsureDocument(string name)
    {
        if (document is null || documents is null || automation is null || owner is null || finished)
            throw Failure("OWNERSHIP_FAILED");
        if (OwnedCall(() => (int)((dynamic)documents).Count) != 1) throw Failure("OWNERSHIP_FAILED");
        object? active = null;
        Exception? primary = null;
        try
        {
            OwnedCall(() => { active = (object?)((dynamic)documents).Active_XHwpDocument; return true; });
            if (active is null || !OwnedHancomProcess.ExactPath(OwnedCall(() => ((IXHwpDocumentInspection)active).FullName), name))
                throw Failure("OWNERSHIP_FAILED");
        }
        catch (Exception error) { primary = error; throw; }
        finally
        {
            ReleaseTemporary(active, primary);
        }
        string? capturedName = OwnedCall(() => ((IXHwpDocumentInspection)document).FullName);
        bool empty = OwnedCall(() => ((IHwpObjectInspection)automation).IsEmpty);
        bool modified = OwnedCall(() => ((IHwpObjectInspection)automation).IsModified);
        if (!OwnedHancomProcess.ExactPath(capturedName, name) || empty || modified)
            throw Failure("OWNERSHIP_FAILED");
    }

    private T OwnedCall<T>(Func<T> action)
    {
        GuardContext();
        Exception? primary = null;
        try { return action(); }
        catch (Exception error) { primary = error; throw; }
        finally
        {
            try { GuardContext(); }
            catch (OperationCanceledException) { if (primary is null) throw; }
            catch { inputGuardFailed = true; if (primary is null) throw; }
        }
    }

    private void GuardContext()
    {
        if (owner is null) throw Failure("OWNERSHIP_FAILED");
        owner.AssertInput();
        lifetimeCancellation.ThrowIfCancellationRequested();
        if (hwnd == IntPtr.Zero) owner.GuardProcess(); else owner.GuardWindow(hwnd);
    }

    private T InputCall<T>(Func<T> action)
    {
        owner!.AssertInput();
        Exception? primary = null;
        try { return action(); }
        catch (Exception error) { primary = error; throw; }
        finally
        {
            try { owner.AssertInput(); }
            catch { inputGuardFailed = true; if (primary is null) throw; }
        }
    }

    public void CloseOpenedDocument() => Finish();
    public void Dispose() => Finish();

    private void Finish()
    {
        if (finished)
        {
            if (finishFailure is not null) throw finishFailure;
            return;
        }
        try
        {
            if (owner is not null && lifetimeCancellation.IsCancellationRequested)
            {
                owner.Abort();
                owner.ConfirmCancelledExit();
                // Safe cancelled owned abort; never a natural exit claim.
            }
            else if (owner is not null)
            {
                if (!openedProof || document is null || automation is null || inputGuardFailed)
                    throw Failure("CLEANUP_FAILED");
                EnsureDocument(expectedName);
                bool closed = InputCall(() => ((IXHwpDocumentInspection)document).Close(false));
                closeRejected = !closed;
                if (!closed || inputGuardFailed) throw Failure("CLEANUP_FAILED");
                if (!owner.HasExited)
                {
                    lifetimeCancellation.ThrowIfCancellationRequested();
                    owner.GuardTerminalProcess();
                    InputCall(() => { Root.Quit(); return true; });
                }
                owner.WaitNaturalExit();
                closedSuccessfully = true;
            }
        }
        catch
        {
            if (owner is not null && lifetimeCancellation.IsCancellationRequested && !closeRejected && !inputGuardFailed)
            {
                try { owner.Abort(); owner.ConfirmCancelledExit(); }
                catch { finishFailure = Failure("CLEANUP_FAILED"); }
            }
            else
            {
                finishFailure = Failure("CLEANUP_FAILED");
                owner?.Abort();
            }
        }
        finally
        {
            // Waits for an in-flight kernel-only cancellation callback before
            // releasing its job/process handles. COM releases stay on the STA.
            abortRegistration.Dispose();
            foreach (object? value in new[] { document, documents, window, automation })
            {
                try { ReleaseGetter(value); }
                catch { finishFailure ??= Failure("CLEANUP_FAILED"); }
            }
            document = documents = window = automation = null;
            try { owner?.Dispose(); }
            catch { finishFailure ??= Failure("CLEANUP_FAILED"); }
            finished = true;
            if (owner is not null && !closedSuccessfully && !lifetimeCancellation.IsCancellationRequested)
                finishFailure ??= Failure("CLEANUP_FAILED");
        }
        if (finishFailure is not null) throw finishFailure;
    }

    private object ReadExactRotObject()
    {
        IRunningObjectTable? table = null;
        IBindCtx? context = null;
        IEnumMoniker? enumerator = null;
        object? instance = null;
        Exception? primary = null;
        var candidates = new List<IMoniker>();
        try
        {
            if (GetRunningObjectTable(0, out table) != 0 || CreateBindCtx(0, out context) != 0)
                throw Failure("AUTOMATION_UNAVAILABLE");
            table!.EnumRunning(out enumerator);
            var row = new IMoniker[1];
            int examined = 0, allHancom = 0;
            while (true)
            {
                int next = enumerator!.Next(1, row, IntPtr.Zero);
                if (next == 1) break;
                if (next != 0 || row[0] is null || ++examined > 512) throw Failure("AUTOMATION_UNAVAILABLE");
                IMoniker? value = row[0];
                row[0] = null!;
                Exception? monikerPrimary = null;
                try
                {
                    value.GetDisplayName(context!, null, out string name);
                    if (name.StartsWith("!HwpObject", StringComparison.Ordinal))
                    {
                        allHancom++;
                        if (name == ExactRotName) { candidates.Add(value); value = null; }
                    }
                }
                catch (Exception error) { monikerPrimary = error; throw; }
                finally { ReleaseTemporary(value, monikerPrimary); }
            }
            if (allHancom != 1 || candidates.Count != 1) throw Failure("AUTOMATION_UNAVAILABLE");
            owner!.GuardProcess();
            int result = table!.GetObject(candidates[0], out instance);
            if (result != 0 || instance is null) throw Failure("AUTOMATION_UNAVAILABLE");
            _ = (IHwpObjectInspection)instance;
            owner!.GuardProcess();
            return instance;
        }
        catch (Exception error)
        {
            primary = error;
            ReleaseTemporary(instance, primary);
            instance = null;
            throw;
        }
        finally
        {
            bool releaseFailed = false;
            foreach (object? value in candidates.Cast<object?>().Concat(new object?[] { enumerator, context, table }))
            {
                try { ReleaseGetter(value); }
                catch { releaseFailed = true; finishFailure ??= Failure("CLEANUP_FAILED"); }
            }
            if (releaseFailed && primary is null)
            {
                // A return value has not been transferred to the caller if this
                // finally fails. Release it too, and retain the cleanup error.
                ReleaseTemporary(instance, finishFailure);
                throw finishFailure!;
            }
        }
    }

    private void CheckCancellation(CancellationToken cancellationToken)
    {
        lifetimeCancellation.ThrowIfCancellationRequested();
        cancellationToken.ThrowIfCancellationRequested();
    }

    internal static bool IsOwnedAbortDisconnection(COMException error, bool cancellationRequested, bool ownedAbortStarted)
    {
        // Exact COM RPC statuses from the installed SDK's winerror.h. Other
        // failures, including native BOOL false, keep their original outcome.
        return cancellationRequested && ownedAbortStarted && error.HResult is
            unchecked((int)0x80010007) or // RPC_E_SERVER_DIED.
            unchecked((int)0x80010012) or // RPC_E_SERVER_DIED_DNE.
            unchecked((int)0x80010108);   // RPC_E_DISCONNECTED.
    }

    // Each real getter/ROT acquisition has exactly one release. Interface casts
    // alias that RCW and must not add a release or use FinalReleaseComObject.
    private static void ReleaseGetter(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
    }

    private void ReleaseTemporary(object? value, Exception? primary)
    {
        try { ReleaseGetter(value); }
        catch
        {
            finishFailure ??= Failure("CLEANUP_FAILED");
            if (primary is null) throw finishFailure;
        }
    }

    private static BridgeFailureException Failure(string code) => new(code, code switch
    {
        "SECURITY_MODULE_REQUIRED" => "Hancom did not accept the approved file-path security module.",
        "SAVE_FAILED" => "Hancom could not save the known trial document safely.",
        "OPEN_FAILED" => "Hancom could not bind the known trial document safely.",
        "CLEANUP_FAILED" => "The owned Hancom session did not finish safely.",
        _ => "The private Hancom session ownership could not be verified.",
    });

    [DllImport("ole32.dll")] private static extern int GetRunningObjectTable(uint reserved, out IRunningObjectTable table);
    [DllImport("ole32.dll")] private static extern int CreateBindCtx(uint reserved, out IBindCtx context);
    [ComImport, Guid("aeb10cd9-3a09-4752-b2ab-947137273436"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    private interface IXHwpDocumentInspection
    {
        [DispId(3)] string? FullName { [return: MarshalAs(UnmanagedType.BStr)] get; }
        [DispId(15007)] void SetActive_XHwpDocument();
        [DispId(15000)] [return: MarshalAs(UnmanagedType.VariantBool)] bool Close([In, MarshalAs(UnmanagedType.VariantBool)] bool isDirty);
    }
    [ComImport, Guid("5e6a8276-cf1c-42b8-bced-319548b02af6"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    private interface IHwpObjectInspection
    {
        [DispId(1)] bool IsModified { [return: MarshalAs(UnmanagedType.VariantBool)] get; }
        [DispId(2)] bool IsEmpty { [return: MarshalAs(UnmanagedType.VariantBool)] get; }
    }
    [ComImport, Guid("d87d278f-9d76-45be-9aa1-a93a7aa410c9"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    private interface IXHwpWindowInspection { [DispId(10)] int WindowHandle { get; } }
}
