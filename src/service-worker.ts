self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const downloads = new Map();

self.onmessage = (event) => {
  const backlog = new Int32Array(event.data.backlog);

  downloads.set(
    event.data.url,
    createDownloadStream(event.data.channel, backlog)
  );
};

function createDownloadStream(
  channel: MessagePort,
  backlog: Int32Array
): ReadableStream {
  const BACKLOG_LIMIT = 1024 * 1024 * 16;

  return new ReadableStream({
    start(controller) {
      channel.onmessage = (event) => {
        if (event.data.kind === 'create') {
          // no-op
        }

        if (event.data.kind === 'end') {
          return controller.close();
        }

        if (event.data.kind === 'abort') {
          controller.error('The download has been aborted');
        }

        if (event.data.kind === 'chunk') {
          const chunk = new Uint8Array(event.data.chunk);

          controller.enqueue(chunk);

          const newBacklog = Atomics.sub(backlog, 0, chunk.length);
          if (newBacklog < BACKLOG_LIMIT / 4) {
            // Only notify once a lower backlog threshold has been reached
            Atomics.notify(backlog, 0);
          }
        }
      };
      channel.start();
    },
    cancel(_reason) {
      // We have to acknowledge any remaining chunks
      channel.onmessage = (event) => {
        if (event.data.kind === 'chunk') {
          const chunk = new Uint8Array(event.data.chunk);

          const newBacklog = Atomics.sub(backlog, 0, chunk.length);
          if (newBacklog < BACKLOG_LIMIT / 4) {
            // Only notify once a lower backlog threshold has been reached
            Atomics.notify(backlog, 0);
          }
        }
      };
      channel.start();
      // We can try to pass on the abort upstream
      channel.postMessage({ kind: 'abort' });
    },
  });
}

self.onfetch = (event) => {
  const download: ReadableStream | undefined = downloads.get(event.request.url);

  if (download === undefined) {
    return null;
  }

  downloads.delete(event.request.url);

  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Security-Policy': "default-src 'none'",
    'X-WebKit-CSP': "default-src 'none'",
    'X-XSS-Protection': '1; mode=block',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });

  event.respondWith(new Response(download, { headers }));
};
