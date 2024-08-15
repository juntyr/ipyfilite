#!/usr/bin/env python
# coding: utf-8

# Copyright (c) Juniper Tyree.
# Distributed under the terms of the Modified BSD License.

try:
    import js  # noqa: F401
    import pyodide  # noqa: F401
    import pyodide_js  # noqa: F401
except ImportError:
    from .native import FileUploadLite  # noqa: F401
else:
    from .pyodide import FileUploadLite  # noqa: F401
