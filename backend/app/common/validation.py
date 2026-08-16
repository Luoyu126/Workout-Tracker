def stripped_non_blank(value: str | None) -> str | None:
    if value is None:
        return None
    stripped_value = value.strip()
    if not stripped_value:
        raise ValueError("value must not be blank")
    return stripped_value


def stripped_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped_value = value.strip()
    return stripped_value or None
