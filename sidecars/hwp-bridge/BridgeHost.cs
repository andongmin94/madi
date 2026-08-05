namespace Madi.HwpBridge;

public sealed class BridgeHost
{
    private readonly HwpBridgeService service;

    public BridgeHost(HwpBridgeService service)
    {
        this.service = service;
    }

    public async Task<int> RunAsync(
        TextReader input,
        TextWriter output,
        CancellationToken cancellationToken = default)
    {
        string? firstLine;
        try
        {
            firstLine = await input.ReadLineAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return 0;
        }

        if (firstLine is null)
        {
            return 0;
        }

        BridgeRequest request;
        try
        {
            request = BridgeProtocol.ParseRequest(firstLine);
        }
        catch (BridgeProtocolException)
        {
            await WriteAsync(
                output,
                BridgeResponse.Error(
                    "invalid",
                    "unknown",
                    "INVALID_REQUEST",
                    "The bridge request is invalid.")).ConfigureAwait(false);
            return 0;
        }

        if (request is CancelRequest initialCancel)
        {
            await WriteAsync(
                output,
                BridgeResponse.Error(
                    initialCancel.RequestId,
                    initialCancel.Command,
                    "NO_ACTIVE_OPERATION",
                    "There is no matching active bridge operation.")).ConfigureAwait(false);
            return 0;
        }

        using var operationCancellation = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken);
        var operation = service.ExecuteAsync(request, operationCancellation.Token);
        while (!operation.IsCompleted)
        {
            string? line;
            try
            {
                using var readCancellation = CancellationTokenSource.CreateLinkedTokenSource(
                    cancellationToken);
                var read = ReadLineInBackgroundAsync(input, readCancellation.Token);
                if (await Task.WhenAny(operation, read).ConfigureAwait(false) == operation)
                {
                    readCancellation.Cancel();
                    ObserveCompletion(read);
                    break;
                }

                line = await read.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                operationCancellation.Cancel();
                break;
            }

            if (line is null)
            {
                operationCancellation.Cancel();
                break;
            }

            BridgeRequest additional;
            try
            {
                additional = BridgeProtocol.ParseRequest(line);
            }
            catch (BridgeProtocolException)
            {
                await WriteAsync(
                    output,
                    BridgeResponse.Error(
                        "invalid",
                        "unknown",
                        "INVALID_REQUEST",
                        "The bridge request is invalid.")).ConfigureAwait(false);
                continue;
            }

            if (additional is CancelRequest cancel &&
                string.Equals(
                    cancel.TargetRequestId,
                    request.RequestId,
                    StringComparison.Ordinal))
            {
                operationCancellation.Cancel();
                await WriteAsync(
                    output,
                    BridgeResponse.CancelledRequest(cancel, cancelled: true)).ConfigureAwait(false);
                continue;
            }

            await WriteAsync(
                output,
                BridgeResponse.Error(
                    additional.RequestId,
                    additional.Command,
                    "BUSY",
                    "The bridge is already processing another operation.")).ConfigureAwait(false);
        }

        var response = await operation.ConfigureAwait(false);
        await WriteAsync(output, response).ConfigureAwait(false);
        return 0;
    }

    private static Task<string?> ReadLineInBackgroundAsync(
        TextReader input,
        CancellationToken cancellationToken) =>
        Task.Run(
            async () => await input.ReadLineAsync(cancellationToken).ConfigureAwait(false),
            CancellationToken.None);

    private static void ObserveCompletion(Task task)
    {
        _ = task.ContinueWith(
            static completed =>
            {
                _ = completed.Exception;
            },
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted |
                TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private static async Task WriteAsync(TextWriter output, BridgeResponse response)
    {
        await output.WriteLineAsync(BridgeJson.Serialize(response)).ConfigureAwait(false);
        await output.FlushAsync().ConfigureAwait(false);
    }
}
