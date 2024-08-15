from __future__ import annotations

import asyncio
import datetime as dt
import uuid
import warnings
from pathlib import Path

from IPython import get_ipython
from traitlets import Bunch, Instance
from traitlets.config import SingletonConfigurable


class IpyfiliteManager(SingletonConfigurable):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        self._session = uuid.uuid4()
        self._upload_widgets = dict()

        try:
            import js  # noqa: F401
            import pyodide  # noqa: F401
            import pyodide_js  # noqa: F401
        except ImportError:
            warnings.warn(
                "ipyfilite is designed to run inside a Pyodide kernel in"
                " JupyterLite",
                FutureWarning,
            )
        else:
            try:
                backlog = js.SharedArrayBuffer.new(4)
                self._backlog = js.Int32Array.new(backlog)
            except Exception:
                raise RuntimeError(
                    "ipyfilite must run in a secure and cross-origin isolated"
                    " context"
                )
            channel = js.MessageChannel.new()
            self._channel = channel.port1
            self._channel.onmessage = self._on_message
            self._channel.start()
            js.postMessage(
                pyodide.ffi.to_js(
                    {
                        "type": "ipyfilite",
                        "kind": "register",
                        "session": str(self._session),
                        "channel": channel.port2,
                        "backlog": backlog,
                    },
                    dict_converter=js.Object.fromEntries,
                    create_pyproxies=False,
                ),
                [channel.port2],
            )

            self._download_fs = pyodide.code.run_js(
                (Path(__file__).parent / "download" / "fs.js").read_text()
            )
            self._download_fs._channel = self._channel
            self._download_fs._backlog = self._backlog
            self._download_fs._pyodide = pyodide_js

            if Path("/download").exists():
                pyodide_js.FS.unmount("/download")
            else:
                Path("/download").mkdir()
            pyodide_js.FS.mount(self._download_fs, None, "/download")

            self._download_root = pyodide_js.FS.lookupPath("/download").node

    @property
    def session(self) -> uuid.UUID:
        return self._session

    @classmethod
    def instance(cls):
        ip = get_ipython()

        manager = super(IpyfiliteManager, cls).instance(parent=ip)

        # Also make the manager accessible inside IPython
        if ip is not None and not hasattr(ip, "ipyfilite_manager"):
            ip.add_traits(
                ipyfilite_manager=Instance(
                    IpyfiliteManager, default_value=manager
                )
            )

        return manager

    def register_upload(self, widget):
        self._upload_widgets[widget._model_id] = widget

    def unregister_upload(self, widget):
        self._upload_widgets.pop(widget._model_id, None)

    def _on_message(self, event):
        import js
        import pyodide
        import pyodide_js

        if not getattr(event, "data", None) or not getattr(
            event.data, "kind", None
        ):
            return

        if event.data.kind != "upload":
            return

        if (
            not getattr(event.data, "files", None)
            or not getattr(event.data, "uuid", None)
            or not getattr(event.data, "widget", None)
        ):
            return

        if event.data.kind != "upload":
            return

        if event.data.widget not in self._upload_widgets:
            return

        upload_path = Path("/uploads") / event.data.uuid
        upload_path.mkdir(parents=True, exist_ok=False)

        pyodide_js.FS.mount(
            pyodide_js.FS.filesystems.WORKERFS,
            pyodide.ffi.to_js(
                {"files": event.data.files},
                dict_converter=js.Object.fromEntries,
                create_pyproxies=False,
            ),
            str(upload_path),
        )

        self._upload_widgets[event.data.widget].set_trait(
            "value",
            [
                Bunch(
                    name=file.name,
                    type=file.type,
                    size=file.size,
                    last_modified=dt.datetime.fromtimestamp(
                        file.lastModified / 1000, tz=dt.timezone.utc
                    ),
                    path=upload_path / file.name,
                )
                for file in event.data.files
            ],
        )

    async def register_download(self, uuid: str, name: str) -> Path:
        if getattr(self, "_download_fs", None) is None:
            downloads = Path.home() / "Downloads"
            if not downloads.exists():
                downloads = Path.cwd()
            return downloads / f"{Path(name).stem}-{uuid}{Path(name).suffix}"
        else:
            # Firefox currently requires async sleeps to fully initialise
            #  the MessageChannels so that messages can be received
            await asyncio.sleep(0.001)
            path = self._download_fs.create_download(
                self._download_root, uuid, name
            )
            await asyncio.sleep(0.0001)
            return Path(path)

    async def unregister_download(self, uuid: str, abort: bool):
        if getattr(self, "_download_fs", None) is not None:
            await asyncio.sleep(0.001)
            self._download_fs.close_download(self._download_root, uuid, abort)
            await asyncio.sleep(0.001)
