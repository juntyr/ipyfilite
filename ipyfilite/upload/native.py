#!/usr/bin/env python
# coding: utf-8

# Copyright (c) Juniper Tyree.
# Distributed under the terms of the Modified BSD License.

from pathlib import Path


class FileUploadLite:
    def __init__(self):
        self.value = tuple()

    async def request(self):
        path = input("Enter filepath:")

        self.value = (dict(name=Path(path).name, path=Path(path)),)

        return self.value

    def close(self):
        pass
