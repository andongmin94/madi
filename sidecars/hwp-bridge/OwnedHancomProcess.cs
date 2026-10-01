using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Madi.HwpBridge;

// Trial-only owner. The bridge itself must already be launched by the approved
// runner on an inactive private desktop; this class never moves a user window.
internal sealed class OwnedHancomProcess : IDisposable
{
    private readonly object sync = new();
    private readonly string desktop;
    private readonly string executable;
    private readonly string executableHash;
    private IntPtr job, process, thread;
    private uint pid;
    private long birth;
    private bool assigned, aborted, abortFailed, disposed;
    private const uint WaitObject = 0, WaitTimeout = 258;
    private const uint ExitWaitMs = 5_000;

    internal OwnedHancomProcess(string expectedDesktop)
    {
        VerifyNativeLayout();
        desktop = expectedDesktop;
        AssertPrivateInput(desktop);
        RequireNoHwp();
        executable = ReadRegisteredExecutable();
        executableHash = FileHash(executable);
        job = CreateJobObjectW(IntPtr.Zero, null);
        Require(job != IntPtr.Zero);
        try
        {
            var limits = new JobExtendedLimits();
            limits.basic.limitFlags = 0x2020; // KILL_ON_JOB_CLOSE | PRIORITY_CLASS.
            limits.basic.priorityClass = 0x4000; // BELOW_NORMAL, no breakaway.
            Require(SetInformationJobObject(job, 9, ref limits,
                (uint)Marshal.SizeOf<JobExtendedLimits>()));
        }
        catch
        {
            CloseHandle(job);
            job = IntPtr.Zero;
            throw;
        }
    }

    internal static string Preflight()
    {
        VerifyNativeLayout();
        if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
            throw Failure("TRIAL_ISOLATION_REQUIRED");
        var name = DesktopName(GetThreadDesktop(GetCurrentThreadId()));
        Require(!name.Equals("Default", StringComparison.OrdinalIgnoreCase));
        Require(IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out bool inJob) && inJob);
        AssertPrivateInput(name);
        RequireNoHwp();
        return name;
    }

    private static void VerifyNativeLayout()
    {
        if (!OperatingSystem.IsWindows() || IntPtr.Size != 4)
            throw Failure("TRIAL_ISOLATION_REQUIRED");
        // Required x86 ABI, not a claim that this staged code was executed.
        Require(Marshal.SizeOf<StartupInfo>() == 68 && Marshal.SizeOf<ProcessInfo>() == 16 &&
            Marshal.SizeOf<JobBasicLimits>() == 48 && Marshal.SizeOf<IoCounters>() == 48 &&
            Marshal.SizeOf<JobExtendedLimits>() == 112 && Marshal.SizeOf<JobAccounting>() == 48);
    }

    internal void Start(string input, CancellationToken cancellationToken)
    {
        lock (sync)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Require(!disposed && !aborted && process == IntPtr.Zero);
            AssertPrivateInput(desktop);
            RequireNoHwp();
            Require(FileHash(executable) == executableHash);
            Require(Path.IsPathFullyQualified(input) && !input.Contains('"'));
            var startup = new StartupInfo
            {
                cb = (uint)Marshal.SizeOf<StartupInfo>(),
                lpDesktop = desktop,
                dwFlags = 0x80, // STARTF_FORCEOFFFEEDBACK.
            };
            Require(CreateProcessW(executable,
                new StringBuilder("\"" + executable + "\" \"" + input + "\""),
                IntPtr.Zero, IntPtr.Zero, false, 0x08004004, IntPtr.Zero,
                Path.GetDirectoryName(input), ref startup, out var created));
            process = created.process;
            thread = created.thread;
            pid = created.pid;
            try
            {
                Require(GetProcessTimes(process, out birth, out _, out _, out _));
                Require(ExactPath(ProcessImage(process), executable));
                Require(AssignProcessToJobObject(job, process));
                assigned = true;
                Require(IsProcessInJob(process, job, out bool inOwnedJob) && inOwnedJob);
                cancellationToken.ThrowIfCancellationRequested();
                Require(!aborted && ResumeThread(thread) == 1);
            }
            catch
            {
                // This handle is ours and still suspended until the last step.
                try { AbortUnderLock(); } catch { abortFailed = true; }
                throw;
            }
        }
        var startupWatch = Stopwatch.StartNew();
        int stable = 0;
        while (startupWatch.ElapsedMilliseconds < 10_000)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (ObserveProcess(requireWindows: false)) stable++; else stable = 0;
            if (stable == 3) return;
            Thread.Sleep(500);
        }
        throw Failure();
    }

    // Cancellation callback: kernel-only, no RCW, ROT, window, or document API.
    // Handle lifetime and start/abort races are serialized by the same lock.
    internal void Abort()
    {
        lock (sync)
        {
            if (!disposed)
            {
                try { AbortUnderLock(); }
                catch { aborted = true; abortFailed = true; }
            }
        }
    }

    private void AbortUnderLock()
    {
        aborted = true;
        if (process == IntPtr.Zero) return;
        if (WaitForSingleObject(process, 0) == WaitObject && (!assigned || ActiveCount() == 0)) return;
        bool stopped = assigned
            ? TerminateJobObject(job, 125)
            : TerminateProcess(process, 125);
        if (!stopped) { abortFailed = true; return; }
        var wait = Stopwatch.StartNew();
        while (wait.ElapsedMilliseconds < ExitWaitMs)
        {
            if (WaitForSingleObject(process, 0) == WaitObject && ActiveCount() == 0) return;
            Thread.Sleep(25);
        }
        abortFailed = true;
    }

    internal void ConfirmCancelledExit()
    {
        lock (sync)
        {
            Require(!disposed && aborted && !abortFailed);
            if (process != IntPtr.Zero)
                Require(WaitForSingleObject(process, 0) == WaitObject);
            Require(ActiveCount() == 0);
        }
    }

    internal void WaitNaturalExit()
    {
        IntPtr captured;
        lock (sync)
        {
            Require(!disposed && !aborted && process != IntPtr.Zero);
            captured = process;
        }
        // Abort may run while the STA waits. Handles cannot be released until
        // this call returns and the cancellation registration has drained.
        uint wait = WaitForSingleObject(captured, ExitWaitMs);
        lock (sync)
        {
            Require(!disposed && process == captured && !aborted);
            Require(wait == WaitObject);
            Require(GetExitCodeProcess(process, out uint exit) && exit == 0);
            Require(ActiveCount() == 0);
        }
    }

    internal bool HasExited
    {
        get { lock (sync) return process != IntPtr.Zero && WaitForSingleObject(process, 0) == WaitObject; }
    }

    internal bool AbortStarted
    {
        get { lock (sync) return aborted; }
    }

    internal void GuardWindow(IntPtr window)
    {
        GuardProcess();
        Require(window != IntPtr.Zero && IsWindow(window));
        uint windowThread = GetWindowThreadProcessId(window, out uint windowPid);
        Require(windowThread != 0 && windowPid == pid);
        Require(DesktopName(GetThreadDesktop(windowThread)) == desktop);
        bool found = false;
        Enumerate(desktop, owned => { if (owned == window) found = true; });
        Require(found);
        GuardProcess();
    }

    internal void GuardProcess() => Require(ObserveProcess(requireWindows: true));

    internal void GuardTerminalProcess() => ObserveProcess(requireWindows: false);

    private bool ObserveProcess(bool requireWindows)
    {
        AssertPrivateInput(desktop);
        lock (sync)
        {
            Require(!disposed && !aborted && assigned && process != IntPtr.Zero);
            Require(WaitForSingleObject(process, 0) == WaitTimeout);
            Require(GetProcessTimes(process, out long actualBirth, out _, out _, out _) && actualBirth == birth);
            Require(ExactPath(ProcessImage(process), executable) && FileHash(executable) == executableHash);
            Require(IsProcessInJob(process, job, out bool inOwnedJob) && inOwnedJob);
            var all = Process.GetProcessesByName("hwp");
            try { Require(all.Length == 1 && all[0].Id == (int)pid); }
            finally { foreach (var value in all) value.Dispose(); }
            using var current = Process.GetProcessById((int)pid);
            foreach (ProcessThread value in current.Threads)
            {
                using (value)
                {
                    Marshal.SetLastPInvokeError(0);
                    IntPtr valueDesktop = GetThreadDesktop((uint)value.Id);
                    if (valueDesktop == IntPtr.Zero)
                    {
                        // As in the accepted diagnostic: worker threads can lack
                        // a desktop with error0. Never claim all thread desktops.
                        Require(Marshal.GetLastPInvokeError() == 0);
                    }
                    else Require(DesktopName(valueDesktop) == desktop);
                }
            }
            int privateWindows = 0;
            Enumerate(desktop, _ => privateWindows++);
            int defaultWindows = 0;
            Enumerate("Default", _ => defaultWindows++);
            Require(defaultWindows == 0);
            if (requireWindows) Require(privateWindows > 0);
            return privateWindows > 0;
        }
    }

    internal void AssertInput() => AssertPrivateInput(desktop);

    private void Enumerate(string name, Action<IntPtr> inspect)
    {
        IntPtr current = GetThreadDesktop(GetCurrentThreadId());
        bool borrowed = DesktopName(current) == name;
        IntPtr value = borrowed ? current : OpenDesktopW(name, 0, false, 0x41);
        Require(value != IntPtr.Zero);
        Exception? primary = null;
        try
        {
            bool windowIdentityFailed = false;
            WindowCallback callback = (window, _) =>
            {
                uint windowThread = GetWindowThreadProcessId(window, out uint windowPid);
                if (windowThread == 0) { windowIdentityFailed = true; return true; }
                if (windowPid != pid) return true;
                try
                {
                    if (DesktopName(GetThreadDesktop(windowThread)) != name)
                        windowIdentityFailed = true;
                    else inspect(window);
                }
                catch { windowIdentityFailed = true; }
                return true;
            };
            Require(EnumDesktopWindows(value, callback, IntPtr.Zero));
            GC.KeepAlive(callback);
            Require(!windowIdentityFailed);
        }
        catch (Exception error) { primary = error; throw; }
        finally { if (!borrowed && !CloseDesktop(value) && primary is null) throw Failure(); }
    }

    internal static bool ExactPath(string? actual, string expected)
    {
        if (string.IsNullOrEmpty(actual) || !Path.IsPathFullyQualified(actual)) return false;
        try { return Path.GetFullPath(actual).Equals(expected, StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    private static void AssertPrivateInput(string expected)
    {
        IntPtr current = GetThreadDesktop(GetCurrentThreadId());
        Require(DesktopName(current) == expected);
        Require(GetDesktopInputFlag(current, 6, out int inputFlag, 4, out _) && inputFlag == 0);
        IntPtr input = OpenInputDesktop(0, false, 1);
        Require(input != IntPtr.Zero);
        Exception? primary = null;
        try
        {
            string name = DesktopName(input);
            Require(name.Equals("Default", StringComparison.OrdinalIgnoreCase) && name != expected);
        }
        catch (Exception error) { primary = error; throw; }
        finally { if (!CloseDesktop(input) && primary is null) throw Failure(); }
    }

    private static void RequireNoHwp()
    {
        var values = Process.GetProcessesByName("hwp");
        try { Require(values.Length == 0); }
        finally { foreach (var value in values) value.Dispose(); }
    }

    private static string ReadRegisteredExecutable()
    {
        using var classes = RegistryKey.OpenBaseKey(RegistryHive.ClassesRoot, RegistryView.Registry32);
        using var progId = classes.OpenSubKey(@"HWPFrame.HwpObject.2\CLSID", false);
        Require(Guid.TryParse(progId?.GetValue(null) as string, out Guid id));
        using var server = classes.OpenSubKey($@"CLSID\{id:B}\LocalServer32", false);
        string command = server?.GetValue(null) as string ?? "";
        var match = Regex.Match(command, "^\"([^\"\\r\\n]+\\.exe)\"\\s+-Automation\\s*$", RegexOptions.IgnoreCase);
        if (!match.Success)
            match = Regex.Match(command, "^([^\"\\r\\n]+?\\.exe)\\s+-Automation\\s*$", RegexOptions.IgnoreCase);
        Require(match.Success);
        string path = Path.GetFullPath(match.Groups[1].Value);
        Require(Path.GetFileName(path).Equals("hwp.exe", StringComparison.OrdinalIgnoreCase));
        return path;
    }

    private uint ActiveCount()
    {
        Require(job != IntPtr.Zero);
        Require(QueryInformationJobObject(job, 1, out var result,
            (uint)Marshal.SizeOf<JobAccounting>(), IntPtr.Zero));
        return result.activeProcesses;
    }

    public void Dispose()
    {
        lock (sync)
        {
            if (disposed) return;
            bool clean = false;
            try { clean = (process == IntPtr.Zero || WaitForSingleObject(process, 0) == WaitObject) && ActiveCount() == 0 && !abortFailed; }
            catch { }
            if (!clean) { try { AbortUnderLock(); } catch { abortFailed = true; } }
            bool closed = true;
            foreach (IntPtr handle in new[] { thread, process, job })
                if (handle != IntPtr.Zero && !CloseHandle(handle)) closed = false;
            thread = process = job = IntPtr.Zero;
            disposed = true;
            if (!clean || !closed) throw Failure("CLEANUP_FAILED");
        }
    }

    private static string DesktopName(IntPtr handle)
    {
        Require(handle != IntPtr.Zero);
        var value = new StringBuilder(512);
        Require(GetUserObjectInformationW(handle, 2, value, 1024, out _));
        return value.ToString();
    }

    private static string ProcessImage(IntPtr handle)
    {
        var value = new StringBuilder(32768);
        uint length = (uint)value.Capacity;
        Require(QueryFullProcessImageNameW(handle, 0, value, ref length));
        return value.ToString();
    }

    private static string FileHash(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }

    private static void Require(bool value) { if (!value) throw Failure(); }
    private static BridgeFailureException Failure(string code = "OWNERSHIP_FAILED") =>
        new(code, code == "CLEANUP_FAILED" ? "The owned Hancom process did not finish safely." : "The private Hancom trial ownership could not be verified.");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public uint cb;
        public string? lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)] private struct JobBasicLimits
    {
        public long processTime, jobTime;
        public uint limitFlags;
        public UIntPtr minimumWorkingSet, maximumWorkingSet;
        public uint activeProcessLimit;
        public UIntPtr affinity;
        public uint priorityClass, schedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct JobExtendedLimits { public JobBasicLimits basic; public IoCounters io; public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] private struct JobAccounting { public long userTime, kernelTime, periodUser, periodKernel; public uint faults, totalProcesses, activeProcesses, terminatedProcesses; }
    private delegate bool WindowCallback(IntPtr window, IntPtr state);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder value, ref uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcessW(string executable, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string? directory, ref StartupInfo startup, out ProcessInfo result);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref JobExtendedLimits value, uint bytes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int kind, out JobAccounting value, uint bytes, IntPtr returnedLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool belongs);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exit);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint exit);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint exit);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, uint bytes, out uint needed);
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", SetLastError = true)] private static extern bool GetDesktopInputFlag(IntPtr handle, int index, out int value, uint bytes, out uint needed);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool EnumDesktopWindows(IntPtr desktop, WindowCallback callback, IntPtr state);
}
