from pathlib import Path

def _setup_pyodide_file_upload_channel():
    import js
    import pyodide
    import pyodide_js

    if getattr(js, "ipyfilite", None) is not None:
        return

    def files_upload_callback(event):
        # FIXME: only continue if the session matches
        
        if not getattr(event, "data", None) or not getattr(event.data, "files", None) or not getattr(event.data, "uuid", None):
            return
        
        upload_path = Path("/uploads") / event.data.uuid
        upload_path.mkdir(parents=True, exist_ok=False)
        
        pyodide_js.FS.mount(
            pyodide_js.FS.filesystems.WORKERFS,
            pyodide.ffi.to_js({ "files": event.data.files }, dict_converter=js.Object.fromEntries, create_pyproxies=False),
            str(upload_path),
        )
    
    js.ipyfilite = js.Reflect.construct(js.BroadcastChannel, ["ipyfilite"])
    js.ipyfilite.onmessage = files_upload_callback
