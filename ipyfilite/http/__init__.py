import io
import urllib.request
import uuid
from enum import Enum
from pathlib import Path
from typing import Optional, Tuple

try:
    import js
    import pyodide
    import pyodide_js
except ImportError:
    _has_pyodide = False
else:
    _has_pyodide = True


AcceptRangesMode = Enum("AcceptRangesMode", ["OnlyExplicit", "AcceptMaybe"])


class HTTPFileIO(io.FileIO if _has_pyodide else io.BufferedReader):
    def __init__(
        self,
        url: str,
        name: str,
        range_mode: AcceptRangesMode = AcceptRangesMode.AcceptMaybe,
        buffer_size: int = io.DEFAULT_BUFFER_SIZE,
    ):
        self._url = url
        self._name = name

        if range_mode not in AcceptRangesMode:
            raise TypeError(
                "`range_mode` must be a variant of `AcceptRangesMode`"
            )

        if _has_pyodide:
            content_length, content_encoding, accept_ranges = (
                _get_content_length_encoding_accept_ranges_pyodide(url)
            )
        else:
            content_length, content_encoding, accept_ranges = (
                _get_content_length_encoding_accept_ranges_urllib(url)
            )

        if content_encoding is not None:
            content_length = None

        if content_length is None and accept_ranges == "bytes":
            if _has_pyodide:
                content_range = _get_content_range_pyodide(url)
            else:
                content_range = _get_content_range_urllib(url)

            # Content-Range: <unit> <range-start>-<range-end>/<size>
            # Content-Range: <unit> <range-start>-<range-end>/*
            # Content-Range: <unit> */<size>
            if (
                content_range is not None
                and content_range.startswith("bytes ")
                and "/" in content_range
                and not content_range.endswith("/*")
            ):
                content_length = int(content_range.rsplit("/", 1)[-1])

        if content_length is None:
            raise IndexError(f"Unknown HTTP file length for '{url}'")

        self._content_length = content_length

        if accept_ranges != "bytes":
            if accept_ranges is None:
                if range_mode == AcceptRangesMode.OnlyExplicit:
                    raise TypeError(
                        f"HTTP file at '{url}' does not advertise support for"
                        " range requests or is behind CORS"
                    )
            else:
                raise TypeError(
                    f"HTTP file at '{url}' does not support range requests"
                )

        if _has_pyodide:
            file = _RawHTTPBlobPyodide.new(
                self.url,
                self.name,
                content_length,
                buffer_size,
                pyodide_js,
            )

            http_path = Path("/http") / str(uuid.uuid4())
            http_path.mkdir(parents=True, exist_ok=False)

            pyodide_js.FS.mount(
                pyodide_js.FS.filesystems.WORKERFS,
                pyodide.ffi.to_js(
                    {
                        "blobs": [
                            {"name": self.name, "data": file},
                        ]
                    },
                    dict_converter=js.Object.fromEntries,
                    create_pyproxies=False,
                ),
                str(http_path),
            )

            self._path = http_path / self.name

            super().__init__(self.path, mode="r", closefd=True)
        else:
            file = _RawHTTPFileUrllib(self.url, content_length)

            super().__init__(file, buffer_size=buffer_size)

    @property
    def url(self) -> str:
        return self._url

    @property
    def name(self) -> str:
        return self._name

    @property
    def mode(self) -> str:
        return "r"

    if _has_pyodide:

        @property
        def path(self) -> Path:
            return self._path

        @name.setter
        def name(self, name: str):
            pass

        @mode.setter
        def mode(self, mode: str):
            pass


def _get_content_length_encoding_accept_ranges_pyodide(
    url: str,
) -> Tuple[Optional[int], Optional[str], Optional[str]]:
    xhr = js.XMLHttpRequest.new()
    xhr.open("HEAD", url, False)
    xhr.send(None)

    content_length = xhr.getResponseHeader("content-length")
    content_length = int(content_length) if content_length else None

    accept_ranges = xhr.getResponseHeader("accept-ranges")
    accept_ranges = accept_ranges.lower() if accept_ranges else None

    content_encoding = xhr.getResponseHeader("content-encoding")
    content_encoding = content_encoding.lower() if content_encoding else None

    return (content_length, content_encoding, accept_ranges)


def _get_content_length_encoding_accept_ranges_urllib(
    url: str,
) -> Tuple[Optional[int], Optional[str], Optional[str]]:
    with urllib.request.urlopen(
        urllib.request.Request(url, method="HEAD")
    ) as response:
        content_length = response.getheader("content-length", None)
        content_length = int(content_length) if content_length else None

        accept_ranges = response.getheader("accept-ranges", None)
        accept_ranges = accept_ranges.lower() if accept_ranges else None

        content_encoding = response.getheader("content-encoding", None)
        content_encoding = (
            content_encoding.lower() if content_encoding else None
        )

    return (content_length, content_encoding, accept_ranges)


def _get_content_range_pyodide(
    url: str,
) -> Optional[str]:
    xhr = js.XMLHttpRequest.new()
    xhr.open("GET", url, False)
    xhr.setRequestHeader("range", "bytes=0-1")
    xhr.send(None)

    if xhr.status != 416:
        return None

    content_range = xhr.getResponseHeader("content-range")
    content_range = content_range.lower() if content_range else None

    return content_range


def _get_content_range_urllib(
    url: str,
) -> Optional[str]:
    with urllib.request.urlopen(
        urllib.request.Request(
            url,
            method="GET",
            headers={
                "range": "bytes=0-1",
            },
        )
    ) as response:
        if response.status != 416:
            return None

        content_range = response.getheader("content-range", None)
        content_range = content_range.lower() if content_range else None

    return content_range


if _has_pyodide:
    _RawHTTPBlobPyodide = pyodide.code.run_js(
        (Path(__file__).parent / "blob.js").read_text()
    )


class _RawHTTPFileUrllib(io.RawIOBase):
    def __init__(self, url: str, content_length: int):
        super().__init__()

        self._url = url
        self._content_length = content_length
        self._pos = 0

    def seek(self, offset: int, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self._pos = 0
        elif whence == io.SEEK_CUR:
            pass
        elif whence == io.SEEK_END:
            self._pos = self._content_length

        self._pos += offset

        return self._pos

    def seekable(self):
        return True

    def readable(self):
        return not self.closed

    def writable(self):
        return False

    def read(self, size=-1):
        if size == 0 or self._pos >= self._content_length:
            return b""

        if size < 0:
            end = self._content_length - 1
        else:
            end = min(self._pos + size - 1, self._content_length - 1)
            size = end - self._pos + 1

        with urllib.request.urlopen(
            urllib.request.Request(
                self._url,
                headers={
                    "range": f"bytes={self._pos}-{max(self._pos+1, end)}",
                },
                method="GET",
            )
        ) as response:
            if response.status == 200:
                raise TypeError(
                    f"HTTP file at '{self._url}' does not support range"
                    " requests"
                )
            if response.status == 416:
                return b""

            content = response.read()
            if len(content) > size:
                content = content[:size]
            self._pos += len(content)

            return content

    def readall(self):
        return self.read(-1)

    def readinto(self, b):
        content = self.read(len(b))
        b[: len(content)] = content
        return len(content)

    def tell(self):
        return self._pos
