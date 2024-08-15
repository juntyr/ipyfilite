#!/usr/bin/env python
# coding: utf-8

# Copyright (c) Juniper Tyree.
# Distributed under the terms of the Modified BSD License.

from pathlib import Path


class FileUploadLite:
    def __init__(self, accept="", multiple=False):
        self.accept = accept
        self.multiple = multiple
        self.value = tuple()

    async def request(self):
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()

        if self.multiple:
            paths = filedialog.askopenfilenames(accept=self.accept)
        else:
            paths = [filedialog.askopenfilename(accept=self.accept)]

        self.value = tuple(dict(name=Path(path).name, path=Path(path)) for path in paths)

        return self.value

    def close(self):
        pass
