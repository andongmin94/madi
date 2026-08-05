using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Madi.HwpBridge;

public sealed record HancomInstallation(
    bool ComRegistered,
    bool SecurityModuleRegistered,
    string? SecurityModulePath,
    string? Version);

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
            return new HancomInstallation(false, false, null, null);
        }

        try
        {
            using var classes = RegistryKey.OpenBaseKey(
                RegistryHive.ClassesRoot,
                RegistryView.Registry32);
            using var progId = classes.OpenSubKey($@"{ProgId}\CLSID", writable: false);
            var classId = progId?.GetValue(null) as string;
            var serverPath = RegisteredServerPath(classes, classId);
            var comRegistered = !string.IsNullOrWhiteSpace(classId) &&
                                !string.IsNullOrWhiteSpace(serverPath) &&
                                File.Exists(serverPath);

            using var currentUser = RegistryKey.OpenBaseKey(
                RegistryHive.CurrentUser,
                RegistryView.Default);
            using var modules = currentUser.OpenSubKey(
                SecurityModuleRegistryPath,
                writable: false);
            var modulePath = modules?.GetValue(SecurityModuleName) as string;
            var moduleRegistered = IsRegularDll(modulePath);
            return new HancomInstallation(
                comRegistered,
                moduleRegistered,
                moduleRegistered ? Path.GetFullPath(modulePath!) : null,
                ExecutableVersion(serverPath));
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or
                ArgumentException or System.Security.SecurityException)
        {
            return new HancomInstallation(false, false, null, null);
        }
    }

    private static string? RegisteredServerPath(RegistryKey classes, string? classId)
    {
        if (string.IsNullOrWhiteSpace(classId))
        {
            return null;
        }

        using var server = classes.OpenSubKey(
            $@"CLSID\{classId}\LocalServer32",
            writable: false);
        var command = server?.GetValue(null) as string;
        if (string.IsNullOrWhiteSpace(command))
        {
            return null;
        }

        var trimmed = command.Trim();
        if (trimmed.StartsWith('"'))
        {
            var endQuote = trimmed.IndexOf('"', 1);
            return endQuote > 1 ? trimmed[1..endQuote] : null;
        }

        var executableEnd = trimmed.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        return executableEnd >= 0 ? trimmed[..(executableEnd + 4)].Trim() : null;
    }

    private static bool IsRegularDll(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) ||
            !Path.IsPathFullyQualified(path) ||
            !string.Equals(Path.GetExtension(path), ".dll", StringComparison.OrdinalIgnoreCase) ||
            !File.Exists(path))
        {
            return false;
        }

        return (File.GetAttributes(path) &
                (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0;
    }

    private static string? ExecutableVersion(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            return null;
        }

        try
        {
            return FileVersionInfo.GetVersionInfo(path).FileVersion;
        }
        catch (FileNotFoundException)
        {
            return null;
        }
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

        return HancomComAutomationSession.Create(installation.Version);
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

    private HancomComAutomationSession(dynamic automation, string? detectedVersion)
    {
        this.automation = automation;
        Version = detectedVersion;
    }

    public string? Version { get; private set; }

    public static HancomComAutomationSession Create(string? detectedVersion)
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

            var session = new HancomComAutomationSession((dynamic)instance, detectedVersion);
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
