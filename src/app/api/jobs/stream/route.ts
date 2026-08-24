import { listJobs, onChange } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events carrying the whole job list on every change. The list is
 * small and the UI wants a consistent snapshot anyway, so pushing the full set
 * beats reconciling per-job deltas — and it keeps the meter moving at whatever
 * rate yt-dlp and ffmpeg actually report, rather than on a polling tick.
 */
export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let inFlight = false;
      let queuedSend = false;

      const send = async () => {
        if (closed) return;
        if (inFlight) {
          queuedSend = true;
          return;
        }
        inFlight = true;
        try {
          const jobs = await listJobs();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ jobs })}\n\n`));
        } catch {
          /* the connection went away mid-write */
        } finally {
          inFlight = false;
          if (queuedSend && !closed) {
            queuedSend = false;
            void send();
          }
        }
      };

      const unsubscribe = onChange(() => void send());

      // Comment frames keep proxies from closing an idle connection.
      const keepAlive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 25_000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener("abort", close, { once: true });

      await send();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
