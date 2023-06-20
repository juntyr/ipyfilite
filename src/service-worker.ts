/// <reference types="./serviceworker" />

export default null;

const downloads = new Map();

self.onmessage = (event: MessageEvent) => {
  downloads.set(event.data.url, {
    name: event.data.name,
    stream: createDownloadStream(event.data.channel),
  });

  // Notify the client that the download is ready
  event.data.channel.postMessage({ kind: 'ready' });

  // Clean up downloads that were never initiated
  setTimeout(() => downloads.delete(event.data.url), 40 * 1000);
};

function createDownloadStream(channel: MessagePort): ReadableStream {
  return new ReadableStream({
    start(controller: ReadableStreamDefaultController) {
      channel.onmessage = (event) => {
        if (event.data.kind === 'create') {
          // no-op
        }

        if (event.data.kind === 'close') {
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
  const download: { name: string; stream: ReadableStream } | undefined =
    downloads.get(event.request.url);

  if (download === undefined) {
    return null;
  }

  const { name, stream } = download;

  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/
  //  Global_Objects/encodeURIComponent#encoding_for_content-disposition_
  //  and_link_headers
  const filename = encodeURIComponent(name)
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(7C|60|5E)/g, (_str, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

  downloads.delete(event.request.url);

  const headers = new Headers({
    'Content-Type': 'application/octet-stream; charset=utf-8',
    'Content-Disposition': "attachment; filename*=UTF-8''" + filename,
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Security-Policy': "default-src 'none'",
    'X-WebKit-CSP': "default-src 'none'",
    'X-XSS-Protection': '1; mode=block',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });

  event.respondWith(new Response(stream, { headers }));
};
