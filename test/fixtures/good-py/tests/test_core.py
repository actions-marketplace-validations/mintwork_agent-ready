from inventory import Inventory


def test_add() -> None:
    inv = Inventory()
    inv.add("apple", 2)
    assert inv.count("apple") == 2
