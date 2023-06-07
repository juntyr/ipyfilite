from __future__ import annotations

import asyncio
import uuid
import warnings
from pathlib import Path

from IPython import get_ipython
from traitlets import Instance
from traitlets.config import SingletonConfigurable


class IpyfiliteManager(SingletonConfigurable):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        self._session = uuid.uuid4()
        self._upload_futures = dict()

        try:
            import js  # noqa: F401
            import pyodide  # noqa: F401
            import pyodide_js  # noqa: F401
        except ImportError:
            warnings.warn(
                "ipyfilite only works inside a Pyodide kernel in JupyterLite",
                FutureWarning,
            )
        else:
            self._channel = js.BroadcastChannel.new("ipyfilite")
            self._channel.onmessage = self._on_file_upload

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

    async def wait_for_upload_value(self, widget):
        widget_id = widget._model_id

        if widget_id not in self._upload_futures:
            self._upload_futures[widget_id] = []

        future = asyncio.Future()
        self._upload_futures[widget_id].append(future)
        return await future

    def _on_file_upload(self, event):
        import js
        import pyodide
        import pyodide_js

        if (
            not getattr(event, "data", None)
            or not getattr(event.data, "files", None)
            or not getattr(event.data, "uuid", None)
            or not getattr(event.data, "session", None)
            or not getattr(event.data, "widget", None)
        ):
            return

        if event.data.session != str(self.session):
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

        futures = self._upload_futures.get(event.data.widget, [])

        value = [
            {
                "name": file.name,
                "type": file.type,
                "size": file.size,
                "last_modified": file.lastModified,
                "path": str(upload_path / file.name),
            }
            for file in event.data.files
        ]

        for future in futures:
            future.set_result(value)

        self._upload_futures.pop(event.data.widget, None)
