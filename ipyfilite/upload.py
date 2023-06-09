#!/usr/bin/env python
# coding: utf-8

# Copyright (c) Juniper Tyree.
# Distributed under the terms of the Modified BSD License.

"""
FileUpload class.

Represents a file upload button.
"""

import asyncio
import datetime as dt
from pathlib import Path

from ipywidgets import (
    ButtonStyle,
    TypedTuple,
    ValueWidget,
    register,
    widget_serialization,
)
from ipywidgets.widgets.trait_types import InstanceDict
from ipywidgets.widgets.widget_description import DescriptionWidget
from traitlets import Bool, Bunch, CaselessStrEnum, Dict, Unicode, default

from ._frontend import module_name, module_version
from ._manager import IpyfiliteManager


def _deserialize_single_file(js):
    uploaded_file = Bunch()
    for attribute in ["name", "type", "size"]:
        uploaded_file[attribute] = js[attribute]
    uploaded_file["last_modified"] = dt.datetime.fromtimestamp(
        js["last_modified"] / 1000, tz=dt.timezone.utc
    )
    uploaded_file["path"] = Path(js["path"])
    return uploaded_file


def _deserialize_value(js, _):
    return [_deserialize_single_file(entry) for entry in js]


def _serialize_single_file(uploaded_file):
    js = {}
    for attribute in ["name", "type", "size"]:
        js[attribute] = uploaded_file[attribute]
    js["last_modified"] = int(
        uploaded_file["last_modified"].timestamp() * 1000
    )
    js["path"] = str(uploaded_file["path"])
    return js


def _serialize_value(value, _):
    return [_serialize_single_file(entry) for entry in value]


_value_serialization = {
    "from_json": _deserialize_value,
    "to_json": _serialize_value,
}


@register
class FileUploadLite(DescriptionWidget, ValueWidget):
    """File upload widget for Pyodide running in JupyterLite

    This creates a file upload input that allows the user to select
    one or more files to upload. The file metadata and the paths at
    which the file has been mounted in read-only mode can be
    retrieved in the kernel.

    Examples
    --------

    >>> import ipyfilite
    >>> uploader = ipyfilite.FileUploadLite()
    >>> uploader

    # After displaying `uploader` and uploading a file:

    >>> uploader.value
    (
        {
            'name': 'example.txt',
            'type': 'text/plain',
            'size': 36,
            'last_modified': datetime.datetime(
                2023, 5, 25, 9, 31, 1, 818000, tzinfo=datetime.timezone.utc,
            ),
            'path': PosixPath(
                '/uploads/68e7b75a-f3e3-40d4-aef9-98b5b4c842d3/example.txt',
            ),
        },
    )
    >>> with open(uploader.value[0].path, "rb") as file:
    >>>     print(file.read())
    b'This is the content of example.txt.\n'

    Parameters
    ----------

    accept: str, optional
        Which file types to accept, e.g. '.doc,.docx'. For a full
        description of how to specify this, see
        https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file#attr-accept
        Defaults to accepting all file types.

    multiple: bool, optional
        Whether to accept multiple files at the same time. Defaults to False.

    disabled: bool, optional
        Whether user interaction is enabled.

    icon: str, optional
        The icon to use for the button displayed on the screen.
        Can be any Font-awesome icon without the fa- prefix.
        Defaults to 'upload'. If missing, no icon is shown.

    description: str, optional
        The text to show on the label. Defaults to 'Upload'.

    button_style: str, optional
        One of 'primary', 'success', 'info', 'warning', 'danger' or ''.

    style: widgets.widget_button.ButtonStyle, optional
        Style configuration for the button.

    value: Tuple[Dict], optional
        The value of the last uploaded file or set of files. See the
        example above for details of how to use this to retrieve file
        content and metadata.
    """

    # Name of the widget model class in front-end
    _model_name = Unicode("FileUploadLiteModel").tag(sync=True)
    _model_module = Unicode(module_name).tag(sync=True)
    _model_module_version = Unicode(module_version).tag(sync=True)

    # Name of the widget view class in front-end
    _view_name = Unicode("FileUploadLiteView").tag(sync=True)
    _view_module = Unicode(module_name).tag(sync=True)
    _view_module_version = Unicode(module_version).tag(sync=True)

    _session = Unicode(
        str(IpyfiliteManager.instance().session), read_only=True
    ).tag(sync=True)

    # Widget specific propertyies, which are defined as traitlets.
    # Any property tagged with `sync=True` is automatically synced to the
    # frontend *any* time it changes in Python. It is synced back to Python
    # from the frontend *any* time the model is touched.
    accept = Unicode(help="File types to accept, empty string for all").tag(
        sync=True
    )
    multiple = Bool(help="If True, allow for multiple files upload").tag(
        sync=True
    )
    disabled = Bool(help="Enable or disable button").tag(sync=True)
    icon = Unicode(
        "upload", help="Font-awesome icon name, without the 'fa-' prefix."
    ).tag(sync=True)
    button_style = CaselessStrEnum(
        values=["primary", "success", "info", "warning", "danger", ""],
        default_value="",
        help="Use a predefined styling for the button.",
    ).tag(sync=True)
    style = InstanceDict(ButtonStyle).tag(sync=True, **widget_serialization)
    value = TypedTuple(
        Dict(), read_only=True, help="The file upload value"
    ).tag(
        sync=True,
        echo_update=False,
        **_value_serialization,
    )

    @default("description")
    def _default_description(self):
        return "Upload"

    def __init__(self):
        super().__init__()
        IpyfiliteManager.instance().register_upload(self)

    async def request(self):
        from IPython.display import display

        display(self)

        future = asyncio.Future()
        self.observe(future.set_result, "value")
        await future
        self.unobserve(future.set_result, "value")

        return self.value

    def __del__(self):
        IpyfiliteManager.instance().unregister_upload(self)
        super().__del__()
