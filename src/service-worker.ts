/// <reference types="./serviceworker" />

export default null;

self.oninstall = () => {
  self.skipWaiting();
};

self.onactivate = (event) => {
  event.waitUntil(self.clients.claim());
};

const downloads = new Map();

self.onmessage = (event: MessageEvent) => {
  downloads.set(event.data.url, createDownloadStream(event.data.channel));

  // Notify the client that the download is ready
  event.data.channel.postMessage({ kind: 'ready' });
};

function createDownloadStream(channel: MessagePort): ReadableStream {
  return new ReadableStream({
    start(controller: ReadableStreamDefaultController) {
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
        }
      };
      channel.start();
    },
    cancel(_reason: any) {
      // We can try to pass on the abort upstream
      channel.postMessage({ kind: 'abort' });
      channel.close();
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
