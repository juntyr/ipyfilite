
# ipyfilite &emsp; [![PyPi]][pypi-url] [![NPM]][npm-url] [![License BSD-3-Clause]][bsd-3] [![CI Status]][ci-status]

[PyPI]: https://img.shields.io/pypi/v/ipyfilite
[pypi-url]: https://pypi.org/project/ipyfilite

[NPM]: https://img.shields.io/npm/v/ipyfilite
[npm-url]: https://www.npmjs.com/package/ipyfilite

[License BSD-3-Clause]: https://img.shields.io/badge/License-BSD_3--Clause-blue.svg
[bsd-3]: https://opensource.org/licenses/BSD-3-Clause

[CI Status]: https://img.shields.io/github/actions/workflow/status/juntyr/phepy/ci.yml?branch=main&label=CI
[ci-status]: https://github.com/juntyr/phepy/actions/workflows/ci.yml?query=branch%3Amain


File upload widget specifically for Pyodide kernels running in JupyterLite. Uploaded files are not loaded into memory but mounted as read-only files in a new WORKERFS.

## Installation

You can install using `pip`:

```bash
pip install ipyfilite
```

If you are using Jupyter Notebook 5.2 or earlier, you may also need to enable
the nbextension:
```bash
jupyter nbextension enable --py [--sys-prefix|--user|--system] ipyfilite
```

## Development Installation

Create a dev environment:
```bash
conda create -n ipyfilite-dev -c conda-forge nodejs yarn python jupyterlab
conda activate ipyfilite-dev
```

Install the python. This will also build the TS package.
```bash
pip install -e ".[test, examples]"
```

When developing your extensions, you need to manually enable your extensions with the
notebook / lab frontend. For lab, this is done by the command:

```
jupyter labextension develop --overwrite .
yarn run build
```

For classic notebook, you need to run:

```
jupyter nbextension install --sys-prefix --symlink --overwrite --py ipyfilite
jupyter nbextension enable --sys-prefix --py ipyfilite
```

Note that the `--symlink` flag doesn't work on Windows, so you will here have to run
the `install` command every time that you rebuild your extension. For certain installations
you might also need another flag instead of `--sys-prefix`, but we won't cover the meaning
of those flags here.

### How to see your changes
#### Typescript:
If you use JupyterLab to develop then you can watch the source directory and run JupyterLab at the same time in different
terminals to watch for changes in the extension's source and automatically rebuild the widget.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
yarn run watch
# Run JupyterLab in another terminal
jupyter lab
```

After a change wait for the build to finish and then refresh your browser and the changes should take effect.

#### Python:
If you make a change to the python code then you will need to restart the notebook kernel to have it take effect.

## Updating the version

To update the version, install tbump and use it to bump the version.
By default it will also create a tag.

```bash
pip install tbump
tbump <new-version>
```

## Funding

`ipyfilite` has been developed as part of [ESiWACE3](https://www.esiwace.eu), the third phase of the Centre of Excellence in Simulation of Weather and Climate in Europe.

Funded by the European Union. This work has received funding from the European High Performance Computing Joint Undertaking (JU) under grant agreement No 101093054.
