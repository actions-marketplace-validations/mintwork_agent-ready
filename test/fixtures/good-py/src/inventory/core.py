from __future__ import annotations


class Inventory:
    def __init__(self) -> None:
        self._items: dict[str, int] = {}

    def add(self, name: str, qty: int = 1) -> None:
        self._items[name] = self._items.get(name, 0) + qty

    def count(
        self,
        name: str,
    ) -> int:
        return self._items.get(name, 0)


async def load(path: str) -> Inventory:
    return Inventory()
