"""Example audience functions for spec/examples/messages/*.yml.

In your app, this file lives at plgkit/audiences.py.
Each function's name is what a message's `audience` lists in YAML.
PLGKit calls each one with the same `context` you pass to decide(),
and sends only the True/False result to the core. Your user object
never leaves your app.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any, Optional


# Example shapes. Use whatever your app already has.
@dataclass
class User:
    id: str
    username: str
    country_code: str  # ISO 3166-1 alpha-2, e.g. "US"
    birth_date: Optional[date] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    species: str = "human"
    is_staff: bool = False


@dataclass
class Context:
    user: User
    req: Any = None  # your framework's request object, if you need it


def _age_in_years(birth_date: date, today: Optional[date] = None) -> int:
    today = today or date.today()
    before_birthday = (today.month, today.day) < (birth_date.month, birth_date.day)
    return today.year - birth_date.year - int(before_birthday)


def is_human(ctx: Context) -> bool:
    return ctx.user.species == "human"


def is_adult(ctx: Context) -> bool:
    if ctx.user.birth_date is None:
        return False
    return _age_in_years(ctx.user.birth_date) >= 18


def is_usa_resident(ctx: Context) -> bool:
    return ctx.user.country_code == "US"


def is_uk_resident(ctx: Context) -> bool:
    return ctx.user.country_code == "GB"


def is_staff(ctx: Context) -> bool:
    return ctx.user.is_staff


def is_duck(ctx: Context) -> bool:
    return ctx.user.species == "duck"


audiences = {
    "is_human": is_human,
    "is_adult": is_adult,
    "is_usa_resident": is_usa_resident,
    "is_uk_resident": is_uk_resident,
    "is_staff": is_staff,
    "is_duck": is_duck,
}
