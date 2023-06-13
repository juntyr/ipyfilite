class _RawHTTPBlobPyodide {
    constructor(url, name, content_length, buffer_size, js) {
        this._url = url;
        this._content_length = content_length;

        this._buffer_start = 0;
        this._buffer = null;
        this._buffer_size = buffer_size;

        this._js = js;
    }

    get size() {
        return this._content_length;
    }

    slice(start=0, end=this.size, contentType="") {
        if (end <= start) {
            return new Blob(undefined, { type: contentType });
        }

        if (this._buffer !== null) {
            if (
                start >= this._buffer_start &&
                end <= (this._buffer_start + this._buffer.size)
            ) {
                return this._buffer.slice(
                    start - this._buffer_start,
                    end - this._buffer_start,
                    contentType,
                );
            }
        }

        const new_start = Math.max(0, start);
        const new_end = Math.max(Math.min(
            Math.max(end - 1, start + this._buffer_size - 1),
            this._content_length - 1,
        ), start + 1);

        const xhr = new XMLHttpRequest();
        xhr.responseType = "blob";
        xhr.open("GET", this._url, false);
        xhr.setRequestHeader("range", `bytes=${start}-${new_end}`);
        xhr.send(null);

        if (xhr.status == 200) {
            throw new this._js.FS.ErrnoError(
                this._js.ERRNO_CODES.EOPNOTSUPP
            );
        }

        const response = xhr.response;

        const real_start = new_start;
        const real_end = real_start + response.size;

        this._buffer_start = Math.max(
            real_start, real_end - this._buffer_size,
        );
        this._buffer = response.slice(this._buffer_start - real_start);

        return response.slice(0, end-start, contentType);
    }
} _RawHTTPBlobPyodide
