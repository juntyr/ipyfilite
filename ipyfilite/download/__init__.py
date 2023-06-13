import uuid

from .._manager import IpyfiliteManager


class FileDownloadPathLite:
    def __init__(self, name: str):
        self._name = name
        self._uuid = str(uuid.uuid4())

    def __enter__(self):
        return IpyfiliteManager.instance().register_download(
            self._uuid, self._name
        )

    def __exit__(self, exc_type, exc_val, exc_tb):
        IpyfiliteManager.instance().unregister_download(self._uuid)
        return False

    @property
    def name(self):
        return self._name
