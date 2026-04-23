from functools import lru_cache
from pathlib import Path
import csv

from api.models import TreeOption


TREE_DATA_PATH = Path(__file__).with_name("treedata.csv")


def _parse_optional_float(value: str):
    value = (value or "").strip()
    return float(value) if value else None


@lru_cache(maxsize=1)
def load_tree_catalog() -> list[TreeOption]:
    with TREE_DATA_PATH.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    options: list[TreeOption] = []
    for row in rows:
        canopy_m = float(row["estimated_canopy_m"])
        options.append(
            TreeOption(
                tree_option_id=row["tree_option_id"],
                common_name=row["common_name"],
                scientific_name=row["scientific_name"],
                size_label=row["size_label"],
                size_gallon=_parse_optional_float(row["size_gallon"]),
                size_caliper_inches=_parse_optional_float(row["size_caliper_inches"]),
                size_classification=row["size_classification"],
                estimated_diameter_m=float(row["estimated_diameter_m"]),
                estimated_canopy_m=canopy_m,
                cost_usd=float(row["cost_usd"]),
                inventory=int(row["inventory"]),
                # Converts canopy width into a conservative fractional canopy gain
                # that stays in the same rough scale as the original optimizer.
                canopy_gain=round(canopy_m / 10000.0, 5),
            )
        )

    return options


@lru_cache(maxsize=1)
def load_tree_catalog_map() -> dict[str, TreeOption]:
    return {option.tree_option_id: option for option in load_tree_catalog()}
