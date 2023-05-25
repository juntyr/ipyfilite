import uuid
import warnings
from pathlib import Path


def _setup_pyodide_file_upload_channel() -> str:
    try:
        import js
        import pyodide
        import pyodide_js
    except ImportError:
        warnings.warn(
            "ipyfilite only works inside a Pyodide kernel in JupyterLite",
            FutureWarning,
        )

        return str(uuid.uuid4())

    if getattr(js, "ipyfilite", None) is not None:
        return js.ipyfilite.session

    def files_upload_callback(event):
        if (
            not getattr(event, "data", None)
            or not getattr(event.data, "files", None)
            or not getattr(event.data, "uuid", None)
            or not getattr(event.data, "session", None)
        ):
            return

        if event.data.session != js.ipyfilite.session:
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

    js.ipyfilite = pyodide.ffi.to_js(
        {
            "channel": js.Reflect.construct(
                js.BroadcastChannel,
                pyodide.ffi.to_js(["ipyfilite"]),
            ),
            "session": str(uuid.uuid4()),
        },
        dict_converter=js.Object.fromEntries,
        create_pyproxies=False,
    )
    js.ipyfilite.channel.onmessage = files_upload_callback

    return js.ipyfilite.session
