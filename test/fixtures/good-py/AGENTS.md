# AGENTS.md

## Commands

```bash
pip install -e .   # install
pytest             # run tests
ruff check .       # lint
mypy src           # typecheck (strict)
```

Build: `python -m build` produces a wheel.

## Architecture

- `src/inventory/` — the package; `src/inventory/core.py` holds the `Inventory` class.
- `tests/` — pytest tests.
