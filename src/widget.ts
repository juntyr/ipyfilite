// Copyright (c) Juniper Tyree
// Distributed under the terms of the Modified BSD License.

import {
  DOMWidgetModel,
  DOMWidgetView,
  ISerializers,
  uuid as uuidv4,
} from '@jupyter-widgets/base';
import { registerServiceWorker } from './register';

import { MODULE_NAME, MODULE_VERSION } from './version';

// Import the CSS
import '../css/widget.css';

interface IFileUploaded {
  name: string;
  size: number;
  type: string;
  last_modified: number;
  path: string;
}

export class FileUploadLiteModel extends DOMWidgetModel {
  defaults() {
    return {
      ...super.defaults(),
      _model_name: FileUploadLiteModel.model_name,
      _model_module: FileUploadLiteModel.model_module,
      _model_module_version: FileUploadLiteModel.model_module_version,
      _view_name: FileUploadLiteModel.view_name,
      _view_module: FileUploadLiteModel.view_module,
      _view_module_version: FileUploadLiteModel.view_module_version,
      _session: uuidv4(),
      accept: '',
      description: 'Upload',
      disabled: false,
      icon: 'upload',
      button_style: '',
      multiple: false,
      value: [], // has type Array<IFileUploaded>
      style: null,
    };
  }

  static serializers: ISerializers = {
    ...DOMWidgetModel.serializers,
    // use a dummy serializer for value to circumvent the default serializer.
    value: { serialize: <T>(x: T): T => x },
  };

  static model_name = 'FileUploadLiteModel';
  static model_module = MODULE_NAME;
  static model_module_version = MODULE_VERSION;
  static view_name = 'FileUploadLiteView';
  static view_module = MODULE_NAME;
  static view_module_version = MODULE_VERSION;
}

export class FileUploadLiteView extends DOMWidgetView {
  el: HTMLButtonElement;
  fileInput: HTMLInputElement;

  preinitialize() {
    // Must set this before the initialize method creates the element
    this.tagName = 'button';
  }

  render(): void {
    super.render();

    this.el.classList.add('jupyter-widgets');
    this.el.classList.add('widget-upload-lite');
    this.el.classList.add('jupyter-button');

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.style.display = 'none';

    this.el.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('click', () => {
      this.fileInput.value = '';
    });

    this.fileInput.addEventListener('change', () => {
      const uuid: string = uuidv4();

      const files: Array<IFileUploaded> = Array.from(
        this.fileInput.files ?? []
      ).map((file: File) => {
        return {
          name: file.name,
          type: file.type,
          size: file.size,
          last_modified: file.lastModified,
          path: `/uploads/${uuid}/${file.name}`,
        };
      });

      Private.getChannel(this.model.get('_session')).postMessage({
        kind: 'upload',
        files: this.fileInput.files,
        uuid,
        widget: this.model.model_id,
      });

      this.model.set({
        value: files,
      });
      this.touch();
    });

    this.listenTo(this.model, 'change:button_style', this.update_button_style);
    this.set_button_style();
    this.update(); // Set defaults.
  }

  update(): void {
    this.el.disabled = this.model.get('disabled');
    this.el.setAttribute('title', this.model.get('tooltip'));

    const value: [] = this.model.get('value');
    const description = `${this.model.get('description')} (${value.length})`;
    const icon = this.model.get('icon');

    if (description.length || icon.length) {
      this.el.textContent = '';
      if (icon.length) {
        const i = document.createElement('i');
        i.classList.add('fa');
        i.classList.add('fa-' + icon);
        if (description.length === 0) {
          i.classList.add('center');
        }
        this.el.appendChild(i);
      }
      this.el.appendChild(document.createTextNode(description));
    }

    this.fileInput.accept = this.model.get('accept');
    this.fileInput.multiple = this.model.get('multiple');

    return super.update();
  }

  update_button_style(): void {
    this.update_mapped_classes(
      FileUploadLiteView.class_map,
      'button_style',
      this.el
    );
  }

  set_button_style(): void {
    this.set_mapped_classes(
      FileUploadLiteView.class_map,
      'button_style',
      this.el
    );
  }

  static class_map = {
    primary: ['mod-primary'],
    success: ['mod-success'],
    info: ['mod-info'],
    warning: ['mod-warning'],
    danger: ['mod-danger'],
  };
}

namespace Private {
  const _OldWorker = window.Worker;
  const _channels: Map<string, MessagePort> = new Map();
  const _downloads: Map<string, Map<string, MessagePort>> = new Map();

  class _NewWorker extends _OldWorker {
    private _session: string | undefined;

    constructor(aURL: string | URL, options: WorkerOptions | undefined) {
      super(aURL, options);

      this.addEventListener('message', (event) => {
        if (
          !(
            event.data &&
            event.data.type &&
            event.data.kind &&
            event.data.type === 'ipyfilite' &&
            event.data.kind === 'register'
          )
        ) {
          return;
        }

        const session = event.data.session;
        this._session = session;

        const channel: MessagePort = event.data.channel;
        _channels.set(session, channel);
        _downloads.set(session, new Map());

        const backlog = new Int32Array(event.data.backlog);

        channel.onmessage = function (event) {
          if (!event.data || !event.data.kind) {
            return;
          }

          if (event.data.kind === 'download') {
            _processDownload(
              backlog,
              session,
              event.data.uuid,
              event.data.name,
              event.data.channel
            );
          }
        };
        channel.start();
      });
    }

    terminate(): void {
      if (this._session !== undefined) {
        if (_channels.has(this._session)) {
          _channels.get(this._session)!.close();
          _channels.delete(this._session);
        }

        if (_downloads.has(this._session)) {
          for (const channel of _downloads.get(this._session)!.values()) {
            channel.postMessage({ kind: 'abort' });
          }
          _downloads.delete(this._session);
        }
      }

      super.terminate();
    }
  }

  window.Worker = _NewWorker;

  export function getChannel(session: string): MessagePort {
    return _channels.get(session)!;
  }

  const _download_queue: (() => Promise<void>)[] = [];
  let _download_queue_active = false;

  let _service_worker: ServiceWorker | null = null;
  let _service_worker_scope = '';

  /* eslint-disable no-inner-declarations */
  function _processDownload(
    backlog: Int32Array,
    session: string,
    uuid: string,
    name: string,
    channel: MessagePort
  ) {
    const BACKLOG_LIMIT = 1024 * 1024 * 16;
    const SEGMENT_LIMIT = 1024 * 1024 * 256;

    const service_worker: ServiceWorker | null = _service_worker;
    let service_worker_channel: MessagePort | null = null;
    let download_ready_resolve: (value: unknown) => void;
    let download_ready_reject: (value: unknown) => void;
    const download_ready = new Promise((resolve, reject) => {
      download_ready_resolve = resolve;
      download_ready_reject = reject;
    });

    let created = false;
    const chunks: Uint8Array[] = [];
    let size = 0;
    let segment = 0;

    _downloads.get(session)!.set(uuid, channel);

    channel.onmessage = function (event) {
      if (!(event.data && event.data.kind)) {
        return;
      }

      if (event.data.kind === 'close' || event.data.kind === 'abort') {
        channel.onmessage = null;
        channel.close();
      }

      if (service_worker !== null) {
        if (service_worker_channel === null) {
          if (event.data.kind === 'create' || event.data.kind === 'chunk') {
            const url = new URL(
              `${_service_worker_scope}/download/${session}/${uuid}`
            ).toString();
            const sw_channel = new MessageChannel();

            service_worker_channel = sw_channel.port1;
            service_worker_channel.onmessage = (event) => {
              if (!(event.data && event.data.kind)) {
                return;
              }

              if (event.data.kind === 'ready') {
                download_ready_resolve(null);
              } else if (event.data.kind === 'abort') {
                channel.postMessage({ kind: 'abort' });
                if (service_worker_channel !== null) {
                  service_worker_channel.onmessage = null;
                  service_worker_channel.close();
                }
                download_ready_reject(null);
              }
            };
            service_worker_channel.start();

            // Pause further chunks until the download has started
            Atomics.add(backlog, 0, BACKLOG_LIMIT);

            _enqueueUserDownload(() => {
              service_worker.postMessage(
                {
                  name,
                  url,
                  channel: sw_channel.port2,
                },
                [sw_channel.port2]
              );

              return download_ready
                .then(() => {
                  const iframe = document.createElement('iframe');
                  iframe.hidden = true;
                  iframe.src = url;
                  document.body.appendChild(iframe);
                })
                .finally(() => {
                  // Resume downloading chunks since
                  // (a) the download has now started -> continue this one
                  // (b) this download has been cancelled -> continue others
                  Atomics.sub(backlog, 0, BACKLOG_LIMIT);
                  Atomics.notify(backlog, 0);
                });
            });
          }
        }

        if (service_worker_channel !== null) {
          service_worker_channel.postMessage(event.data);

          if (event.data.kind === 'close' || event.data.kind === 'abort') {
            download_ready.finally(() => {
              if (service_worker_channel !== null) {
                service_worker_channel.onmessage = null;
                service_worker_channel.close();
              }
            });
          } else if (event.data.kind === 'chunk') {
            const chunk = new Uint8Array(event.data.chunk);

            const newBacklog = Atomics.sub(backlog, 0, chunk.length);
            if (newBacklog < BACKLOG_LIMIT / 4) {
              // Only notify once a lower backlog threshold has been reached
              Atomics.notify(backlog, 0);
            }
          }

          return;
        }
      }

      let downloadChunk = false;

      if (event.data.kind === 'create') {
        created = true;
      } else if (event.data.kind === 'chunk') {
        created = true;

        const chunk = new Uint8Array(event.data.chunk);

        chunks.push(chunk);
        size += chunk.length;

        const newBacklog = Atomics.sub(backlog, 0, chunk.length);
        if (newBacklog < BACKLOG_LIMIT / 4) {
          // Only notify once a lower backlog threshold has been reached
          Atomics.notify(backlog, 0);
        }

        if (size >= SEGMENT_LIMIT) {
          segment += 1;
          downloadChunk = true;
        }
      } else if (event.data.kind === 'close') {
        if (created) {
          // download if the file was created and either
          // (a) we have received an empty file (not segemented)
          // (b) we have received a segmented file and there is data left
          downloadChunk = chunks.length > 0 || segment === 0;
        }

        if (segment > 0) {
          segment += 1;
        }
      } else if (event.data.kind === 'abort') {
        return;
      } else {
        // ignore unknown message kinds
        return;
      }

      if (!downloadChunk) {
        return;
      }

      // Pause further chunks until the download has gone through
      Atomics.add(backlog, 0, BACKLOG_LIMIT);

      const chunkname =
        segment > 0 ? `${name}.${segment.toString().padStart(3, '0')}` : name;

      const download = document.createElement('a');
      download.rel = 'noopener';
      download.href = URL.createObjectURL(new Blob(chunks));
      download.download = chunkname;

      _enqueueUserDownload(async () => {
        // Resume downloading chunks since the download has now started
        Atomics.sub(backlog, 0, BACKLOG_LIMIT);
        Atomics.notify(backlog, 0);

        download.dispatchEvent(new MouseEvent('click'));
        setTimeout(() => URL.revokeObjectURL(download.href), 40 * 1000);
      });

      chunks.splice(0, chunks.length);
      size = 0;
    };
    channel.start();
  }

  /* eslint-disable no-inner-declarations */
  function _enqueueUserDownload(download: () => Promise<void>) {
    _download_queue.push(download);

    if (!_download_queue_active) {
      _download_queue_active = true;
      _processNextDownloadQueueItem();
    }
  }

  function _processNextDownloadQueueItem() {
    const downloadFunc = _download_queue.shift();

    if (downloadFunc === undefined) {
      _download_queue_active = false;
      return;
    }

    downloadFunc().then(() =>
      setTimeout(
        () => _processNextDownloadQueueItem(),
        2000 + Math.random() * 1000
      )
    );
  }

  if (navigator.serviceWorker) {
    navigator.serviceWorker
      .getRegistration()
      .then((serviceWorkerRegistration) => {
        return serviceWorkerRegistration || registerServiceWorker();
      })
      .then((serviceWorkerRegistration) => {
        _service_worker_scope = serviceWorkerRegistration.scope;

        if ((_service_worker = serviceWorkerRegistration.active) !== null) {
          return;
        }

        const bootingServiceWorker = (serviceWorkerRegistration.installing ||
          serviceWorkerRegistration.waiting)!;

        bootingServiceWorker.addEventListener(
          'statechange',
          function serviceWorkerActivationListener() {
            if (bootingServiceWorker.state === 'activated') {
              bootingServiceWorker.removeEventListener(
                'statechange',
                serviceWorkerActivationListener
              );
              _service_worker = serviceWorkerRegistration.active;
            }
          }
        );
      });
  }
}
