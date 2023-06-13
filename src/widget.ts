// Copyright (c) Juniper Tyree
// Distributed under the terms of the Modified BSD License.

import {
  DOMWidgetModel,
  DOMWidgetView,
  ISerializers,
  uuid as uuidv4,
} from '@jupyter-widgets/base';

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

      Private.getBroadcastChannel().postMessage({
        kind: 'upload',
        files: this.fileInput.files,
        uuid,
        session: this.model.get('_session'),
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
  const _channel = new BroadcastChannel('ipyfilite');

  export function getBroadcastChannel(): BroadcastChannel {
    return _channel;
  }

  /* eslint-disable no-inner-declarations */
  function _createUserDownload(name: string, chunks: [Uint8Array]) {
    const download = document.createElement('a');
    download.rel = 'noopener';
    download.href = URL.createObjectURL(new Blob(chunks));
    download.download = name;
    setTimeout(() => URL.revokeObjectURL(download.href), 40 * 1000);
    setTimeout(() => download.dispatchEvent(new MouseEvent('click')), 0);
  }

  const _downloads = new Map();

  _channel.onmessage = function (event) {
    if (!event.data || !event.data.kind) {
      return;
    }

    if (event.data.kind === 'download-open') {
      if (_downloads.has(event.data.uuid)) {
        console.warn(`Download stream for '${event.data.uuid}' already open.`);
        return;
      }

      _downloads.set(event.data.uuid, {
        name: event.data.name,
        chunks: [],
        size: 0,
        segment: 0,
      });
    } else if (event.data.kind === 'download-chunk') {
      if (!_downloads.has(event.data.uuid)) {
        console.warn(
          `No download stream for '${event.data.uuid}' is open to write to.`
        );
        return;
      }

      const download = _downloads.get(event.data.uuid);
      const chunk = new Uint8Array(event.data.chunk);

      download.chunks.push(chunk);
      download.size += chunk.length;

      if (download.size >= 1024 * 1024 * 256) {
        download.segment += 1;
        _createUserDownload(
          `${download.name}.${download.segment.toString().padStart(3, '0')}`,
          download.chunks
        );
        download.chunks = [];
        download.size = 0;
      }
    } else if (event.data.kind === 'download-close') {
      if (!_downloads.has(event.data.uuid)) {
        console.warn(
          `No download stream for '${event.data.uuid}' is open to close.`
        );
        return;
      }

      const download = _downloads.get(event.data.uuid);
      _downloads.delete(event.data.uuid);

      if (download.segment > 0 && download.chunks.length === 0) {
        return; // segemented download with no more data
      }

      if (download.segment > 0) {
        download.segment += 1;
        _createUserDownload(
          `${download.name}.${download.segment.toString().padStart(3, '0')}`,
          download.chunks
        );
      } else {
        _createUserDownload(download.name, download.chunks);
      }
    }
  };
}
