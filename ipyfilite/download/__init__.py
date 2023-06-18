import uuid

from .._manager import IpyfiliteManager


class FileDownloadPathLite:
    def __init__(self, name: str):
        self._name = name
        self._uuid = str(uuid.uuid4())

    async def __aenter__(self):
        return await IpyfiliteManager.instance().register_download(
            self._uuid, self._name
        )

    async def __aexit__(self, exc_type, exc_value, traceback):
        await IpyfiliteManager.instance().unregister_download(
            self._uuid, exc_value is not None
        )
        return False

    @property
    def name(self):
        return self._name
