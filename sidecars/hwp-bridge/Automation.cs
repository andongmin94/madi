using System.Runtime.InteropServices;
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
    IHancomAutomationSession Create(HancomInstallation installation);
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
    public IHancomAutomationSession Create(HancomInstallation installation)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new BridgeFailureException(
                "NOT_INSTALLED",
                "Windows Hancom Office automation is not installed.");
        }

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

        return HancomComAutomationSession.Create();
    }
}

internal sealed class HancomComAutomationSession : IHancomAutomationSession
{
    private const string ProgId = "HWPFrame.HwpObject.2";
    private const string SecurityModuleType = "FilePathCheckDLL";
    private const string SecurityModuleName = "FilePathCheckerModuleExample";

    // Conservative standard-dialog responses from the official automation manual:
    // OK, Cancel, Abort, Cancel, No, Cancel for the six Win32 dialog groups.
    private const int ConservativeMessageBoxMode = 0x00224121;

    private dynamic? automation;
    private dynamic? ownedWindow;
    private dynamic? openedDocument;
    private int? previousMessageBoxMode;

    private HancomComAutomationSession(dynamic automation)
    {
        this.automation = automation;
    }

    public string? Version { get; private set; }

    public static HancomComAutomationSession Create()
    {
        object? instance = null;
        try
        {
            var type = Type.GetTypeFromProgID(ProgId, throwOnError: true);
            instance = Activator.CreateInstance(type!);
            if (instance is null)
            {
                throw new BridgeFailureException(
                    "AUTOMATION_UNAVAILABLE",
                    "Hancom Office automation could not be started.");
            }

            var session = new HancomComAutomationSession((dynamic)instance);
            session.Initialize();
            return session;
        }
        catch (BridgeFailureException)
        {
            Release(instance);
            throw;
        }
        catch (Exception)
        {
            Release(instance);
            throw new BridgeFailureException(
                "AUTOMATION_UNAVAILABLE",
                "Hancom Office automation could not be started.");
        }
    }

    public void Open(string path, string format, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            var opened = (bool)automation!.Open(path, format, "");
            if (!opened)
            {
                throw new BridgeFailureException(
                    "OPEN_FAILED",
                    "Hancom Office could not open the requested document.");
            }

            openedDocument = automation.XHwpDocuments.Active_XHwpDocument;
            cancellationToken.ThrowIfCancellationRequested();
        }
        catch (BridgeFailureException)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            throw new BridgeFailureException(
                "OPEN_FAILED",
                "Hancom Office could not open the requested document.");
        }
    }

    public void SaveAs(string path, string format, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            var saved = (bool)automation!.SaveAs(path, format, "");
            if (!saved)
            {
                throw new BridgeFailureException(
                    "SAVE_FAILED",
                    "Hancom Office could not save the converted document.");
            }

            cancellationToken.ThrowIfCancellationRequested();
        }
        catch (BridgeFailureException)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            throw new BridgeFailureException(
                "SAVE_FAILED",
                "Hancom Office could not save the converted document.");
        }
    }

    public void CloseOpenedDocument()
    {
        if (openedDocument is null)
        {
            return;
        }

        try
        {
            openedDocument.Close(false);
        }
        catch (Exception)
        {
            // Cleanup is best effort and never targets documents not opened by this session.
        }
        finally
        {
            Release(openedDocument);
            openedDocument = null;
        }
    }

    public void Dispose()
    {
        CloseOpenedDocument();
        if (automation is not null && previousMessageBoxMode.HasValue)
        {
            try
            {
                automation.SetMessageBoxMode(previousMessageBoxMode.Value);
            }
            catch (Exception)
            {
                // The dedicated automation instance is already being released.
            }
        }

        if (ownedWindow is not null)
        {
            try
            {
                ownedWindow.Close(false);
            }
            catch (Exception)
            {
                // Never enumerate or close any window other than the captured owned window.
            }
            finally
            {
                Release(ownedWindow);
                ownedWindow = null;
            }
        }

        Release(automation);
        automation = null;
    }

    private void Initialize()
    {
        try
        {
            var registered = (bool)automation!.RegisterModule(
                SecurityModuleType,
                SecurityModuleName);
            if (!registered)
            {
                throw new BridgeFailureException(
                    "SECURITY_MODULE_REQUIRED",
                    "The Hancom file-path security module is not registered.");
            }

            previousMessageBoxMode = (int)automation.SetMessageBoxMode(
                ConservativeMessageBoxMode);
            if (string.IsNullOrWhiteSpace(Version))
            {
                Version = (string?)automation.Version;
            }

            if ((int)automation.XHwpWindows.Count > 0)
            {
                ownedWindow = automation.XHwpWindows.Item(0);
                ownedWindow.Visible = false;
            }
        }
        catch (BridgeFailureException)
        {
            Dispose();
            throw;
        }
        catch (Exception)
        {
            Dispose();
            throw new BridgeFailureException(
                "AUTOMATION_UNAVAILABLE",
                "Hancom Office automation could not be initialized safely.");
        }
    }

    private static void Release(object? value)
    {
        if (value is not null && Marshal.IsComObject(value))
        {
            try
            {
                Marshal.FinalReleaseComObject(value);
            }
            catch (InvalidComObjectException)
            {
                // Already released.
            }
        }
    }
}
