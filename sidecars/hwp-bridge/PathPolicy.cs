namespace Madi.HwpBridge;

public static class BridgePathPolicy
{
    public static string ExistingInput(string value, string expectedExtension)
    {
        var canonical = CanonicalAbsolute(value);
        RequireExtension(canonical, expectedExtension);
        if (!File.Exists(canonical))
        {
            throw Failure("INPUT_NOT_FOUND", "The requested input file does not exist.");
        }

        var attributes = File.GetAttributes(canonical);
        if ((attributes & FileAttributes.Directory) != 0 ||
            (attributes & FileAttributes.ReparsePoint) != 0)
        {
            throw Failure("INVALID_PATH", "The requested input path is not a regular file.");
        }

        return canonical;
    }

    public static string Output(string value, string expectedExtension)
    {
        var canonical = CanonicalAbsolute(value);
        RequireExtension(canonical, expectedExtension);
        var directory = Path.GetDirectoryName(canonical);
        if (string.IsNullOrEmpty(directory) || !Directory.Exists(directory))
        {
            throw Failure(
                "OUTPUT_DIRECTORY_NOT_FOUND",
                "The requested output directory does not exist.");
        }

        var directoryAttributes = File.GetAttributes(directory);
        if ((directoryAttributes & FileAttributes.ReparsePoint) != 0)
        {
            throw Failure("INVALID_PATH", "The requested output directory is not allowed.");
        }

        if (Directory.Exists(canonical))
        {
            throw Failure("INVALID_PATH", "The requested output path is not a file.");
        }

        return canonical;
    }

    private static string CanonicalAbsolute(string value)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(value) ||
                value.Length > 32_000 ||
                value.StartsWith(@"\\?\", StringComparison.Ordinal) ||
                value.StartsWith(@"\\.\", StringComparison.Ordinal) ||
                value.Any(character => char.IsControl(character)) ||
                !Path.IsPathFullyQualified(value))
            {
                throw Failure("INVALID_PATH", "The requested path is invalid.");
            }

            var canonical = Path.GetFullPath(value);
            var root = Path.GetPathRoot(canonical);
            if (string.IsNullOrEmpty(root) ||
                string.Equals(root, canonical, StringComparison.OrdinalIgnoreCase))
            {
                throw Failure("INVALID_PATH", "The requested path is invalid.");
            }

            return canonical;
        }
        catch (BridgeFailureException)
        {
            throw;
        }
        catch (Exception exception) when (
            exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            throw Failure("INVALID_PATH", "The requested path is invalid.");
        }
    }

    private static void RequireExtension(string value, string expectedExtension)
    {
        if (!string.Equals(
                Path.GetExtension(value),
                expectedExtension,
                StringComparison.OrdinalIgnoreCase))
        {
            throw Failure("WRONG_EXTENSION", "The requested file extension is not allowed.");
        }
    }

    private static BridgeFailureException Failure(string code, string message) =>
        new(code, message);
}
