#!/usr/bin/env python
# coding: utf-8

# Copyright (c) Juniper Tyree.
# Distributed under the terms of the Modified BSD License.

from ..upload import FileUploadLite


def test_upload_creation_blank():
    u = FileUploadLite()
    assert u.value == ()
