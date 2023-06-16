Object.create({
    mount: function(mount /* ignored */) {
        const node = this._pyodide.FS.createNode(
            null, "/", 0o40000 /* S_IFDIR */ | 0o777 /* a=rwx */,
        );
        node.node_ops = this.node_ops;
        node.stream_ops = this.stream_ops;
        node.size = 4096;
        node.timestamp = Date.now();
        node._downloads = {};
        node._pre_downloads = {};
        node._pyodide = this._pyodide;
        node._channel = this._channel;
        node._backlog = this._backlog;
        return node;
    },
    create_download: function(parent, uuid, filename) {
        const channel = new MessageChannel();
        channel.port1.start();
        parent._channel.postMessage({
            kind: "download",
            name: filename,
            channel: channel.port2,
        }, [channel.port2]);
        parent._pre_downloads[uuid] = { channel: channel.port1 };
        return `${parent.mount.mountpoint}/${uuid}`;
    },
    close_download: function(parent, uuid) {
        if (parent._pre_downloads[uuid] !== undefined) {
            parent._pre_downloads[uuid].channel.postMessage({ kind: "close" });
            parent._pre_downloads[uuid].channel.close();
            delete parent._pre_downloads[uuid];
            return;
        }
        const node = parent._downloads[uuid];
        if (node._opened !== false) {
            throw new parent._pyodide.FS.ErrnoError(
                parent._pyodide.ERRNO_CODES.EEXIST
            );
        }
        node._channel.postMessage({ kind: "close" });
        node._channel.close();
        parent._pyodide.FS.destroyNode(node);
        delete parent._downloads[uuid];
    },
    node_ops: {
        getattr: function(node) {
            return {
                dev: 1,
                ino: node.id,
                mode: node.mode,
                nlink: 1,
                uid: 0,
                gid: 0,
                rdev: undefined,
                size: node.size,
                atime: new Date(node.timestamp),
                mtime: new Date(node.timestamp),
                ctime: new Date(node.timestamp),
                blksize: 4096,
                blocks: Math.ceil(node.size / 4096),
            };
        },
        setattr: function(node, attr) {
            if (attr.timestamp !== undefined) {
                node.timestamp = attr.timestamp;
            }
            if (attr.size !== undefined) {
                if (node.size !== attr.size) {
                    throw new node._pyodide.FS.ErrnoError(
                        node._pyodide.ERRNO_CODES.ESPIPE
                    );
                }
            }
            if (attr.mode !== undefined) {
                throw new node._pyodide.FS.ErrnoError(
                    node._pyodide.ERRNO_CODES.EPERM
                );
            }
        },
        readdir: function(node) {
            if (!(node.mode & 16384 /* S_IFDIR */)) {
                throw new node._pyodide.FS.ErrnoError(
                    node._pyodide.ERRNO_CODES.ENOTDIR
                );
            }
            const entries = ['.', '..'];
            for (const key in node._downloads) {
                if (!node._downloads.hasOwnProperty(key)) {
                    continue;
                }
                entries.push(key);
            }
            return entries;
        },
        lookup: function(parent, name /* ignored */) {
            throw new parent._pyodide.FS.ErrnoError(
                parent._pyodide.ERRNO_CODES.ENOENT
            );
        },
        mknod: (parent, name, mode, dev /* ignored */) => {
            if (!parent._pyodide.FS.isFile(mode)) {
                throw new parent._pyodide.FS.ErrnoError(
                    parent._pyodide.ERRNO_CODES.EINVAL
                );
            }
            const uuid = name;
            if (parent._pre_downloads[uuid] === undefined) {
                throw new parent._pyodide.FS.ErrnoError(
                    parent._pyodide.ERRNO_CODES.EPERM
                );
            }
            const { channel } = parent._pre_downloads[uuid];
            const node = parent._pyodide.FS.createNode(
                parent, uuid, 0o100000 /* S_IFREG */ | 0o222 /* a=w */,
            );
            node.node_ops = parent.node_ops;
            node.stream_ops = parent.stream_ops;
            node.size = 0;
            node.timestamp = Date.now();
            node.parent.timestamp = node.timestamp;
            node._opened = false;
            node._pyodide = parent._pyodide;
            node._backlog = parent._backlog;
            node._channel = channel;
            node._channel.postMessage({ kind: "create" });
            parent._downloads[uuid] = node;
            delete parent._pre_downloads[uuid];
            return node;
        },
    },
    stream_ops: {
        open: function(stream) {
            if (stream.node._pyodide.FS.isDir(stream.node.mode)) {
                return;
            }
            if (stream.node._opened !== false) {
                throw new stream.node._pyodide.FS.ErrnoError(
                    stream.node._pyodide.ERRNO_CODES.EEXIST
                );
            }
            stream.node._opened = true;
        },
        write: function(
            stream, buffer, offset, length, position /* ignored */,
        ) {
            if (stream.node._opened !== true) {
                throw new stream.node._pyodide.FS.ErrnoError(
                    stream.node._pyodide.ERRNO_CODES.ENODEV
                )
            };
            const BACKLOG_LIMIT = 1024 * 1024 * 16;
            let backlog = Atomics.add(stream.node._backlog, 0, length);
            while (backlog >= BACKLOG_LIMIT) {
                backlog = Atomics.sub(stream.node._backlog, 0, length) - length;
                if (backlog >= BACKLOG_LIMIT) {
                    if (Atomics.wait(
                        stream.node._backlog, 0, backlog, 1000,
                    ) === "timed-out") {
                        // back off and allow the user-code to re-engage
                        return 0;
                    }
                }
                backlog = Atomics.add(stream.node._backlog, 0, length);
            }
            // TODO: support some write coalescing to reduce the number of messages
            stream.node.size += length;
            stream.node.timestamp = Date.now();
            stream.node._channel.postMessage({
                kind: "chunk",
                chunk: buffer.slice(offset, offset+length),
            });
            return length;
        },
        close: function(stream) {
            if (stream.node._pyodide.FS.isDir(stream.node.mode)) {
                return;
            }
            if (stream.node._opened !== true) {
                throw new stream.node._pyodide.FS.ErrnoError(
                    stream.node._pyodide.ERRNO_CODES.ENODEV
                )
            };
            stream.node._opened = false;
        },
        llseek: function(stream, offset, whence) {
            // Only allow seeks
            // - on directories
            // - CUR + 0: needed for tell
            // - END + 0: needed for append
            if (
                !stream.node._pyodide.FS.isDir(stream.node.mode) &&
                !(
                    (offset === 0 && whence === 1) ||
                    (offset === 0 && whence === 2)
                )
            ) {
                throw new stream.node._pyodide.FS.ErrnoError(
                    stream.node._pyodide.ERRNO_CODES.ESPIPE
                );
            }
            let position = offset;
            if (whence === 1) {
                position += stream.position;
            } else if (whence === 2) {
                if (stream.node._pyodide.FS.isFile(stream.node.mode)) {
                    position += stream.node.size;
                }
            }
            if (position < 0) {
                throw new stream.node._pyodide.FS.ErrnoError(
                    stream.node._pyodide.ERRNO_CODES.EINVAL
                );
            }
            return position;
        },
    },
})
